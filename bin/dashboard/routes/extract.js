function registerExtractRoutes(app, ctx) {
	const {
		projectRoot,
		path,
		fs,
		AiFactory,
		findPath,
		candidateService,
		headerResolution,
	} = ctx;

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
			console.error('[API Error]', err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 从文本提取 (针对剪贴板)；可选 relativePath 用于 // as:create 场景，按路径解析头文件
	// 若检测到完整 Recipe MD 格式（含多个时按约定 --- 分隔），直接解析，不调用 AI
	app.post('/api/extract/text', async (req, res) => {
		try {
			const { text, language, relativePath } = req.body;
			const parseRecipeMd = require('../../../lib/recipe/parseRecipeMd.js');

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
			console.error('[API Error]', err);
			res.status(500).json({ error: err.message, aiError: false });
		}
	});
}

module.exports = {
	registerExtractRoutes,
};
