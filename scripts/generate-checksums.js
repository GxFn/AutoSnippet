#!/usr/bin/env node

/**
 * 发布时生成 checksums.json（关键文件路径 → SHA-256），供原生入口完整性校验使用。
 * 在项目根目录执行：node scripts/generate-checksums.js
 * 
 * ⚠️  发布前检查：
 * 1. 确认 .env 中 ASD_SKIP_CHECKSUMS=0 或已注释（不应为 1）
 * 2. 执行本脚本生成 checksums.json
 * 3. 提交 checksums.json 到版本控制
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');

// 发布前检查：确保 ASD_SKIP_CHECKSUMS 未被设置为 1
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
	const envContent = fs.readFileSync(envPath, 'utf8');
	if (/ASD_SKIP_CHECKSUMS\s*=\s*1/i.test(envContent)) {
		console.warn('⚠️  警告：.env 中 ASD_SKIP_CHECKSUMS=1 处于开启状态');
		console.warn('    发布前请确保已关闭此开关（改为 =0 或注释掉）');
		console.warn('    继续执行...\n');
	}
}

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
