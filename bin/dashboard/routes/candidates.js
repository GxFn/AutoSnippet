function registerCandidatesRoutes(app, ctx) {
	const { projectRoot, candidateService } = ctx;

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
			console.error('[API Error]', err);
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
			console.error('[API Error]', err);
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
			console.error('[API Error]', err);
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
			const similarityService = require('../../../lib/candidate/similarityService');
			const similar = await similarityService.findSimilarRecipes(projectRoot, cand);
			res.json({ similar });
		} catch (err) {
			console.error('[API Error]', err);
			res.status(500).json({ error: err.message });
		}
	});
}

module.exports = {
	registerCandidatesRoutes,
};
