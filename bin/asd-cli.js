#!/usr/bin/env node

/**
 * 职责：
 * - AutoSnippet CLI 入口（命令行 asd）
 * - 负责解析参数/路由子命令，并串联 install/create/extract/watch 等能力
 *
 * 核心流程：
 * - commander 解析命令与全局参数（--preset/--yes）
 * - 读取/查找 spec（AutoSnippet.boxspec.json）
 * - 调用对应模块执行实际逻辑（create/install/extract/watch/...）
 *
 * 核心方法：
 * - loadPresetConfig(presetPath): 读取预置输入 JSON（用于非交互）
 * - getSpecFile(callback): 向上查找 AutoSnippet.boxspec.json
 *
 * 主要命令：
 * - setup / init
 * - install(i) / create(c) / extract(e) / watch(w)
 */

const fs = require('fs');
const path = require('path');

// 入口校验：包内存在 checksums.json 且未经过 asd-verify（无 ASD_VERIFIED）时，可拒跑或警告，避免绕过完整性校验直接运行 node bin/asd-cli.js
const pkgRoot = path.join(__dirname, '..');
const checksumsPath = path.join(pkgRoot, 'checksums.json');
if (fs.existsSync(checksumsPath) && process.env.ASD_VERIFIED !== '1') {
	const msg = 'asd: 未经过完整性校验入口（请使用 asd 命令，勿直接运行 node bin/asd-cli.js）。开发/调试可设 ASD_SKIP_ENTRY_CHECK=1 跳过。';
	if (process.env.ASD_STRICT_ENTRY === '1') {
		console.error(msg);
		process.exit(1);
	}
	if (process.env.ASD_SKIP_ENTRY_CHECK !== '1') {
		console.warn('⚠️  ' + msg);
	}
}

// 读取输入命令
const inquirer = require('inquirer');
// 命令行工具
const commander = require('commander');
// 全局路径：优先用 shell 传入的 ASD_CWD（asd 脚本里 $(pwd)），避免 dev:link / 符号链接等场景下 process.cwd() 与用户所在目录不一致
const CMD_PATH = process.env.ASD_CWD || process.cwd();
const pjson = require('../package.json');
const findPath = require('../lib/infrastructure/paths/PathFinder');
const install = require('../lib/snippet/snippetInstaller.js');
const create = require('./create-snippet.js');
const watch = require('../lib/watch/fileWatcher.js');
const cache = require('../lib/infrastructure/cache/CacheStore.js');
const ui = require('./dashboard-server.js');
const defaults = require('../lib/infrastructure/config/Defaults');
const spmDepMapUpdater = require('../lib/spm/spmDepMapUpdater.js');
const { execSync } = require('child_process');
const { createCliHelpers } = require('./cli-helpers');
const { registerCommands } = require('./cli-commands');
const helpers = createCliHelpers({
	CMD_PATH,
	findPath,
	cache,
	create,
	inquirer,
	defaults,
	commander,
	execSync,
});

registerCommands(commander, {
	pjson,
	CMD_PATH,
	findPath,
	install,
	create,
	watch,
	cache,
	ui,
	defaults,
	spmDepMapUpdater,
	helpers,
	inquirer,
	fs,
	path,
});

commander.parse(process.argv);
