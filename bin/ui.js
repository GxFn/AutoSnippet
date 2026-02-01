const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
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

const openBrowser = require('../lib/infra/openBrowser');
const openBrowserReuseTab = openBrowser.openBrowserReuseTab;
const writeGuard = require('../lib/writeGuard');
const rateLimit = require('../lib/rateLimit');

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
			const searchMark = /\/\/\s*(?:autosnippet:search|as:search|as:s)(\s|$)/;
			let found = -1;
			for (let i = 0; i < lines.length; i++) {
				const t = triggerSymbol.stripTriggerPrefix(lines[i].trim()).trim();
				if (searchMark.test(t) || t === '// as:search' || t.startsWith('// as:search ') || t === '// as:s' || t.startsWith('// as:s ') || t.startsWith('// autosnippet:search')) {
					found = i;
					break;
				}
			}
			if (found < 0) {
				return res.status(404).json({ error: 'No // as:search or // as:s line found in file' });
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

	// API: 上下文语义搜索（供 Agent/Skill 调用），返回项合并 recipe-stats 供 AI 可见
	app.post('/api/context/search', async (req, res) => {
		try {
			const { query, limit = 5, filter } = req.body;
			if (!query || typeof query !== 'string') {
				return res.status(400).json({ error: 'query is required and must be a string' });
			}
			const { getInstance } = require('../lib/context');
			const ai = await AiFactory.getProvider(projectRoot);
			if (!ai) return res.status(400).json({ error: 'AI 未配置，无法进行语义检索' });
			const service = getInstance(projectRoot);
			let items = await service.search(query, { limit, filter });
			try {
				const recipeStats = require('../lib/recipe/recipeStats');
				// MCP/Agent 引用：本次搜索返回的 Recipe 记一次 ai 使用
				for (const it of items) {
					const meta = it.metadata || {};
					if (meta.type !== 'recipe') continue;
					const sourcePath = meta.sourcePath || meta.source || it.id || '';
					const fileKey = sourcePath ? path.basename(sourcePath) : null;
					if (fileKey) recipeStats.recordRecipeUsage(projectRoot, { recipeFilePath: fileKey, source: 'ai' });
				}
				const stats = recipeStats.getRecipeStats(projectRoot);
				const byFileEntries = Object.values(stats.byFile || {});
				items = items.map((it) => {
					const meta = it.metadata || {};
					const fileKey = path.basename(meta.sourcePath || meta.source || it.id || '');
					const entry = fileKey ? (stats.byFile || {})[fileKey] : null;
					if (!entry) return it;
					const score = recipeStats.getAuthorityScore(entry, byFileEntries, {});
					return {
						...it,
						stats: {
							authority: entry.authority ?? 0,
							guardUsageCount: entry.guardUsageCount ?? 0,
							humanUsageCount: entry.humanUsageCount ?? 0,
							aiUsageCount: entry.aiUsageCount ?? 0,
							authorityScore: Math.round(score * 100) / 100
						}
					};
				});
			} catch (_) {}
			res.json({ items });
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 语义搜索
	app.post('/api/search/semantic', async (req, res) => {
		try {
			const { keyword, limit = 5 } = req.body;
			if (!keyword) return res.status(400).json({ error: 'Keyword is required' });

			const ai = await AiFactory.getProvider(projectRoot);
			if (!ai) return res.status(500).json({ error: 'AI Provider not configured' });

			const { getInstance } = require('../lib/context');
			const service = getInstance(projectRoot);
			const results = await service.search(keyword, { limit });

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
			const IndexingPipeline = require('../lib/context/IndexingPipeline');
			const result = await IndexingPipeline.run(projectRoot, { clear: true });
			res.json({ success: true, indexed: result.indexed, skipped: result.skipped, removed: result.removed });
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
				// 未保存内容进入候选池，分类 _recipe，无过期
				await candidateService.appendCandidates(projectRoot, '_recipe', result, 'new-recipe');
			}

			res.json({ result, isMarked });
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 从文本提取 (针对剪贴板)；可选 relativePath 用于 // as:create 场景，按路径解析头文件
	// 若检测到完整 Recipe MD 格式（含多个时按约定 --- 分隔），直接解析，不调用 AI
	app.post('/api/extract/text', async (req, res) => {
		try {
			const { text, language, relativePath } = req.body;
			const parseRecipeMd = require('../lib/recipe/parseRecipeMd.js');

			// 优先按多 Recipe 约定解析（每个 Recipe 以 --- 开头，块间用空行 + --- 分隔）
			const allRecipes = parseRecipeMd.parseRecipeMdAll(text);
			if (allRecipes.length > 0) {
				// 若传入路径，可为首条补充头文件解析
				if (relativePath && typeof relativePath === 'string' && allRecipes[0]) {
					try {
						const resolved = await headerResolution.resolveHeadersForText(projectRoot, relativePath, text);
						if (resolved.headers && resolved.headers.length > 0 && (!allRecipes[0].headers || allRecipes[0].headers.length === 0)) {
							allRecipes[0].headers = resolved.headers;
							allRecipes[0].headerPaths = resolved.headerPaths;
							allRecipes[0].moduleName = resolved.moduleName;
						}
					} catch (_) {}
				}
				await candidateService.appendCandidates(projectRoot, '_recipe', allRecipes, 'new-recipe');
				// 返回第一条供前端展示；多条时前端可提示「已加入 N 条候选」
				const first = allRecipes[0];
				if (allRecipes.length > 1) {
					first._multipleCount = allRecipes.length;
				}
				return res.json(first);
			}

			// 单块完整 Recipe MD
			if (parseRecipeMd.isCompleteRecipeMd(text)) {
				const result = parseRecipeMd.parseRecipeMd(text);
				if (result) {
					if (relativePath && typeof relativePath === 'string') {
						try {
							const resolved = await headerResolution.resolveHeadersForText(projectRoot, relativePath, text);
							if (resolved.headers && resolved.headers.length > 0 && (!result.headers || result.headers.length === 0)) {
								result.headers = resolved.headers;
								result.headerPaths = resolved.headerPaths;
								result.moduleName = resolved.moduleName;
							}
						} catch (_) {}
					}
					await candidateService.appendCandidates(projectRoot, '_recipe', [result], 'new-recipe');
					return res.json(result);
				}
			}

			const ai = await AiFactory.getProvider(projectRoot);
			if (!ai) {
				return res.status(500).json({ error: 'AI provider not available', aiError: true });
			}

			let result;
			try {
				result = await ai.summarize(text, language);
			} catch (aiErr) {
				console.error('[AI Error]', aiErr);
				return res.status(500).json({ error: `AI 识别失败: ${aiErr.message}`, aiError: true });
			}

			if (!result || result.error) {
				return res.status(500).json({ error: result?.error || 'AI 识别失败，未返回有效结果', aiError: true });
			}

			// 若由 // as:create 传入路径，则按该文件所在 target 解析头文件（与 create/headName 一致）
			if (relativePath && typeof relativePath === 'string' && result && !result.error) {
				const resolved = await headerResolution.resolveHeadersForText(projectRoot, relativePath, text);
				result.headers = Array.from(new Set([...(result.headers || []), ...resolved.headers]));
				result.headerPaths = resolved.headerPaths;
				result.moduleName = resolved.moduleName;
			}

			// 未保存内容进入候选池，分类 _recipe，无过期
			if (result && !result.error && result.title && result.code) {
				await candidateService.appendCandidates(projectRoot, '_recipe', [result], 'new-recipe');
			}

			res.json(result);
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message, aiError: false });
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
				let statsMap = {};
				try {
					const recipeStats = require('../lib/recipe/recipeStats');
					const stats = recipeStats.getRecipeStats(projectRoot);
					statsMap = stats.byFile || {};
				} catch (_) {}
				const byFileEntries = Object.values(statsMap);
				recipes = allMdFiles.map(filePath => {
					const content = fs.readFileSync(filePath, 'utf8');
					const relativePath = path.relative(recipesDir, filePath).replace(/\\/g, '/');
					const fileKey = path.basename(relativePath);
					const entry = statsMap[fileKey];
					let stats = null;
					if (entry) {
						try {
							const recipeStats = require('../lib/recipe/recipeStats');
							const score = recipeStats.getAuthorityScore(entry, byFileEntries, {});
							stats = {
								authority: entry.authority ?? 0,
								guardUsageCount: entry.guardUsageCount ?? 0,
								humanUsageCount: entry.humanUsageCount ?? 0,
								aiUsageCount: entry.aiUsageCount ?? 0,
								lastUsedAt: entry.lastUsedAt || null,
								authorityScore: Math.round(score * 100) / 100
							};
						} catch (_) {}
					}
					return { name: relativePath, content, stats };
				});
			}

			const aiConfig = AiFactory.getConfigSync(projectRoot);
			// 过滤过期项，_pending 排到底端；按质量分排序候选（高分靠前）
			const qualityRules = require('../lib/candidate/qualityRules');
			let candidates = candidateService.listCandidatesWithPrune(projectRoot);
			for (const [targetName, group] of Object.entries(candidates)) {
				if (group && Array.isArray(group.items)) {
					group.items.sort((a, b) => {
						const sa = qualityRules.evaluateCandidate(a);
						const sb = qualityRules.evaluateCandidate(b);
						return sb - sa;
					});
				}
			}
			const sorted = Object.entries(candidates).sort(([a], [b]) => {
				if (a === '_pending' && b !== '_pending') return 1;
				if (a !== '_pending' && b === '_pending') return -1;
				return a.localeCompare(b);
			});
			candidates = Object.fromEntries(sorted);

			res.json({ 
				rootSpec, 
				recipes, 
				candidates,
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

	// API: AI 翻译（中文 → 英文，用于 Recipe summary/usageGuide）
	app.post('/api/ai/translate', async (req, res) => {
		try {
			const { summary, usageGuide } = req.body;
			if (!summary && !usageGuide) {
				return res.json({ summary_en: '', usageGuide_en: '' });
			}
			const ai = await AiFactory.getProvider(projectRoot);
			const sys = 'You are a technical translator. Translate the following from Chinese to English. Keep technical terms (e.g. API names, class names) unchanged. Return ONLY valid JSON: { "summary_en": "...", "usageGuide_en": "..." }. Use empty string for missing input. Preserve Markdown in usageGuide.';
			const parts = [];
			if (summary) parts.push(`summary (摘要):\n${summary}`);
			if (usageGuide) parts.push(`usageGuide (使用指南):\n${usageGuide}`);
			const prompt = parts.join('\n\n');
			const text = await ai.chat(prompt, [], sys);
			const raw = (text || '').replace(/```json?\s*/gi, '').replace(/```\s*$/g, '').trim();
			let out = { summary_en: '', usageGuide_en: '' };
			try {
				const parsed = JSON.parse(raw);
				if (parsed.summary_en != null) out.summary_en = String(parsed.summary_en);
				if (parsed.usageGuide_en != null) out.usageGuide_en = String(parsed.usageGuide_en);
			} catch (_) {
				// 若解析失败，尝试提取第一段作为 summary_en
				if (summary) out.summary_en = raw.split('\n')[0] || summary;
			}
			res.json(out);
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

			const { getInstance } = require('../lib/context');
			const contextService = getInstance(projectRoot);
			const aiProvider = await AiFactory.getProvider(projectRoot);

			let filteredSnippets = [];
			let filteredRecipes = [];

			if (aiProvider) {
				try {
					const semanticResults = await contextService.search(prompt, { limit: 5, filter: { type: 'recipe' } });
					
					semanticResults.forEach(res => {
						if (res.metadata?.type === 'recipe') {
							const name = res.metadata?.name || res.metadata?.sourcePath || res.id;
							filteredRecipes.push(`--- RECIPE (Semantic): ${name} ---\n${res.content || ''}`);
						}
					});
				} catch (e) {
					console.warn('[Chat] Semantic search failed, falling back to keyword search:', e.message || e);
					const stats = await contextService.getStats();
					if (stats && stats.count === 0) {
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
			const probe = writeGuard.checkWritePermission(projectRoot);
			if (!probe.ok) {
				return res.status(403).json({ error: probe.error || '没权限', code: 'RECIPE_WRITE_FORBIDDEN' });
			}
			const clientId = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
			const rate = rateLimit.checkRecipeSave(projectRoot, clientId);
			if (!rate.allowed) {
				if (rate.retryAfter) res.setHeader('Retry-After', String(rate.retryAfter));
				return res.status(429).json({
					error: '保存过于频繁，请稍后再试',
					code: 'RECIPE_SAVE_RATE_LIMIT',
					retryAfter: rate.retryAfter
				});
			}
			const { name, content } = req.body;
			const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
			const recipesDir = fs.existsSync(rootSpecPath)
				? (() => { try { const s = JSON.parse(fs.readFileSync(rootSpecPath, 'utf8')); return path.join(projectRoot, s.recipes?.dir || 'Knowledge/recipes'); } catch (_) { return path.join(projectRoot, 'Knowledge/recipes'); } })()
				: path.join(projectRoot, 'Knowledge/recipes');
			if (!fs.existsSync(recipesDir)) fs.mkdirSync(recipesDir, { recursive: true });
			// 清理文件名：将 / 和 \ 替换为 -，避免 ENOENT；不用 path.basename 以免截断成最后一段（如 -unique.md）
			const rawFileName = name.endsWith('.md') ? name : `${name}.md`;
			const fileName = rawFileName.replace(/[/\\]/g, '-').replace(/\.\./g, '-');
			if (!fileName || fileName === '.md') {
				return res.status(400).json({ error: 'Invalid recipe name' });
			}
			const filePath = path.join(recipesDir, fileName);
			fs.writeFileSync(filePath, content, 'utf8');
			res.json({ success: true });

			// 增量更新语义索引（后台执行，不阻塞响应）
			(async () => {
				try {
					const ai = await AiFactory.getProvider(projectRoot);
					if (!ai) return;
					const { getInstance } = require('../lib/context');
					const service = getInstance(projectRoot);
					const sourcePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
					const body = (content || '').replace(/^---[\s\S]*?---/, '').trim();
					const vector = await ai.embed(body || content);
					const vec = Array.isArray(vector) && vector[0] !== undefined ? (Array.isArray(vector[0]) ? vector[0] : vector) : [];
					await service.upsert({
						id: `recipe_${fileName}`,
						content: body || content,
						vector: vec,
						metadata: { name: fileName, type: 'recipe', sourcePath }
					});
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
			const probe = writeGuard.checkWritePermission(projectRoot);
			if (!probe.ok) {
				return res.status(403).json({ error: probe.error || '没权限', code: 'RECIPE_WRITE_FORBIDDEN' });
			}
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
			const probe = writeGuard.checkWritePermission(projectRoot);
			if (!probe.ok) {
				return res.status(403).json({ error: probe.error || '没权限', code: 'RECIPE_WRITE_FORBIDDEN' });
			}
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
	app.post('/api/recipes/delete', async (req, res) => {
		try {
			const probe = writeGuard.checkWritePermission(projectRoot);
			if (!probe.ok) {
				return res.status(403).json({ error: probe.error || '没权限', code: 'RECIPE_WRITE_FORBIDDEN' });
			}
			const { name } = req.body;
			const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
			const recipesDir = fs.existsSync(rootSpecPath)
				? (() => { try { const s = JSON.parse(fs.readFileSync(rootSpecPath, 'utf8')); return path.join(projectRoot, s.recipes?.dir || 'Knowledge/recipes'); } catch (_) { return path.join(projectRoot, 'Knowledge/recipes'); } })()
				: path.join(projectRoot, 'Knowledge/recipes');
			const rawFileName = name.endsWith('.md') ? name : `${name}.md`;
			const fileName = rawFileName.replace(/[/\\]/g, '-').replace(/\.\./g, '-');
			if (!fileName || fileName === '.md') {
				return res.status(400).json({ error: 'Invalid recipe name' });
			}
			const filePath = path.join(recipesDir, fileName);
			if (fs.existsSync(filePath)) {
				fs.unlinkSync(filePath);
				try {
					const { getInstance } = require('../lib/context');
					const service = getInstance(projectRoot);
					const adapter = service.getAdapter();
					const sourcePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
					const items = await adapter.searchByFilter({ type: 'recipe', sourcePath });
					for (const item of items) {
						await service.remove(item.id);
					}
					if (items.length === 0) {
						await service.remove(`recipe_${fileName}`);
					}
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

	// API: 设置 Recipe 权威分（0～5）
	app.post('/api/recipes/set-authority', async (req, res) => {
		try {
			const { name, authority } = req.body;
			if (name == null || authority == null) {
				return res.status(400).json({ error: 'name and authority (0-5) are required' });
			}
			const v = Math.max(0, Math.min(5, Number(authority)));
			const recipeStats = require('../lib/recipe/recipeStats');
			recipeStats.setAuthority(projectRoot, { recipeFilePath: name }, v);
			res.json({ success: true, name, authority: v });
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 记录 Recipe 使用（供 MCP「确认代码使用」等场景，记为 human 使用）
	app.post('/api/recipes/record-usage', async (req, res) => {
		try {
			const { recipeFilePaths, source } = req.body;
			const list = Array.isArray(recipeFilePaths) ? recipeFilePaths : (recipeFilePaths != null ? [String(recipeFilePaths)] : []);
			const src = source === 'human' || source === 'guard' || source === 'ai' ? source : 'human';
			if (list.length === 0) {
				return res.status(400).json({ error: 'recipeFilePaths (array or single string) is required' });
			}
			const recipeStats = require('../lib/recipe/recipeStats');
			for (const name of list) {
				const fileKey = typeof name === 'string' && name.trim() ? path.basename(name.trim()) : null;
				if (fileKey) recipeStats.recordRecipeUsage(projectRoot, { recipeFilePath: fileKey, source: src });
			}
			res.json({ success: true, count: list.length, source: src });
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: Guard 规则表
	app.get('/api/guard/rules', (req, res) => {
		try {
			const guardRules = require('../lib/guard/guardRules');
			const data = guardRules.getGuardRules(projectRoot);
			res.json(data);
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 新增或更新一条 Guard 规则（Dashboard / AI 写入规则）
	app.post('/api/guard/rules', (req, res) => {
		try {
			const { ruleId, message, severity, pattern, languages, note, dimension } = req.body;
			if (!ruleId || !message || !severity || !pattern || !languages) {
				return res.status(400).json({ error: 'ruleId、message、severity、pattern、languages 为必填' });
			}
			const guardRules = require('../lib/guard/guardRules');
			const result = guardRules.addOrUpdateRule(projectRoot, ruleId, {
				message,
				severity,
				pattern,
				languages: Array.isArray(languages) ? languages : [languages].filter(Boolean),
				note,
				...(dimension === 'file' || dimension === 'target' || dimension === 'project' ? { dimension } : {})
			});
			res.json({ success: true, ...result });
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 根据用户语义描述由 AI 生成一条 Guard 规则（返回表单用，用户可修改后确认写入）
	app.post('/api/guard/rules/generate', async (req, res) => {
		try {
			const { description } = req.body;
			if (!description || typeof description !== 'string' || !description.trim()) {
				return res.status(400).json({ error: '请提供语义描述（description）' });
			}
			const ai = await AiFactory.getProvider(projectRoot);
			if (!ai) {
				return res.status(400).json({ error: 'AI 未配置，无法生成规则。请先在项目根配置 .env 或 boxspec.ai' });
			}
			const prompt = `用户希望添加一条 Guard 静态检查规则，语义描述如下：

「${description.trim()}」

请根据上述描述，生成一条规则。你只能回复一个合法的 JSON 对象，不要包含任何其他文字、markdown 或代码块标记。JSON 必须包含且仅包含以下字段：
- ruleId: 字符串，英文、短横线格式，如 no-main-thread-sync
- message: 字符串，违反时提示的说明（中文或英文）
- severity: 字符串，只能是 "error" 或 "warning"
- pattern: 字符串，用于对代码每一行匹配的正则表达式；在 JSON 中反斜杠需双写，如 "dispatch_sync\\\\s*\\\\("
- languages: 数组，元素为 "objc" 和/或 "swift"，如 ["objc","swift"]
- note: 字符串，可选，备注说明
- dimension: 字符串，可选，审查规模。只能是 "file"、"target"、"project" 之一，或不写该字段（表示任意规模均运行）。file=仅同文件内审查，target=仅同 SPM target 内，project=仅整个项目内。根据规则语义选择合适规模。

只输出这一份 JSON，不要解释。`;
			const raw = await ai.chat(prompt);
			let text = (raw && typeof raw === 'string' ? raw : String(raw)).trim();
			const jsonMatch = text.match(/\{[\s\S]*\}/);
			if (jsonMatch) text = jsonMatch[0];
			text = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
			const rule = JSON.parse(text);
			if (!rule.ruleId || !rule.message || !rule.pattern) {
				return res.status(400).json({ error: 'AI 返回的规则缺少 ruleId、message 或 pattern' });
			}
			const out = {
				ruleId: String(rule.ruleId).trim().replace(/\s+/g, '-'),
				message: String(rule.message || '').trim(),
				severity: rule.severity === 'error' ? 'error' : 'warning',
				pattern: String(rule.pattern || '').trim(),
				languages: Array.isArray(rule.languages) ? rule.languages.filter(l => l === 'objc' || l === 'swift') : ['objc', 'swift'],
				note: rule.note != null ? String(rule.note).trim() : '',
				dimension: rule.dimension === 'file' || rule.dimension === 'target' || rule.dimension === 'project' ? rule.dimension : ''
			};
			if (out.languages.length === 0) out.languages = ['objc', 'swift'];
			res.json(out);
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message || 'AI 生成规则失败' });
		}
	});

	// API: Guard 违反记录
	app.get('/api/guard/violations', (req, res) => {
		try {
			const guardViolations = require('../lib/guard/guardViolations');
			const data = guardViolations.getGuardViolations(projectRoot);
			res.json(data);
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 清空 Guard 违反记录
	app.post('/api/guard/violations/clear', (req, res) => {
		try {
			const guardViolations = require('../lib/guard/guardViolations');
			guardViolations.clearRuns(projectRoot);
			res.json({ success: true });
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

	// API: 获取 Target 将要扫描的文件列表（不调用 AI）。支持 body.target 或 body.targetName（按名称查 target）
	app.post('/api/spm/target-files', async (req, res) => {
		try {
			let target = req.body?.target;
			if (!target && req.body?.targetName) {
				const targets = await targetScanner.listAllTargets(projectRoot);
				target = targets.find(t => t.name === req.body.targetName);
				if (!target) {
					return res.status(404).json({ error: `未找到 Target: ${req.body.targetName}` });
				}
			}
			if (!target) {
				return res.status(400).json({ error: '需要 body.target 或 body.targetName' });
			}
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
				// 未保存内容进入候选池，分类 _pending，保留 24 小时
				await candidateService.appendCandidates(projectRoot, '_pending', recipes, 'spm-scan', 24);
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

	// API: 追加候选（供 Cursor/MCP 批量扫描：Cursor AI 提取后提交，无需项目内 AI）
	app.post('/api/candidates/append', async (req, res) => {
		try {
			const { targetName, items, source, expiresInHours } = req.body;
			if (!targetName || !Array.isArray(items) || items.length === 0) {
				return res.status(400).json({ error: '需要 targetName 与 items（数组，至少一条）' });
			}
			const safeSource = (source && typeof source === 'string') ? source : 'cursor-scan';
			const hours = typeof expiresInHours === 'number' ? expiresInHours : 24;
			await candidateService.appendCandidates(projectRoot, String(targetName), items, safeSource, hours);
			res.json({ ok: true, count: items.length, targetName: String(targetName) });
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
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

	// API: 按 target 全部移除
	app.post('/api/candidates/delete-target', async (req, res) => {
		try {
			const { targetName } = req.body;
			await candidateService.removeAllInTarget(projectRoot, targetName);
			res.json({ success: true });
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 候选与已有 Recipe 的相似度
	// 支持两种入参：① targetName + candidateId（从候选池查找）② candidate（直接传入内容，用于深度扫描等无 candidateId 的项）
	app.post('/api/candidates/similarity', async (req, res) => {
		try {
			const { targetName, candidateId, candidate } = req.body;
			let cand = null;
			if (targetName && candidateId) {
				const candidates = candidateService.listCandidates(projectRoot);
				const group = candidates[targetName];
				if (group && Array.isArray(group.items)) {
					cand = group.items.find(i => i.id === candidateId);
				}
			} else if (candidate && typeof candidate === 'object') {
				cand = { title: candidate.title, summary: candidate.summary, code: candidate.code, usageGuide: candidate.usageGuide };
			}
			if (!cand) {
				return res.json({ similar: [] });
			}
			const similarityService = require('../lib/candidate/similarityService');
			const similar = await similarityService.findSimilarRecipes(projectRoot, cand);
			res.json({ similar });
		} catch (err) {
			console.error(`[API Error]`, err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 获取单个 Recipe 内容（供候选对比弹窗）
	app.get('/api/recipes/get', (req, res) => {
		try {
			const name = req.query.name;
			if (!name) return res.status(400).json({ error: '需要 name 参数' });
			const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
			const rootSpec = specRepository.readSpecFile(rootSpecPath);
			const recipesDir = path.join(projectRoot, (rootSpec && (rootSpec.recipes?.dir || rootSpec.skills?.dir)) ? (rootSpec.recipes?.dir || rootSpec.skills?.dir) : 'Knowledge/recipes');
			const fileName = name.endsWith('.md') ? name : `${name}.md`;
			const recipesResolved = path.resolve(recipesDir);
			let filePath = path.resolve(recipesDir, fileName.replace(/\.\./g, ''));
			if (!filePath.startsWith(recipesResolved)) {
				return res.status(400).json({ error: '非法路径' });
			}
			if (!fs.existsSync(filePath)) {
				const findByName = (dir) => {
					const entries = fs.readdirSync(dir, { withFileTypes: true });
					for (const e of entries) {
						const full = path.join(dir, e.name);
						if (e.isDirectory() && !e.name.startsWith('.')) {
							const found = findByName(full);
							if (found) return found;
						} else if (e.name === fileName) return full;
					}
					return null;
				};
				filePath = findByName(recipesDir);
				if (!filePath) return res.status(404).json({ error: 'Recipe 不存在' });
			}
			const content = fs.readFileSync(filePath, 'utf8');
			res.json({ name: path.basename(filePath), content });
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

		const autoEmbed = require('../lib/context/autoEmbed');

	app.listen(port, () => {
		const url = `http://localhost:${port}`;
		console.log(`🚀 AutoSnippet Dashboard 运行在: ${url}`);
		openBrowserReuseTab(url);

		// 恰当时机自动执行 embed（可 ASD_AUTO_EMBED=0 关闭）
		autoEmbed.scheduleAutoEmbed(projectRoot, 5000);
	});
}

module.exports = { launch };
