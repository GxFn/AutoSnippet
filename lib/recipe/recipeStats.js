/**
 * Recipe 使用统计与权威分：读写 {knowledgeBase}/.autosnippet/recipe-stats.json
 * 支持 byTrigger / byFile 双写，写前加锁，recordRecipeUsage 按 source 累加三档计数
 */

const fs = require('fs');
const path = require('path');
const Paths = require('../infrastructure/config/Paths');

const STATS_FILENAME = 'recipe-stats.json';
const LOCK_FILENAME = 'recipe-stats.lock';
const LOCK_RETRIES = 10;
const LOCK_RETRY_MS = 50;
const SCHEMA_VERSION = 1;

function getStatsPath(projectRoot) {
	return path.join(Paths.getProjectInternalDataPath(projectRoot), STATS_FILENAME);
}

function getLockPath(projectRoot) {
	return path.join(Paths.getProjectInternalDataPath(projectRoot), LOCK_FILENAME);
}

function ensureDir(projectRoot) {
	const dir = Paths.getProjectInternalDataPath(projectRoot);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

/**
 * @param {string} projectRoot
 * @returns {{ schemaVersion: number, byTrigger: Record<string, Entry>, byFile: Record<string, Entry> }}
 */
function getRecipeStats(projectRoot) {
	const p = getStatsPath(projectRoot);
	try {
		const raw = fs.readFileSync(p, 'utf8');
		const data = JSON.parse(raw);
		if (data.schemaVersion !== SCHEMA_VERSION) {
			return { schemaVersion: SCHEMA_VERSION, byTrigger: {}, byFile: {} };
		}
		return {
			schemaVersion: data.schemaVersion,
			byTrigger: data.byTrigger || {},
			byFile: data.byFile || {}
		};
	} catch (_) {
		return { schemaVersion: SCHEMA_VERSION, byTrigger: {}, byFile: {} };
	}
}

function defaultEntry() {
	return {
		guardUsageCount: 0,
		humanUsageCount: 0,
		aiUsageCount: 0,
		lastUsedAt: null,
		authority: 0
	};
}

function cloneEntry(entry) {
	return {
		guardUsageCount: entry.guardUsageCount || 0,
		humanUsageCount: entry.humanUsageCount || 0,
		aiUsageCount: entry.aiUsageCount || 0,
		lastUsedAt: entry.lastUsedAt || null,
		authority: entry.authority ?? 0
	};
}

function updateEntryForSource(entry, source) {
	const e = cloneEntry(entry);
	if (source === 'guard') e.guardUsageCount += 1;
	else if (source === 'human') e.humanUsageCount += 1;
	else if (source === 'ai') e.aiUsageCount += 1;
	e.lastUsedAt = new Date().toISOString();
	return e;
}

/**
 * 写前加锁：创建 .lock 文件，重试若干次后执行 fn()，完成后删除 .lock
 * @param {string} projectRoot
 * @param {() => void} fn
 */
function withLock(projectRoot, fn) {
	ensureDir(projectRoot);
	const lockPath = getLockPath(projectRoot);
	let acquired = false;
	for (let i = 0; i < LOCK_RETRIES; i++) {
		try {
			fs.writeFileSync(lockPath, process.pid + '\n' + Date.now(), { flag: 'wx' });
			acquired = true;
			break;
		} catch (_) {
			// 等待后重试
			const deadline = Date.now() + LOCK_RETRY_MS;
			while (Date.now() < deadline) {}
		}
	}
	if (!acquired) {
		throw new Error('recipe-stats: 无法获取写锁，请稍后重试');
	}
	try {
		fn();
	} finally {
		try {
			fs.unlinkSync(lockPath);
		} catch (_) {}
	}
}

/**
 * 记录一次 Recipe 使用
 * @param {string} projectRoot
 * @param {{ trigger?: string, recipeFilePath?: string, source: 'guard'|'human'|'ai' }} opts
 */
function recordRecipeUsage(projectRoot, opts) {
	const { trigger, recipeFilePath, source } = opts;
	if (!recipeFilePath && !trigger) return;
	const fileKey = recipeFilePath ? path.basename(recipeFilePath) : null;

	withLock(projectRoot, () => {
		const stats = getRecipeStats(projectRoot);
		const upd = (entry) => updateEntryForSource(entry || defaultEntry(), source);

		if (trigger) {
			stats.byTrigger[trigger] = upd(stats.byTrigger[trigger]);
		}
		if (fileKey) {
			stats.byFile[fileKey] = upd(stats.byFile[fileKey]);
		}
		fs.writeFileSync(getStatsPath(projectRoot), JSON.stringify(stats, null, 2), 'utf8');
	});
}

/**
 * 设置权威分 0～5
 * @param {string} projectRoot
 * @param {{ trigger?: string, recipeFilePath?: string }} key
 * @param {number} value 0～5
 */
function setAuthority(projectRoot, key, value) {
	const v = Math.max(0, Math.min(5, Number(value)));
	const trigger = key.trigger;
	const fileKey = key.recipeFilePath ? path.basename(key.recipeFilePath) : null;
	if (!trigger && !fileKey) return;

	withLock(projectRoot, () => {
		const stats = getRecipeStats(projectRoot);
		if (trigger) {
			const e = stats.byTrigger[trigger] || defaultEntry();
			stats.byTrigger[trigger] = { ...cloneEntry(e), authority: v };
		}
		if (fileKey) {
			const e = stats.byFile[fileKey] || defaultEntry();
			stats.byFile[fileKey] = { ...cloneEntry(e), authority: v };
		}
		fs.writeFileSync(getStatsPath(projectRoot), JSON.stringify(stats, null, 2), 'utf8');
	});
}

/**
 * 使用热度：usageHeat = w_guard * guard + w_human * human + w_ai * ai
 * @param {object} entry
 * @param {{ w_guard?: number, w_human?: number, w_ai?: number }} weights
 */
function getUsageHeat(entry, weights = {}) {
	const wg = weights.w_guard ?? 1;
	const wh = weights.w_human ?? 2;
	const wa = weights.w_ai ?? 1;
	return (entry.guardUsageCount || 0) * wg + (entry.humanUsageCount || 0) * wh + (entry.aiUsageCount || 0) * wa;
}

/**
 * 综合权威分：α * normalize(usageHeat) + (1-α) * (authority/5)
 * @param {object} entry
 * @param {object[]} allEntries 同维度所有条目（用于归一化 usageHeat）
 * @param {{ usageWeight?: number, w_guard?: number, w_human?: number, w_ai?: number }} weights
 */
function getAuthorityScore(entry, allEntries, weights = {}) {
	const α = weights.usageWeight ?? 0.5;
	const heat = getUsageHeat(entry, weights);
	const heats = (allEntries || []).map(e => getUsageHeat(e, weights));
	const maxHeat = Math.max(...heats, 1);
	const normHeat = heat / maxHeat;
	const authNorm = ((entry.authority ?? 0) / 5);
	return α * normHeat + (1 - α) * authNorm;
}

module.exports = {
	getRecipeStats,
	recordRecipeUsage,
	setAuthority,
	getUsageHeat,
	getAuthorityScore,
	getStatsPath
};
