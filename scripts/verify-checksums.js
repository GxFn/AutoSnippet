#!/usr/bin/env node

/**
 * 校验 checksums.json：与 Swift asd-verify 逻辑一致，用于无 Swift 环境下的自测与 CI。
 * 规则：拒绝 relPath 含 ".." 或为绝对路径；校验每项 SHA-256（Node crypto，小写 hex）。
 * 用法：在项目根执行 node scripts/verify-checksums.js [path/to/checksums.json]
 * 退出码：0 通过，1 失败。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const checksumsPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : path.join(root, 'checksums.json');

function sha256Hex(filePath) {
	const content = fs.readFileSync(filePath);
	return crypto.createHash('sha256').update(content).digest('hex');
}

function verifyIntegrity(rootDir, checksumsFilePath) {
	let data;
	try {
		data = fs.readFileSync(checksumsFilePath, 'utf8');
	} catch (e) {
		console.error('asd: 无法读取 checksums.json');
		return false;
	}
	let json;
	try {
		json = JSON.parse(data);
	} catch (e) {
		console.error('asd: checksums.json 格式无效');
		return false;
	}
	if (typeof json !== 'object' || json === null || Array.isArray(json)) {
		console.error('asd: checksums.json 格式无效');
		return false;
	}
	const rootNorm = path.resolve(rootDir);
	for (const [relPath, expectedHex] of Object.entries(json)) {
		if (relPath.startsWith('/') || relPath.includes('..')) {
			console.error('asd: 校验拒绝非法路径:', relPath);
			return false;
		}
		const fullPath = path.resolve(rootDir, relPath);
		const relToRoot = path.relative(rootNorm, fullPath);
		if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
			console.error('asd: 校验拒绝路径逃逸:', relPath);
			return false;
		}
		try {
			if (!fs.existsSync(fullPath)) {
				console.error('asd: 校验失败（无法读取）:', relPath);
				return false;
			}
			const actualHex = sha256Hex(fullPath);
			if (actualHex !== expectedHex) {
				console.error('asd: 完整性校验失败:', relPath);
				return false;
			}
		} catch (e) {
			console.error('asd: 校验失败（无法读取）:', relPath);
			return false;
		}
	}
	return true;
}

if (!fs.existsSync(checksumsPath)) {
	console.error('asd: 未找到', checksumsPath);
	process.exit(1);
}

const ok = verifyIntegrity(root, checksumsPath);
process.exit(ok ? 0 : 1);
