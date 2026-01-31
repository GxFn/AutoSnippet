#!/usr/bin/env node

/**
 * 统一维护有局限性的配置与默认值
 * 避免散落在 init、IndexingPipeline、ContextService、chunker、install-cursor-skill、targetScanner 等各处
 */

// ─── 路径 ───────────────────────────────────────────────────────────────
const RECIPES_DIR = 'Knowledge/recipes';
const RECIPES_INDEX = 'Knowledge/recipes/index.json';
const SPMMAP_FILENAME = 'AutoSnippet.spmmap.json';
const SPMMAP_PATH = `Knowledge/${SPMMAP_FILENAME}`;
const ROOT_SPEC_FILENAME = 'AutoSnippetRoot.boxspec.json';

// ─── Context 存储 ───────────────────────────────────────────────────────
const DEFAULT_STORAGE_ADAPTER = 'json';
const STORAGE_ADAPTERS = ['json', 'lance'];

// ─── Context 索引 ───────────────────────────────────────────────────────
const SOURCE_TYPES = ['recipe', 'doc', 'target-readme'];
const SOURCE_TYPE_RECIPE = 'recipe';
const SOURCE_TYPE_TARGET_README = 'target-readme';
const DEFAULT_SOURCES = [{ path: RECIPES_DIR, type: 'recipe' }];
const DEFAULT_CHUNKING = { strategy: 'whole' };
const CHUNKING_STRATEGIES = ['whole', 'section', 'fixed', 'auto'];
const DEFAULT_MAX_CHUNK_TOKENS = 800;
const DEFAULT_OVERLAP_TOKENS = 80;
const CHARS_PER_TOKEN = 3;

// ─── Target README（target-readme 源）───────────────────────────────────
const README_NAMES = ['README.md', 'README_CN.md', 'readme.md'];

// ─── MCP / 连接层（Skills 只描述语义，连接在此配置）───────────────────────
const DEFAULT_ASD_UI_URL = 'http://localhost:3000';

// ─── Skills / install:cursor-skill ──────────────────────────────────────
const GUARD_CONTEXT_EXCERPT_LIMIT = 12000;

/** category 推断规则：{ pattern: RegExp, category }，按顺序匹配 */
const CATEGORY_RULES = [
	{ pattern: /network|net|请求|api/i, category: 'network' },
	{ pattern: /video|播放|player/i, category: 'video' },
	{ pattern: /scheme|url|跳转|router/i, category: 'navigation' },
	{ pattern: /pyramid|service|服务/i, category: 'foundation' },
	{ pattern: /ui|view|cell|table/i, category: 'ui' }
];
const DEFAULT_CATEGORY = 'general';

/** 从路径和内容推断 category */
function inferCategory(relPath, content) {
	const frontMatch = (content || '').match(/^---[\s\S]*?category:\s*["']?([\w-]+)["']?/m);
	if (frontMatch) return frontMatch[1];
	const lower = (relPath || '').toLowerCase();
	for (const { pattern, category } of CATEGORY_RULES) {
		if (pattern.test(lower)) return category;
	}
	return DEFAULT_CATEGORY;
}

module.exports = {
	// 路径
	RECIPES_DIR,
	RECIPES_INDEX,
	SPMMAP_FILENAME,
	SPMMAP_PATH,
	ROOT_SPEC_FILENAME,

	// Context
	DEFAULT_STORAGE_ADAPTER,
	STORAGE_ADAPTERS,
	SOURCE_TYPES,
	SOURCE_TYPE_RECIPE,
	SOURCE_TYPE_TARGET_README,
	DEFAULT_SOURCES,
	DEFAULT_CHUNKING,
	CHUNKING_STRATEGIES,
	DEFAULT_MAX_CHUNK_TOKENS,
	DEFAULT_OVERLAP_TOKENS,
	CHARS_PER_TOKEN,

	// Target README
	README_NAMES,

	// MCP
	DEFAULT_ASD_UI_URL,

	// Skills
	GUARD_CONTEXT_EXCERPT_LIMIT,
	CATEGORY_RULES,
	DEFAULT_CATEGORY,
	inferCategory
};
