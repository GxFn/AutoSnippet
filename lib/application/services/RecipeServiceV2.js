/**
 * RecipeService V2 - Recipe 管理服务升级版本
 * 
 * 职责：
 * - 解析 Recipe Markdown 文件
 * - 提取和管理 Recipe 元数据
 * - 搜索和过滤 Recipe
 * - 统计和分析 Recipe
 * 
 * @class RecipeServiceV2
 * @example
 * const service = new RecipeServiceV2(projectRoot);
 * const recipe = await service.parse('./recipe.md');
 * const recipes = await service.listRecipes();
 */

const fs = require('fs');
const path = require('path');
const { getTriggerFromContent } = require('../../recipe/parseRecipeMd');
const defaults = require('../../infrastructure/config/Defaults');
const Paths = require('../../infrastructure/config/Paths.js');

class RecipeServiceV2 {
  constructor(projectRoot, config = {}) {
  this._validateProjectRoot(projectRoot);
  this.projectRoot = projectRoot;
  this.config = this._parseConfig(config);
  this.recipeCache = new Map();
  this.logger = this._createLogger();
  }

  // ============ Public API ============

  /**
   * 解析单个 Recipe 文件
   * 
   * @param {string} filePath - Recipe 文件路径（绝对或相对）
   * @returns {Promise<Object>} Recipe 对象，包含 metadata 和 content
   */
  async parse(filePath) {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.projectRoot, filePath);
    
    if (!fs.existsSync(fullPath)) {
    throw new Error(`Recipe file not found: ${fullPath}`);
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    return this.parseContent(content, { filePath: fullPath });
  } catch (e) {
    this.logger.error('Parse recipe failed', { filePath, error: e.message });
    throw e;
  }
  }

  /**
   * 解析 Recipe 内容
   * 
   * @param {string} content - Recipe 内容
   * @param {Object} options - 选项（filePath, metadata 等）
   * @returns {Promise<Object>} Recipe 对象
   */
  async parseContent(content, options = {}) {
  try {
    const { filePath = '', metadata: customMetadata = {} } = options;
    
    // 分离 frontmatter 和内容体
    const { frontmatter, body } = this._extractFrontmatter(content);
    
    // 解析元数据
    const metadata = this._parseFrontmatter(frontmatter);
    const mergedMetadata = { ...metadata, ...customMetadata };
    
    // 提取触发器
    const trigger = getTriggerFromContent(body);
    if (trigger) {
    mergedMetadata.trigger = trigger;
    }

    // 提取代码块
    const codeBlocks = this._extractCodeBlocks(body);

    const recipe = {
    id: mergedMetadata.id || path.basename(filePath, '.md'),
    filePath,
    metadata: mergedMetadata,
    content: body.trim(),
    codeBlocks,
    raw: content
    };

    // 缓存
    if (recipe.id) {
    this.recipeCache.set(recipe.id, recipe);
    }

    return recipe;
  } catch (e) {
    this.logger.error('Parse content failed', { error: e.message });
    throw e;
  }
  }

  /**
   * 列出所有 Recipe
   * 
   * @param {Object} options - 选项（directory, filter 等）
   * @returns {Promise<Object[]>} Recipe 列表
   */
  async listRecipes(options = {}) {
  try {
    const directory = options.directory || this._getRecipesDirectory();
    
    if (!fs.existsSync(directory)) {
    this.logger.warn('Recipes directory not found', { directory });
    return [];
    }

    const files = this._getAllMarkdownFiles(directory);
    const recipes = [];

    for (const file of files) {
    try {
      const recipe = await this.parse(file);
      recipes.push(recipe);
    } catch (e) {
      this.logger.warn('Failed to parse recipe', { file, error: e.message });
    }
    }

    // 应用过滤
    return this._applyFilters(recipes, options.filter);
  } catch (e) {
    this.logger.error('List recipes failed', { error: e.message });
    return [];
  }
  }

  /**
   * 按 ID 查找 Recipe
   * 
   * @param {string} id - Recipe ID
   * @returns {Promise<Object|null>} Recipe 对象或 null
   */
  async findById(id) {
  try {
    if (this.recipeCache.has(id)) {
    return this.recipeCache.get(id);
    }

    const recipes = await this.listRecipes();
    const recipe = recipes.find(r => r.id === id);
    
    if (recipe) {
    this.recipeCache.set(id, recipe);
    }

    return recipe || null;
  } catch (e) {
    this.logger.error('Find by id failed', { id, error: e.message });
    return null;
  }
  }

  /**
   * 按触发器查找 Recipe
   * 
   * @param {string} trigger - 触发器（如 snippet shortcut）
   * @returns {Promise<Object[]>} 匹配的 Recipe 列表
   */
  async findByTrigger(trigger) {
  try {
    const recipes = await this.listRecipes();
    return recipes.filter(r => r.metadata.trigger === trigger);
  } catch (e) {
    this.logger.error('Find by trigger failed', { trigger, error: e.message });
    return [];
  }
  }

  /**
   * 按语言查找 Recipe
   * 
   * @param {string} language - 编程语言
   * @returns {Promise<Object[]>} 匹配的 Recipe 列表
   */
  async findByLanguage(language) {
  try {
    const recipes = await this.listRecipes();
    return recipes.filter(r => 
    r.metadata.language === language || 
    r.metadata.languages?.includes(language)
    );
  } catch (e) {
    this.logger.error('Find by language failed', { language, error: e.message });
    return [];
  }
  }

  /**
   * 按关键词搜索 Recipe
   * 
   * @param {string} keyword - 搜索关键词
   * @returns {Promise<Object[]>} 匹配的 Recipe 列表
   */
  async search(keyword) {
  try {
    if (!keyword) return [];

    const recipes = await this.listRecipes();
    const lowerKeyword = keyword.toLowerCase();

    return recipes.filter(r => 
    r.id.toLowerCase().includes(lowerKeyword) ||
    r.metadata.title?.toLowerCase().includes(lowerKeyword) ||
    r.metadata.description?.toLowerCase().includes(lowerKeyword) ||
    r.metadata.tags?.some(tag => tag.toLowerCase().includes(lowerKeyword)) ||
    r.content.toLowerCase().includes(lowerKeyword)
    );
  } catch (e) {
    this.logger.error('Search failed', { keyword, error: e.message });
    return [];
  }
  }

  /**
   * 验证 Recipe 格式
   * 
   * @param {Object} recipe - Recipe 对象
   * @returns {Object} 验证结果 { valid, errors }
   */
  validateRecipe(recipe) {
  const errors = [];

  if (!recipe.id) errors.push('Missing id');
  if (!recipe.content) errors.push('Missing content');
  if (!recipe.metadata) errors.push('Missing metadata');

  return {
    valid: errors.length === 0,
    errors
  };
  }

  /**
   * 获取 Recipe 统计信息
   * 
   * @returns {Promise<Object>} 统计信息
   */
  async getStats() {
  try {
    const recipes = await this.listRecipes();
    
    const stats = {
    total: recipes.length,
    byLanguage: {},
    avgCodeBlocks: 0,
    withTrigger: 0,
    withTags: 0
    };

    let totalCodeBlocks = 0;

    for (const recipe of recipes) {
    // 按语言统计
    const lang = recipe.metadata.language || 'unknown';
    stats.byLanguage[lang] = (stats.byLanguage[lang] || 0) + 1;

    // 代码块统计
    totalCodeBlocks += recipe.codeBlocks.length;

    // 触发器统计
    if (recipe.metadata.trigger) stats.withTrigger++;

    // 标签统计
    if (recipe.metadata.tags?.length > 0) stats.withTags++;
    }

    stats.avgCodeBlocks = recipes.length > 0 ? (totalCodeBlocks / recipes.length).toFixed(2) : 0;

    return stats;
  } catch (e) {
    this.logger.error('Get stats failed', { error: e.message });
    return {};
  }
  }

  /**
   * 清空缓存
   */
  clearCache() {
  this.recipeCache.clear();
  this.logger.log('Cache cleared');
  }

  // ============ Private Methods ============

  /**
   * 验证项目根目录
   * @private
   */
  _validateProjectRoot(projectRoot) {
  if (!projectRoot || typeof projectRoot !== 'string') {
    throw new Error('projectRoot must be a non-empty string');
  }
  }

  /**
   * 解析配置
   * @private
   */
  _parseConfig(config) {
  return {
    cacheDuration: config.cacheDuration || 5 * 60 * 1000,
    ...config
  };
  }

  /**
   * 获取 Recipe 目录
   * @private
   */
  _getRecipesDirectory() {
  try {
    const specPath = Paths.getProjectSpecPath(this.projectRoot);
    if (fs.existsSync(specPath)) {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    const recipeDir = spec.recipes?.dir || spec.skills?.dir;
    if (recipeDir) {
      return path.join(this.projectRoot, recipeDir);
    }
    }
  } catch (_) {
    // Fallback to default
  }
  return path.join(this.projectRoot, defaults.RECIPES_DIR);
  }

  /**
   * 提取 Frontmatter
   * @private
   */
  _extractFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (match) {
    return { frontmatter: match[1], body: match[2] };
  }
  return { frontmatter: '', body: content };
  }

  /**
   * 解析 Frontmatter YAML
   * @private
   */
  _parseFrontmatter(frontmatter) {
  const metadata = {};
  
  if (!frontmatter) return metadata;

  const lines = frontmatter.split('\n');
  for (const line of lines) {
    const [key, ...valueParts] = line.split(':');
    if (key && valueParts.length > 0) {
    const value = valueParts.join(':').trim();
    
    // 处理列表
    if (value.startsWith('[') && value.endsWith(']')) {
      metadata[key.trim()] = JSON.parse(value);
    } else if (value === 'true') {
      metadata[key.trim()] = true;
    } else if (value === 'false') {
      metadata[key.trim()] = false;
    } else {
      metadata[key.trim()] = value;
    }
    }
  }

  return metadata;
  }

  /**
   * 提取代码块
   * @private
   */
  _extractCodeBlocks(content) {
  const blocks = [];
  const codeBlockRegex = /```([\w]*)\n([\s\S]*?)```/g;
  
  let match;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    blocks.push({
    language: match[1] || 'plaintext',
    code: match[2].trim()
    });
  }

  return blocks;
  }

  /**
   * 递归获取所有 Markdown 文件
   * @private
   */
  _getAllMarkdownFiles(dirPath, list = []) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      this._getAllMarkdownFiles(fullPath, list);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      list.push(fullPath);
    }
    }
  } catch (e) {
    this.logger.warn('Read directory failed', { dirPath, error: e.message });
  }

  return list;
  }

  /**
   * 应用过滤条件
   * @private
   */
  _applyFilters(recipes, filter = {}) {
  let result = recipes;

  if (filter.language) {
    result = result.filter(r => r.metadata.language === filter.language);
  }

  if (filter.tags) {
    result = result.filter(r => 
    filter.tags.some(tag => r.metadata.tags?.includes(tag))
    );
  }

  if (filter.hasTrigger === true) {
    result = result.filter(r => r.metadata.trigger);
  } else if (filter.hasTrigger === false) {
    result = result.filter(r => !r.metadata.trigger);
  }

  if (filter.limit) {
    result = result.slice(0, filter.limit);
  }

  return result;
  }

  /**
   * 创建 logger
   * @private
   */
  _createLogger() {
  return {
    log: (msg, data) => {
    if (process.env.DEBUG) {
      console.log(`[RecipeServiceV2] ${msg}`, data ? JSON.stringify(data) : '');
    }
    },
    warn: (msg, data) => {
    console.warn(`[RecipeServiceV2] ⚠️ ${msg}`, data ? JSON.stringify(data) : '');
    },
    error: (msg, data) => {
    console.error(`[RecipeServiceV2] ❌ ${msg}`, data ? JSON.stringify(data) : '');
    }
  };
  }
}

module.exports = RecipeServiceV2;
