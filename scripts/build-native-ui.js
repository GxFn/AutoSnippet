#!/usr/bin/env node

/**
 * 在 macOS 上构建 native-ui 辅助程序（可选）
 */

if (process.platform !== 'darwin') process.exit(0);

const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'tools', 'native-ui', 'main.swift');
const out = path.join(root, 'bin', 'native-ui');

try {
	execSync(`swiftc "${src}" -o "${out}" -framework AppKit`, { cwd: root, stdio: 'pipe' });
} catch (_) {
	// Swift 未安装或构建失败，静默跳过
}
