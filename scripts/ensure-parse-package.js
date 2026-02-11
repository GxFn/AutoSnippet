#!/usr/bin/env node

/**
 * npm install 时可选构建 ParsePackage（Swift 解析器，依赖 swift-syntax）
 * 仅当 ASD_BUILD_SWIFT_PARSER=1 时构建；否则打印说明并跳过。成功则运行时优先使用 ParsePackage；未构建时回退 dump-package / AST-lite。
 */

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

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

// 仅当显式设置环境变量时构建，并说明在安装什么
if (process.env.ASD_BUILD_SWIFT_PARSER === '1' || process.env.ASD_BUILD_SWIFT_PARSER === 'true') {
  console.log('正在安装 Swift 解析器（ParsePackage）…');
  runSwiftBuild();
  process.exit(0);
}

console.log('跳过 Swift 解析器（ParsePackage）；需要时执行 asd install:full --parser 或安装时设置 ASD_BUILD_SWIFT_PARSER=1。');
process.exit(0);
