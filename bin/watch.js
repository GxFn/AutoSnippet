#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const open = require('open');
const injection = require('./injection.js');

// 全局路径
const CMD_PATH = process.cwd();
const cache = require('./cache.js');

const headerMark = '// ahead ';
const alinkMark = 'alink';
const wellMark = '#';
const atMark = '@';

const headerReg = /^\/\/ ahead <\w+\/\w+.h>$/;
const headerSwiftReg = /^\/\/ ahead \w+$/;
const importReg = /^\#import\s*<\w+\/\w+.h>$/;
const importSwiftReg = /^import\s*\w+$/;

let timeoutLink = null;
let timeoutHead = null;

function watchFileChange(specFile) {

	// 监听文件变化
	const filePath = CMD_PATH;
	let isReading = false;

	fs.watch(filePath, {recursive: true}, (event, filename) => {
		if (filename) {
			setTimeout(() => {
				if (!watchFileFilter(filePath, filename)) {
					return;
				}
				if (isReading) {
					return;
				}
				isReading = true;

				let updateFile = path.join(filePath, filename);
				fs.readFile(updateFile, 'utf8', (err, data) => {
					isReading = false;
					if (err) {
						console.error(err);
						return;
					}

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
							console.log('headerLine: ' + headerLine);
						}
						if (lineVal.startsWith(atMark) && lineVal.endsWith(wellMark + alinkMark)) {
							alinkLine = lineVal;
							console.log('alinkLine: ' + alinkLine);
						}
					});

					if (alinkLine) {

						clearTimeout(timeoutLink);
						timeoutLink = setTimeout(() => {
							openLink(specFile, alinkLine);
						}, 300);
					}

					if (headerLine && currHeaderReg.test(headerLine)) {

						clearTimeout(timeoutHead);
						timeoutHead = setTimeout(() => {
							checkAnotherFile(specFile, updateFile, headerLine, importArray, isSwift);
						}, 300);
					}
				});
			}, 1000);
		}
	});
}

function checkAnotherFile(specFile, updateFile, headerLine, importArray, isSwift) {
	if (isSwift || updateFile.endsWith('.h')) {
		injection.handleHeaderLine(specFile, updateFile, headerLine, importArray, isSwift);
		return;
	}

	// 识别.h文件的引入头文件
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

function watchFileFilter(filePath, filename) {
	let updateFile = path.join(filePath, filename);
	if (updateFile.includes('xcuserdata')
		|| updateFile.includes('.git')
		|| updateFile.includes('.mgit')
		|| updateFile.includes('.easybox')) {
		return false;
	}
	if (filename.endsWith('~.m')
		|| filename.endsWith('~.h')) {
		return false;
	}
	if (!filename.endsWith('.m')
		&& !filename.endsWith('.h')
		&& !filename.endsWith('.swift')) {
		return false;
	}
	return true;
}

exports.watchFileChange = watchFileChange;