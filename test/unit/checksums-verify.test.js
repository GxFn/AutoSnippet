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

testValidChecksumsPass();
testWrongHashFails();
testPathTraversalRejected();
testAbsolutePathRejected();
testInvalidJsonFails();
testMissingFileFails();
testGenerateThenVerify();

console.log('checksums-verify.test.js 通过');
