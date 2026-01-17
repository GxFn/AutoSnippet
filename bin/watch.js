#!/usr/bin/env node

const chokidar = require('chokidar');
const path = require('path');
const open = require('open');
const injection = require('./injection.js');

const CMD_PATH = process.cwd();
const cache = require('./cache.js');

const headerMark = '// ahead ';
const alinkMark = 'alink';
const wellMark = '#';
const atMark = '@';

// 匹配原始格式和转义格式：// ahead <Module/Header.h> 或 // ahead &lt;Module/Header.h&gt;
const headerReg = /^\/\/ ahead\s+(?:&lt;|<)(\w+)\/(\w+\.h)(?:&gt;|>)(\s+.+)?$/;
const headerSwiftReg = /^\/\/ ahead \w+$/;
const importReg = /^\#import\s*<\w+\/\w+.h>$/;
const importSwiftReg = /^import\s*\w+$/;

const debounceTimers = new Map();
const DEBOUNCE_DELAY = 300;

let timeoutLink = null;
let timeoutHead = null;

function watchFileChange(specFile, watchRootPath) {
	const filePath = watchRootPath || CMD_PATH;
	
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
	
	const filePattern = ['**/*.m', '**/*.h', '**/*.swift'];
	
	console.log(`✅ 文件监听已启动: ${filePath}`);
	
	const watcher = chokidar.watch(filePattern, {
		cwd: filePath,
		ignored: ignored,
		ignoreInitial: true,
		persistent: true,
		awaitWriteFinish: {
			stabilityThreshold: 500,  // 增加稳定阈值，等待文件写入完成
			pollInterval: 100
		},
		usePolling: false,  // macOS/Linux 使用原生事件
		interval: 100,
		binaryInterval: 300
	});

	watcher.on('change', (relativePath) => {
		const fullPath = path.join(filePath, relativePath);
		handleFileChange(specFile, fullPath, relativePath);
	});

	watcher.on('add', (relativePath) => {
		const fullPath = path.join(filePath, relativePath);
		handleFileChange(specFile, fullPath, relativePath);
	});

	watcher.on('error', (error) => {
		console.error('文件监听错误:', error.message);
	});

	watcher.on('ready', () => {
		console.log('文件监听器已就绪，等待文件变更...');
	});

	return watcher;
}

function handleFileChange(specFile, fullPath, relativePath) {
	const existingTimer = debounceTimers.get(fullPath);
	if (existingTimer) {
		clearTimeout(existingTimer);
	}

	const timer = setTimeout(() => {
		debounceTimers.delete(fullPath);
		processFileChange(specFile, fullPath, relativePath);
	}, DEBOUNCE_DELAY);

	debounceTimers.set(fullPath, timer);
}

function processFileChange(specFile, updateFile, relativePath) {
	const fs = require('fs');
	
	fs.access(updateFile, fs.constants.F_OK, (err) => {
		if (err) {
			return;
		}

		fs.stat(updateFile, (statErr, stats) => {
			if (statErr || stats.isDirectory()) {
				return;
			}

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

					if (currImportReg.test(lineVal)) {
						importArray.push(lineVal);
					}
					if (lineVal.startsWith(headerMark)) {
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
					}, DEBOUNCE_DELAY);
				}

				if (headerLine) {
					// 先解码 HTML 实体（&lt; -> <, &gt; -> >, &amp; -> &）
					let decodedHeaderLine = headerLine
						.replace(/&lt;/g, '<')
						.replace(/&gt;/g, '>')
						.replace(/&amp;/g, '&');
					
					const isMatch = currHeaderReg.test(decodedHeaderLine);
					
					if (isMatch) {
						clearTimeout(timeoutHead);
						timeoutHead = setTimeout(() => {
							// 传递解码后的 headerLine
							checkAnotherFile(specFile, updateFile, decodedHeaderLine, importArray, isSwift);
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

exports.watchFileChange = watchFileChange;