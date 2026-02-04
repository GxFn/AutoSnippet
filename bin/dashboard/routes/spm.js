function registerSpmRoutes(app, ctx) {
	const { projectRoot, path, fs, AiFactory, targetScanner, spmDepMapUpdater, findPath, headerResolution, candidateService, Paths } = ctx;

	// API: 获取 SPM Targets
	app.get('/api/spm/targets', async (req, res) => {
		try {
			const targets = await targetScanner.listAllTargets(projectRoot);
			res.json(targets);
		} catch (err) {
			console.error('[API Error]', err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 获取项目 SPM 依赖关系图（优先读 spmmap 全解析结果，用于前端「依赖关系图」页展示）
	app.get('/api/dep-graph', async (req, res) => {
		try {
			const knowledgeDir = Paths.getProjectKnowledgePath(projectRoot);
			const mapPath = path.join(knowledgeDir, 'AutoSnippet.spmmap.json');
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
			console.error('[API Error]', err);
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
			console.error('[API Error]', err);
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
			console.error('[API Error]', err);
			let message = err.message || String(err);
			if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(message)) {
				message = `网络请求失败: ${message}。请检查：1) 是否在项目根（含 .env）运行 asd ui；2) 国内访问 Google 需在 .env 中设置 https_proxy/http_proxy；3) 或改用国内可用 provider，如在 .env 中设置 ASD_AI_PROVIDER=deepseek 并配置 ASD_DEEPSEEK_API_KEY。`;
			}
			res.status(500).json({ error: message });
		}
	});
}

module.exports = {
	registerSpmRoutes,
};
