/**
 * Guard 违反项存储：读写 Knowledge/.autosnippet/guard-violations.json
 * 每次 // as:guard 产生一条 run，包含 filePath、triggeredAt、violations
 */

const fs = require('fs');
const path = require('path');

const VIOLATIONS_FILENAME = 'guard-violations.json';
const LOCK_FILENAME = 'guard-violations.lock';
const LOCK_RETRIES = 10;
const LOCK_RETRY_MS = 50;
const SCHEMA_VERSION = 1;
const MAX_RUNS = 200;

function getViolationsPath(projectRoot) {
	return path.join(projectRoot, 'Knowledge', '.autosnippet', VIOLATIONS_FILENAME);
}

function getLockPath(projectRoot) {
	return path.join(projectRoot, 'Knowledge', '.autosnippet', LOCK_FILENAME);
}

function ensureDir(projectRoot) {
	const dir = path.join(projectRoot, 'Knowledge', '.autosnippet');
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

/**
 * @param {string} projectRoot
 * @returns {{ schemaVersion: number, runs: Array<{ id: string, filePath: string, triggeredAt: string, violations: Array<{ ruleId: string, message: string, severity: string, line: number, snippet: string }> }> }}
 */
function getGuardViolations(projectRoot) {
	const p = getViolationsPath(projectRoot);
	try {
		const raw = fs.readFileSync(p, 'utf8');
		const data = JSON.parse(raw);
		if (data.schemaVersion !== SCHEMA_VERSION) {
			return { schemaVersion: SCHEMA_VERSION, runs: [] };
		}
		return {
			schemaVersion: data.schemaVersion,
			runs: Array.isArray(data.runs) ? data.runs : []
		};
	} catch (_) {
		return { schemaVersion: SCHEMA_VERSION, runs: [] };
	}
}

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
			const deadline = Date.now() + LOCK_RETRY_MS;
			while (Date.now() < deadline) {}
		}
	}
	if (!acquired) {
		throw new Error('guard-violations: 无法获取写锁');
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
 * 追加一次 Guard 运行记录
 * @param {string} projectRoot
 * @param {{ id: string, filePath: string, triggeredAt: string, violations: Array<{ ruleId: string, message: string, severity: string, line: number, snippet: string }> }} run
 */
function appendRun(projectRoot, run) {
	withLock(projectRoot, () => {
		const data = getGuardViolations(projectRoot);
		data.runs.unshift(run);
		if (data.runs.length > MAX_RUNS) {
			data.runs = data.runs.slice(0, MAX_RUNS);
		}
		fs.writeFileSync(getViolationsPath(projectRoot), JSON.stringify(data, null, 2), 'utf8');
	});
}

/**
 * 清空违反记录（可选，供前端「清空历史」）
 * @param {string} projectRoot
 */
function clearRuns(projectRoot) {
	withLock(projectRoot, () => {
		fs.writeFileSync(getViolationsPath(projectRoot), JSON.stringify({
			schemaVersion: SCHEMA_VERSION,
			runs: []
		}, null, 2), 'utf8');
	});
}

module.exports = {
	getGuardViolations,
	appendRun,
	clearRuns,
	getViolationsPath
};
