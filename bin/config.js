#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

// 获取代码片段输出路径（写入 Xcode CodeSnippets 目录）
function getSnippetsPath() {
	const USER_HOME = process.env.HOME || process.env.USERPROFILE;
	const snippetsPath = path.join(USER_HOME, 'Library/Developer/Xcode/UserData/CodeSnippets');
	
	// 确保目录存在
	try {
		fs.accessSync(snippetsPath, fs.constants.F_OK);
	} catch (err) {
		fs.mkdirSync(snippetsPath, { recursive: true });
	}
	
	return snippetsPath;
}

// 获取缓存目录路径（使用用户 home 目录下的缓存）
function getCachePath() {
	const USER_HOME = process.env.HOME || process.env.USERPROFILE;
	const cachePath = path.join(USER_HOME, '.autosnippet', 'cache');
	
	// 确保目录存在
	try {
		fs.accessSync(cachePath, fs.constants.F_OK);
	} catch (err) {
		fs.mkdirSync(cachePath, { recursive: true });
	}
	
	return cachePath;
}

module.exports = {
	getSnippetsPath,
	getCachePath
};
