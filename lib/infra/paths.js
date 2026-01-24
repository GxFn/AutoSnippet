#!/usr/bin/env node

/**
 * 职责：
 * - 提供路径相关的基础能力（Xcode CodeSnippets 输出目录、AutoSnippet 缓存目录）
 * - 统一通过 HOME/USERPROFILE 计算路径，并确保目录存在
 *
 * 核心方法：
 * - getSnippetsPath(): 返回 ~/Library/Developer/Xcode/UserData/CodeSnippets，并确保目录存在
 * - getCachePath(): 返回 ~/.autosnippet/cache，并确保目录存在
 */

const path = require('path');
const fs = require('fs');

function getSnippetsPath() {
	const USER_HOME = process.env.HOME || process.env.USERPROFILE;
	const snippetsPath = path.join(USER_HOME, 'Library/Developer/Xcode/UserData/CodeSnippets');
	try {
		fs.accessSync(snippetsPath, fs.constants.F_OK);
	} catch {
		fs.mkdirSync(snippetsPath, { recursive: true });
	}
	return snippetsPath;
}

function getCachePath() {
	const USER_HOME = process.env.HOME || process.env.USERPROFILE;
	const cachePath = path.join(USER_HOME, '.autosnippet', 'cache');
	try {
		fs.accessSync(cachePath, fs.constants.F_OK);
	} catch {
		fs.mkdirSync(cachePath, { recursive: true });
	}
	return cachePath;
}

module.exports = {
	getSnippetsPath,
	getCachePath
};

