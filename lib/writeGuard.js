/**
 * 写权限探针：在子仓库目录执行 git push --dry-run，通过后视为有权限；缓存仅进程内，不做文件存储。
 * 未配置探针目录时不启用，直接放行。
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const Paths = require('./infrastructure/config/Paths.js');
const ProjectStructure = require('./infrastructure/paths/ProjectStructure');

const DEFAULT_TTL_SECONDS = 86400; // 24 小时
const cache = new Map(); // key: projectRoot + writeDir, value: { passedAt }

/**
 * 获取探针目录（使用 ProjectStructure 统一管理，固定为 AutoSnippet/recipes）。
 * @param {string} projectRoot - 项目根目录
 * @returns {string} - 相对于项目根的 recipes 目录路径
 */
function getProbeDir(projectRoot) {
	// 返回相对路径，与 projectRoot 拼接后得到完整路径
	const fullPath = ProjectStructure.getRecipesDir(projectRoot);
	return path.relative(projectRoot, fullPath);
}

/**
 * 检查是否有写入权限（探针：子仓库内 git push --dry-run）。未配置探针目录时直接放行。
 * @param {string} projectRoot 项目根目录
 * @returns {{ ok: boolean, error?: string, debug?: object }}
 */
function checkWritePermission(projectRoot) {
	if (process.env.ASD_DISABLE_WRITE_GUARD === '1' || process.env.ASD_SKIP_WRITE_GUARD === '1') {
		return { ok: true, debug: { projectRoot, configured: false, result: 'disabled-by-env' } };
	}
	const writeDir = getProbeDir(projectRoot);
	const debug = {
		projectRoot,
		writeDir,
		configured: true  // 固定路径，始终已配置
	};

	if (!writeDir) {
		// 不可能发生，但保持防御性编程
		debug.result = 'no-config';
		return { ok: true, debug };
	}

	const probeDir = path.join(projectRoot, writeDir);
	const cacheKey = projectRoot + '\0' + writeDir;
	const ttlMs = (Number(process.env.ASD_PROBE_TTL_SECONDS) || DEFAULT_TTL_SECONDS) * 1000;

	const cached = cache.get(cacheKey);
	if (cached && (Date.now() - cached.passedAt) < ttlMs) {
		// 缓存命中：返回缓存的结果（ok 或 error）
		debug.result = 'cached';
		debug.cached = cached;
		debug.cacheExpireTime = new Date(cached.passedAt + ttlMs);
		return { ok: cached.ok, ...(cached.ok ? {} : { error: cached.error }), debug };
	}

	debug.probePath = probeDir;
	debug.pathExists = fs.existsSync(probeDir);
	debug.isDirectory = debug.pathExists && fs.statSync(probeDir).isDirectory();

	if (!debug.pathExists || !debug.isDirectory) {
		// 检查是否是 git submodule 残留配置问题
		const gitModulesPath = path.join(projectRoot, '.git', 'modules');
		const possibleOldPaths = ['Knowledge/recipes', 'recipes', 'Knowledge', 'AutoSnippet/recipes', 'AutoSnippet'];
		let foundOldModule = null;
		
		if (fs.existsSync(gitModulesPath)) {
			for (const oldPath of possibleOldPaths) {
				const oldModulePath = path.join(gitModulesPath, oldPath);
				if (fs.existsSync(oldModulePath)) {
					foundOldModule = oldPath;
					break;
				}
			}
		}
		
		if (foundOldModule) {
			const errorMsg = `检测到旧的 git submodule 配置残留 (.git/modules/${foundOldModule})，请先清理：
1. rm -rf .git/modules/${foundOldModule}
2. rm -rf ${foundOldModule}
3. git config --remove-section submodule.${foundOldModule} (如果存在)
4. 重新启动 Dashboard 并清除缓存`;
			const result = { ok: false, error: errorMsg };
			cache.set(cacheKey, { passedAt: Date.now(), ...result });
			debug.result = 'old-submodule-found';
			debug.oldModulePath = foundOldModule;
			console.error(`[writeGuard] ❌ 发现旧的 git submodule 配置: ${foundOldModule}`);
			console.error(`[writeGuard] 💡 清理命令: cd ${projectRoot} && rm -rf .git/modules/${foundOldModule} ${foundOldModule} && git config --remove-section submodule.${foundOldModule}`);
			return { ...result, debug };
		}
		
		// 尝试自动创建目录并初始化 git
		try {
			if (!debug.pathExists) {
				fs.mkdirSync(probeDir, { recursive: true });
				execSync('git init', { cwd: probeDir, stdio: 'pipe' });
				console.log(`[writeGuard] ✅ 自动创建探针目录并初始化 git: ${probeDir}`);
				debug.autoCreated = true;
				// 重新检查权限
				return checkWritePermission(projectRoot);
			}
		} catch (createError) {
			console.error(`[writeGuard] ⚠️ 无法自动创建目录: ${createError.message}`);
		}
		
		const errorMsg = !debug.pathExists 
			? `探针目录不存在: ${probeDir}` 
			: `${probeDir} 不是目录`;
		const result = { ok: false, error: errorMsg };
		cache.set(cacheKey, { passedAt: Date.now(), ...result });
		debug.result = 'path-not-found';
		console.error(`[writeGuard] ❌ 权限检查失败 - 路径问题: ${errorMsg}`);
		return { ...result, debug };
	}

	try {
		execSync('git push --dry-run', { cwd: probeDir, stdio: 'pipe', timeout: 15000 });
		const result = { ok: true };
		cache.set(cacheKey, { passedAt: Date.now(), ...result });
		debug.result = 'success';
		console.log(`[writeGuard] ✅ 权限检查通过: ${probeDir}`);
		return { ...result, debug };
	} catch (e) {
		const gitError = e.message.split('\n')[0];
		
		// 如果是因为没有 remote，视为权限通过
		if (gitError.includes('No configured push destination') || 
		    gitError.includes('no upstream branch') ||
		    gitError.includes('does not have any remotes') ||
		    e.stderr?.toString().includes('fatal: No configured push destination')) {
			const result = { ok: true };
			cache.set(cacheKey, { passedAt: Date.now(), ...result });
			debug.result = 'no-remote-allowed';
			debug.gitError = '没有配置 remote，视为本地开发环境，允许保存';
			console.log(`[writeGuard] ✅ 权限检查通过（无 remote）: ${probeDir}`);
			return { ...result, debug };
		}
		
		const errorMsg = `Git push 失败: ${gitError}`;
		const result = { ok: false, error: errorMsg };
		cache.set(cacheKey, { passedAt: Date.now(), ...result });
		debug.result = 'git-failed';
		debug.gitError = gitError;
		console.error(`[writeGuard] ❌ 权限检查失败 - Git 错误: ${errorMsg}`);
		return { ...result, debug };
	}
}

/**
 * 清空权限检查缓存（用于权限变更后强制重新检查）
 * @param {string} [projectRoot] 特定项目，未指定则清空全局缓存
 * @returns {{ cleared: number, message: string }}
 */
function clearCache(projectRoot) {
	let cleared = 0;

	if (projectRoot) {
		// 清空特定项目的缓存
		const keysToDelete = [];
		for (const key of cache.keys()) {
			if (key.startsWith(projectRoot)) {
				keysToDelete.push(key);
			}
		}
		cleared = keysToDelete.length;
		keysToDelete.forEach(k => cache.delete(k));
	} else {
		// 清空全局缓存
		cleared = cache.size;
		cache.clear();
	}

	return {
		cleared,
		message: `已清空 ${cleared} 条权限检查缓存记录`
	};
}

/**
 * 深度清除：同时清除内存缓存和 Node 模块缓存（需要后端调用）
 * @param {string} [projectRoot] 特定项目
 * @returns {{ cleared: number, modulesCleared: boolean, message: string }}
 */
function deepClearCache(projectRoot) {
	const result = clearCache(projectRoot);
	
	// 尝试清除 Node require 缓存中的相关模块
	let modulesCleared = false;
	try {
		const modulesToClear = [
			'./writeGuard.js',
			'../lib/writeGuard.js',
			'./lib/writeGuard.js'
		];
		
		for (const mod of modulesToClear) {
			for (const cacheKey in require.cache) {
				if (cacheKey.includes('writeGuard.js')) {
					delete require.cache[cacheKey];
					modulesCleared = true;
				}
			}
		}
	} catch (e) {
		// 忽略清除失败
	}

	return {
		cleared: result.cleared,
		modulesCleared,
		message: `已清空权限缓存。${modulesCleared ? '✅ Node 模块缓存已清除，无需重启 Dashboard。' : '⚠️ Node 模块缓存可能仍在使用，如问题未解决请重启 Dashboard。'}`
	};
}

module.exports = { checkWritePermission, getProbeDir, clearCache, deepClearCache };
