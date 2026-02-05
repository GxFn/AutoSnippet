const Paths = require('../../../lib/infrastructure/config/Paths.js');

function registerRecipesRoutes(app, ctx) {
	const { projectRoot, path, fs, AiFactory, writeGuard, rateLimit, specRepository } = ctx;

	function normalizeRecipeFileName(name) {
		if (!name || typeof name !== 'string') {
			return { ok: false, error: 'Invalid recipe name' };
		}
		const trimmed = name.trim();
		if (!trimmed) return { ok: false, error: 'Invalid recipe name' };
		if (trimmed.includes('..') || /[\\/]/.test(trimmed)) {
			return { ok: false, error: 'Invalid recipe name' };
		}
		const rawFileName = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
		if (rawFileName === '.md') return { ok: false, error: 'Invalid recipe name' };
		return { ok: true, fileName: rawFileName };
	}

	// API: 保存 Recipe（保存后异步更新语义索引，无需单独 asd embed）
	app.post('/api/recipes/save', (req, res) => {
		try {
			const probe = writeGuard.checkWritePermission(projectRoot);
			if (!probe.ok) {
				// 调试输出：包含完整的错误信息
				console.error('[API /recipes/save] ❌ 权限检查失败');
				console.error('  projectRoot:', probe.debug?.projectRoot);
				console.error('  writeDir:', probe.debug?.writeDir);
				console.error('  probePath:', probe.debug?.probePath);
				console.error('  error:', probe.error);
				console.error('  debug:', JSON.stringify(probe.debug, null, 2));
				return res.status(403).json({ error: probe.error || '没权限', code: 'RECIPE_WRITE_FORBIDDEN', debug: probe.debug });
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
			const rootSpecPath = Paths.getProjectSpecPath(projectRoot);
			let rootSpec = null;
			try { if (fs.existsSync(rootSpecPath)) rootSpec = JSON.parse(fs.readFileSync(rootSpecPath, 'utf8')); } catch (_) {}
			const recipesDir = Paths.getProjectRecipesPath(projectRoot, rootSpec);
			if (!fs.existsSync(recipesDir)) fs.mkdirSync(recipesDir, { recursive: true });
			const normalized = normalizeRecipeFileName(name);
			if (!normalized.ok) {
				return res.status(400).json({ error: normalized.error, code: 'RECIPE_NAME_INVALID' });
			}
			const fileName = normalized.fileName;
			const filePath = path.join(recipesDir, fileName);
			fs.writeFileSync(filePath, content, 'utf8');
			res.json({ success: true });

			// 增量更新语义索引（后台执行，不阻塞响应）
			(async () => {
				try {
					const ai = await AiFactory.getProvider(projectRoot);
					if (!ai) return;
					const { getInstance } = require('../../../lib/context');
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
			console.error('[API Error]', err);
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
			const rootSpecPath = Paths.getProjectSpecPath(projectRoot);
			let rootSpecDel = null;
			try { if (fs.existsSync(rootSpecPath)) rootSpecDel = JSON.parse(fs.readFileSync(rootSpecPath, 'utf8')); } catch (_) {}
			const recipesDir = Paths.getProjectRecipesPath(projectRoot, rootSpecDel);
			const normalized = normalizeRecipeFileName(name);
			if (!normalized.ok) {
				return res.status(400).json({ error: normalized.error, code: 'RECIPE_NAME_INVALID' });
			}
			const fileName = normalized.fileName;
			const filePath = path.join(recipesDir, fileName);
			if (fs.existsSync(filePath)) {
				fs.unlinkSync(filePath);
				try {
					const { getInstance } = require('../../../lib/context');
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
			console.error('[API Error]', err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 获取单个 Recipe 内容（供候选对比弹窗）
	app.get('/api/recipes/get', (req, res) => {
		try {
			const name = req.query.name;
			if (!name) return res.status(400).json({ error: true, message: '需要 name 参数' });
			const rootSpecPath = Paths.getProjectSpecPath(projectRoot);
			const rootSpec = specRepository.readSpecFile(rootSpecPath);
			const recipesDir = Paths.getProjectRecipesPath(projectRoot, rootSpec);
			const fileName = name.endsWith('.md') ? name : `${name}.md`;
			const recipesResolved = path.resolve(recipesDir);
			let filePath = path.resolve(recipesDir, fileName.replace(/\.\./g, ''));
			if (!filePath.startsWith(recipesResolved)) {
				return res.status(400).json({ error: true, message: '非法路径' });
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
				if (!filePath) return res.status(404).json({ error: true, message: 'Recipe 不存在' });
			}
			const content = fs.readFileSync(filePath, 'utf8');
			res.json({ name: path.basename(filePath), content });
		} catch (err) {
			console.error('[API Error]', err);
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
			const recipeStats = require('../../../lib/recipe/recipeStats');
			recipeStats.setAuthority(projectRoot, { recipeFilePath: name }, v);
			res.json({ success: true, name, authority: v });
		} catch (err) {
			console.error('[API Error]', err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 记录 Recipe 使用（供 MCP「确认代码使用」等场景，记为 human 使用）
	app.post('/api/recipes/record-usage', async (req, res) => {
		try {
			const { recipeFilePaths, source } = req.body;
			const name = req.body?.name;
			const list = Array.isArray(recipeFilePaths)
				? recipeFilePaths
				: (recipeFilePaths != null ? [String(recipeFilePaths)] : (name != null ? [String(name)] : []));
			const src = source === 'human' || source === 'guard' || source === 'ai' ? source : 'human';
			if (list.length === 0) {
				return res.status(400).json({ error: 'recipeFilePaths (array or single string) is required' });
			}
			const recipeStats = require('../../../lib/recipe/recipeStats');
			for (const name of list) {
				const fileKey = typeof name === 'string' && name.trim() ? path.basename(name.trim()) : null;
				if (fileKey) recipeStats.recordRecipeUsage(projectRoot, { recipeFilePath: fileKey, source: src });
			}
			res.json({ success: true, count: list.length, source: src });
		} catch (err) {
			console.error('[API Error]', err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 清空权限检查缓存（强制重新检查 git push --dry-run）
	app.post('/api/admin/clear-permission-cache', (req, res) => {
		try {
			// 使用深度清除，同时清除内存缓存和 Node 模块缓存
			const result = writeGuard.deepClearCache ? writeGuard.deepClearCache(projectRoot) : writeGuard.clearCache(projectRoot);
			res.json({ 
				success: true, 
				...result,
				hint: '已清空权限缓存，下次操作将重新检查权限。'
			});
		} catch (err) {
			console.error('[API Error]', err);
			res.status(500).json({ error: err.message });
		}
	});

	// API: 删除所有 Recipes
	app.post('/api/recipes/delete-all', async (req, res) => {
		try {
			const probe = writeGuard.checkWritePermission(projectRoot);
			if (!probe.ok) {
				return res.status(403).json({ error: probe.error || '没权限', code: 'RECIPE_WRITE_FORBIDDEN' });
			}
			const rootSpecPath = Paths.getProjectSpecPath(projectRoot);
			let rootSpecDel = null;
			try { if (fs.existsSync(rootSpecPath)) rootSpecDel = JSON.parse(fs.readFileSync(rootSpecPath, 'utf8')); } catch (_) {}
			const recipesDir = Paths.getProjectRecipesPath(projectRoot, rootSpecDel);
			
			if (!fs.existsSync(recipesDir)) {
				return res.json({ success: true, count: 0 });
			}

			const files = fs.readdirSync(recipesDir).filter(f => f.endsWith('.md'));
			let deletedCount = 0;

			for (const fileName of files) {
				const filePath = path.join(recipesDir, fileName);
				try {
					fs.unlinkSync(filePath);
					deletedCount++;
					
					// 从语义索引中移除
					try {
						const { getInstance } = require('../../../lib/context');
						const service = getInstance(projectRoot);
						const adapter = service.getAdapter();
						const sourcePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
						await adapter.deleteBySourcePath(sourcePath);
					} catch (_) {}
				} catch (err) {
					console.error(`Failed to delete ${fileName}:`, err);
				}
			}

			res.json({ success: true, count: deletedCount });
		} catch (err) {
			console.error('[API Error]', err);
			res.status(500).json({ error: err.message });
		}
	});
}

module.exports = {
	registerRecipesRoutes,
};
