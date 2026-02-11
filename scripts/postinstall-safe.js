#!/usr/bin/env node

/**
 * 安全的 postinstall 脚本 - 只检查不编译
 * 用于避免触发 npm 安全警告
 */

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(__dirname, '..');

// 检查预构建的二进制文件
function checkBinaries() {
  const checks = [
    {
      name: 'Native UI',
      path: path.join(root, 'resources', 'native-ui', 'native-ui'),
      optional: true,
      platform: 'darwin'
    },
    {
      name: 'ASD Entry',
      path: path.join(root, 'bin', 'asd-verify'),
      optional: true,
      platform: 'darwin'
    }
  ];

  checks.forEach(({ name, path: binPath, optional, platform }) => {
    // 跳过非目标平台
    if (platform && process.platform !== platform) {
      return;
    }

    if (fs.existsSync(binPath)) {
      const stat = fs.statSync(binPath);
      const sizeKB = (stat.size / 1024).toFixed(1);
      console.log(`✅ ${name}: 已安装 (${sizeKB}KB)`);
    } else if (optional) {
      console.log(`ℹ️  ${name}: 未安装（可选功能）`);
    } else {
      console.warn(`⚠️  ${name}: 未找到`);
    }
  });
}

// 主流程
console.log('\n📦 AutoSnippet 安装检查...\n');

checkBinaries();

console.log('\n✅ 安装完成！运行 asd -h 查看帮助\n');
