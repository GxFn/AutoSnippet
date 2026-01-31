#!/usr/bin/env node

/**
 * npm install 时可选构建 ParsePackage（Swift 解析器，依赖 swift-syntax）
 * 交互式安装时提示用户是否安装；非交互或 ASD_BUILD_SWIFT_PARSER=1 时按需构建/跳过。
 * 成功则运行时优先使用 ParsePackage；未构建时回退 dump-package / AST-lite。
 */

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const parsePackageDir = path.join(rootDir, 'tools', 'parse-package');
const manifestPath = path.join(parsePackageDir, 'Package.swift');
const binaryPath = path.join(parsePackageDir, '.build', 'release', 'ParsePackage');

function runSwiftBuild() {
	const result = spawnSync('swift', ['build', '-c', 'release'], {
		cwd: parsePackageDir,
		stdio: 'inherit',
		shell: false,
	});
	if (result.status === 0 && fs.existsSync(binaryPath)) {
		console.log('Swift 解析器安装完成。');
	}
	process.exit(0);
}

if (!fs.existsSync(manifestPath)) {
	process.exit(0);
}
if (fs.existsSync(binaryPath)) {
	process.exit(0);
}

// 环境变量强制安装时直接构建
if (process.env.ASD_BUILD_SWIFT_PARSER === '1' || process.env.ASD_BUILD_SWIFT_PARSER === 'true') {
	runSwiftBuild();
	return;
}

const swiftParserTip = '提示：Swift 解析器（ParsePackage）未安装；需要时执行 asd install:full --parser（任意目录均可），或安装时设置 ASD_BUILD_SWIFT_PARSER=1。';

// 非交互（无 TTY）时打印提示后跳过，不阻塞 CI 等（npm install 时通常无 TTY）
if (!process.stdin.isTTY) {
	console.log(swiftParserTip);
	process.exit(0);
}

// 交互式：提示用户是否安装
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('是否安装 Swift 解析器（ParsePackage）？安装后 SPM 解析更准确，约需数分钟。(y/N) ', (answer) => {
	rl.close();
	const yes = /^y(es)?$/i.test((answer || '').trim());
	if (yes) {
		runSwiftBuild();
	} else {
		console.log(swiftParserTip);
		process.exit(0);
	}
});
