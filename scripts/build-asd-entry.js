#!/usr/bin/env node

/**
 * 构建 asd 完整性校验入口（Swift，仅 macOS）。产物：bin/asd-verify。
 * 若不存在或构建失败，将直接使用 node bin/cli.js。
 */

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

if (process.platform !== 'darwin') process.exit(0);

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'resources', 'asd-entry', 'main.swift');
const out = path.join(root, 'bin', 'asd-verify');

// 检查是否在发布流程中
const isPublishing = process.env.npm_lifecycle_event === 'prepublishOnly';

try {
	fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
	execSync(`swiftc "${src}" -o "${out}"`, { cwd: root, stdio: 'pipe' });
	
	// 验证构建结果
	if (fs.existsSync(out)) {
		console.log('✅ ASD Entry 构建成功');
	}
} catch (err) {
	// 如果在发布流程中构建失败，应该报错
	if (isPublishing) {
		console.error('❌ ASD Entry 构建失败（发布流程中）');
		console.error('请确保：');
		console.error('  1. 当前系统是 macOS');
		console.error('  2. 已安装 Xcode Command Line Tools: xcode-select --install');
		console.error('  3. Swift 编译器可用: which swiftc');
		process.exit(1);
	}
	
	// 在用户安装时，如果已有预编译的二进制文件，静默跳过
	if (fs.existsSync(out)) {
		console.log('ℹ️  使用预编译的 ASD Entry');
	} else {
		console.log('⚠️  ASD Entry 未构建（将使用 Node.js 入口）');
	}
}
