function registerSnippetsRoutes(app, ctx) {
	const {
		projectRoot,
		path,
		fs,
		Paths,
		specRepository,
		markerLine,
		writeGuard,
		triggerSymbol,
		unescapeSnippetLine,
	} = ctx;

	// API: 保存 Snippet (更新 boxspec.json)
	app.post('/api/snippets/save', (req, res) => {
		try {
			const probe = writeGuard.checkWritePermission(projectRoot);
			if (!probe.ok) {
				return res.status(403).json({ error: probe.error || '没权限', code: 'RECIPE_WRITE_FORBIDDEN' });
			}
			const { snippet } = req.body;
			const rootSpecPath = Paths.getProjectSpecPath(projectRoot);

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
			console.error('[API Error]', err);
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
			const rootSpecPath = Paths.getProjectSpecPath(projectRoot);
			await specRepository.deleteSnippet(rootSpecPath, identifier, { syncRoot: true });
			res.json({ success: true });
		} catch (err) {
			console.error('[API Error]', err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 删除所有 Snippets
	app.post('/api/snippets/delete-all', async (req, res) => {
		try {
			const probe = writeGuard.checkWritePermission(projectRoot);
			if (!probe.ok) {
				return res.status(403).json({ error: probe.error || '没权限', code: 'RECIPE_WRITE_FORBIDDEN' });
			}
			const rootSpecPath = Paths.getProjectSpecPath(projectRoot);
			const spec = specRepository.readSpecFile(rootSpecPath);
			const count = spec?.list?.length || 0;

			if (count > 0) {
				// 获取所有 snippet identifiers
				const identifiers = spec.list.map(s => s.identifier);
				
				// 逐个删除（使用 deleteSnippet 确保清理分体文件和同步）
				for (const identifier of identifiers) {
					await specRepository.deleteSnippet(rootSpecPath, identifier, { syncRoot: true });
				}
			}

			res.json({ success: true, count });
		} catch (err) {
			console.error('[API Error]', err);
			res.status(500).json({ error: err.message });
		}
	});
}

module.exports = {
	registerSnippetsRoutes,
};
