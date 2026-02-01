#!/usr/bin/env node

/**
 * 构建 asd 原生入口（完整性校验 + spawn Node）。仅 macOS 且 Swift 可用时构建，失败则静默跳过。
 * 产物：bin/asd-verify。若不存在，bin/asd 脚本会回退到 node bin/asnip.js。
 */

if (process.platform !== 'darwin') process.exit(0);

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'resources', 'asd-entry', 'main.swift');
const out = path.join(root, 'bin', 'asd-verify');

try {
	fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
	execSync(`swiftc "${src}" -o "${out}"`, { cwd: root, stdio: 'pipe' });
} catch (_) {
	// Swift 未安装或构建失败，静默跳过；bin/asd 将回退到 node
}
