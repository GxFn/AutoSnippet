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
		if (!specObj.skills || typeof specObj.skills !== 'object') {
			specObj.skills = { dir: 'skills', format: 'md+frontmatter', index: 'skills/index.json' };
		} else {
			if (!specObj.skills.dir) specObj.skills.dir = 'skills';
			if (!specObj.skills.format) specObj.skills.format = 'md+frontmatter';
			if (!specObj.skills.index) specObj.skills.index = 'skills/index.json';
		}
	} else if (base === 'AutoSnippet.boxspec.json') {
		if (!specObj.schemaVersion) specObj.schemaVersion = 2;
		if (!specObj.kind) specObj.kind = 'module';
		if (!specObj.module || typeof specObj.module !== 'object') specObj.module = {};
	}

	return specObj;
}

function parseCategoriesFromCompletion(completion) {
	// completion 形如：@key@View@Tool@Moudle
	const s = String(completion || '');
	if (!s.includes('@')) return [];
	const parts = s.split('@').map(p => p.trim()).filter(Boolean);
	// 去掉最后的 Moudle 标记
	return parts.filter(p => p !== 'Moudle');
}

function normalizeTrigger(raw) {
	if (!raw) return '';
	const s = String(raw).trim();
	if (!s) return '';
	return s.startsWith('@') ? s : ('@' + s);
}

function rawKeyFromTrigger(trigger) {
	const t = normalizeTrigger(trigger);
	return t.startsWith('@') ? t.slice(1) : t;
}

function normalizeSnippetSchemaV2(snippet) {
	if (!snippet || typeof snippet !== 'object') return snippet;

	// ✅ 严格模式（不再兼容旧字段）：
	// 必填：identifier/title/trigger/completion/summary/languageShort/body
	const identifier = String(snippet.identifier || '').trim();
	const title = String(snippet.title || '').trim();
	const completion = String(snippet.completion || '').trim();
	const summary = String(snippet.summary || '').trim();
	const trigger = normalizeTrigger(snippet.trigger);
	const languageShort = String(snippet.languageShort || '').trim();
	const body = Array.isArray(snippet.body) ? snippet.body.map(String) : null;

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
	snippet.body = body

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
	try {
		const data = fs.readFileSync(specFile, 'utf8');
		if (data) return JSON.parse(data);
	} catch (err) {
		if (err && err.code === 'ENOENT') return { list: [] };
	}
	return { list: [] };
}

function writeSpecFile(specFile, obj) {
	const dir = path.dirname(specFile);
	try { fs.mkdirSync(dir, { recursive: true }); } catch {}
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
			if (rootSpecFile) {
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

module.exports = {
	readSpecFile,
	writeSpecFile,
	saveSnippet
};

