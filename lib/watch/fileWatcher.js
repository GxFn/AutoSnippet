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
const createMarkShort = '// as:create';
const guardMarkShort = '// as:guard';
const searchMarkShort = '// as:search';
const searchMarkLong = '// autosnippet:search';
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
		usePolling: process.env.ASD_WATCH_POLLING === 'true',
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
				let createLine = null;
				let guardLine = null;
				let searchLine = null;

				const lineArray = data.split('\n');
				lineArray.forEach(element => {
					const lineVal = element.trim();
					let normalizedLineVal = lineVal.startsWith(atMark) ? lineVal.slice(1).trimStart() : lineVal;
					if (normalizedLineVal.startsWith('#')) normalizedLineVal = normalizedLineVal.slice(1).trimStart();
					if (currImportReg.test(lineVal)) {
						importArray.push(lineVal);
					}
					if (
						normalizedLineVal.startsWith(headerMarkInclude) || normalizedLineVal.startsWith(headerMarkImport)
						|| normalizedLineVal.startsWith(headerMarkIncludeShort) || normalizedLineVal.startsWith(headerMarkImportShort)
					) {
						headerLine = normalizedLineVal;
					}
					if (lineVal.startsWith(atMark) && lineVal.endsWith(wellMark + alinkMark)) {
						alinkLine = lineVal;
					}
					if (normalizedLineVal === createMarkShort) {
						createLine = lineVal;
					}
					if (normalizedLineVal.startsWith(guardMarkShort)) {
						guardLine = normalizedLineVal;
					}
					if (normalizedLineVal.startsWith(searchMarkShort) || normalizedLineVal.startsWith(searchMarkLong)) {
						searchLine = normalizedLineVal;
					}
				});

				if (createLine) {
					handleCreateTrigger(updateFile, relativePath);
				}

				if (guardLine) {
					handleGuardTrigger(specFile, updateFile, data, guardLine);
				}

				if (searchLine) {
					handleSearchTrigger(updateFile, relativePath, searchLine);
				}

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

function handleCreateTrigger(fullPath, relativePath) {
	const fs = require('fs');
	const { execSync } = require('child_process');
	
	// 1. 尝试获取剪切板内容 (仅限 macOS)
	let clipboardContent = '';
	try {
		if (process.platform === 'darwin') {
			clipboardContent = execSync('pbpaste', { encoding: 'utf8' }).trim();
		}
	} catch (e) {
		console.warn('[Watcher] Failed to read clipboard:', e.message);
	}

	// 2. 移除文件中的标记
	try {
		const content = fs.readFileSync(fullPath, 'utf8');
		const newContent = content.replace(/\/\/ as:create\n?/g, '').replace(/@\/\/ as:create\n?/g, '');
		fs.writeFileSync(fullPath, newContent, 'utf8');
	} catch (err) {
		console.error('Failed to remove as:create mark', err);
	}

	// 3. 构造跳转 URL
	// 如果剪切板有内容，我们在 URL 中标记使用剪切板模式
	const useClipboard = clipboardContent.length > 0;
	const url = `http://localhost:3000/?action=create&path=${encodeURIComponent(relativePath)}${useClipboard ? '&source=clipboard' : ''}`;
	
	const open = require('open');
	open(url);
}

function handleSearchTrigger(fullPath, relativePath, searchLine) {
	const keyword = searchLine
		.replace(new RegExp(`^\\/\\/\\s*(?:autosnippet|as):search\\s*`), '')
		.trim();
	const url = `http://localhost:3000/?action=search&q=${encodeURIComponent(keyword)}&path=${encodeURIComponent(relativePath)}`;
	const open = require('open');
	open(url);
}

async function handleGuardTrigger(specFile, fullPath, code, guardLine) {
	const AiFactory = require('../ai/AiFactory');
	const fs = require('fs');
	const path = require('path');
	const VectorStore = require('../ai/vectorStore');

	const keyword = guardLine.replace(guardMarkShort, '').trim();
	console.log(`\n🛡️  [Project Guard] 正在检查文件: ${path.basename(fullPath)} ${keyword ? `(目标: ${keyword})` : ''}`);

	// 1. 获取相关知识库内容
	const projectRoot = await require('../../bin/findPath').findProjectRoot(path.dirname(specFile));
	let recipesContent = '';
	
	if (projectRoot) {
		const store = new VectorStore(projectRoot);
		const ai = await AiFactory.getProvider(projectRoot);
		
		if (ai) {
			// 优先使用语义搜索获取上下文
			const queryText = keyword || code.substring(0, 500); // 如果没有关键字，用前500字做语义搜索
			try {
				const queryVector = await ai.embed(queryText);
				const semanticResults = store.search(queryVector, 3);
				
				if (semanticResults.length > 0) {
					console.log(`🧠 已通过语义检索找到 ${semanticResults.length} 条相关规范...`);
					semanticResults.forEach(res => {
						recipesContent += `\n--- Recipe (Semantic Match): ${res.metadata.name} ---\n${res.content}\n`;
					});
				}
			} catch (e) {
				console.warn('[Guard] 语义搜索失败，回退到关键字搜索');
			}
		}

		// 如果语义搜索没结果或失败，回退到关键字搜索
		if (!recipesContent) {
			const rootSpec = JSON.parse(fs.readFileSync(path.join(projectRoot, 'AutoSnippetRoot.boxspec.json'), 'utf8'));
			const recipesDir = path.join(projectRoot, rootSpec.recipes?.dir || rootSpec.skills?.dir || 'Knowledge/recipes');
			
			if (fs.existsSync(recipesDir)) {
				const recipeFiles = fs.readdirSync(recipesDir).filter(f => f.endsWith('.md'));
				for (const file of recipeFiles) {
					// 无关键字时加载全部 recipe，有关键字时按文件名匹配
					if (!keyword || file.toLowerCase().includes(keyword.toLowerCase())) {
						const content = fs.readFileSync(path.join(recipesDir, file), 'utf8');
						recipesContent += `\n--- Recipe (Keyword Match): ${file} ---\n${content}\n`;
					}
				}
			}
		}
	}

	if (!recipesContent) {
		console.log('ℹ️  未找到匹配的 Recipe 知识，跳过 Guard 检查。');
		return;
	}

	// 2. 调用 AI 进行检查
	try {
		const ai = await AiFactory.getProvider(projectRoot);
		const prompt = `你是一个资深的 iOS 架构师和代码审查员。
请根据以下“项目知识库(Recipes)”中的规范和最佳实践，审查提供的“源代码”。

项目知识库：
${recipesContent}

待审查源代码：
${code}

任务：
1. 检查代码是否违反了知识库中的任何准则、模式或约束。
2. 如果存在风险或改进点，请给出具体的、建设性的建议。
3. 如果代码表现优秀，请简要说明符合了哪些准则。
4. 请直接输出结果，保持简洁。`;

		console.log('AI 正在分析规范合规性...');
		const result = await ai.chat(prompt);
		
		console.log('\n--- 🛡️  Guard 审查结果 ---');
		console.log(result);
		console.log('------------------------\n');
	} catch (err) {
		console.error('❌ Guard 检查出错:', err.message);
	}
}

module.exports = {
	watchFileChange
};

