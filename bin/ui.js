const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const open = require('open');
const AiFactory = require('../lib/ai/AiFactory');
const specRepository = require('../lib/snippet/specRepository');
const snippetInstaller = require('../lib/snippet/snippetInstaller');
const spmDepMapUpdater = require('../lib/spm/spmDepMapUpdater');
const watch = require('../lib/watch/fileWatcher');
const findPath = require('./findPath');
const targetScanner = require('../lib/spm/targetScanner');
const candidateService = require('../lib/ai/candidateService');
const headerResolution = require('../lib/ai/headerResolution');
const markerLine = require('../lib/snippet/markerLine');
const triggerSymbol = require('../lib/infra/triggerSymbol');

/**
 * 检测当前进程是否已有控制 Chromium 系浏览器的权限（与 openChrome.applescript 所需一致）
 * 用「控制浏览器」的同一类操作检测，避免与「System Events」权限不一致导致已授权仍提示
 * @returns {boolean}
 */
function hasMacOSBrowserControlGranted() {
	if (process.platform !== 'darwin') return false;
	const chromiumBrowsers = [
		'Google Chrome Canary',
		'Google Chrome',
		'Microsoft Edge',
		'Brave Browser',
		'Vivaldi',
		'Chromium'
	];
	for (const browser of chromiumBrowsers) {
		try {
			execSync(`osascript -e 'tell application "${browser}" to get name'`, {
				stdio: 'ignore'
			});
			return true;
		} catch (_) {
			// 未安装或未授权，尝试下一个
		}
	}
	return false;
}

/**
 * 在 macOS 上尝试复用已打开的同 URL 标签（如 http://localhost:3000），失败则用 open 新开
 * 可通过环境变量 ASD_UI_NO_REUSE_TAB=1 跳过复用，直接使用系统默认方式打开
 * @param {string} url 要打开的地址
 */
function openBrowserReuseTab(url) {
	const skipReuse = process.env.ASD_UI_NO_REUSE_TAB === '1' || process.env.ASD_UI_OPEN_REUSE === '0';
	if (skipReuse) {
		open(url);
		return;
	}
	if (process.platform === 'darwin') {
		const chromiumBrowsers = [
			'Google Chrome Canary',
			'Google Chrome',
			'Microsoft Edge',
			'Brave Browser',
			'Vivaldi',
			'Chromium'
		];
		const scriptPath = path.join(__dirname, 'openChrome.applescript');
		if (!fs.existsSync(scriptPath)) {
			open(url);
			return;
		}
		if (!hasMacOSBrowserControlGranted()) {
			console.log('💡 若已打开该页将复用标签；若系统弹出「辅助功能」权限请求，允许即可；未授权则自动新开标签。');
		}
		for (const browser of chromiumBrowsers) {
			try {
				execSync(`osascript "${scriptPath}" "${encodeURI(url)}" "${browser}"`, {
					cwd: __dirname,
					stdio: 'ignore'
				});
				return;
			} catch (_) {
				// 未授权、浏览器未安装或脚本失败，静默回退到 open(url)
			}
		}
	}
	open(url);
}

/** 将 spec 中存储的 XML 转义还原为原始代码，供前端编辑显示，避免保存时重复转义 */
function unescapeSnippetLine(str) {
	if (typeof str !== 'string') return str;
	return str
		.replace(/&gt;/g, '>')
		.replace(/&lt;/g, '<')
		.replace(/&amp;/g, '&');
}

/**
 * 启动 Dashboard Server
 * @param {string} projectRoot 
 * @param {number} port 
 * @param {{ forceBuild?: boolean }} options 
 */
function launch(projectRoot, port = 3000, options = {}) {
	const forceBuild = options.forceBuild === true || process.env.ASD_UI_BUILD === '1' || process.env.ASD_UI_REBUILD === '1';
	// 1. 在后台启动 Watcher
	console.log(`[Dashboard] 正在后台启动项目监听器...`);
	const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
	try {
		watch.watchFileChange(rootSpecPath, projectRoot, { quiet: true });
		console.log(`[Dashboard] ✅ 监听器已就绪`);
	} catch (err) {
		console.error(`[Dashboard] ❌ 监听器启动失败: ${err.message}`);
	}

	const app = express();
	app.use(cors());
	app.use(express.json());

	// API: Recipe 关键词查找（asd ui 启动时可用，供 Cursor/MCP/脚本调用）
	app.get('/api/recipes/search', async (req, res) => {
		try {
			const q = (req.query.q || req.query.keyword || '').trim().toLowerCase();
			const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
			let rootSpec = {};
			try {
				rootSpec = JSON.parse(fs.readFileSync(rootSpecPath, 'utf8'));
			} catch (_) {}
			const recipesDir = path.join(projectRoot, rootSpec.recipes?.dir || rootSpec.skills?.dir || 'Knowledge/recipes');
			if (!fs.existsSync(recipesDir)) {
				return res.json({ results: [], total: 0 });
			}
			const getAllMd = (dirPath, list = []) => {
				const entries = fs.readdirSync(dirPath, { withFileTypes: true });
				for (const e of entries) {
					const full = path.join(dirPath, e.name);
					if (e.isDirectory() && !e.name.startsWith('.')) {
						getAllMd(full, list);
					} else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
						list.push(full);
					}
				}
				return list;
			};
			const allMd = getAllMd(recipesDir);
			const results = [];
			for (const full of allMd) {
				const content = fs.readFileSync(full, 'utf8');
				const rel = path.relative(recipesDir, full).replace(/\\/g, '/');
				if (!q || rel.toLowerCase().includes(q) || content.toLowerCase().includes(q)) {
					results.push({ name: rel, path: full, content });
				}
			}
			res.json({ results, total: results.length });
		} catch (err) {
			console.error('[API Error]', err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: as:search 选即插 — 在 path 文件中找到 // as:search 行并替换为 content
	app.post('/api/insert-at-search-mark', async (req, res) => {
		try {
			const { path: relativePath, content } = req.body;
			if (!relativePath || content === undefined) {
				return res.status(400).json({ error: 'path and content are required' });
			}
			const fullPath = path.resolve(projectRoot, relativePath);
			if (!fullPath.startsWith(projectRoot)) {
				return res.status(400).json({ error: 'path must be under project root' });
			}
			if (!fs.existsSync(fullPath)) {
				return res.status(404).json({ error: 'File not found' });
			}
			const raw = fs.readFileSync(fullPath, 'utf8');
			const lines = raw.split(/\r?\n/);
			const searchMark = /\/\/\s*(?:autosnippet|as):search(\s|$)/;
			let found = -1;
			for (let i = 0; i < lines.length; i++) {
				const t = triggerSymbol.stripTriggerPrefix(lines[i].trim()).trim();
				if (searchMark.test(t) || t === '// as:search' || t.startsWith('// as:search ') || t.startsWith('// autosnippet:search')) {
					found = i;
					break;
				}
			}
			if (found < 0) {
				return res.status(404).json({ error: 'No // as:search line found in file' });
			}
			const insertLines = String(content).split(/\r?\n/);
			const newLines = [...lines.slice(0, found), ...insertLines, ...lines.slice(found + 1)];
			fs.writeFileSync(fullPath, newLines.join('\n'), 'utf8');
			res.json({ success: true, path: relativePath });
		} catch (err) {
			console.error('[API Error]', err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 语义搜索
	app.post('/api/search/semantic', async (req, res) => {
		try {
			const { keyword, limit = 5 } = req.body;
			if (!keyword) return res.status(400).json({ error: 'Keyword is required' });

			const VectorStore = require('../lib/ai/vectorStore');
			const store = new VectorStore(projectRoot);
			const ai = await AiFactory.getProvider(projectRoot);
			
			if (!ai) return res.status(500).json({ error: 'AI Provider not configured' });

			const queryVector = await ai.embed(keyword);
			const results = store.search(queryVector, limit);

			res.json(results);
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 执行 Install (同步到 Xcode)
	app.post('/api/commands/install', async (req, res) => {
		try {
			const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
			const result = snippetInstaller.addCodeSnippets(rootSpecPath);
			res.json(result);
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 执行 SPM Map 刷新
	app.post('/api/commands/spm-map', async (req, res) => {
		try {
			const result = await spmDepMapUpdater.updateSpmDepMap(projectRoot, { aggressive: true });
			res.json(result);
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 全量重建语义索引（等同 asd embed，可与「刷新项目」等合并使用）
	app.post('/api/commands/embed', async (req, res) => {
		try {
			const VectorStore = require('../lib/ai/vectorStore');
			const store = new VectorStore(projectRoot);
			const ai = await AiFactory.getProvider(projectRoot);
			if (!ai) {
				return res.status(400).json({ error: '未配置 AI，无法构建语义索引' });
			}
			store.clear();
			const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
			const recipesDir = fs.existsSync(rootSpecPath)
				? (() => { try { const s = JSON.parse(fs.readFileSync(rootSpecPath, 'utf8')); return path.join(projectRoot, s.recipes?.dir || 'Knowledge/recipes'); } catch (_) { return path.join(projectRoot, 'Knowledge/recipes'); } })()
				: path.join(projectRoot, 'Knowledge/recipes');
			let count = 0;
			if (fs.existsSync(recipesDir)) {
				const files = fs.readdirSync(recipesDir).filter(f => f.endsWith('.md'));
				for (const file of files) {
					const content = fs.readFileSync(path.join(recipesDir, file), 'utf8');
					const body = content.replace(/^---[\s\S]*?---/, '').trim();
					const vector = await ai.embed(body || content);
					store.upsert(`recipe_${file}`, vector, body || content, { name: file, type: 'recipe' });
					count++;
				}
			}
			store.save();
			res.json({ success: true, indexed: count });
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 从路径精准提取 (优先支持 // as:code 标记)
	app.post('/api/extract/path', async (req, res) => {
		try {
			const { relativePath } = req.body;
			const fullPath = path.resolve(projectRoot, relativePath);
			if (!fs.existsSync(fullPath)) {
				return res.status(404).json({ error: 'File not found' });
			}

			let content = fs.readFileSync(fullPath, 'utf8');
			
			// 1. 尝试使用标记锁定代码范围 (as:code 或 autosnippet:code)
			const markerRegex = /\/\/\s*(?:as|autosnippet):code\s*\n([\s\S]*?)\n\s*\/\/\s*(?:as|autosnippet):code/i;
			const match = content.match(markerRegex);
			
			let targetCode = '';
			let isMarked = false;

			if (match && match[1]) {
				targetCode = match[1].trim();
				isMarked = true;
			} else {
				targetCode = content.slice(0, 5000); // 未找到标记，回退到 AI 全文分析
			}

			// 2. 提取文件头部的 import (无论是否有标记，都从全文提取 imports)
			const importRegex = /^(?:#import|import)\s+.*$/gm;
			const headers = content.match(importRegex) || [];

			const ai = await AiFactory.getProvider(projectRoot);
			// 调用 AI 生成摘要和技能描述，但限定在我们锁定的 targetCode 上
			const result = await ai.extractRecipes(isMarked ? 'Marked Code' : 'Full File', [{ 
				name: relativePath, 
				content: targetCode 
			}]);

			// 注入提取到的真实 headers、相对路径与 target 名（与 create/headName 一致：<TargetName/Header.h> path）
			const targetRootDir = await findPath.findTargetRootDir(fullPath);
			const moduleName = targetRootDir ? path.basename(targetRootDir) : null;
			if (Array.isArray(result)) {
				for (const item of result) {
					item.headers = Array.from(new Set([...(item.headers || []), ...headers]));
					const headerList = item.headers || [];
					item.headerPaths = await Promise.all(headerList.map(h => headerResolution.resolveHeaderRelativePath(h, targetRootDir)));
					item.moduleName = moduleName;
				}
			}

			res.json({ result, isMarked });
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 从文本提取 (针对剪贴板)；可选 relativePath 用于 // as:create 场景，按路径解析头文件
	app.post('/api/extract/text', async (req, res) => {
		try {
			const { text, language, relativePath } = req.body;
			const ai = await AiFactory.getProvider(projectRoot);
			const result = await ai.summarize(text, language);

			// 若由 // as:create 传入路径，则按该文件所在 target 解析头文件（与 create/headName 一致）
			if (relativePath && typeof relativePath === 'string' && result && !result.error) {
				const resolved = await headerResolution.resolveHeadersForText(projectRoot, relativePath, text);
				result.headers = Array.from(new Set([...(result.headers || []), ...resolved.headers]));
				result.headerPaths = resolved.headerPaths;
				result.moduleName = resolved.moduleName;
			}

			res.json(result);
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

// 获取所有 Snippets 和 Recipes
	app.get('/api/data', async (req, res) => {
		try {
			const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
			// 使用 specRepository 的增强读取逻辑（自动合并 snippets/ 目录）
			let rootSpec = specRepository.readSpecFile(rootSpecPath);
			const recipesDir = path.join(projectRoot, (rootSpec && (rootSpec.recipes?.dir || rootSpec.skills?.dir)) ? (rootSpec.recipes?.dir || rootSpec.skills?.dir) : 'Knowledge/recipes');

			// ✅ 字段映射：确保前端拿到的是统一的字段名
			if (rootSpec && Array.isArray(rootSpec.list)) {
				const recipeFiles = fs.existsSync(recipesDir) ? fs.readdirSync(recipesDir).filter(f => f.endsWith('.md')) : [];
				const recipeContents = recipeFiles.map(f => fs.readFileSync(path.join(recipesDir, f), 'utf8'));

				rootSpec.list = rootSpec.list.map(s => {
					let category = s.category || '';
					if (!category) {
						// 尝试从相关的 recipe 文件中找分类
						const relatedRecipe = recipeContents.find(content => content.includes(`id: ${s.identifier}`));
						if (relatedRecipe) {
							const match = relatedRecipe.match(/category:\s*(.*)/);
							if (match) category = match[1].trim();
						}
					}

					return {
						...s,
						completionKey: s.completion || s.completionKey || '',
						language: s.languageShort || s.language || '',
						category: category || 'Utility', // 默认 Utility
						content: (s.body || s.content || []).map(unescapeSnippetLine),
						headers: (s.headers || []).map(unescapeSnippetLine),
						includeHeaders: !!s.includeHeaders
					};
				});
			}
			
			let recipes = [];
			if (fs.existsSync(recipesDir)) {
				// 递归获取所有 md 文件
				const getAllFiles = (dirPath, arrayOfFiles) => {
					const files = fs.readdirSync(dirPath);
					arrayOfFiles = arrayOfFiles || [];
					files.forEach(file => {
						const fullPath = path.join(dirPath, file);
						if (fs.statSync(fullPath).isDirectory()) {
							arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
						} else if (file.endsWith('.md') && file !== 'README.md') {
							arrayOfFiles.push(fullPath);
						}
					});
					return arrayOfFiles;
				};

				const allMdFiles = getAllFiles(recipesDir);
				recipes = allMdFiles.map(filePath => {
					const content = fs.readFileSync(filePath, 'utf8');
					const relativePath = path.relative(recipesDir, filePath);
					return { name: relativePath, content };
				});
			}

			const aiConfig = AiFactory.getConfigSync(projectRoot);
			res.json({ 
				rootSpec, 
				recipes, 
				candidates: candidateService.listCandidates(projectRoot),
				projectRoot,
				watcherStatus: 'active',
				aiConfig: { provider: aiConfig.provider, model: aiConfig.model }
			});
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 获取可用的 AI 提供商列表（供前端切换）
	app.get('/api/ai/providers', (req, res) => {
		try {
			const list = [
				{ id: 'google', label: 'Google Gemini', defaultModel: 'gemini-2.0-flash' },
				{ id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o' },
				{ id: 'deepseek', label: 'DeepSeek', defaultModel: 'deepseek-chat' },
				{ id: 'claude', label: 'Claude', defaultModel: 'claude-3-5-sonnet-20240620' },
				{ id: 'ollama', label: 'Ollama', defaultModel: 'llama3' },
				{ id: 'mock', label: 'Mock (测试)', defaultModel: 'mock-l3' }
			];
			res.json(list);
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 更新 AI 配置（写入 boxspec.ai，后续 getProvider 会优先读此配置）
	app.post('/api/ai/config', (req, res) => {
		try {
			const { provider, model } = req.body;
			if (!provider || typeof provider !== 'string') {
				return res.status(400).json({ error: 'provider is required' });
			}
			const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
			let spec = specRepository.readSpecFile(rootSpecPath);
			if (!spec) spec = { list: [] };
			const finalModel = model && typeof model === 'string' ? model : AiFactory._defaultModel(provider);
			spec.ai = { provider: provider.toLowerCase(), model: finalModel };
			specRepository.writeSpecFile(rootSpecPath, spec);
			res.json({ provider: spec.ai.provider, model: spec.ai.model });
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: AI 摘要
	app.post('/api/ai/summarize', async (req, res) => {
		try {
			const { code, language } = req.body;
			const ai = await AiFactory.getProvider(projectRoot);
			const result = await ai.summarize(code, language);
			res.json(result);
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: AI 聊天
	app.post('/api/ai/chat', async (req, res) => {
		try {
			const { prompt, history } = req.body;
			
			// 1. 获取所有数据
			const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
			const fullSpec = specRepository.readSpecFile(rootSpecPath);
			const allSnippets = fullSpec.list || [];
			const recipesDir = path.join(projectRoot, (fullSpec && (fullSpec.recipes?.dir || fullSpec.skills?.dir)) ? (fullSpec.recipes?.dir || fullSpec.skills?.dir) : 'Knowledge/recipes');

			const VectorStore = require('../lib/ai/vectorStore');
			const store = new VectorStore(projectRoot);
			const aiProvider = await AiFactory.getProvider(projectRoot);

			let filteredSnippets = [];
			let filteredRecipes = [];

			if (aiProvider) {
				try {
					const queryVector = await aiProvider.embed(prompt);
					const semanticResults = store.search(queryVector, 5);
					
					semanticResults.forEach(res => {
						if (res.metadata.type === 'recipe') {
							filteredRecipes.push(`--- RECIPE (Semantic): ${res.metadata.name} ---\n${res.content}`);
						}
					});
				} catch (e) {
					console.warn('[Chat] Semantic search failed, falling back to keyword search:', e.message || e);
					if (store.data.items.length === 0) {
						console.warn('[Chat] 提示: 运行 asd embed 可构建语义索引以启用语义检索');
					}
				}
			}

			// 2. 关键词预过滤 (回退或补全)
			if (filteredRecipes.length === 0) {
				const queryKeywords = prompt.toLowerCase().replace(/[^\w\s\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(w => w.length > 1);
				
				filteredSnippets = allSnippets.filter(s => {
					const text = `${s.title} ${s.summary} ${s.trigger} ${s.completion || ''}`.toLowerCase();
					return queryKeywords.some(kw => text.includes(kw));
				}).slice(0, 10);

				if (fs.existsSync(recipesDir)) {
					const recipeFiles = fs.readdirSync(recipesDir).filter(f => f.endsWith('.md') && f !== 'README.md');
					filteredRecipes = recipeFiles.filter(file => {
						const text = file.toLowerCase();
						return queryKeywords.some(kw => text.includes(kw));
					}).map(file => {
						return `--- RECIPE: ${file} ---\n${fs.readFileSync(path.join(recipesDir, file), 'utf8')}`;
					}).slice(0, 3);
				}
			}

			let readmeContent = '';
			const readmePath = path.join(recipesDir, 'README.md');
			if (fs.existsSync(readmePath)) {
				readmeContent = `[CORE PROJECT GUIDELINE]\n${fs.readFileSync(readmePath, 'utf8')}\n\n`;
			}

			const systemInstruction = `
				You are an expert iOS Development Assistant for this project.
				
				[CORE PROJECT GUIDELINE]
				${readmeContent}
				
				[RELEVANT SNIPPETS]
				${filteredSnippets.length > 0 ? filteredSnippets.map(s => `- ${s.title} (Trigger: ${s.completion || s.trigger}): ${s.summary}`).join('\n') : 'No specific snippets found.'}
				
				[RELEVANT RECIPES]
				${filteredRecipes.length > 0 ? filteredRecipes.join('\n\n') : 'No specific recipes found.'}
				
				Rules:
				1. If a snippet exists for a task, MUST mention its trigger key.
				2. Prioritize project-specific patterns from RECIPES over general iOS knowledge.
				3. Response should be concise and professional.
			`;

			const result = await aiProvider.chat(prompt, history, systemInstruction);
			res.json({ text: result });
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 保存 Recipe（保存后异步更新语义索引，无需单独 asd embed）
	app.post('/api/recipes/save', (req, res) => {
		try {
			const { name, content } = req.body;
			const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
			const recipesDir = fs.existsSync(rootSpecPath)
				? (() => { try { const s = JSON.parse(fs.readFileSync(rootSpecPath, 'utf8')); return path.join(projectRoot, s.recipes?.dir || 'Knowledge/recipes'); } catch (_) { return path.join(projectRoot, 'Knowledge/recipes'); } })()
				: path.join(projectRoot, 'Knowledge/recipes');
			if (!fs.existsSync(recipesDir)) fs.mkdirSync(recipesDir, { recursive: true });
			
			const fileName = name.endsWith('.md') ? name : `${name}.md`;
			const filePath = path.join(recipesDir, fileName);
			fs.writeFileSync(filePath, content, 'utf8');
			res.json({ success: true });

			// 增量更新语义索引（后台执行，不阻塞响应）
			(async () => {
				try {
					const ai = await AiFactory.getProvider(projectRoot);
					if (!ai) return;
					const VectorStore = require('../lib/ai/vectorStore');
					const store = new VectorStore(projectRoot);
					const body = (content || '').replace(/^---[\s\S]*?---/, '').trim();
					const vector = await ai.embed(body || content);
					store.upsert(`recipe_${fileName}`, vector, body || content, { name: fileName, type: 'recipe' });
					store.save();
				} catch (e) {
					console.warn('[Index] Recipe 语义索引更新失败:', e.message);
				}
			})();
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 保存 Snippet (更新 boxspec.json)
	app.post('/api/snippets/save', (req, res) => {
		try {
			const { snippet } = req.body;
			const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');

			// ✅ 映射 Dashboard Snippet 格式到内部 specRepository 格式（Trigger 输入框绑定的是 completionKey，保存时优先用其值以同步用户编辑）
			const triggerBase = snippet.completionKey ?? snippet.trigger ?? '';
			const sym = triggerSymbol.TRIGGER_SYMBOL;
			const normalizedTrigger = triggerSymbol.ensureTriggerPrefix(triggerBase);
			const categoryPart = snippet.category ? `${sym}${snippet.category}` : '';
			
			// 处理 body：确保是数组；若前端误传了已转义内容则先还原，再清理触发符，最后只转义一次写入
			const rawBody = snippet.body || snippet.content || [];
			let cleanedBody = Array.isArray(rawBody) ? rawBody.map(unescapeSnippetLine) : [];
			
			if (cleanedBody.length > 0) {
				let firstLine = String(cleanedBody[0]).trim();
				if (firstLine === normalizedTrigger || firstLine === triggerBase || firstLine === normalizedTrigger.slice(1)) {
					cleanedBody.shift();
				}
				const symEsc = sym.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
				while (cleanedBody.length && new RegExp('^' + symEsc + '$').test(String(cleanedBody[0]).trim())) cleanedBody.shift();
				if (cleanedBody.length) {
					firstLine = String(cleanedBody[0]).trim();
					if (new RegExp('^' + symEsc + '\\s*\\/\\/\\s*as:(include|import)\\s+').test(firstLine)) cleanedBody[0] = firstLine.replace(new RegExp('^' + symEsc + '\\s*'), '');
				}
			}

			if (snippet.includeHeaders && Array.isArray(snippet.headers) && snippet.headers.length > 0) {
				const isSwift = snippet.language === 'swift';
				const headerSet = new Set((snippet.headers || []).map(h => String(h).trim()).filter(Boolean));
				while (cleanedBody.length) {
					const line = String(cleanedBody[0]).trim();
					const isMarker = /^\/\/\s*as:(include|import)\s+/.test(line);
					if (line === '' || headerSet.has(line) || isMarker) cleanedBody.shift();
					else break;
				}
				const headerPaths = Array.isArray(snippet.headerPaths) ? snippet.headerPaths : [];
				const moduleName = snippet.moduleName || null;
				const markerLines = snippet.headers.map((h, idx) => markerLine.toAsMarkerLine(h, isSwift, headerPaths[idx], moduleName)).filter(Boolean);
				cleanedBody = [...markerLines, '', ...cleanedBody];
			}

			const internalSnippet = {
				identifier: snippet.identifier,
				title: snippet.category ? `[${snippet.category}] ${snippet.title.replace(/^\[.*?\]\s*/, '')}` : snippet.title,
				trigger: normalizedTrigger,
				completion: `${normalizedTrigger}${categoryPart}`, // 强制使用规范格式
				summary: snippet.summary,
				category: snippet.category,
				headers: snippet.headers, // 保存头文件列表
				includeHeaders: snippet.includeHeaders, // 保存是否引入的偏好
				languageShort: snippet.language === 'swift' ? 'swift' : 'objc',
				body: cleanedBody.map(line => {
					return String(line)
						.replace(/&/g, '&amp;')
						.replace(/</g, '&lt;')
						.replace(/>/g, '&gt;');
				})
			};

			specRepository.saveSnippet(rootSpecPath, internalSnippet, { syncRoot: true, installSingle: true });
			res.json({ success: true });
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 删除 Snippet
	app.post('/api/snippets/delete', async (req, res) => {
		try {
			const { identifier } = req.body;
			const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
			await specRepository.deleteSnippet(rootSpecPath, identifier, { syncRoot: true });
			res.json({ success: true });
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 删除 Recipe（同时从语义索引中移除）
	app.post('/api/recipes/delete', (req, res) => {
		try {
			const { name } = req.body;
			const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
			const recipesDir = fs.existsSync(rootSpecPath)
				? (() => { try { const s = JSON.parse(fs.readFileSync(rootSpecPath, 'utf8')); return path.join(projectRoot, s.recipes?.dir || 'Knowledge/recipes'); } catch (_) { return path.join(projectRoot, 'Knowledge/recipes'); } })()
				: path.join(projectRoot, 'Knowledge/recipes');
			const fileName = name.endsWith('.md') ? name : `${name}.md`;
			const filePath = path.join(recipesDir, fileName);
			if (fs.existsSync(filePath)) {
				fs.unlinkSync(filePath);
				try {
					const VectorStore = require('../lib/ai/vectorStore');
					const store = new VectorStore(projectRoot);
					store.remove(`recipe_${fileName}`);
				} catch (e) {
					console.warn('[Index] 语义索引移除失败:', e.message);
				}
				res.json({ success: true });
			} else {
				res.status(404).json({ error: 'File not found' });
			}
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 获取 SPM Targets
	app.get('/api/spm/targets', async (req, res) => {
		try {
			const targets = await targetScanner.listAllTargets(projectRoot);
			res.json(targets);
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 获取项目 SPM 依赖关系图（优先读 spmmap 全解析结果，用于前端「依赖关系图」页展示）
	app.get('/api/dep-graph', async (req, res) => {
		try {
			const mapPath = path.join(projectRoot, 'Knowledge', 'AutoSnippet.spmmap.json');
			let graph = null;
			if (fs.existsSync(mapPath)) {
				try {
					const raw = fs.readFileSync(mapPath, 'utf8');
					const map = raw ? JSON.parse(raw) : null;
					if (map && map.graph && map.graph.packages) graph = map.graph;
				} catch (_) {}
			}
			if (!graph || !graph.packages) {
				graph = spmDepMapUpdater.buildSpmProjectGraph(projectRoot);
			}
			if (!graph || !graph.packages) {
				return res.json({ nodes: [], edges: [], projectRoot: null });
			}
			const nodes = Object.keys(graph.packages).map((id) => ({
				id,
				label: id,
				type: 'package',
				packageDir: graph.packages[id]?.packageDir,
				packageSwift: graph.packages[id]?.packageSwift,
				targets: graph.packages[id]?.targets,
			}));
			const edges = [];
			for (const [from, tos] of Object.entries(graph.edges || {})) {
				for (const to of tos || []) {
					edges.push({ from, to });
				}
			}
			res.json({
				nodes,
				edges,
				projectRoot: graph.projectRoot,
				generatedAt: graph.generatedAt,
			});
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 获取 Target 将要扫描的文件列表（不调用 AI）
	app.post('/api/spm/target-files', async (req, res) => {
		try {
			const { target } = req.body;
			const files = await targetScanner.getTargetFilesContent(target);
			const scannedFiles = files.map(f => ({
				name: f.name,
				path: path.relative(projectRoot, f.path).replace(/\\/g, '/')
			}));
			res.json({ files: scannedFiles, count: scannedFiles.length });
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 扫描 Target 并提取 Recipes
	app.post('/api/spm/scan', async (req, res) => {
		try {
			const { target } = req.body;
			const files = await targetScanner.getTargetFilesContent(target);
			if (files.length === 0) {
				return res.json({ message: 'No source files found for this target.' });
			}

			const scannedFiles = files.map(f => ({
				name: f.name,
				path: path.relative(projectRoot, f.path).replace(/\\/g, '/')
			}));

			const ai = await AiFactory.getProvider(projectRoot);
			const recipes = await ai.extractRecipes(target.name, files);
			// 为每条 recipe 的 headers 解析相对路径并带上 target 名（与 create/headName 一致：<TargetName/Header.h> path）
			const targetRootDir = await findPath.findTargetRootDir(files[0].path);
			const moduleName = target.name;
			if (Array.isArray(recipes)) {
				for (const recipe of recipes) {
					const headerList = recipe.headers || [];
					recipe.headerPaths = await Promise.all(headerList.map(h => headerResolution.resolveHeaderRelativePath(h, targetRootDir)));
					recipe.moduleName = moduleName;
				}
			}
			res.json({ recipes, scannedFiles });
		} catch (err) {
			console.error(`[API Error]`, err);
			let message = err.message || String(err);
			if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(message)) {
				message = `网络请求失败: ${message}。请检查：1) 是否在项目根（含 .env）运行 asd ui；2) 国内访问 Google 需在 .env 中设置 https_proxy/http_proxy；3) 或改用国内可用 provider，如在 .env 中设置 ASD_AI_PROVIDER=deepseek 并配置 ASD_DEEPSEEK_API_KEY。`;
			}
			res.status(500).json({ error: message });
		}
	});

	// API: 删除候选内容
	app.post('/api/candidates/delete', async (req, res) => {
		try {
			const { targetName, candidateId } = req.body;
			await candidateService.removeCandidate(projectRoot, targetName, candidateId);
			res.json({ success: true });
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// 静态资源（前端编译后的代码）；若未构建则自动在包目录执行 install + build（-g 安装也适用）
	const pkgRoot = path.resolve(__dirname, '..');
	const dashboardDir = path.join(pkgRoot, 'dashboard');
	let distPath = path.join(dashboardDir, 'dist');
	const needBuild = !fs.existsSync(distPath) || forceBuild;
	if (needBuild) {
		if (forceBuild) {
			console.log('🔄 启动前重新构建 Dashboard...');
		} else {
			console.log('⚠️	未检测到 dashboard/dist，正在自动构建（首次约需 1–2 分钟）...');
		}
		const { execSync } = require('child_process');
		try {
			if (!fs.existsSync(path.join(dashboardDir, 'node_modules'))) {
				console.log('		安装 dashboard 依赖...');
				execSync('npm install', { cwd: dashboardDir, stdio: 'inherit' });
			}
			execSync('npm run build:dashboard', { cwd: pkgRoot, stdio: 'inherit' });
		} catch (err) {
			console.error('❌ 自动构建失败:', err.message);
		}
	}
	distPath = path.join(dashboardDir, 'dist');
	if (fs.existsSync(distPath)) {
		app.use('/', express.static(distPath));
		app.get(/^((?!\/api).)*$/, (req, res) => {
			res.sendFile(path.join(distPath, 'index.html'));
		});
	} else {
		app.get('/', (req, res) => {
			res.status(200).send(
				'<h1>AutoSnippet Dashboard Server</h1>' +
				'<p>前端构建失败。请检查：</p>' +
				'<ul><li>在 AutoSnippet 安装目录执行 <code>npm run build:dashboard</code></li>' +
				'<li>或到 <a href="https://github.com/GxFn/AutoSnippet">GitHub</a> 查看说明</li></ul>'
			);
		});
		console.warn('⚠️	 构建后仍无 dashboard/dist，请手动在包目录执行: npm run build:dashboard');
	}

	app.listen(port, () => {
		const url = `http://localhost:${port}`;
		console.log(`🚀 AutoSnippet Dashboard 运行在: ${url}`);
		openBrowserReuseTab(url);
	});
}

module.exports = { launch };
