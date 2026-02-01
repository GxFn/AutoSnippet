#!/usr/bin/env node

/**
 * 全量安装 / 按需安装：统一入口
 * asd install:full           - 核心 + 可选依赖 + Dashboard
 * asd install:full --parser  - 上述 + Swift 解析器
 * asd install:full --lancedb - 仅安装 LanceDB
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const lancedbOnly = process.env.ASD_INSTALL_LANCEDB_ONLY === '1' || process.env.ASD_INSTALL_LANCEDB_ONLY === 'true';
const withParser = process.env.ASD_INSTALL_PARSER === '1' || process.env.ASD_INSTALL_PARSER === 'true';
const withNativeUi = process.env.ASD_INSTALL_NATIVE_UI === '1' || process.env.ASD_INSTALL_NATIVE_UI === 'true';
const dashboardDist = path.join(rootDir, 'dashboard', 'dist');

if (lancedbOnly) {
	console.log('=== 安装 LanceDB ===\n');
	execSync('npm install @lancedb/lancedb', { cwd: rootDir, stdio: 'inherit' });
	console.log('\n✅ LanceDB 安装完成。在 boxspec 中配置 adapter: "lance" 后执行 asd embed。');
	process.exit(0);
}

console.log('=== AutoSnippet 全量安装 ===\n');

// 1. 核心 + 可选依赖（含 LanceDB）
console.log('1/4 安装核心与可选依赖（含 LanceDB）...');
execSync('npm install', { cwd: rootDir, stdio: 'inherit' });
console.log('');

// 2. Dashboard（仅当前端不存在时安装并构建）
if (!fs.existsSync(dashboardDist)) {
	console.log('2/4 前端不存在，安装并构建 Dashboard...');
	const dashboardDir = path.join(rootDir, 'dashboard');
	execSync('npm install', { cwd: dashboardDir, stdio: 'inherit' });
	execSync('npm run build:dashboard', { cwd: rootDir, stdio: 'inherit' });
	console.log('');
} else {
	console.log('2/4 跳过 Dashboard（已存在预构建前端）');
	console.log('');
}

// 3. ParsePackage / Native UI（可选）
if (withParser) {
	console.log('3/4 构建 Swift 解析器（ParsePackage）...');
	execSync('npm run build:parser', { cwd: rootDir, stdio: 'inherit' });
} else {
	console.log('3/4 跳过 ParsePackage（需时执行 asd install:full --parser）');
}
if (withNativeUi || process.platform === 'darwin') {
	console.log('4/4 构建 Native UI 辅助程序（macOS）...');
	try {
		require('./build-native-ui.js');
	} catch (_) {}
} else {
	console.log('4/4 跳过 Native UI（非 macOS）');
}

console.log('\n✅ 全量安装完成');
