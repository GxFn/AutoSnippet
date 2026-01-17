#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const config = require('./config.js');

const SpecCache = 'SpecCache_';
const KeysCache = 'KeysCache_';
const LinkCache = 'LinkCache_';
const HeadCache = 'HeadCache_';

async function updateCache(specFile, content) {
	const filePath = getFilePathFromHolderPath(SpecCache, specFile);

	try {
		await fs.promises.access(filePath);
	} catch (error) {
		fs.writeFileSync(filePath, '');
	}
	// 增加本地chache
	try {
		fs.writeFileSync(filePath, content);
		// 缓存completionKey
		cache = JSON.parse(content);
		if (cache && cache.list) {

			let linkCache = {};
			let headCache = {};
			let keysCache = {
				list: []
			};

			cache.list.forEach(element => {
				if (element['{completionKey}']) {
					let key = element['{completionKey}'];
					keysCache.list.push(key);

					if (element['{link}']) {
						linkCache[key] = element['{link}'];
					} else if (element['{readme}']) {
						linkCache[key] = element['{readme}'];
					}

					// ✅ SPM 模块：headName 已经包含相对路径，不需要 specHeadPath
					if (element['{headName}']
						&& element['{language}'] !== 'Xcode.SourceCodeLanguage.Swift') {
						// headName 本身已经是相对路径，直接使用
						const headerFileName = path.basename(element['{headName}']);
						headCache[headerFileName] = element['{headName}'];
					}
				}
			});

			// 保存completionKey
			setSubCache(KeysCache, specFile, JSON.stringify(keysCache, null, 4));

			// 保存跳转地址
			setSubCache(LinkCache, specFile, JSON.stringify(linkCache, null, 4));

			// 保存头文件信息
			setSubCache(HeadCache, specFile, JSON.stringify(headCache, null, 4));
		}
	} catch (err) {
		console.log(err);
	}
}

async function setSubCache(key, specFile, content) {
	const filePath = getFilePathFromHolderPath(key, specFile);

	try {
		await fs.promises.access(filePath);
	} catch (error) {
		fs.writeFileSync(filePath, '');
	}
	try {
		fs.writeFileSync(filePath, content);
	} catch (err) {
		console.log(err);
	}
}

async function getSubCache(key, specFile) {
	const filePath = getFilePathFromHolderPath(key, specFile);
	let subCache = null;

	try {
		await fs.promises.access(filePath);
	} catch (error) {
		fs.writeFileSync(filePath, '');
	}
	try {
		// 读取AutoSnippet的占位配置
		const data = fs.readFileSync(filePath, 'utf8');
		if (data) {
			subCache = JSON.parse(data);
		}
	} catch (err) {
		console.error(err);
	}

	return subCache;
}

async function getKeysCache(specFile) {
	return await getSubCache(KeysCache, specFile);
}

async function getLinkCache(specFile) {
	return await getSubCache(LinkCache, specFile);
}

async function getHeadCache(specFile) {
	return await getSubCache(HeadCache, specFile);
}

function getFilePathFromHolderPath(key, specFile) {
	const pathBuff = Buffer.from(specFile, 'utf-8');
	const fileName = key + pathBuff.toString('base64') + '.json';
	
	// ✅ 使用配置模块获取缓存路径
	const cachePath = config.getCachePath();
	const filePath = path.join(cachePath, fileName);

	return filePath;
}

exports.updateCache = updateCache;
exports.getKeysCache = getKeysCache;
exports.getLinkCache = getLinkCache;
exports.getHeadCache = getHeadCache;