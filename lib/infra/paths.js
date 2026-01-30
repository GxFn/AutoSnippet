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
	if (process.env.ASD_SNIPPETS_PATH) return process.env.ASD_SNIPPETS_PATH;
	const USER_HOME = process.env.HOME || process.env.USERPROFILE;
	const snippetsPath = path.join(USER_HOME, 'Library/Developer/Xcode/UserData/CodeSnippets');
	try {
		fs.accessSync(snippetsPath, fs.constants.F_OK);
	} catch {
		try { fs.mkdirSync(snippetsPath, { recursive: true }); } catch (e) {}
	}
	return snippetsPath;
}

function getCachePath() {
	if (process.env.ASD_CACHE_PATH) return process.env.ASD_CACHE_PATH;
	const USER_HOME = process.env.HOME || process.env.USERPROFILE;
	const cachePath = path.join(USER_HOME, '.autosnippet', 'cache');
	try {
		fs.accessSync(cachePath, fs.constants.F_OK);
	} catch {
		try { fs.mkdirSync(cachePath, { recursive: true }); } catch (e) {}
	}
	return cachePath;
}

/**
 * 获取项目内部的数据目录
 * 现在统一为 [ProjectRoot]/Knowledge
 */
function getProjectKnowledgePath(projectRoot) {
	const dataPath = path.join(projectRoot, 'Knowledge');
	if (!fs.existsSync(dataPath)) {
		try { fs.mkdirSync(dataPath, { recursive: true }); } catch (e) {}
	}
	return dataPath;
}

/**
 * 获取项目内部的隐藏数据目录（用于缓存、候选等）
 * 统一为 [ProjectRoot]/Knowledge/.autosnippet
 */
function getProjectInternalDataPath(projectRoot) {
	const dataPath = path.join(getProjectKnowledgePath(projectRoot), '.autosnippet');
	if (!fs.existsSync(dataPath)) {
		try { fs.mkdirSync(dataPath, { recursive: true }); } catch (e) {}
	}
	return dataPath;
}

module.exports = {
	getSnippetsPath,
	getCachePath,
	getProjectKnowledgePath,
	getProjectInternalDataPath
};

