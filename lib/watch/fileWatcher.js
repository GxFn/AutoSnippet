#!/usr/bin/env node

/**
 * 职责：
 * - chokidar 文件监听封装（过滤、debounce、summary、事件回调）
 * - 这是对原 `bin/watch.js` 的下沉实现，保持对外入口 watchFileChange 不变
 */

const chokidar = require('chokidar');
const path = require('path');
const open = require('open');
const injection = require('../injection/injectionService.js');
const cache = require('../infra/cacheStore.js');

const CMD_PATH = process.cwd();

const headerMarkInclude = '// autosnippet:include ';
const headerMarkImport = '// autosnippet:import ';
const headerMarkIncludeShort = '// as:include ';
const headerMarkImportShort = '// as:import ';
const alinkMark = 'alink';
const wellMark = '#';
const atMark = '@';

// ObjC 头文件名常见包含 `+`（Category）、`-`、`.` 等字符
const headerReg = /^@?\/\/\s*(?:autosnippet|as):include\s+<([A-Za-z0-9_]+)\/([A-Za-z0-9_+.-]+\.h)>(\s+.+)?$/;
const headerSwiftReg = /^@?\/\/\s*(?:autosnippet|as):import\s+\w+$/;
const importReg = /^\#import\s*<[A-Za-z0-9_]+\/[A-Za-z0-9_+.-]+\.h>$/;
const importSwiftReg = /^import\s*\w+$/;

const debounceTimers = new Map();
const DEBOUNCE_DELAY = 300;

let timeoutLink = null;
let timeoutHead = null;

function watchFileChange(specFile, watchRootPath, options = {}) {
	const filePath = watchRootPath || CMD_PATH;

	const pathPrefix = options && options.pathPrefix ? String(options.pathPrefix) : null;
	const onlyFile = options && options.file ? path.resolve(String(options.file)) : null;
	const exts = Array.isArray(options && options.exts) ? options.exts.map(e => (e.startsWith('.') ? e : `.${e}`)) : null;
	const quiet = !!(options && options.quiet);
	const summary = !!(options && options.summary);
	const summaryState = summary ? { files: new Set(), headers: 0, links: 0, startedAt: Date.now() } : null;

	const ignored = [
		'**/node_modules/**',
		'**/.git/**',
		'**/.mgit/**',
		'**/.easybox/**',
		'**/xcuserdata/**',
		'**/.build/**',
		'**/*.swp',
		'**/*.tmp',
		'**/*~.m',
		'**/*~.h',
	];

	const filePattern = (exts && exts.length)
		? exts.map((e) => `**/*${e}`)
		: ['**/*.m', '**/*.h', '**/*.swift'];

	if (!quiet) {
		console.log(`✅ 文件监听已启动: ${filePath}`);
		if (pathPrefix) console.log(`ℹ️  仅监听目录前缀: ${pathPrefix}`);
		if (onlyFile) console.log(`ℹ️  仅监听文件: ${onlyFile}`);
		if (exts && exts.length) console.log(`ℹ️  仅监听后缀: ${exts.join(',')}`);
	}

	const watcher = chokidar.watch(filePattern, {
		cwd: filePath,
		ignored: ignored,
		ignoreInitial: true,
		persistent: true,
		awaitWriteFinish: {
			stabilityThreshold: 500,
			pollInterval: 100
		},
		usePolling: false,
		interval: 100,
		binaryInterval: 300
	});

	watcher.on('change', (relativePath) => {
		const fullPath = path.join(filePath, relativePath);
		if (onlyFile && path.resolve(fullPath) !== onlyFile) return;
		if (pathPrefix && !path.normalize(relativePath).startsWith(path.normalize(pathPrefix))) return;
		handleFileChange(specFile, fullPath, relativePath, options);
	});

	watcher.on('add', (relativePath) => {
		const fullPath = path.join(filePath, relativePath);
		if (onlyFile && path.resolve(fullPath) !== onlyFile) return;
		if (pathPrefix && !path.normalize(relativePath).startsWith(path.normalize(pathPrefix))) return;
		handleFileChange(specFile, fullPath, relativePath, options);
	});

	watcher.on('error', (error) => {
		console.error('文件监听错误:', error.message);
	});

	watcher.on('ready', () => {
		if (!quiet) console.log('文件监听器已就绪，等待文件变更...');
	});

	if (summaryState) {
		const printSummaryOnce = () => {
			const ms = Date.now() - summaryState.startedAt;
			console.log('');
			console.log('======== AutoSnippet watch summary ========');
			console.log(`watchedRoot: ${filePath}`);
			if (pathPrefix) console.log(`pathPrefix: ${pathPrefix}`);
			if (onlyFile) console.log(`file: ${onlyFile}`);
			if (exts && exts.length) console.log(`exts: ${exts.join(',')}`);
			console.log(`events: header=${summaryState.headers}, link=${summaryState.links}`);
			console.log(`touchedFiles: ${summaryState.files.size}`);
			console.log(`elapsed: ${ms}ms`);
			console.log('==========================================');
		};
		process.once('exit', printSummaryOnce);
		process.once('SIGINT', () => { try { printSummaryOnce(); } finally { process.exit(130); } });

		const oldOnEvent = options.onEvent;
		options.onEvent = (evt) => {
			try {
				if (evt && evt.file) summaryState.files.add(evt.file);
				if (evt && evt.type === 'header') summaryState.headers++;
				if (evt && evt.type === 'alink') summaryState.links++;
			} catch {}
			if (typeof oldOnEvent === 'function') {
				try { oldOnEvent(evt); } catch {}
			}
		};
	}

	return watcher;
}

function handleFileChange(specFile, fullPath, relativePath, options) {
	const existingTimer = debounceTimers.get(fullPath);
	if (existingTimer) clearTimeout(existingTimer);

	const timer = setTimeout(() => {
		debounceTimers.delete(fullPath);
		processFileChange(specFile, fullPath, relativePath, options);
	}, DEBOUNCE_DELAY);

	debounceTimers.set(fullPath, timer);
}

function processFileChange(specFile, updateFile, relativePath, options) {
	const fs = require('fs');

	fs.access(updateFile, fs.constants.F_OK, (err) => {
		if (err) return;
		fs.stat(updateFile, (statErr, stats) => {
			if (statErr || stats.isDirectory()) return;
			fs.readFile(updateFile, 'utf8', (readErr, data) => {
				if (readErr) {
					console.error(`❌ 读取文件失败: ${updateFile}`, readErr.message);
					return;
				}

				const filename = path.basename(updateFile);
				const isSwift = filename.endsWith('.swift');
				const currImportReg = isSwift ? importSwiftReg : importReg;
				const currHeaderReg = isSwift ? headerSwiftReg : headerReg;

				let importArray = [];
				let headerLine = null;
				let alinkLine = null;

				const lineArray = data.split('\n');
				lineArray.forEach(element => {
					const lineVal = element.trim();
					const normalizedLineVal = lineVal.startsWith(atMark) ? lineVal.slice(1).trimStart() : lineVal;
					if (currImportReg.test(lineVal)) {
						importArray.push(lineVal);
					}
					if (
						normalizedLineVal.startsWith(headerMarkInclude) || normalizedLineVal.startsWith(headerMarkImport)
						|| normalizedLineVal.startsWith(headerMarkIncludeShort) || normalizedLineVal.startsWith(headerMarkImportShort)
					) {
						// 保留原始内容交给下游解析（directiveParser 也会兼容 @）
						headerLine = lineVal;
					}
					if (lineVal.startsWith(atMark) && lineVal.endsWith(wellMark + alinkMark)) {
						alinkLine = lineVal;
					}
				});

				if (alinkLine) {
					clearTimeout(timeoutLink);
					timeoutLink = setTimeout(() => {
						openLink(specFile, alinkLine);
						if (options && typeof options.onEvent === 'function') {
							try { options.onEvent({ type: 'alink', file: updateFile, relativePath }); } catch {}
						}
					}, DEBOUNCE_DELAY);
				}

				if (headerLine) {
					const isMatch = currHeaderReg.test(headerLine);
					if (isMatch) {
						clearTimeout(timeoutHead);
						timeoutHead = setTimeout(() => {
							checkAnotherFile(specFile, updateFile, headerLine, importArray, isSwift);
							if (options && typeof options.onEvent === 'function') {
								try { options.onEvent({ type: 'header', file: updateFile, relativePath }); } catch {}
							}
						}, DEBOUNCE_DELAY);
					}
				}
			});
		});
	});
}

function checkAnotherFile(specFile, updateFile, headerLine, importArray, isSwift) {
	const fs = require('fs');

	if (isSwift || updateFile.endsWith('.h')) {
		injection.handleHeaderLine(specFile, updateFile, headerLine, importArray, isSwift);
		return;
	}

	const dotIndex = updateFile.lastIndexOf('.');
	const mainPathFile = updateFile.substring(0, dotIndex) + '.h';

	fs.access(mainPathFile, fs.constants.F_OK, (err) => {
		if (err) {
			injection.handleHeaderLine(specFile, updateFile, headerLine, importArray, isSwift);
			return;
		}
		fs.readFile(mainPathFile, 'utf8', (err, data) => {
			if (err) {
				injection.handleHeaderLine(specFile, updateFile, headerLine, importArray, isSwift);
				return;
			}

			const lineArray = data.split('\n');
			lineArray.forEach(element => {
				const lineVal = element.trim();
				if (importReg.test(lineVal)) {
					importArray.push(lineVal);
				}
			});

			injection.handleHeaderLine(specFile, updateFile, headerLine, importArray, isSwift);
		});
	});
}

function openLink(specFile, inputWord) {
	if (inputWord.includes(wellMark)) {
		const wellKey = inputWord.split(wellMark);

		if (wellKey.length > 1 && wellKey[1] === alinkMark) {
			cache.getLinkCache(specFile).then(function (linkCache) {
				if (linkCache) {
					const completionKey = wellKey[0].replace(atMark, '');
					let link = decodeURI(linkCache[completionKey]);

					if (!link.startsWith('http')) {
						const specSlashIndex = specFile.lastIndexOf('/');
						const specFilePath = specFile.substring(0, specSlashIndex + 1);
						link = specFilePath + link;
					}

					if (link) {
						open(link, {app: {name: 'google chrome'}});
					}
				}
			});
		}
	}
}

module.exports = {
	watchFileChange
};

