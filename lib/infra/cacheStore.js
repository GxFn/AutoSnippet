#!/usr/bin/env node

/**
 * 职责：
 * - 维护 AutoSnippet 的本地缓存（基于 spec 内容派生的索引）
 * - 将 snippet 列表解析成：completion keys、跳转链接、头文件相对路径映射等
 *
 * 说明：
 * - 这是对原 `bin/cache.js` 的下沉实现，保持对外函数签名不变
 */

const fs = require('fs');
const path = require('path');
const triggerSymbol = require('./triggerSymbol.js');
const paths = require('./paths.js');

const SpecCache = 'SpecCache_';
const KeysCache = 'KeysCache_';
const LinkCache = 'LinkCache_';
const HeadCache = 'HeadCache_';

async function updateCache(specFile, content) {
	const filePath = getFilePathFromHolderPath(SpecCache, specFile);

	try {
		await fs.promises.access(filePath);
	} catch {
		fs.writeFileSync(filePath, '');
	}

	try {
		fs.writeFileSync(filePath, content);
		cache = JSON.parse(content);
		if (cache && cache.list) {
			let linkCache = {};
			let headCache = {};
			let keysCache = { list: [] };

			cache.list.forEach(element => {
				const trigger = element && element.trigger ? String(element.trigger) : '';
				const rawKey = triggerSymbol.stripTriggerPrefix(trigger);
				if (element && rawKey) {
					let key = rawKey;
					keysCache.list.push(key);

					if (element.link) {
						linkCache[key] = element.link;
					} else if (element.readme) {
						linkCache[key] = element.readme;
					}

					if (element.headName
						&& element.languageShort !== 'swift') {
						const headerFileName = path.basename(element.headName);
						headCache[headerFileName] = element.headName;
					}
				}
			});

			setSubCache(KeysCache, specFile, JSON.stringify(keysCache, null, 4));
			setSubCache(LinkCache, specFile, JSON.stringify(linkCache, null, 4));
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
	} catch {
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
	} catch {
		fs.writeFileSync(filePath, '');
	}
	try {
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
	const cachePath = paths.getCachePath();
	return path.join(cachePath, fileName);
}

module.exports = {
	updateCache,
	getKeysCache,
	getLinkCache,
	getHeadCache
};

