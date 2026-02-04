/**
 * SpecRepositoryV2 - Spec 文件仓库服务
 * 
 * 职责：
 * - 读写项目唯一 spec（AutoSnippet.boxspec.json，位于知识库目录内）
 * - 提供 snippet upsert 统一入口
 * - 管理分体存储（Knowledge/snippets/*.json）
 * - 缓存管理与 AI 增强
 * 
 * @class SpecRepositoryV2
 */

const fs = require('fs');
const path = require('path');
const triggerSymbol = require('../../infrastructure/config/TriggerSymbol.js');
const cacheStore = require('../../infrastructure/cache/CacheStore.js');
const defaults = require('../../infrastructure/config/Defaults');
const findPath = require('../../infrastructure/paths/PathFinder');
const snippetInstaller = require('../../snippet/snippetInstaller.js');
const Paths = require('../../infrastructure/config/Paths');

class SpecRepositoryV2 {
  constructor(projectRoot, config = {}) {
    this.projectRoot = projectRoot;
    this.config = this._parseConfig(config);
    this.logger = this._createLogger();
  }

  // ============ Public API ============

  /**
   * 读取 Spec 文件
   * @param {string} specFile - spec 文件路径
   * @returns {Object} spec 对象（合并 snippets 目录内容）
   */
  readSpecFile(specFile) {
    try {
      let mainSpec = { list: [] };
      
      // 读取主 spec 文件
      try {
        const data = fs.readFileSync(specFile, 'utf8');
        if (data) mainSpec = JSON.parse(data);
      } catch (err) {
        if (err && err.code !== 'ENOENT') {
          this.logger.error('Read spec file failed', { path: specFile, error: err.message });
        }
      }

      if (!mainSpec.list) mainSpec.list = [];

      // 合并 snippets 目录内容（用项目根而非 spec 所在目录，避免 Paths.getProjectKnowledgePath 在知识库下再建一层 AutoSnippet）
      const projectRoot = this._projectRootFromSpecFile(specFile);
      const snippetsDir = path.join(Paths.getProjectKnowledgePath(projectRoot), 'snippets');
      
      if (fs.existsSync(snippetsDir)) {
        mainSpec.list = this._mergeSnippetsFromDir(mainSpec.list, snippetsDir);
      }

      return mainSpec;
    } catch (e) {
      this.logger.error('Read spec failed', { error: e.message });
      return { list: [] };
    }
  }

  /**
   * 写入 Spec 文件
   * @param {string} specFile - spec 文件路径
   * @param {Object} obj - spec 对象
   * @returns {string} 写入的内容
   */
  writeSpecFile(specFile, obj) {
    try {
      const projectRoot = this._projectRootFromSpecFile(specFile);
      const knowledgeDir = Paths.getProjectKnowledgePath(projectRoot);
      const snippetsDir = path.join(knowledgeDir, 'snippets');
      
      // 确保目录存在
      this._ensureDirectories(projectRoot, knowledgeDir, snippetsDir);

      // 检查是否为根 spec
      const baseName = path.basename(specFile);
      const isRootSpec = baseName === defaults.SPEC_FILENAME;

      if (isRootSpec && Array.isArray(obj.list)) {
        // 分体存储：所有片段存到独立文件
        for (const snippet of obj.list) {
          if (snippet && snippet.identifier) {
            const snippetPath = path.join(snippetsDir, `${snippet.identifier}.json`);
            fs.writeFileSync(snippetPath, JSON.stringify(snippet, null, 4), 'utf8');
          }
        }
        
        // 根文件清空 list，仅保留元数据
        const mainObj = { ...obj };
        mainObj.list = [];
        const content = JSON.stringify(mainObj, null, 4);
        fs.writeFileSync(specFile, content, 'utf8');
        
        // 缓存保留全量数据
        cacheStore.updateCache(specFile, JSON.stringify(obj, null, 4));
        
        this.logger.log('Root spec written', { snippets: obj.list.length });
        return content;
      }

      // 普通模块 spec 单文件存储
      const content = JSON.stringify(obj, null, 4);
      fs.writeFileSync(specFile, content, 'utf8');
      cacheStore.updateCache(specFile, content);
      
      this.logger.log('Spec written', { path: specFile, snippets: obj.list.length });
      return content;
    } catch (e) {
      this.logger.error('Write spec failed', { error: e.message });
      return null;
    }
  }

  /**
   * 保存 snippet 到 spec
   * @param {string} specFile - spec 文件路径
   * @param {Object} snippet - snippet 对象
   * @param {Object} options - 选项（syncRoot, installSingle）
   * @returns {Object} 结果对象 {ok, replaced}
   */
  async saveSnippet(specFile, snippet, options = {}) {
    try {
      const syncRoot = options.syncRoot !== false;
      const installSingle = options.installSingle !== false;

      // 规范化和增强 snippet
      this._normalizeSnippet(snippet);
      await this._augmentSnippetForAi(snippet, specFile);

      // 更新主 spec
      const specObj = this._applySpecDefaults(this.readSpecFile(specFile), specFile);
      const { list, replaced } = this._upsertSnippet(specObj.list, snippet);
      specObj.list = list;
      this.writeSpecFile(specFile, specObj);

      // 同步到根 spec
      if (syncRoot) {
        await this._syncToRootSpec(specFile, snippet);
      }

      // 安装到编辑器
      if (installSingle) {
        this._installSnippet(specFile, snippet);
      }

      this.logger.log('Snippet saved', { identifier: snippet.identifier, replaced });
      return { ok: true, replaced };
    } catch (e) {
      this.logger.error('Save snippet failed', { error: e.message });
      return { ok: false, error: e.message };
    }
  }

  /**
   * 删除 snippet
   * @param {string} specFile - spec 文件路径
   * @param {string} identifier - snippet 标识
   * @param {Object} options - 选项（syncRoot）
   * @returns {Object} 结果对象
   */
  async deleteSnippet(specFile, identifier, options = {}) {
    try {
      const syncRoot = options.syncRoot !== false;
      
      const specObj = this.readSpecFile(specFile);
      if (!specObj || !Array.isArray(specObj.list)) {
        return { ok: false, error: 'invalid spec' };
      }

      const originalLength = specObj.list.length;
      specObj.list = specObj.list.filter(s => s.identifier !== identifier);
      
      if (specObj.list.length === originalLength) {
        return { ok: false, error: 'snippet not found' };
      }

      // 删除分体文件
      const projectRoot = this._projectRootFromSpecFile(specFile);
      const snippetPath = path.join(Paths.getProjectKnowledgePath(projectRoot), 'snippets', `${identifier}.json`);
      if (fs.existsSync(snippetPath)) {
        try {
          fs.unlinkSync(snippetPath);
        } catch (e) {
          this.logger.warn('Delete snippet file failed', { path: snippetPath });
        }
      }

      this.writeSpecFile(specFile, specObj);

      // 同步根 spec
      if (syncRoot) {
        await this._deleteFromRootSpec(specFile, identifier);
      }

      this.logger.log('Snippet deleted', { identifier });
      return { ok: true };
    } catch (e) {
      this.logger.error('Delete snippet failed', { error: e.message });
      return { ok: false, error: e.message };
    }
  }

  /**
   * 获取 snippet（按 identifier）
   * @param {string} specFile - spec 文件路径
   * @param {string} identifier - snippet 标识
   * @returns {Object|null}
   */
  getSnippet(specFile, identifier) {
    try {
      const specObj = this.readSpecFile(specFile);
      if (!Array.isArray(specObj.list)) return null;
      
      return specObj.list.find(s => s.identifier === identifier) || null;
    } catch (e) {
      this.logger.error('Get snippet failed', { error: e.message });
      return null;
    }
  }

  /**
   * 列出所有 snippet
   * @param {string} specFile - spec 文件路径
   * @returns {Array<Object>}
   */
  listSnippets(specFile) {
    try {
      const specObj = this.readSpecFile(specFile);
      return Array.isArray(specObj.list) ? specObj.list : [];
    } catch (e) {
      this.logger.error('List snippets failed', { error: e.message });
      return [];
    }
  }

  // ============ Private Methods ============

  /**
   * 解析配置
   * @private
   */
  _parseConfig(config) {
    return {
      enableAugment: config.enableAugment !== false,
      enableInstall: config.enableInstall !== false,
      ...config
    };
  }

  /**
   * 创建日志器
   * @private
   */
  _createLogger() {
    const debug = process.env.DEBUG && process.env.DEBUG.includes('SpecRepositoryV2');
    return {
      log: (msg, data) => debug && console.log(`[SpecRepositoryV2] ✓ ${msg}`, data || ''),
      warn: (msg, data) => console.warn(`[SpecRepositoryV2] ⚠️ ${msg}`, data || ''),
      error: (msg, data) => console.error(`[SpecRepositoryV2] ❌ ${msg}`, data || '')
    };
  }

  /**
   * 规范化 snippet
   * @private
   */
  _normalizeSnippet(snippet) {
    const identifier = String(snippet.identifier || '').trim();
    let title = String(snippet.title || '').trim();
    const completion = String(snippet.completion || '').trim();
    const summary = String(snippet.summary || '').trim();
    const trigger = this._normalizeTrigger(snippet.trigger);
    const languageShort = String(snippet.languageShort || '').trim();
    let body = Array.isArray(snippet.body) ? snippet.body.map(String) : null;
    const category = String(snippet.category || 'Utility').trim();
    const headers = Array.isArray(snippet.headers) ? snippet.headers.map(String) : [];
    const includeHeaders = !!snippet.includeHeaders;

    // 清理标题中的 [Category] 前缀
    title = this._stripCategoryFromTitle(title);
    
    // 去除重复的 import 行
    if (body && body.length > 0) {
      body = this._deduplicateImportLines(body);
    }

    if (!identifier) throw new Error('missing identifier');
    if (!title) throw new Error('missing title');
    if (!trigger) throw new Error('missing trigger');
    if (!completion) throw new Error('missing completion');
    if (!summary) throw new Error('missing summary');
    if (languageShort !== 'objc' && languageShort !== 'swift') {
      throw new Error('invalid languageShort');
    }
    if (!body) throw new Error('missing body');

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
  }

  /**
   * 为 AI 增强 snippet
   * @private
   */
  async _augmentSnippetForAi(snippet, specFile) {
    if (!this.config.enableAugment) return snippet;

    const identifier = snippet.identifier;
    const title = snippet.title;
    const completion = snippet.completion;
    const summary = snippet.summary;
    const body = snippet.body;
    const specName = snippet.specName;

    const now = new Date().toISOString();
    if (!snippet._meta || typeof snippet._meta !== 'object') snippet._meta = {};
    if (!snippet._meta.createdAt) snippet._meta.createdAt = now;
    snippet._meta.updatedAt = now;

    // 相对路径
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

    // 标准化字段
    snippet.trigger = this._normalizeTrigger(snippet.trigger);
    snippet.languageShort = snippet.languageShort || 'unknown';
    if (!Array.isArray(body)) snippet.body = [];

    // 结构化字段（skill 视角）
    const categories = this._parseCategoriesFromCompletion(completion);
    const tags = categories
      .map(c => triggerSymbol.stripTriggerPrefix(c))
      .filter(c => c && c !== this._rawKeyFromTrigger(snippet.trigger));

    snippet.skill = snippet.skill && typeof snippet.skill === 'object' ? snippet.skill : {};
    if (!snippet.skill.schemaVersion) snippet.skill.schemaVersion = 1;
    snippet.skill.id = snippet.skill.id || identifier;
    snippet.skill.title = title;
    snippet.skill.summary = summary;
    snippet.skill.triggers = Array.isArray(snippet.skill.triggers) ? snippet.skill.triggers : [];
    
    const trig = this._normalizeTrigger(snippet.trigger);
    if (trig && !snippet.skill.triggers.includes(trig)) {
      snippet.skill.triggers.push(trig);
    }
    
    snippet.skill.tags = Array.isArray(snippet.skill.tags) ? snippet.skill.tags : [];
    tags.forEach(t => {
      if (t && !snippet.skill.tags.includes(t)) snippet.skill.tags.push(t);
    });
    
    snippet.skill.language = snippet.languageShort;
    snippet.skill.headers = snippet.headers || [];

    // deps 信息
    snippet.skill.deps = snippet.skill.deps && typeof snippet.skill.deps === 'object' ? snippet.skill.deps : {};
    if (specName) {
      snippet.skill.deps.module = specName;
      if (snippet.languageShort === 'swift') {
        snippet.skill.deps.swiftImports = Array.isArray(snippet.skill.deps.swiftImports) 
          ? snippet.skill.deps.swiftImports 
          : [];
        if (!snippet.skill.deps.swiftImports.includes(specName)) {
          snippet.skill.deps.swiftImports.push(specName);
        }
      }
    }

    return snippet;
  }

  /**
   * 应用 spec 默认值
   * @private
   */
  _applySpecDefaults(specObj, specFile) {
    if (!specObj || typeof specObj !== 'object') specObj = {};
    if (!Array.isArray(specObj.list)) specObj.list = [];

    const base = path.basename(specFile || '');
    if (base === defaults.SPEC_FILENAME) {
      if (!specObj.schemaVersion) specObj.schemaVersion = 2;
      if (!specObj.kind) specObj.kind = 'root';
      if (specObj.root !== true) specObj.root = true;
      if (!specObj.recipes || typeof specObj.recipes !== 'object') {
        specObj.recipes = { 
          dir: defaults.RECIPES_DIR, 
          format: 'md+frontmatter', 
          index: defaults.RECIPES_INDEX 
        };
      } else {
        if (!specObj.recipes.dir) specObj.recipes.dir = defaults.RECIPES_DIR;
        if (!specObj.recipes.format) specObj.recipes.format = 'md+frontmatter';
        if (!specObj.recipes.index) specObj.recipes.index = defaults.RECIPES_INDEX;
      }
    }

    return specObj;
  }

  /**
   * upsert snippet 到列表
   * @private
   */
  _upsertSnippet(list, snippet) {
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

  /**
   * 规范化 trigger
   * @private
   */
  _normalizeTrigger(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    return s || '';
  }

  /**
   * 从 trigger 获取原始 key
   * @private
   */
  _rawKeyFromTrigger(trigger) {
    const t = this._normalizeTrigger(trigger);
    return triggerSymbol.stripTriggerPrefix(t);
  }

  /**
   * 从 title 移除 category 前缀
   * @private
   */
  _stripCategoryFromTitle(title) {
    const s = String(title || '').trim();
    const withoutBracket = s.replace(/^\[[^\]]*\]\s*/, '').trim();
    return withoutBracket || s;
  }

  /**
   * 去重 import 行
   * @private
   */
  _deduplicateImportLines(body) {
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

  /**
   * 解析 completion 中的 categories
   * @private
   */
  _parseCategoriesFromCompletion(completion) {
    const s = String(completion || '').trim();
    if (!s.includes(triggerSymbol.TRIGGER_SYMBOL)) return [];
    
    const parts = s.split(triggerSymbol.TRIGGER_SPLIT_REGEX)
      .map(p => p.trim())
      .filter(Boolean);
    return parts.filter(p => p !== 'Moudle');
  }

  /**
   * 从 spec 文件路径解析项目根（知识库目录的父级），避免把知识库目录当项目根导致创建 AutoSnippet/AutoSnippet
   * @private
   */
  _projectRootFromSpecFile(specFile) {
    let d = path.dirname(specFile);
    while (d) {
      if (fs.existsSync(path.join(d, defaults.SPEC_FILENAME))) {
        return path.dirname(d);
      }
      const p = path.dirname(d);
      if (p === d) break;
      d = p;
    }
    return path.dirname(specFile);
  }

  /**
   * 确保目录存在
   * @private
   */
  _ensureDirectories(projectRoot, knowledgeDir, snippetsDir) {
    try {
      fs.mkdirSync(projectRoot, { recursive: true });
    } catch {}
    try {
      fs.mkdirSync(knowledgeDir, { recursive: true });
    } catch {}
    try {
      fs.mkdirSync(snippetsDir, { recursive: true });
    } catch {}
  }

  /**
   * 从 snippets 目录合并片段
   * @private
   */
  _mergeSnippetsFromDir(list, snippetsDir) {
    try {
      const files = fs.readdirSync(snippetsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(snippetsDir, file), 'utf8');
          const snippet = JSON.parse(content);
          
          const existingIndex = list.findIndex(s => s.identifier === snippet.identifier);
          if (existingIndex > -1) {
            list[existingIndex] = snippet;
          } else {
            list.push(snippet);
          }
        } catch (e) {
          this.logger.warn('Read snippet fragment failed', { file });
        }
      }
    } catch (err) {
      this.logger.error('Merge snippets from dir failed', { error: err.message });
    }
    
    return list;
  }

  /**
   * 同步到根 spec
   * @private
   */
  async _syncToRootSpec(specFile, snippet) {
    try {
      const rootSpecFile = await findPath.getRootSpecFilePath(specFile);
      if (rootSpecFile && rootSpecFile !== path.resolve(specFile)) {
        await this._augmentSnippetForAi(snippet, rootSpecFile);
        const rootObj = this._applySpecDefaults(this.readSpecFile(rootSpecFile), rootSpecFile);
        const { list } = this._upsertSnippet(rootObj.list, snippet);
        rootObj.list = list;
        this.writeSpecFile(rootSpecFile, rootObj);
      }
    } catch (e) {
      this.logger.warn('Sync to root spec failed', { error: e.message });
    }
  }

  /**
   * 从根 spec 删除
   * @private
   */
  async _deleteFromRootSpec(specFile, identifier) {
    try {
      const rootSpecFile = await findPath.getRootSpecFilePath(specFile);
      if (rootSpecFile && rootSpecFile !== path.resolve(specFile)) {
        const rootObj = this.readSpecFile(rootSpecFile);
        if (rootObj && Array.isArray(rootObj.list)) {
          rootObj.list = rootObj.list.filter(s => s.identifier !== identifier);
          this.writeSpecFile(rootSpecFile, rootObj);
        }
      }
    } catch (e) {
      this.logger.warn('Delete from root spec failed', { error: e.message });
    }
  }

  /**
   * 安装 snippet
   * @private
   */
  _installSnippet(specFile, snippet) {
    if (!this.config.enableInstall) return;
    try {
      snippetInstaller.addCodeSnippets(specFile, snippet);
    } catch (e) {
      this.logger.warn('Install snippet failed', { error: e.message });
    }
  }
}

module.exports = SpecRepositoryV2;
