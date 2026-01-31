#!/usr/bin/env node

/**
 * 恰当时机自动执行 asd embed
 * 触发时机：asd ui 启动时检测（无索引或 Recipe 变更）
 * 可通过 ASD_AUTO_EMBED=0 关闭
 */

const fs = require('fs');
const path = require('path');
const persistence = require('./persistence');
const paths = require('../infra/paths');
const defaults = require('../infra/defaults');

function getRecipesDir(projectRoot) {
	const specPath = path.join(projectRoot, defaults.ROOT_SPEC_FILENAME);
	if (!fs.existsSync(specPath)) return path.join(projectRoot, defaults.RECIPES_DIR);
	try {
		const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
		const dir = spec?.recipes?.dir || spec?.skills?.dir || defaults.RECIPES_DIR;
		return path.join(projectRoot, dir);
	} catch (_) {
		return path.join(projectRoot, defaults.RECIPES_DIR);
	}
}

function getRecipesMaxMtime(projectRoot) {
	const recipesDir = getRecipesDir(projectRoot);
	if (!fs.existsSync(recipesDir)) return 0;
	let max = 0;
	const walk = (dir) => {
		try {
			const entries = fs.readdirSync(dir, { withFileTypes: true });
			for (const e of entries) {
				const full = path.join(dir, e.name);
				if (e.isDirectory() && !e.name.startsWith('.')) {
					walk(full);
				} else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
					try {
						const stat = fs.statSync(full);
						if (stat.mtimeMs > max) max = stat.mtimeMs;
					} catch (_) {}
				}
			}
		} catch (_) {}
	};
	walk(recipesDir);
	return max;
}

/**
 * 是否需要执行 embed
 * @param {string} projectRoot
 * @returns {boolean}
 */
function shouldAutoEmbed(projectRoot) {
	if (process.env.ASD_AUTO_EMBED === '0') return false;
	const recipesMaxMtime = getRecipesMaxMtime(projectRoot);
	if (recipesMaxMtime === 0) return false;
	const manifestPath = persistence.getManifestPath && persistence.getManifestPath(projectRoot);
	const manifestExists = manifestPath && fs.existsSync(manifestPath);
	if (!manifestExists) return true;
	const manifest = persistence.readManifest(projectRoot);
	const lastEmbed = manifest.updatedAt || manifest.lastFullRebuild || 0;
	return lastEmbed === 0 || recipesMaxMtime > lastEmbed;
}

/**
 * 后台执行 embed，不阻塞
 * @param {string} projectRoot
 */
async function runAutoEmbed(projectRoot) {
	try {
		const IndexingPipeline = require('./IndexingPipeline');
		const result = await IndexingPipeline.run(projectRoot, { clear: false });
		console.log(`[AutoSnippet] ✅ 语义索引已自动更新（indexed: ${result.indexed}, skipped: ${result.skipped}）`);
	} catch (e) {
		console.warn(`[AutoSnippet] 语义索引自动更新失败: ${e.message}`);
	}
}

/**
 * 延迟调度：asd ui 启动后检查并在恰当时机执行 embed
 * @param {string} projectRoot
 * @param {number} delayMs 延迟毫秒，避免阻塞启动
 */
function scheduleAutoEmbed(projectRoot, delayMs = 5000) {
	setTimeout(() => {
		if (!shouldAutoEmbed(projectRoot)) return;
		runAutoEmbed(projectRoot);
	}, delayMs);
}

module.exports = {
	shouldAutoEmbed,
	runAutoEmbed,
	scheduleAutoEmbed
};
