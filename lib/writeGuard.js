/**
 * 写权限探针：在子仓库目录执行 git push --dry-run，通过后视为有权限；缓存仅进程内，不做文件存储。
 * 未配置探针目录时不启用，直接放行。
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const DEFAULT_TTL_SECONDS = 86400; // 24 小时
const cache = new Map(); // key: projectRoot + writeDir, value: { passedAt }

/**
 * 获取探针目录（相对 projectRoot）。未配置则返回 null。
 * @param {string} projectRoot
 * @returns {string|null}
 */
function getProbeDir(projectRoot) {
	const fromEnv = process.env.ASD_RECIPES_WRITE_DIR;
	if (fromEnv && fromEnv.trim()) return fromEnv.trim();
	const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
	if (!fs.existsSync(rootSpecPath)) return null;
	try {
		const spec = JSON.parse(fs.readFileSync(rootSpecPath, 'utf8'));
		const fromSpec = spec.recipes?.writeDir;
		if (fromSpec && typeof fromSpec === 'string' && fromSpec.trim()) return fromSpec.trim();
	} catch (_) {}
	return null;
}

/**
 * 检查是否有写入权限（探针：子仓库内 git push --dry-run）。未配置探针目录时直接放行。
 * @param {string} projectRoot 项目根目录
 * @returns {{ ok: boolean, error?: string }}
 */
function checkWritePermission(projectRoot) {
	const writeDir = getProbeDir(projectRoot);
	if (!writeDir) return { ok: true };

	const probeDir = path.join(projectRoot, writeDir);
	const cacheKey = projectRoot + '\0' + writeDir;
	const ttlMs = (Number(process.env.ASD_PROBE_TTL_SECONDS) || DEFAULT_TTL_SECONDS) * 1000;

	const cached = cache.get(cacheKey);
	if (cached && (Date.now() - cached.passedAt) < ttlMs) {
		return { ok: true };
	}

	if (!fs.existsSync(probeDir) || !fs.statSync(probeDir).isDirectory()) {
		return { ok: false, error: '没权限' };
	}

	try {
		execSync('git push --dry-run', { cwd: probeDir, stdio: 'pipe', timeout: 15000 });
	} catch (_) {
		return { ok: false, error: '没权限' };
	}

	cache.set(cacheKey, { passedAt: Date.now() });
	return { ok: true };
}

module.exports = { checkWritePermission, getProbeDir };
