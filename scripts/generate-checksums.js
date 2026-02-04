#!/usr/bin/env node

/**
 * 发布时生成 checksums.json（关键文件路径 → SHA-256），供原生入口完整性校验使用。
 * 在项目根目录执行：node scripts/generate-checksums.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');

/** 参与完整性校验的关键文件（相对项目根） */
const KEY_FILES = [
	'bin/asd-cli.js',
	'bin/dashboard-server.js',
	'lib/writeGuard.js',
	'lib/rateLimit.js',
	'lib/services/context/ContextService.js',
	'lib/application/services/ContextServiceV2.js',
	'lib/context/adapters/MilvusAdapter.js',
	'lib/context/adapters/JsonAdapter.js',
	'lib/ai/AiFactory.js',
	'lib/ai/AiProvider.js',
];

const checksums = {};

for (const rel of KEY_FILES) {
	const full = path.join(root, rel);
	if (!fs.existsSync(full)) {
		console.error(`generate-checksums: 文件不存在: ${rel}`);
		process.exit(1);
	}
	const content = fs.readFileSync(full);
	const hash = crypto.createHash('sha256').update(content).digest('hex');
	checksums[rel] = hash;
}

const outPath = path.join(root, 'checksums.json');
fs.writeFileSync(outPath, JSON.stringify(checksums, null, 2), 'utf8');
console.log(`checksums.json 已写入: ${outPath}`);
