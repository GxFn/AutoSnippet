#!/usr/bin/env node

/**
 * checksums 校验逻辑单元测试
 * 与 Swift asd-verify / scripts/verify-checksums.js 行为一致：非法路径、缺文件、错误哈希、无效 JSON 均失败。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '../..');
const KEY_FILES = ['bin/asnip.js', 'bin/ui.js', 'lib/writeGuard.js'];

function assert(cond, msg) {
	if (!cond) throw new Error(msg || 'Assertion failed');
}

function sha256Hex(filePath) {
	const content = fs.readFileSync(filePath);
	return crypto.createHash('sha256').update(content).digest('hex');
}

function runVerify(checksumsPath) {
	try {
		execSync(`node scripts/verify-checksums.js "${checksumsPath}"`, {
			cwd: projectRoot,
			stdio: 'pipe'
		});
		return true;
	} catch (_) {
		return false;
	}
}

function testValidChecksumsPass() {
	const tempDir = path.join(projectRoot, 'test', 'temp');
	fs.mkdirSync(tempDir, { recursive: true });
	const checksumsPath = path.join(tempDir, 'checksums-valid.json');
	const checksums = {};
	for (const rel of KEY_FILES) {
		const full = path.join(projectRoot, rel);
		assert(fs.existsSync(full), `KEY_FILE 不存在: ${rel}`);
		checksums[rel] = sha256Hex(full);
	}
	fs.writeFileSync(checksumsPath, JSON.stringify(checksums, null, 2), 'utf8');
	assert(runVerify(checksumsPath), '合法 checksums 应通过校验');
}

function testWrongHashFails() {
	const tempDir = path.join(projectRoot, 'test', 'temp');
	fs.mkdirSync(tempDir, { recursive: true });
	const checksumsPath = path.join(tempDir, 'checksums-wrong.json');
	const checksums = {};
	for (const rel of KEY_FILES) {
		const full = path.join(projectRoot, rel);
		checksums[rel] = sha256Hex(full);
	}
	checksums[KEY_FILES[0]] = '0'.repeat(64);
	fs.writeFileSync(checksumsPath, JSON.stringify(checksums, null, 2), 'utf8');
	assert(!runVerify(checksumsPath), '错误哈希应校验失败');
}

function testPathTraversalRejected() {
	const tempDir = path.join(projectRoot, 'test', 'temp');
	fs.mkdirSync(tempDir, { recursive: true });
	const checksumsPath = path.join(tempDir, 'checksums-traversal.json');
	const checksums = { '../package.json': '0'.repeat(64) };
	fs.writeFileSync(checksumsPath, JSON.stringify(checksums), 'utf8');
	assert(!runVerify(checksumsPath), '含 .. 的路径应被拒绝');
}

function testAbsolutePathRejected() {
	const tempDir = path.join(projectRoot, 'test', 'temp');
	fs.mkdirSync(tempDir, { recursive: true });
	const checksumsPath = path.join(tempDir, 'checksums-absolute.json');
	const checksums = { '/etc/passwd': '0'.repeat(64) };
	fs.writeFileSync(checksumsPath, JSON.stringify(checksums), 'utf8');
	assert(!runVerify(checksumsPath), '绝对路径应被拒绝');
}

function testInvalidJsonFails() {
	const tempDir = path.join(projectRoot, 'test', 'temp');
	fs.mkdirSync(tempDir, { recursive: true });
	const checksumsPath = path.join(tempDir, 'checksums-invalid.json');
	fs.writeFileSync(checksumsPath, 'not json {', 'utf8');
	assert(!runVerify(checksumsPath), '无效 JSON 应校验失败');
}

function testMissingFileFails() {
	const tempDir = path.join(projectRoot, 'test', 'temp');
	fs.mkdirSync(tempDir, { recursive: true });
	const checksumsPath = path.join(tempDir, 'checksums-missing.json');
	const checksums = {};
	for (const rel of KEY_FILES) {
		const full = path.join(projectRoot, rel);
		checksums[rel] = sha256Hex(full);
	}
	checksums['bin/nonexistent.js'] = '0'.repeat(64);
	fs.writeFileSync(checksumsPath, JSON.stringify(checksums), 'utf8');
	assert(!runVerify(checksumsPath), '清单中不存在的文件应校验失败');
}

function testGenerateThenVerify() {
	const tempDir = path.join(projectRoot, 'test', 'temp');
	fs.mkdirSync(tempDir, { recursive: true });
	const checksumsPath = path.join(tempDir, 'checksums-gen.json');
	const checksums = {};
	for (const rel of KEY_FILES) {
		const full = path.join(projectRoot, rel);
		assert(fs.existsSync(full), `KEY_FILE 不存在: ${rel}`);
		checksums[rel] = sha256Hex(full);
	}
	fs.writeFileSync(checksumsPath, JSON.stringify(checksums, null, 2), 'utf8');
	assert(runVerify(checksumsPath), '与 generate-checksums 同逻辑生成的清单应通过 verify');
}

/** 运行 node bin/asnip.js -v，返回 { stdout, stderr, exitCode } */
function runAsnipV(env = {}) {
	const fullEnv = { ...process.env, ...env };
	const sp = require('child_process').spawnSync('node', ['bin/asnip.js', '-v'], {
		cwd: projectRoot,
		encoding: 'utf8',
		env: fullEnv
	});
	return { stdout: sp.stdout || '', stderr: sp.stderr || '', exitCode: sp.status };
}

/** 入口校验：存在 checksums.json 时，未经过 asd-verify 应警告但可继续；ASD_STRICT_ENTRY=1 应拒跑；ASD_VERIFIED/ASD_SKIP 应无警告 */
function testEntryCheck() {
	const checksumsPath = path.join(projectRoot, 'checksums.json');
	if (!fs.existsSync(checksumsPath)) {
		console.log('跳过入口校验测试：checksums.json 不存在，请先 npm run generate-checksums');
		return;
	}
	// 无 ASD_VERIFIED：应有警告、exit 0
	const r0 = runAsnipV({});
	assert(r0.exitCode === 0, '无 ASD_VERIFIED 时应 exit 0');
	assert((r0.stderr || '').includes('未经过完整性校验') || (r0.stdout || '').includes('未经过完整性校验'), '无 ASD_VERIFIED 时应输出校验警告');

	// ASD_STRICT_ENTRY=1：应 exit 1
	const r1 = runAsnipV({ ASD_STRICT_ENTRY: '1' });
	assert(r1.exitCode === 1, 'ASD_STRICT_ENTRY=1 时应 exit 1');

	// ASD_VERIFIED=1：无警告、exit 0
	const r2 = runAsnipV({ ASD_VERIFIED: '1' });
	assert(r2.exitCode === 0, 'ASD_VERIFIED=1 时应 exit 0');
	assert(!(r2.stderr || r2.stdout || '').includes('未经过完整性校验'), 'ASD_VERIFIED=1 时不应输出校验警告');

	// ASD_SKIP_ENTRY_CHECK=1：无警告、exit 0
	const r3 = runAsnipV({ ASD_SKIP_ENTRY_CHECK: '1' });
	assert(r3.exitCode === 0, 'ASD_SKIP_ENTRY_CHECK=1 时应 exit 0');
	assert(!(r3.stderr || r3.stdout || '').includes('未经过完整性校验'), 'ASD_SKIP_ENTRY_CHECK=1 时不应输出校验警告');
}

testValidChecksumsPass();
testWrongHashFails();
testPathTraversalRejected();
testAbsolutePathRejected();
testInvalidJsonFails();
testMissingFileFails();
testGenerateThenVerify();
testEntryCheck();

console.log('checksums-verify.test.js 通过');
