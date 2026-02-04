const Paths = require('../../../lib/infrastructure/config/Paths.js');

function registerCoreRoutes(app, ctx) {
	const {
		projectRoot,
		path,
		fs,
		AiFactory,
		specRepository,
		candidateService,
		unescapeSnippetLine,
	} = ctx;

	// API: 健康检查（用于检测 Dashboard 是否运行）
	app.get('/api/health', (req, res) => {
		res.json({ 
			service: 'AutoSnippet Dashboard',
			status: 'running',
			projectRoot: projectRoot,
			timestamp: Date.now()
		});
	});

	// API: Recipe 关键词查找（asd ui 启动时可用，供 Cursor/MCP/脚本调用）
	app.get('/api/recipes/search', async (req, res) => {
		try {
			const q = (req.query.q || req.query.keyword || '').trim().toLowerCase();
			const rootSpecPath = Paths.getProjectSpecPath(projectRoot);
			let rootSpec = {};
			try {
				rootSpec = JSON.parse(fs.readFileSync(rootSpecPath, 'utf8'));
			} catch (_) {}
			const recipesDir = Paths.getProjectRecipesPath(projectRoot, rootSpec);
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

	// 获取所有 Snippets 和 Recipes
	app.get('/api/data', async (req, res) => {
		try {
			const rootSpecPath = Paths.getProjectSpecPath(projectRoot);
			// 使用 specRepository 的增强读取逻辑（自动合并 snippets/ 目录）
			let rootSpec = specRepository.readSpecFile(rootSpecPath);
			const recipesDir = Paths.getProjectRecipesPath(projectRoot, rootSpec);

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
					const recipeStats = require('../../../lib/recipe/recipeStats');
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
							const recipeStats = require('../../../lib/recipe/recipeStats');
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
			const qualityRules = require('../../../lib/candidate/qualityRules');
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
			console.error('[API Error]', err);
			res.status(500).json({ error: err.message });
		}
	});
}

module.exports = {
	registerCoreRoutes,
};
