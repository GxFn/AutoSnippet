#!/usr/bin/env node

/**
 * 职责：
 * - 读写模块 spec（AutoSnippet.boxspec.json）与根 spec（AutoSnippetRoot.boxspec.json）
 * - 提供“按 identifier upsert snippet”的统一入口，并负责：
 *   - 创建文件/目录（若不存在）
 *   - 同步到 root spec（可选）
 *   - 刷新缓存（cacheStore.updateCache）
 *   - 写入单条 codesnippet（保持当前 create/save 行为）
 */

const fs = require('fs');
const path = require('path');
const cacheStore = require('../infra/cacheStore.js');
const paths = require('../infra/paths.js');
const findPath = require('../../bin/findPath.js'); // Phase 1 先复用现有实现，后续再迁移
const snippetInstaller = require('./snippetInstaller.js');

function applySpecDefaults(specObj, specFile) {
	if (!specObj || typeof specObj !== 'object') specObj = {};
	if (!Array.isArray(specObj.list)) specObj.list = [];

	const base = path.basename(specFile || '');
	if (base === 'AutoSnippetRoot.boxspec.json') {
		if (!specObj.schemaVersion) specObj.schemaVersion = 2;
		if (!specObj.kind) specObj.kind = 'root';
		if (specObj.root !== true) specObj.root = true;
		if (!specObj.recipes || typeof specObj.recipes !== 'object') {
			specObj.recipes = { dir: 'Knowledge/recipes', format: 'md+frontmatter', index: 'Knowledge/recipes/index.json' };
		} else {
			if (!specObj.recipes.dir) specObj.recipes.dir = 'Knowledge/recipes';
			if (!specObj.recipes.format) specObj.recipes.format = 'md+frontmatter';
			if (!specObj.recipes.index) specObj.recipes.index = 'Knowledge/recipes/index.json';
		}
	} else if (base === 'AutoSnippet.boxspec.json') {
		if (!specObj.schemaVersion) specObj.schemaVersion = 2;
		if (!specObj.kind) specObj.kind = 'module';
		if (!specObj.module || typeof specObj.module !== 'object') specObj.module = {};
	}

	return specObj;
}

function parseCategoriesFromCompletion(completion) {
	// completion 形如：#key#View#Tool 或 @key@View@Tool@Moudle
	const s = String(completion || '');
	if (!s.includes('@') && !s.includes('#')) return [];
	
	// 同时支持 @ 和 # 拆分
	const parts = s.split(/[@#]/).map(p => p.trim()).filter(Boolean);
	
	// 去掉最后的 Moudle 标记（兼容旧版本）
	return parts.filter(p => p !== 'Moudle');
}

function normalizeTrigger(raw) {
	if (!raw) return '';
	const s = String(raw).trim();
	if (!s) return '';
	// 不再强制添加前缀，保持原有输入，但在使用时根据需要添加
	return s;
}

function rawKeyFromTrigger(trigger) {
	const t = normalizeTrigger(trigger);
	return (t.startsWith('@') || t.startsWith('#')) ? t.slice(1) : t;
}

/** 去除 title 中多余的 category 前缀（如 [Service]），避免与 category 字段重复 */
function stripCategoryFromTitle(title) {
	const s = String(title || '').trim();
	const withoutBracket = s.replace(/^\[[^\]]*\]\s*/, '').trim();
	return withoutBracket || s;
}

/** 对 body 中的 #import / #include / import 行去重，保留首次出现 */
function deduplicateImportLines(body) {
	if (!Array.isArray(body) || body.length === 0) return body;
	const seen = new Set();
	const result = [];
	for (const line of body) {
		const normalized = String(line).trim();
		const isImport = /^#\s*(?:import|include)\s+/.test(normalized) || /^import\s+/.test(normalized);
		if (isImport && seen.has(normalized)) continue;
		if (isImport) seen.add(normalized);
		result.push(line);
	}
	return result;
}

function normalizeSnippetSchemaV2(snippet) {
	if (!snippet || typeof snippet !== 'object') return snippet;

	// ✅ 严格模式（不再兼容旧字段）：
	// 必填：identifier/title/trigger/completion/summary/languageShort/body
	const identifier = String(snippet.identifier || '').trim();
	let title = String(snippet.title || '').trim();
	const completion = String(snippet.completion || '').trim();
	const summary = String(snippet.summary || '').trim();
	const trigger = normalizeTrigger(snippet.trigger);
	const languageShort = String(snippet.languageShort || '').trim();
	let body = Array.isArray(snippet.body) ? snippet.body.map(String) : null;
	const category = String(snippet.category || 'Utility').trim();
	const headers = Array.isArray(snippet.headers) ? snippet.headers.map(String) : [];
	const includeHeaders = !!snippet.includeHeaders;

	// 去除 title 中多余的 [Category] 前缀，与 category 字段不重复
	title = stripCategoryFromTitle(title);
	// 去除 body 中重复的 #import / #include 行
	if (body && body.length > 0) body = deduplicateImportLines(body);

	if (!identifier) throw new Error('invalid snippet: missing identifier');
	if (!title) throw new Error('invalid snippet: missing title');
	if (!trigger) throw new Error('invalid snippet: missing trigger');
	if (!completion) throw new Error('invalid snippet: missing completion');
	if (!summary) throw new Error('invalid snippet: missing summary');
	if (languageShort !== 'objc' && languageShort !== 'swift') throw new Error('invalid snippet: missing/invalid languageShort');
	if (!body) throw new Error('invalid snippet: missing body');

	snippet.identifier = identifier;
	snippet.title = title;
	snippet.trigger = trigger;
	snippet.completion = completion;
	snippet.summary = summary;
	snippet.languageShort = languageShort;
	snippet.body = body;
	snippet.category = category;
	snippet.headers = headers;
	snippet.includeHeaders = includeHeaders;

	return snippet;
}

async function augmentSnippetForAi(snippet, specFile) {
	if (!snippet || typeof snippet !== 'object') return snippet;

	const identifier = snippet.identifier;
	const title = snippet.title;
	const completion = snippet.completion;
	const summary = snippet.summary;
	const link = snippet.link;
	const body = snippet.body;
	const specName = snippet.specName;

	const now = new Date().toISOString();
	if (!snippet._meta || typeof snippet._meta !== 'object') snippet._meta = {};
	if (!snippet._meta.createdAt) snippet._meta.createdAt = now;
	snippet._meta.updatedAt = now;

	// _meta.specFile：改为相对项目根目录的路径（更适合 AI 与可迁移性）
	try {
		const rootSpecFile = await findPath.getRootSpecFilePath(specFile);
		const projectRoot = rootSpecFile ? path.dirname(rootSpecFile) : null;
		if (projectRoot) {
			const rel = path.relative(projectRoot, specFile).replace(/\\/g, '/');
			snippet._meta.specFile = rel;
		} else {
			snippet._meta.specFile = specFile;
		}
	} catch {
		snippet._meta.specFile = specFile;
	}

	// ✅ 结构化字段（AI/人类更容易理解）
	snippet.trigger = normalizeTrigger(snippet.trigger);
	snippet.languageShort = snippet.languageShort || 'unknown';
	if (!Array.isArray(body)) snippet.body = [];

	// ✅ skill 视角（不改变运行时：仅增强语义）
	const categories = parseCategoriesFromCompletion(completion);
	const tags = categories
		.map((c) => c.startsWith('@') ? c.slice(1) : c)
		.filter((c) => c && c !== rawKeyFromTrigger(snippet.trigger));

	snippet.skill = snippet.skill && typeof snippet.skill === 'object' ? snippet.skill : {};
	if (!snippet.skill.schemaVersion) snippet.skill.schemaVersion = 1;
	snippet.skill.id = snippet.skill.id || identifier;
	snippet.skill.title = title;
	snippet.skill.summary = summary;
	snippet.skill.triggers = Array.isArray(snippet.skill.triggers) ? snippet.skill.triggers : [];
	const trig = normalizeTrigger(snippet.trigger);
	if (trig && !snippet.skill.triggers.includes(trig)) snippet.skill.triggers.push(trig);
	snippet.skill.tags = Array.isArray(snippet.skill.tags) ? snippet.skill.tags : [];
	tags.forEach((t) => { if (t && !snippet.skill.tags.includes(t)) snippet.skill.tags.push(t); });
	snippet.skill.language = snippet.languageShort;
	snippet.skill.headers = snippet.headers || []; // 同步头文件信息

	// deps：尽量从现有字段推断（可后续由 watch/deps/skills 补全）
	snippet.skill.deps = snippet.skill.deps && typeof snippet.skill.deps === 'object' ? snippet.skill.deps : {};
	if (specName) {
		// 对 Swift：swiftImports；对 ObjC：moduleName 也可作为依赖线索
		snippet.skill.deps.module = specName;
		if (snippet.languageShort === 'swift') {
			snippet.skill.deps.swiftImports = Array.isArray(snippet.skill.deps.swiftImports) ? snippet.skill.deps.swiftImports : [];
			if (!snippet.skill.deps.swiftImports.includes(specName)) snippet.skill.deps.swiftImports.push(specName);
		}
	}

	return snippet;
}

function readSpecFile(specFile) {
	let mainSpec = { list: [] };
	try {
		const data = fs.readFileSync(specFile, 'utf8');
		if (data) mainSpec = JSON.parse(data);
	} catch (err) {
		if (err && err.code !== 'ENOENT') console.error(`Error reading spec: ${err.message}`);
	}

	if (!mainSpec.list) mainSpec.list = [];

	// ✅ 增强逻辑：如果存在 snippets 文件夹，自动合并内部的所有片段
	const projectRoot = path.dirname(specFile);
	const snippetsDir = path.join(projectRoot, 'Knowledge', 'snippets');
	
	if (fs.existsSync(snippetsDir)) {
		try {
			const files = fs.readdirSync(snippetsDir).filter(f => f.endsWith('.json'));
			for (const file of files) {
				try {
					const content = fs.readFileSync(path.join(snippetsDir, file), 'utf8');
					const snippet = JSON.parse(content);
					// 如果主列表中不存在（或者 identifier 匹配），则合并/更新
					const existingIndex = mainSpec.list.findIndex(s => s.identifier === snippet.identifier);
					if (existingIndex > -1) {
						mainSpec.list[existingIndex] = snippet;
					} else {
						mainSpec.list.push(snippet);
					}
				} catch (e) {
					console.warn(`Failed to read snippet fragment: ${file}`);
				}
			}
		} catch (err) {
			console.error(`Error reading snippets directory: ${err.message}`);
		}
	}

	return mainSpec;
}

function writeSpecFile(specFile, obj) {
	const projectRoot = path.dirname(specFile);
	const knowledgeDir = path.join(projectRoot, 'Knowledge');
	const snippetsDir = path.join(knowledgeDir, 'snippets');
	
	// 1. 确保目录存在
	try { fs.mkdirSync(projectRoot, { recursive: true }); } catch {}
	try { fs.mkdirSync(knowledgeDir, { recursive: true }); } catch {}
	try { fs.mkdirSync(snippetsDir, { recursive: true }); } catch {}

	// 2. 只有根配置（AutoSnippetRoot）才执行分体存储
	const baseName = path.basename(specFile);
	if (baseName === 'AutoSnippetRoot.boxspec.json' && Array.isArray(obj.list)) {
		// 分离所有片段到独立文件
		for (const snippet of obj.list) {
			if (snippet && snippet.identifier) {
				const snippetPath = path.join(snippetsDir, `${snippet.identifier}.json`);
				fs.writeFileSync(snippetPath, JSON.stringify(snippet, null, 4), 'utf8');
			}
		}
		// 3. 入口文件不再存储全量 list，仅保留基础元数据（可以保留一个空的 list 或 identifier 列表）
		const mainObj = { ...obj };
		mainObj.list = []; // 清空主文件中的 list 数组，让它变轻
		const content = JSON.stringify(mainObj, null, 4);
		fs.writeFileSync(specFile, content, 'utf8');
		cacheStore.updateCache(specFile, JSON.stringify(obj, null, 4)); // 缓存依然保留全量，供运行时使用
		return content;
	}

	// 4. 普通模块配置保持原样（单文件存储）
	const content = JSON.stringify(obj, null, 4);
	fs.writeFileSync(specFile, content, 'utf8');
	cacheStore.updateCache(specFile, content);
	return content;
}

function upsertIntoList(list, snippet) {
	if (!Array.isArray(list)) list = [];
	let replaced = false;
	for (let i = 0; i < list.length; i++) {
		if (list[i] && list[i].identifier === snippet.identifier) {
			list[i] = snippet;
			replaced = true;
			break;
		}
	}
	if (!replaced) list.push(snippet);
	return { list, replaced };
}

async function saveSnippet(specFile, snippet, options = {}) {
	const syncRoot = options.syncRoot !== false; // default true
	const installSingle = options.installSingle !== false; // default true

	normalizeSnippetSchemaV2(snippet);
	await augmentSnippetForAi(snippet, specFile);

	const specObj = applySpecDefaults(readSpecFile(specFile), specFile);
	const upd = upsertIntoList(specObj.list, snippet);
	specObj.list = upd.list;
	writeSpecFile(specFile, specObj);

	if (syncRoot) {
		try {
			const rootSpecFile = await findPath.getRootSpecFilePath(specFile);
			if (rootSpecFile && rootSpecFile !== path.resolve(specFile)) {
				await augmentSnippetForAi(snippet, rootSpecFile);
				const rootObj = applySpecDefaults(readSpecFile(rootSpecFile), rootSpecFile);
				const updRoot = upsertIntoList(rootObj.list, snippet);
				rootObj.list = updRoot.list;
				writeSpecFile(rootSpecFile, rootObj);
			}
		} catch {
			// ignore
		}
	}

	if (installSingle) {
		try {
			snippetInstaller.addCodeSnippets(specFile, snippet);
		} catch {
			// ignore
		}
	}

	return { ok: true, replaced: upd.replaced };
}

async function deleteSnippet(specFile, identifier, options = {}) {
	const syncRoot = options.syncRoot !== false;
	const specObj = readSpecFile(specFile); // 这里的 read 已经包含 snippets 文件夹的内容
	if (!specObj || !Array.isArray(specObj.list)) return { ok: false, error: 'invalid spec' };

	const originalLength = specObj.list.length;
	specObj.list = specObj.list.filter(s => s.identifier !== identifier);
	
	if (specObj.list.length === originalLength) return { ok: false, error: 'snippet not found' };

	// 物理删除分体文件
	const projectRoot = path.dirname(specFile);
	const snippetPath = path.join(projectRoot, 'Knowledge', 'snippets', `${identifier}.json`);
	if (fs.existsSync(snippetPath)) {
		try {
			fs.unlinkSync(snippetPath);
		} catch (e) {
			console.warn(`Failed to delete snippet file: ${snippetPath}`);
		}
	}

	writeSpecFile(specFile, specObj);

	if (syncRoot) {
		try {
			const rootSpecFile = await findPath.getRootSpecFilePath(specFile);
			if (rootSpecFile && rootSpecFile !== path.resolve(specFile)) {
				const rootObj = readSpecFile(rootSpecFile);
				if (rootObj && Array.isArray(rootObj.list)) {
					rootObj.list = rootObj.list.filter(s => s.identifier !== identifier);
					writeSpecFile(rootSpecFile, rootObj);
				}
			}
		} catch {
			// ignore
		}
	}

	return { ok: true };
}

module.exports = {
	readSpecFile,
	writeSpecFile,
	saveSnippet,
	deleteSnippet
};

