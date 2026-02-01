#!/usr/bin/env node

/**
 * 统一搜索服务：关键词搜索 + 语义搜索
 * 返回 { title, name, content, code, type }[] 供 CLI / watch 使用
 */

const fs = require('fs');
const path = require('path');
const defaults = require('../infra/defaults');
const { getTriggerFromContent } = require('../recipe/parseRecipeMd');

const FENCED_CODE_RE = /```[\w]*\r?\n([\s\S]*?)```/;

function extractFirstCodeBlock(content) {
	if (!content || typeof content !== 'string') return '';
	const stripped = content.replace(/^---[\s\S]*?---\s*\n?/, '').trim();
	const match = stripped.match(FENCED_CODE_RE);
	if (match && match[1]) return match[1].trim();
	return stripped.slice(0, 8000);
}

/**
 * 关键词搜索 Snippets + Recipes
 */
function keywordSearch(projectRoot, keyword) {
	const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
	let rootSpec = {};
	try {
		rootSpec = JSON.parse(fs.readFileSync(rootSpecPath, 'utf8'));
	} catch (_) {
		rootSpec = { list: [] };
	}

	const results = [];
	const k = keyword ? keyword.toLowerCase() : '';

	// Snippets
	const list = rootSpec.list || [];
	for (const s of list) {
		if (!keyword || (s.title && s.title.toLowerCase().includes(k)) ||
			(s.completion && s.completion.toLowerCase().includes(k)) ||
			(s.summary && s.summary.toLowerCase().includes(k))) {
			const raw = s.body || s.code;
			const code = Array.isArray(raw) ? raw.join('\n') : (raw || '');
			results.push({
				title: `[Snippet] ${s.title || s.completion || 'snippet'} (${s.completion || ''})`,
				name: s.title || s.completion || 'snippet',
				content: code,
				code,
				type: 'snippet'
			});
		}
	}

	// Recipes
	const recipesDir = path.join(projectRoot, rootSpec.recipes?.dir || rootSpec.skills?.dir || defaults.RECIPES_DIR);
	if (fs.existsSync(recipesDir)) {
		const getAllMd = (dirPath, list = []) => {
			const entries = fs.readdirSync(dirPath, { withFileTypes: true });
			for (const e of entries) {
				const full = path.join(dirPath, e.name);
				if (e.isDirectory() && !e.name.startsWith('.')) getAllMd(full, list);
				else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) list.push(full);
			}
			return list;
		};
		const allMd = getAllMd(recipesDir);
		for (const full of allMd) {
			const content = fs.readFileSync(full, 'utf8');
			const rel = path.relative(recipesDir, full).replace(/\\/g, '/');
			if (!keyword || rel.toLowerCase().includes(k) || content.toLowerCase().includes(k)) {
				const code = extractFirstCodeBlock(content);
				results.push({
					title: rel.replace(/\.md$/i, ''),
					name: rel,
					content,
					code,
					type: 'recipe',
					trigger: getTriggerFromContent(content) || undefined
				});
			}
		}
	}

	return results;
}

/**
 * 语义搜索（需 embed 索引）
 */
async function semanticSearch(projectRoot, keyword, limit = 5) {
	try {
		const { getInstance } = require('../context');
		const service = getInstance(projectRoot);
		const items = await service.search(keyword, { limit, filter: { type: 'recipe' } });
		return items.map(res => {
			const percent = ((res.similarity || 0) * 100).toFixed(0);
			const name = res.metadata?.name || res.metadata?.sourcePath || res.id;
			const content = res.content || '';
			const trigger = getTriggerFromContent(content) || undefined;
			return {
				title: `(${percent}%) ${name}`,
				name: name,
				content,
				code: extractFirstCodeBlock(content) || content.slice(0, 2000) || '',
				type: 'recipe',
				trigger
			};
		});
	} catch (e) {
		return [];
	}
}

/**
 * 统一入口：关键词 + 可选语义
 */
async function search(projectRoot, keyword, options = {}) {
	const { semantic = false, limit = 10 } = options;
	if (semantic) {
		const semanticResults = await semanticSearch(projectRoot, keyword, limit);
		if (semanticResults.length > 0) return semanticResults;
	}
	return keywordSearch(projectRoot, keyword);
}

module.exports = {
	search,
	keywordSearch,
	semanticSearch,
	extractFirstCodeBlock
};
