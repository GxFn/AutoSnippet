function registerSearchRoutes(app, ctx) {
	const { projectRoot, path, fs, AiFactory, triggerSymbol } = ctx;
	const Paths = require('../../../lib/infrastructure/config/Paths.js');
	const { analyzeContext } = require('../../../lib/search/contextAnalyzer.js');

	// ============================================================
	// 调试工具
	// ============================================================
	const DEBUG = process.env.ASD_DEBUG_SEARCH === '1' || process.env.DEBUG?.includes('search');
	
	function debug(taskName, step, data) {
		if (!DEBUG) return;
		const timestamp = new Date().toISOString().split('T')[1];
		console.log(`\n[${timestamp}] [Search:${taskName}] ${step}`, data ? JSON.stringify(data, null, 2) : '');
	}

	function debugError(taskName, step, error) {
		if (!DEBUG) return;
		const timestamp = new Date().toISOString().split('T')[1];
		console.error(`\n[${timestamp}] [Search:${taskName}] ❌ ${step}`, error?.message || error);
	}

	// ============================================================
	// 统一的搜索核心函数（共享给所有搜索 API）
	// ============================================================
	async function performUnifiedSearch(params) {
		const {
			keyword,
			targetName = null,
			currentFile = null,
			language = 'swift',
			limit = 10,
			allSearchMarks = null,
			fileContent = null // 可选的文件内容（避免重复读取）
		} = params;

		if (!keyword) {
			throw new Error('keyword is required');
		}

		const taskId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		debug(taskId, 'INIT', {
			keyword,
			targetName,
			currentFile,
			language,
			limit,
			hasFileContent: !!fileContent
		});

		const { getInstance } = require('../../../lib/context');
		const recipeStats = require('../../../lib/recipe/recipeStats');
		const service = getInstance(projectRoot);
		const rootSpec = require(Paths.getProjectSpecPath(projectRoot));

		// 1. 分析当前上下文（使用 analyzeContext 深度分析）
		debug(taskId, '1️⃣ Context Analysis Start', { targetName, currentFile, language });
		const contextInfo = await analyzeContext(projectRoot, { targetName, currentFile, language });
		debug(taskId, '1️⃣ Context Analysis Complete', contextInfo);

		let vectorResults = [];
		let keywordResults = [];

		// 2. 向量搜索
		debug(taskId, '2️⃣ Vector Search Start', { keyword, limit: limit + 5 });
		try {
			const ai = await AiFactory.getProvider(projectRoot);
			if (ai) {
				vectorResults = await service.search(keyword, { limit: limit + 5, filter: { type: 'recipe' } });
				vectorResults = vectorResults.map(r => ({ ...r, _vectorScore: r.similarity || 0 }));
				debug(taskId, '2️⃣ Vector Search Complete', {
					count: vectorResults.length,
					topResults: vectorResults.slice(0, 3).map(r => ({
						name: r.name,
						score: r._vectorScore
					}))
				});
			} else {
				debug(taskId, '2️⃣ Vector Search Skipped', { reason: 'No AI provider' });
			}
		} catch (e) {
			debugError(taskId, '2️⃣ Vector Search Failed', e);
		}

		// 3. 关键词搜索
		debug(taskId, '3️⃣ Keyword Search Start', { keyword });
		try {
			const recipesDir = Paths.getProjectRecipesPath(projectRoot, rootSpec);
			if (fs.existsSync(recipesDir)) {
				const keywordTerms = keyword.toLowerCase().split(/\s+/).filter(w => w.length > 1);
				debug(taskId, '3️⃣ Keyword Terms', { keywordTerms });
				
				// 从 contextInfo 获取丰富的上下文术语
				const contextTerms = [
					...contextInfo.fileInfo?.imports || [],
					...contextInfo.fileInfo?.classes || [],
					...contextInfo.targetInfo?.suggestedApis || []
				].map(t => t.toLowerCase());

				const getAllMd = (dirPath, list = []) => {
					const entries = fs.readdirSync(dirPath, { withFileTypes: true });
					for (const e of entries) {
						const full = path.join(dirPath, e.name);
						if (e.isDirectory() && !e.name.startsWith('.')) {
							getAllMd(full, list);
						} else if (e.isFile() && e.name.endsWith('.md')) {
							list.push(full);
						}
					}
					return list;
				};

				const allRecipes = getAllMd(recipesDir);
				for (const recipePath of allRecipes) {
					try {
						const content = fs.readFileSync(recipePath, 'utf8');
						const fileName = path.relative(recipesDir, recipePath).replace(/\\/g, '/');
						
						let matches = 0;
						let contextMatches = 0;
						const text = content.toLowerCase();
						const name = fileName.toLowerCase();

						// 主要关键词匹配
						for (const term of keywordTerms) {
							if (name.includes(term) || text.includes(term)) matches++;
						}

						// 上下文关键词匹配（权重更高）
						for (const contextTerm of contextTerms) {
							if (contextTerm && text.includes(contextTerm)) {
								contextMatches++;
							}
						}

						if (matches > 0 || contextMatches > 0) {
							const keywordScore = Math.min(1, (matches / Math.max(keywordTerms.length, 1)) * 0.6);
							const contextScore = Math.min(0.4, (contextMatches / Math.max(contextTerms.length, 1)) * 0.4);
							const totalScore = keywordScore + contextScore;

							keywordResults.push({
								name: fileName,
								content,
								_keywordScore: totalScore,
								_contextMatches: contextMatches,
								_isContextRelevant: contextMatches > 0
							});
						}
					} catch (e) {
						debugError(taskId, '3️⃣ Recipe Parse Error', { file: recipePath, error: e.message });
					}
				}
				debug(taskId, '3️⃣ Keyword Search Complete', {
					count: keywordResults.length,
					topResults: keywordResults.slice(0, 3).map(r => ({
						name: r.name,
						score: r._keywordScore,
						contextMatches: r._contextMatches
					}))
				});
			}
		} catch (e) {
			debugError(taskId, '3️⃣ Keyword Search Failed', e);
		}

		// 4. 合并和评分
		debug(taskId, '4️⃣ Merge & Score Start', {
			vectorCount: vectorResults.length,
			keywordCount: keywordResults.length
		});
		const mergedMap = new Map();
		
		for (const vr of vectorResults) {
			const key = vr.metadata?.name || vr.id || '';
			if (!mergedMap.has(key)) {
				mergedMap.set(key, {
					name: key,
					content: vr.content || '',
					_vectorScore: vr._vectorScore,
					_keywordScore: 0,
					...vr
				});
			}
		}

		for (const kr of keywordResults) {
			if (!mergedMap.has(kr.name)) {
				mergedMap.set(kr.name, kr);
			} else {
				const existing = mergedMap.get(kr.name);
				existing._keywordScore = kr._keywordScore;
				existing._contextMatches = kr._contextMatches;
				existing._isContextRelevant = kr._isContextRelevant;
			}
		}

		// 5. 智能评分：上下文相关性加权（统一的权重配置）
		let results = Array.from(mergedMap.values()).map(item => {
			const vectorScore = item._vectorScore || 0;
			const keywordScore = item._keywordScore || 0;
			const isContextRelevant = item._isContextRelevant || false;
			
			// 统一权重：平衡的上下文加权
			const contextBoost = isContextRelevant ? 1.3 : 1.0;
			const hybridScore = (vectorScore * 0.6 + keywordScore * 0.4) * contextBoost;
			
			return { 
				...item, 
				_hybridScore: hybridScore,
				_vectorScore: vectorScore, 
				_keywordScore: keywordScore,
				isContextRelevant 
			};
		});

		// 6. 权威分加权排序
		debug(taskId, '5️⃣ Hybrid Score Calculation', {
			count: results.length,
			topResults: results.slice(0, 3).map(r => ({
				name: r.name,
				hybridScore: r._hybridScore,
				vectorScore: r._vectorScore,
				keywordScore: r._keywordScore,
				isContextRelevant: r.isContextRelevant
			}))
		});
		try {
			const stats = recipeStats.getRecipeStats(projectRoot);
			const byFileEntries = Object.values(stats.byFile || {});
			
			debug(taskId, '6️⃣ Authority Scoring Start', {
				statsCount: Object.keys(stats.byFile || {}).length,
				totalByFileEntries: byFileEntries.length
			});

			results = results.map(item => {
				const key = path.basename(item.name);
				const entry = (stats.byFile || {})[key];
				const authorityScore = entry ? recipeStats.getAuthorityScore(entry, byFileEntries, {}) : 0;
				
				// 统一权重：平衡的得分公式
				const contextScore = item.isContextRelevant ? 0.5 : 0;
				const finalScore = item._hybridScore * 0.6 + (authorityScore || 0) * 0.3 + contextScore * 0.1;
				
				return {
					...item,
					similarity: finalScore,
					authority: entry?.authority || 0,
					usageCount: (entry?.guardUsageCount || 0) + (entry?.humanUsageCount || 0) + (entry?.aiUsageCount || 0),
					authorityScore: Math.round((authorityScore || 0) * 100) / 100,
					stats: entry ? {
						authority: entry.authority ?? 0,
						guardUsageCount: entry.guardUsageCount ?? 0,
						humanUsageCount: entry.humanUsageCount ?? 0,
						aiUsageCount: entry.aiUsageCount ?? 0,
						authorityScore: Math.round(authorityScore * 100) / 100
					} : undefined
				};
			});
		} catch (e) {
			console.warn('[Unified Search] Authority scoring failed:', e.message);
		}

		// 7. AI 多标记上下文评估（新增）
		if (allSearchMarks && Array.isArray(allSearchMarks) && allSearchMarks.length > 1) {
			try {
				const ai = await AiFactory.getProvider(projectRoot);
				if (ai) {
					const contextDescription = allSearchMarks.map((mark, idx) => 
						`搜索 ${idx + 1}: 关键词"${mark.keyword}"，代码上下文:\n${mark.context || ''}`
					).join('\n\n');

					const evalPrompt = `
用户在 Xcode 文件中有多个搜索标记：

${contextDescription}

请评估以下 Recipe 对这些搜索的整体相关性（1-100 分）：

Recipe: ${results[0]?.name || 'N/A'}
内容: ${results[0]?.content?.substring(0, 500) || 'N/A'}

只返回一个数字（1-100），表示相关性分数。
`;

					const aiEvalResult = await ai.generateText(evalPrompt, { maxTokens: 10 });
					const aiScore = parseInt(aiEvalResult.trim()) || 50;
					const aiBoost = Math.max(0, Math.min(1, aiScore / 100));

					results = results.map(r => ({
						...r,
						_aiRelevanceScore: aiScore,
						similarity: r.similarity * 0.7 + aiBoost * 0.3
					}));

					debug(taskId, '7️⃣ AI Evaluation Complete', {
						aiScore,
						aiBoost: aiBoost.toFixed(2),
						topResultFinalScore: results[0]?.similarity
					});
				}
			} catch (e) {
				debugError(taskId, '7️⃣ AI Evaluation Failed', e);
			}
		}

		// 8. 排序和限制
		debug(taskId, '8️⃣ Sort & Filter Start', { beforeCount: results.length, minSimilarity: vectorResults.length > 0 ? 0.3 : 0.2 });
		results.sort((a, b) => b.similarity - a.similarity);
		
		// 设置最小相似度阈值
		const minSimilarity = vectorResults.length > 0 ? 0.3 : 0.2;
		results = results.filter(r => r.similarity >= minSimilarity);
		
		debug(taskId, '8️⃣ After Filter', { afterCount: results.length, limit });
		results = results.slice(0, limit);

		debug(taskId, '✅ COMPLETE', {
			finalCount: results.length,
			topResults: results.slice(0, 3).map(r => ({
				name: r.name,
				similarity: r.similarity,
				authority: r.authority
			}))
		});

		return {
			results,
			contextInfo,
			hasAiEvaluation: allSearchMarks && Array.isArray(allSearchMarks) && allSearchMarks.length > 1
		};
	}

	// ============================================================
	// API 端点
	// ============================================================

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

	// API: Xcode 中的搜索触发 — 从代码注释 // as:s keyword 触发搜索
	// 现在使用统一的搜索核心，获得和 context-aware 相同的高质量结果
	app.post('/api/search/trigger-from-code', async (req, res) => {
		try {
			const { filePath, lineNumber, keyword, projectName, allSearchMarks } = req.body;
			
			if (!keyword) {
				return res.status(400).json({ error: 'keyword is required' });
			}

			// 1. 提取搜索关键词
			let searchKeyword = keyword.trim();
			const searchMatch = keyword.match(/(?:as:s|as:search)\s+(.+)$/i);
			if (searchMatch) {
				searchKeyword = searchMatch[1].trim();
			}

			if (!searchKeyword) {
				return res.status(400).json({ error: 'No keyword found in search mark' });
			}

			// 2. 推断 Target（从文件路径）
			// 2. 推断 Target（从文件路径）
			let inferredTargetName = null;
			if (filePath) {
				const pathParts = filePath.split('/');
				const sourcesIdx = pathParts.indexOf('Sources');
				// 修复: 当 Sources 存在时（包括索引 0），Target 是 Sources 后面的路径段
				if (sourcesIdx >= 0 && sourcesIdx < pathParts.length - 1) {
					inferredTargetName = pathParts[sourcesIdx + 1];
				} else {
					// 备选: 从文件名推断
					const fileName = pathParts[pathParts.length - 1] || '';
					const nameMatch = fileName.match(/^([A-Z][a-zA-Z]+)/);
					if (nameMatch) {
						inferredTargetName = nameMatch[1];
					}
				}
			}

			// 3. 读取文件内容（作为可选参数传入）
			let fileContent = '';
			let fileSize = 0;
			if (filePath) {
				const fullPath = path.resolve(projectRoot, filePath);
				if (fs.existsSync(fullPath)) {
					try {
						fileContent = fs.readFileSync(fullPath, 'utf8');
						fileSize = fileContent.length;
					} catch (e) {
						console.warn('[Trigger from Code] Failed to read file:', e.message);
					}
				}
			}

			// 3.1 如果可读到文件内容，优先从行号提取真实 keyword（避免前端缓存/旧值）
			let keywordSource = 'payload';
			if (fileContent && Number.isFinite(lineNumber) && lineNumber > 0) {
				const lines = fileContent.split(/\r?\n/);
				const lineText = lines[lineNumber - 1] || '';
				const lineMatch = lineText.match(/\/\/\s*(?:autosnippet:search|as:search|as:s)\s+(.+)$/i);
				if (lineMatch && lineMatch[1] && lineMatch[1].trim()) {
					searchKeyword = lineMatch[1].trim();
					keywordSource = 'file';
				}
			}

			// 📊 诊断日志：对比请求信息
			const requestInfo = {
				source: 'Xcode Real',
				keyword: searchKeyword,
				keywordSource: keywordSource,
				targetName: inferredTargetName,
				filePath: filePath,
				lineNumber: lineNumber,
				fileSize: fileSize,
				hasFileContent: fileContent.length > 0,
				hasAllSearchMarks: Array.isArray(allSearchMarks) && allSearchMarks.length > 0,
				allSearchMarksCount: Array.isArray(allSearchMarks) ? allSearchMarks.length : 0
			};
			console.log('[Trigger from Code] Request Info:', JSON.stringify(requestInfo, null, 2));

			// 4. 调用统一的搜索核心（使用 analyzeContext 进行深度分析）
			const searchStartTime = Date.now();
			const { results, contextInfo, hasAiEvaluation } = await performUnifiedSearch({
				keyword: searchKeyword,
				targetName: inferredTargetName,
				currentFile: filePath,
				language: 'swift',
				limit: 8,  // Xcode 优化
				allSearchMarks: allSearchMarks,
				fileContent: fileContent
			});
			const searchTime = Date.now() - searchStartTime;

			// 📊 诊断日志：搜索结果信息
			const resultInfo = {
				totalResults: results.length,
				topResult: results.length > 0 ? {
					name: results[0].name,
					similarity: Math.round(results[0].similarity * 100) / 100,
					isContextRelevant: results[0].isContextRelevant
				} : null,
				resultScores: results.slice(0, 5).map(r => ({
					name: r.name.split('/').pop(),
					similarity: Math.round(r.similarity * 100) / 100,
					contextRelevant: r.isContextRelevant
				})),
				contextAnalyzed: {
					imports: contextInfo?.fileInfo?.imports?.length || 0,
					classes: contextInfo?.fileInfo?.classes?.length || 0,
					functions: contextInfo?.fileInfo?.functions?.length || 0,
					suggestedApis: contextInfo?.targetInfo?.suggestedApis?.length || 0
				},
				searchTime: searchTime + 'ms',
				hasAiEvaluation: hasAiEvaluation
			};
			console.log('[Trigger from Code] Search Results:', JSON.stringify(resultInfo, null, 2));

			// 5. 清理结果为 Xcode 格式
			// 5.1. 使用 SearchServiceV2 为结果添加 Agent 评分
			let agentScores = new Map();
			try {
				const SearchServiceV2 = require('../../../lib/application/services/SearchServiceV2');
				const searchServiceV2 = new SearchServiceV2(projectRoot, {
					enableIntelligentLayer: true,
					enableLearning: false
				});

				// 生成 sessionId 和 userId
				const sessionId = `xcode-${filePath || 'general'}-${Date.now()}`;
				const userId = process.env.ASD_USER_ID || process.env.USER || process.env.USERNAME || 'unknown';

				// 对前 5 个结果调用 SearchServiceV2 以获得 Agent 评分
				const agentResults = await searchServiceV2.search(searchKeyword, {
					limit: 5,
					sessionId,
					userId,
					context: { source: 'dashboard-xcode-watch' }
				});

				// 构建 agentScores map
				if (agentResults && Array.isArray(agentResults)) {
					for (const agentResult of agentResults) {
						if (agentResult.name && agentResult.qualityScore !== undefined) {
							agentScores.set(agentResult.name, {
								qualityScore: agentResult.qualityScore,
								recommendReason: agentResult.recommendReason || undefined
							});
						}
					}
				}
			} catch (e) {
				console.warn('[Trigger from Code] Agent scoring failed, using defaults:', e.message);
			}

			// 5.2. 清理结果为 Xcode 格式
			const cleanResults = results.map(r => {
				const agentScore = agentScores.get(r.name);
				return {
					name: r.name,
					snippet: r.content ? r.content.substring(0, 300) : '',
					similarity: Math.round(r.similarity * 100),
					isContextRelevant: r.isContextRelevant,
					authority: Math.round(r.authority * 100) / 100,
					usageCount: r.usageCount,
					stats: r.stats,
					aiRelevanceScore: r._aiRelevanceScore ? Math.round(r._aiRelevanceScore) : undefined,
					qualityScore: agentScore?.qualityScore,
					recommendReason: agentScore?.recommendReason
				};
			});

			const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
			res.set('Pragma', 'no-cache');
			res.set('Expires', '0');

			res.json({ 
				success: true,
				keyword: searchKeyword,
				targetName: inferredTargetName,
				results: cleanResults,
				total: cleanResults.length,
				hasAiEvaluation: hasAiEvaluation,
				searchTime: Date.now(),
				requestId: requestId
			});
		} catch (err) {
			console.error('[Trigger from Code Error]', err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 上下文感知搜索 — 基于当前文件/target 的智能推荐
	app.post('/api/search/context-aware', async (req, res) => {
		try {
			const { keyword, targetName, currentFile, language, limit = 10, allSearchMarks } = req.body;
			if (!keyword) return res.status(400).json({ error: 'Keyword is required' });

			// 📊 诊断日志：对比请求信息
			const requestInfo = {
				source: 'Dashboard Simulator',
				keyword: keyword,
				targetName: targetName,
				currentFile: currentFile,
				language: language,
				limit: limit,
				hasAllSearchMarks: Array.isArray(allSearchMarks) && allSearchMarks.length > 0,
				allSearchMarksCount: Array.isArray(allSearchMarks) ? allSearchMarks.length : 0
			};
			console.log('[Context-Aware Search] Request Info:', JSON.stringify(requestInfo, null, 2));

			// 使用统一的搜索核心
			const searchStartTime = Date.now();
			const { results, contextInfo, hasAiEvaluation } = await performUnifiedSearch({
				keyword,
				targetName,
				currentFile,
				language,
				limit,
				allSearchMarks
			});
			const searchTime = Date.now() - searchStartTime;

			// 📊 诊断日志：搜索结果信息
			const resultInfo = {
				totalResults: results.length,
				topResult: results.length > 0 ? {
					name: results[0].name,
					similarity: Math.round(results[0].similarity * 100) / 100,
					isContextRelevant: results[0].isContextRelevant
				} : null,
				resultScores: results.slice(0, 5).map(r => ({
					name: r.name.split('/').pop(),
					similarity: Math.round(r.similarity * 100) / 100,
					contextRelevant: r.isContextRelevant
				})),
				contextAnalyzed: {
					imports: contextInfo?.fileInfo?.imports?.length || 0,
					classes: contextInfo?.fileInfo?.classes?.length || 0,
					functions: contextInfo?.fileInfo?.functions?.length || 0,
					suggestedApis: contextInfo?.targetInfo?.suggestedApis?.length || 0
				},
				searchTime: searchTime + 'ms',
				hasAiEvaluation: hasAiEvaluation
			};
			console.log('[Context-Aware Search] Search Results:', JSON.stringify(resultInfo, null, 2));

			// 格式化结果供 Dashboard 使用
			// 使用 SearchServiceV2 为结果添加 Agent 评分
			let agentScores = new Map();
			try {
				const SearchServiceV2 = require('../../../lib/application/services/SearchServiceV2');
				const searchServiceV2 = new SearchServiceV2(projectRoot, {
					enableIntelligentLayer: true,
					enableLearning: false
				});

				// 生成 sessionId 和 userId
				const sessionId = `dashboard-${currentFile || 'general'}-${Date.now()}`;
				const userId = process.env.ASD_USER_ID || process.env.USER || process.env.USERNAME || 'unknown';

				// 对前 5 个结果调用 SearchServiceV2 以获得 Agent 评分
				const agentResults = await searchServiceV2.search(keyword, {
					limit: 5,
					sessionId,
					userId,
					context: { source: 'dashboard-context-aware' }
				});

				// 构建 agentScores map
				if (agentResults && Array.isArray(agentResults)) {
					for (const agentResult of agentResults) {
						if (agentResult.name && agentResult.qualityScore !== undefined) {
							agentScores.set(agentResult.name, {
								qualityScore: agentResult.qualityScore,
								recommendReason: agentResult.recommendReason || undefined
							});
						}
					}
				}
			} catch (e) {
				console.warn('[Context-Aware Search] Agent scoring failed, using defaults:', e.message);
			}

			// 格式化结果供 Dashboard 使用
			const cleanResults = results.map(r => {
				const agentScore = agentScores.get(r.name);
				return {
					name: r.name,
					content: r.content,
					similarity: Math.round(r.similarity * 100) / 100,
					authority: r.authority,
					usageCount: r.usageCount,
					stats: r.stats,
					isContextRelevant: r.isContextRelevant,
					matchType: r._vectorScore > r._keywordScore ? 'semantic' : 'keyword',
					metadata: r.metadata,
					aiRelevanceScore: r.aiRelevanceScore, // 多标记 AI 评分
					qualityScore: agentScore?.qualityScore,
					recommendReason: agentScore?.recommendReason
				};
			});

			res.json({ 
				results: cleanResults,
				context: contextInfo,
				total: cleanResults.length,
				hasAiEvaluation,
				searchTime: Date.now()
			});
		} catch (err) {
			console.error('[API Error]', err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 混合搜索（向量 + 关键词 + 权威分）- 最佳搜索体验
	app.post('/api/search/hybrid', async (req, res) => {
		try {
			const { keyword, limit = 10, category, language } = req.body;
			if (!keyword) return res.status(400).json({ error: 'Keyword is required' });

			const { getInstance } = require('../../../lib/context');
			const recipeStats = require('../../../lib/recipe/recipeStats');

			const service = getInstance(projectRoot);
			const rootSpec = require(Paths.getProjectSpecPath(projectRoot));

			let vectorResults = [];
			let keywordResults = [];

			// 1. 尝试向量搜索
			try {
				const ai = await AiFactory.getProvider(projectRoot);
				if (ai) {
					vectorResults = await service.search(keyword, { limit: limit + 5, filter: { type: 'recipe' } });
					vectorResults = vectorResults.map(r => ({ ...r, _vectorScore: r.similarity || 0 }));
				}
			} catch (e) {
				console.warn('[Hybrid Search] Vector search failed:', e.message);
			}

			// 2. 关键词搜索（回退 + 补充）
			try {
				const recipesDir = Paths.getProjectRecipesPath(projectRoot, rootSpec);
				if (fs.existsSync(recipesDir)) {
					const keywordTerms = keyword.toLowerCase().split(/\s+/).filter(w => w.length > 1);
					const getAllMd = (dirPath, list = []) => {
						const entries = fs.readdirSync(dirPath, { withFileTypes: true });
						for (const e of entries) {
							const full = path.join(dirPath, e.name);
							if (e.isDirectory() && !e.name.startsWith('.')) {
								getAllMd(full, list);
							} else if (e.isFile() && e.name.endsWith('.md')) {
								list.push(full);
							}
						}
						return list;
					};

					const allRecipes = getAllMd(recipesDir);
					for (const filePath of allRecipes) {
						const content = fs.readFileSync(filePath, 'utf8');
						const fileName = path.relative(recipesDir, filePath).replace(/\\/g, '/');
						
						// 计算关键词匹配分
						let matches = 0;
						let matchFields = [];
						const text = content.toLowerCase();
						const name = fileName.toLowerCase();

						for (const term of keywordTerms) {
							if (name.includes(term)) {
								matches++;
								matchFields.push('filename');
							} else if (text.includes(term)) {
								matches++;
								matchFields.push('content');
							}
						}

						if (matches > 0) {
							const keywordScore = Math.min(1, (matches / Math.max(keywordTerms.length, 1)) * 0.8);
							keywordResults.push({
								name: fileName,
								content,
								_keywordScore: keywordScore,
								_matchFields: [...new Set(matchFields)]
							});
						}
					}
				}
			} catch (e) {
				console.warn('[Hybrid Search] Keyword search failed:', e.message);
			}

			// 3. 合并结果（向量 + 关键词）
			const mergedMap = new Map();
			
			// 加入向量结果
			for (const vr of vectorResults) {
				const key = vr.metadata?.name || vr.id || '';
				if (!mergedMap.has(key)) {
					mergedMap.set(key, {
						name: key,
						content: vr.content || '',
						_vectorScore: vr._vectorScore,
						_keywordScore: 0,
						...vr
					});
				}
			}

			// 加入关键词结果
			for (const kr of keywordResults) {
				if (!mergedMap.has(kr.name)) {
					mergedMap.set(kr.name, kr);
				} else {
					const existing = mergedMap.get(kr.name);
					existing._keywordScore = kr._keywordScore;
					existing._matchFields = kr._matchFields;
				}
			}

			// 4. 综合评分（60% 向量 + 40% 关键词）
			let results = Array.from(mergedMap.values()).map(item => {
				const vectorScore = item._vectorScore || 0;
				const keywordScore = item._keywordScore || 0;
				const hybridScore = vectorScore * 0.6 + keywordScore * 0.4;
				return { ...item, _hybridScore: hybridScore, _vectorScore: vectorScore, _keywordScore: keywordScore };
			});

			// 5. 权威分加权排序
			try {
				const stats = recipeStats.getRecipeStats(projectRoot);
				const byFileEntries = Object.values(stats.byFile || {});
				
				results = results.map(item => {
					const key = path.basename(item.name);
					const entry = (stats.byFile || {})[key];
					const authorityScore = entry ? recipeStats.getAuthorityScore(entry, byFileEntries, {}) : 0;
					
					// 最终分数 = 混合分 70% + 权威分 30%
					const finalScore = item._hybridScore * 0.7 + (authorityScore || 0) * 0.3;
					
					return {
						...item,
						similarity: finalScore,
						authority: entry?.authority || 0,
						usageCount: (entry?.guardUsageCount || 0) + (entry?.humanUsageCount || 0) + (entry?.aiUsageCount || 0),
						authorityScore: Math.round((authorityScore || 0) * 100) / 100,
						stats: entry ? {
							authority: entry.authority ?? 0,
							guardUsageCount: entry.guardUsageCount ?? 0,
							humanUsageCount: entry.humanUsageCount ?? 0,
							aiUsageCount: entry.aiUsageCount ?? 0,
							authorityScore: Math.round(authorityScore * 100) / 100
						} : undefined
					};
				});
			} catch (e) {
				console.warn('[Hybrid Search] Authority scoring failed:', e.message);
			}

			// 6. 过滤（可选）
			if (category) {
				results = results.filter(r => {
					const meta = (r.content || '').match(/category:\s*(.*)/i);
					return meta && meta[1].toLowerCase().includes(category.toLowerCase());
				});
			}
			if (language) {
				results = results.filter(r => {
					const meta = (r.content || '').match(/language:\s*(.*)/i);
					return meta && meta[1].toLowerCase().includes(language.toLowerCase());
				});
			}

			// 7. 排序和限制
			results.sort((a, b) => b.similarity - a.similarity);
			results = results.slice(0, limit);

			// 8. 返回有效数据
			const cleanResults = results.map(r => ({
				name: r.name,
				content: r.content,
				similarity: Math.round(r.similarity * 100) / 100,
				authority: r.authority,
				usageCount: r.usageCount,
				stats: r.stats,
				matchType: r._vectorScore > r._keywordScore ? 'semantic' : 'keyword',
				metadata: r.metadata
			}));

			res.json({ 
				results: cleanResults,
				total: cleanResults.length,
				hasVector: vectorResults.length > 0,
				hasKeyword: keywordResults.length > 0,
				searchTime: Date.now()
			});
		} catch (err) {
			console.error('[API Error]', err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 语义搜索（保留向后兼容）
	app.post('/api/search/semantic', async (req, res) => {
		try {
			const { keyword, limit = 5 } = req.body;
			if (!keyword) return res.status(400).json({ error: 'Keyword is required' });

			const ai = await AiFactory.getProvider(projectRoot);
			if (!ai) return res.status(500).json({ error: 'AI Provider not configured' });

			const { getInstance } = require('../../../lib/context');
			const service = getInstance(projectRoot);
			const results = await service.search(keyword, { limit });

			res.json(results);
		} catch (err) {
			console.error('[API Error]', err);
			res.status(500).json({ error: err.message });
		}
	});
}

module.exports = {
	registerSearchRoutes,
};
