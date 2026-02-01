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
const triggerSymbol = require('../infra/triggerSymbol.js');

const CMD_PATH = process.cwd();

const headerMarkInclude = '// autosnippet:include ';
const headerMarkImport = '// autosnippet:import ';
const headerMarkIncludeShort = '// as:include ';
const headerMarkImportShort = '// as:import ';
const createMarkShort = '// as:create';
const guardMarkShort = '// as:guard';
const searchMarkShort = '// as:search';
const searchMarkLong = '// autosnippet:search';
// 简写：as:c = as:create, as:s = as:search, as:g = as:guard
const createAlias = '// as:c';
const guardAlias = '// as:g';
const searchAlias = '// as:s';
// as:create 选项：-c 使用剪切板，-f 使用路径
const createLineRegex = /^\/\/\s*as:(?:create|c)(?:\s+(-[cf]))?\s*$/;
const createRemoveRegex = /^@?\s*\/\/\s*as:(?:create|c)(?:\s+-[cf])?\s*\r?\n?/gm;
const alinkMark = 'alink';
const wellMark = triggerSymbol.TRIGGER_SYMBOL;
const atMark = triggerSymbol.TRIGGER_SYMBOL;

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
		: ['**/*.m', '**/*.h', '**/*.swift', '**/_draft_*.md'];

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
				const isDraftFile = /^_draft_.*\.md$/i.test(filename);
				if (isDraftFile) {
					handleDraftFile(specFile, updateFile, relativePath, data);
				}

				const isSwift = filename.endsWith('.swift');
				const currImportReg = isSwift ? importSwiftReg : importReg;
				const currHeaderReg = isSwift ? headerSwiftReg : headerReg;

				let importArray = [];
				let headerLine = null;
				let alinkLine = null;
				let createLine = null;
				let createOption = null; // 'c'=剪切板, 'f'=路径, null=自动
				let guardLine = null;
				let searchLine = null;

				const lineArray = data.split('\n');
				lineArray.forEach(element => {
					const lineVal = element.trim();
					let normalizedLineVal = triggerSymbol.stripTriggerPrefix(lineVal);
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
					const createMatch = normalizedLineVal.match(createLineRegex);
					if (createMatch) {
						createLine = lineVal;
						createOption = createMatch[1] === '-c' ? 'c' : (createMatch[1] === '-f' ? 'f' : null);
					}
					if (normalizedLineVal.startsWith(guardMarkShort) || normalizedLineVal.startsWith(guardAlias)) {
						guardLine = normalizedLineVal;
					}
					if (normalizedLineVal.startsWith(searchMarkShort) || normalizedLineVal.startsWith(searchMarkLong) || normalizedLineVal.startsWith(searchAlias)) {
						searchLine = normalizedLineVal;
					}
				});

				if (createLine) {
					handleCreateTrigger(specFile, updateFile, relativePath, createOption);
				}

				if (guardLine) {
					handleGuardTrigger(specFile, updateFile, data, guardLine);
				}

				if (searchLine) {
					handleSearchTrigger(specFile, updateFile, relativePath, searchLine);
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
	const sym = triggerSymbol.TRIGGER_SYMBOL;
	let completionKey = null;
	if (inputWord.includes(sym)) {
		const parts = inputWord.split(sym).map(p => p.trim()).filter(Boolean);
		if (parts.length >= 2 && parts[parts.length - 1] === alinkMark) {
			completionKey = parts[parts.length - 2];
		}
	}
	if (completionKey != null) {
		cache.getLinkCache(specFile).then(function (linkCache) {
			if (linkCache) {
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

async function handleCreateTrigger(specFile, fullPath, relativePath, createOption) {
	const fs = require('fs');
	const path = require('path');
	const { execSync } = require('child_process');

	const projectRoot = path.dirname(specFile);
	// createOption: 'c'=强制剪切板（读剪贴板并静默创建或打开）, 'f'=强制路径（只打开 Dashboard）, null=不做抉择，只打开 Dashboard 由用户自己点 Scan File / Use Copied Code

	// 1. 仅 -c 时读剪贴板；无选项或 -f 不读，不做抉择
	let textToExtract = '';
	if (createOption === 'c') {
		try {
			if (process.platform === 'darwin') {
				textToExtract = execSync('pbpaste', { encoding: 'utf8' }).trim();
			}
		} catch (e) {
			console.warn('[Watcher] Failed to read clipboard:', e.message);
		}
	}

	// 2. 移除文件中的标记（支持 as:create / as:c 及 -c/-f）
	try {
		const content = fs.readFileSync(fullPath, 'utf8');
		const newContent = content.replace(createRemoveRegex, '');
		fs.writeFileSync(fullPath, newContent, 'utf8');
	} catch (err) {
		console.error('[Watcher] Failed to remove as:create mark', err);
	}

	// 无选项：只打开 Dashboard，路径已填，由用户自己点 Scan File 或 Use Copied Code
	// -f 强制路径：打开 Dashboard 并带 autoScan=1，前端自动执行 Scan File（不检查剪切板）
	if (createOption !== 'c') {
		const autoScan = createOption === 'f' ? '&autoScan=1' : '';
		console.log(createOption === 'f' ? '[as:create -f] 已打开 Dashboard，自动执行 Scan File' : '[as:create] 已打开 Dashboard，请选择 Scan File（按当前文件）或 Use Copied Code（按剪贴板）');
		const url = `http://localhost:3000/?action=create&path=${encodeURIComponent(relativePath)}${autoScan}`;
		const openBrowser = require('../infra/openBrowser');
		openBrowser.openBrowserReuseTab(url, 'http://localhost:3000');
		return;
	}

	// -c 且无剪贴板：仍只打开 Dashboard，由用户粘贴后点 Use Copied Code
	if (textToExtract.length === 0) {
		console.log('[as:create -c] 剪贴板为空，已打开 Dashboard，可粘贴后点 Use Copied Code');
		const url = `http://localhost:3000/?action=create&path=${encodeURIComponent(relativePath)}`;
		const openBrowser = require('../infra/openBrowser');
		openBrowser.openBrowserReuseTab(url, 'http://localhost:3000');
		return;
	}

	// 3. 静默创建候选（剪贴板有内容时）：先按 Recipe MD 解析，不调用 AI；解析失败再走 AI
	const useSilent = process.env.ASD_CREATE_SILENT !== '0';
	if (useSilent) {
		try {
			const parseRecipeMd = require('../recipe/parseRecipeMd');
			const candidateService = require('../ai/candidateService');
			const headerResolution = require('../ai/headerResolution');

			const normalized = (arr) => arr.map(r => ({
				title: r.title,
				summary: r.summary || r.summary_cn || '',
				trigger: r.trigger,
				category: r.category || 'Utility',
				language: r.language === 'swift' ? 'swift' : 'objc',
				code: r.code,
				usageGuide: r.usageGuide || '',
				headers: r.headers || []
			}));

			// 3a. 优先多 Recipe 或完整 Recipe MD 解析，不调用 AI
			const allRecipes = parseRecipeMd.parseRecipeMdAll(textToExtract);
			if (allRecipes.length > 0) {
				const items = normalized(allRecipes);
				if (relativePath && items[0] && (!items[0].headers || items[0].headers.length === 0)) {
					try {
						const resolved = await headerResolution.resolveHeadersForText(projectRoot, relativePath, textToExtract);
						if (resolved && resolved.headers && resolved.headers.length > 0) {
							items[0].headers = resolved.headers;
							items[0].headerPaths = resolved.headerPaths;
							items[0].moduleName = resolved.moduleName;
						}
					} catch (_) {}
				}
				await candidateService.appendCandidates(projectRoot, '_watch', items, 'watch-create');
				const msg = allRecipes.length === 1
					? `已创建候选「${allRecipes[0].title}」，请在 Dashboard Candidates 页审核`
					: `已创建 ${allRecipes.length} 条候选，请在 Dashboard Candidates 页审核`;
				console.log(`✅ [as:create] ${msg}`);
				if (process.platform === 'darwin') {
					try {
						execSync(`osascript -e 'display notification "${msg.replace(/"/g, '\\"')}" with title "AutoSnippet"'`, { encoding: 'utf8' });
					} catch (_) {}
				}
				return;
			}
			if (parseRecipeMd.isCompleteRecipeMd(textToExtract)) {
				const one = parseRecipeMd.parseRecipeMd(textToExtract);
				if (one) {
					const item = normalized([one])[0];
					if (relativePath && (!item.headers || item.headers.length === 0)) {
						try {
							const resolved = await headerResolution.resolveHeadersForText(projectRoot, relativePath, textToExtract);
							if (resolved && resolved.headers && resolved.headers.length > 0) {
								item.headers = resolved.headers;
								item.headerPaths = resolved.headerPaths;
								item.moduleName = resolved.moduleName;
							}
						} catch (_) {}
					}
					await candidateService.appendCandidates(projectRoot, '_watch', [item], 'watch-create');
					console.log(`✅ [as:create] 已静默创建候选「${one.title}」，请在 Dashboard Candidates 页审核`);
					if (process.platform === 'darwin') {
						try {
							const msg = `已创建候选「${one.title}」，请在 Candidates 页审核`;
							execSync(`osascript -e 'display notification "${msg.replace(/"/g, '\\"')}" with title "AutoSnippet"'`, { encoding: 'utf8' });
						} catch (_) {}
					}
					return;
				}
			}

			// 3b. 非 Recipe MD 再走 AI
			const AiFactory = require('../ai/AiFactory');
			const ai = await AiFactory.getProvider(projectRoot);
			if (ai) {
				const lang = relativePath && /\.swift$/i.test(relativePath) ? 'swift' : 'objc';
				const result = await ai.summarize(textToExtract, lang);
				if (result && !result.error && result.title && result.code) {
					await candidateService.appendCandidates(projectRoot, '_watch', [result], 'watch-create');
					console.log(`✅ [as:create] 已静默创建候选「${result.title}」，请在 Dashboard Candidates 页审核`);
					if (process.platform === 'darwin') {
						try {
							const msg = `已创建候选「${result.title}」，请在 Candidates 页审核`;
							execSync(`osascript -e 'display notification "${msg.replace(/"/g, '\\"')}" with title "AutoSnippet"'`, { encoding: 'utf8' });
						} catch (_) {}
					}
					return;
				}
			}
		} catch (e) {
			console.warn('[Watcher] 静默创建候选失败，回退到打开浏览器:', e.message);
		}
	}

	// 4. 回退：剪贴板有内容但静默创建失败，打开浏览器并带 source=clipboard 供页面粘贴
	const url = `http://localhost:3000/?action=create&path=${encodeURIComponent(relativePath)}&source=clipboard`;
	const openBrowser = require('../infra/openBrowser');
	openBrowser.openBrowserReuseTab(url, 'http://localhost:3000');
}

async function handleDraftFile(specFile, fullPath, relativePath, content) {
	const path = require('path');
	const projectRoot = path.dirname(specFile);

	if (!content || content.trim().length < 20) return;

	try {
		const parseRecipeMd = require('../recipe/parseRecipeMd');
		const candidateService = require('../ai/candidateService');

		// 优先按多 Recipe 约定解析（每个 Recipe 以 --- 开头，块间用空行 + --- 分隔）
		const allRecipes = parseRecipeMd.parseRecipeMdAll(content);
		const normalized = (arr) => arr.map(r => ({
			title: r.title,
			summary: r.summary || r.summary_cn || '',
			trigger: r.trigger,
			category: r.category || 'Utility',
			language: r.language === 'swift' ? 'swift' : 'objc',
			code: r.code,
			usageGuide: r.usageGuide || '',
			headers: r.headers || []
		}));

		if (allRecipes.length > 0) {
			const items = normalized(allRecipes);
			await candidateService.appendCandidates(projectRoot, '_draft', items, 'draft-file');
			const msg = allRecipes.length === 1
				? `已创建候选「${allRecipes[0].title}」，请在 Dashboard Candidates 页审核`
				: `已创建 ${allRecipes.length} 条候选，请在 Dashboard Candidates 页审核`;
			console.log(`✅ [_draft] ${msg}`);
			if (process.platform === 'darwin') {
				try {
					const { execSync } = require('child_process');
					execSync(`osascript -e 'display notification "${msg.replace(/"/g, '\\"')}" with title "AutoSnippet"'`, { encoding: 'utf8' });
				} catch (_) {}
			}
			return;
		}

		// 单块完整 Recipe 或非约定格式：走单条解析或 AI
		let result = null;
		if (parseRecipeMd.isCompleteRecipeMd(content)) {
			result = parseRecipeMd.parseRecipeMd(content);
			if (result) {
				result = {
					title: result.title,
					summary: result.summary || result.summary_cn || '',
					trigger: result.trigger,
					category: result.category || 'Utility',
					language: result.language === 'swift' ? 'swift' : 'objc',
					code: result.code,
					usageGuide: result.usageGuide || '',
					headers: result.headers || []
				};
			}
		}
		if (!result) {
			const AiFactory = require('../ai/AiFactory');
			const ai = await AiFactory.getProvider(projectRoot);
			if (ai) {
				const lang = /\.swift$/i.test(relativePath) ? 'swift' : 'objc';
				const extracted = await ai.summarize(content, lang);
				if (extracted && !extracted.error && extracted.title && extracted.code) {
					result = {
						title: extracted.title,
						summary: extracted.summary || extracted.summary_cn || '',
						trigger: extracted.trigger || '@' + (extracted.title || 'recipe'),
						category: extracted.category || 'Utility',
						language: (extracted.language || 'objc').toLowerCase().startsWith('swift') ? 'swift' : 'objc',
						code: extracted.code,
						usageGuide: extracted.usageGuide_cn || extracted.usageGuide_en || '',
						headers: extracted.headers || []
					};
				}
			}
		}
		if (result) {
			await candidateService.appendCandidates(projectRoot, '_draft', [result], 'draft-file');
			console.log(`✅ [_draft] 已创建候选「${result.title}」，请在 Dashboard Candidates 页审核`);
			if (process.platform === 'darwin') {
				try {
					const msg = `已创建候选「${result.title}」，请在 Candidates 页审核`;
					const { execSync } = require('child_process');
					execSync(`osascript -e 'display notification "${msg.replace(/"/g, '\\"')}" with title "AutoSnippet"'`, { encoding: 'utf8' });
				} catch (_) {}
			}
		}
	} catch (e) {
		console.warn('[Watcher] 草稿文件解析失败:', e.message);
	}
}

async function handleSearchTrigger(specFile, fullPath, relativePath, searchLine) {
	const path = require('path');
	const fs = require('fs');

	// 环境变量 ASD_SEARCH_USE_BROWSER=1 时回退到打开浏览器
	if (process.env.ASD_SEARCH_USE_BROWSER === '1') {
		const keyword = searchLine.replace(/^\/\/\s*(?:autosnippet:search|as:search|as:s)\s*/, '').trim();
		const url = `http://localhost:3000/?action=search&q=${encodeURIComponent(keyword)}&path=${encodeURIComponent(relativePath)}`;
		const openBrowser = require('../infra/openBrowser');
		openBrowser.openBrowserReuseTab(url, 'http://localhost:3000');
		return;
	}

	const keyword = searchLine
		.replace(/^\/\/\s*(?:autosnippet:search|as:search|as:s)\s*/, '')
		.trim();

	const projectRoot = path.dirname(specFile);
	const searchService = require('../search/searchService');
	const nativeUi = require('../infra/nativeUi');

	// 优先语义搜索，失败则关键词搜索
	const filter = {};
	const ext = path.extname(fullPath).toLowerCase();
	if (ext === '.swift') filter.language = 'swift';
	else if (ext === '.m' || ext === '.h') filter.language = 'objc';

	const results = await searchService.search(projectRoot, keyword, { semantic: true, limit: 8, filter: Object.keys(filter).length > 0 ? filter : undefined });
	if (results.length === 0) {
		const msg = keyword ? `「${keyword}」未找到匹配的 Recipe/Snippet` : '未找到匹配内容';
		console.log(`[as:search] ${msg}`);
		if (process.platform === 'darwin') {
			try {
				const notifier = require('../infra/notifier');
				notifier.notify(msg, { title: 'AutoSnippet', subtitle: 'as:search' });
			} catch (_) {}
		}
		return;
	}

	console.log(`[as:search] 找到 ${results.length} 个匹配，请选择...`);
	const titles = results.map(r => r.title);
	const idx = await nativeUi.pickFromList(titles, 'AutoSnippet 搜索结果', '请选择要插入的代码:');
	if (idx < 0) return;

	const selected = results[idx];
	const code = selected.code || selected.content || '';
	const confirmed = await nativeUi.showPreview(selected.title, code);
	if (!confirmed) return;

	// 替换标记行为代码
	const triggerSymbol = require('../infra/triggerSymbol');
	const raw = fs.readFileSync(fullPath, 'utf8');
	const lines = raw.split(/\r?\n/);
	const searchMark = /\/\/\s*(?:autosnippet:search|as:search|as:s)(\s|$)/;
	let found = -1;
	for (let i = 0; i < lines.length; i++) {
		const t = triggerSymbol.stripTriggerPrefix(lines[i].trim()).trim();
		if (searchMark.test(t) || t === '// as:search' || t.startsWith('// as:search ') || t === '// as:s' || t.startsWith('// as:s ') || t.startsWith('// autosnippet:search')) {
			found = i;
			break;
		}
	}
	if (found >= 0) {
		const insertLines = String(code).split(/\r?\n/);
		const newLines = [...lines.slice(0, found), ...insertLines, ...lines.slice(found + 1)];
		fs.writeFileSync(fullPath, newLines.join('\n'), 'utf8');
		console.log(`✅ 已插入到 ${path.basename(fullPath)}`);
		try {
			const recipeStats = require('../recipe/recipeStats');
			recipeStats.recordRecipeUsage(projectRoot, {
				trigger: selected.trigger,
				recipeFilePath: selected.name,
				source: 'human'
			});
		} catch (_) {}
	}
}

async function handleGuardTrigger(specFile, fullPath, code, guardLine) {
	const AiFactory = require('../ai/AiFactory');
	const fs = require('fs');
	const path = require('path');
	const { getInstance } = require('../context');

	const rest = guardLine.replace(/^\/\/\s*as:(?:guard|g)\s*/, '').trim();
	const scopeMatch = rest.toLowerCase().match(/^(file|target|project)$/);
	const scope = scopeMatch ? scopeMatch[1] : null;
	const keyword = scope ? '' : rest;
	console.log(`\n🛡️  [Project Guard] 正在检查文件: ${path.basename(fullPath)}${scope ? ` [审查规模: ${scope}]` : ' [审查规模: file]'}${keyword ? ` (目标: ${keyword})` : ''}`);

	// 1. 获取相关知识库内容
	const projectRoot = await require('../../bin/findPath').findProjectRoot(path.dirname(specFile));
	let recipesContent = '';
	/** 参与本次 Guard 的 Recipe 列表，用于埋点 recordRecipeUsage */
	const guardUsedRecipes = [];

	if (projectRoot) {
		const service = getInstance(projectRoot);
		const ai = await AiFactory.getProvider(projectRoot);
		const getTriggerFromContent = require('../recipe/parseRecipeMd').getTriggerFromContent;

		if (ai) {
			// 优先使用语义搜索获取上下文
			const queryText = keyword || code.substring(0, 500); // 如果没有关键字，用前500字做语义搜索
			try {
				const semanticResults = await service.search(queryText, { limit: 3, filter: { type: 'recipe' } });
				
				if (semanticResults.length > 0) {
					console.log(`🧠 已通过语义检索找到 ${semanticResults.length} 条相关规范...`);
					semanticResults.forEach(res => {
						const name = res.metadata?.name || res.metadata?.sourcePath || res.id;
						const content = res.content || '';
						recipesContent += `\n--- Recipe (Semantic Match): ${name} ---\n${content}\n`;
						guardUsedRecipes.push({
							trigger: getTriggerFromContent(content) || undefined,
							recipeFilePath: name
						});
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
						guardUsedRecipes.push({
							trigger: getTriggerFromContent(content) || undefined,
							recipeFilePath: file
						});
					}
				}
			}
		}
	}

	if (!recipesContent) {
		const msg = '未找到匹配的 Recipe 知识，跳过 Guard 检查';
		console.log(`ℹ️  ${msg}。`);
		if (process.platform === 'darwin') {
			try {
				const notifier = require('../infra/notifier');
				notifier.notify(msg, { title: 'AutoSnippet', subtitle: 'Guard' });
			} catch (_) {}
		}
		return;
	}

	// 埋点：参与本次 Guard 的每条 Recipe 记一次 guard 使用
	try {
		const recipeStats = require('../recipe/recipeStats');
		for (const r of guardUsedRecipes) {
			recipeStats.recordRecipeUsage(projectRoot, {
				trigger: r.trigger,
				recipeFilePath: r.recipeFilePath,
				source: 'guard'
			});
		}
	} catch (_) {}

	// 1.5 静态规则检查并写入违反项（无后缀或 target/project 时检查范围内所有文件，便于发现问题）
	const ext = path.extname(fullPath).toLowerCase();
	const language = ext === '.swift' ? 'swift' : (ext === '.m' || ext === '.h' ? 'objc' : null);
	const effectiveScope = scope || 'file';
	let staticViolations = [];
	if (language) {
		try {
			const guardRules = require('../guard/guardRules');
			if (effectiveScope === 'file') {
				staticViolations = guardRules.runStaticCheck(projectRoot, code, language, scope);
			} else {
				staticViolations = await guardRules.runStaticCheckForScope(projectRoot, effectiveScope, fullPath, scope);
			}
			const relativeFilePath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
			const fileAuditViolations = await guardRules.runFileAudit(projectRoot, code, language, relativeFilePath, fullPath, effectiveScope);
			if (fileAuditViolations.length > 0) {
				staticViolations = staticViolations.concat(fileAuditViolations);
			}
			if (staticViolations.length > 0) {
				console.log(`\n⚠️  [Guard 静态规则] 发现 ${staticViolations.length} 处${effectiveScope !== 'file' ? `（范围: ${effectiveScope}）` : ''}：`);
				staticViolations.forEach(v => {
					const loc = v.filePath ? `${v.filePath}:${v.line}` : `L${v.line}`;
					console.log(`   [${v.severity}] ${v.ruleId} ${loc}: ${v.message}`);
				});
			}
		} catch (e) {
			console.warn('[Guard] 静态规则检查失败:', e.message);
		}
	}
	const runId = 'run-' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
	const relativeFilePath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
	const run = {
		id: runId,
		filePath: relativeFilePath,
		triggeredAt: new Date().toISOString(),
		violations: staticViolations
	};
	try {
		const guardViolations = require('../guard/guardViolations');
		guardViolations.appendRun(projectRoot, run);
	} catch (_) {}

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

