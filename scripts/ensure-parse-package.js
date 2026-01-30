#!/usr/bin/env node

/**
 * npm install 时可选构建 ParsePackage（Swift 解析器，依赖 swift-syntax）
 * 成功则运行时优先使用 ParsePackage；失败不阻塞 npm install，运行时回退 dump-package / AST-lite
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const parsePackageDir = path.join(rootDir, 'tools', 'parse-package');
const manifestPath = path.join(parsePackageDir, 'Package.swift');
const binaryPath = path.join(parsePackageDir, '.build', 'release', 'ParsePackage');

if (!fs.existsSync(manifestPath)) {
	process.exit(0);
}
if (fs.existsSync(binaryPath)) {
	process.exit(0);
}

const result = spawnSync('swift', ['build', '-c', 'release'], {
	cwd: parsePackageDir,
	stdio: 'pipe',
	shell: false,
});

if (result.status === 0 && fs.existsSync(binaryPath)) {
	process.exit(0);
}
process.exit(0);
