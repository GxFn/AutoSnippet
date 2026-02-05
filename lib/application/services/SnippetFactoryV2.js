/**
 * SnippetFactoryV2 - 代码片段工厂服务
 * 
 * 职责：
 * - 从不同来源构建 snippet 对象
 * - 处理文本、文件、答案等输入
 * - 生成标准化的 snippet 数据结构
 * 
 * @class SnippetFactoryV2
 */

const triggerSymbol = require('../../infrastructure/config/TriggerSymbol.js');

class SnippetFactoryV2 {
  constructor(projectRoot, config = {}) {
  this.projectRoot = projectRoot;
  this.config = this._parseConfig(config);
  this.logger = this._createLogger();
  }

  // ============ Public API ============

  /**
   * 从文本创建 snippet
   * @param {Object} answers - 用户答案（title, completion_first 等）
   * @param {string} text - 代码文本
   * @param {Object} options - 选项（language 等）
   * @returns {Object|null} snippet 对象
   */
  fromText(answers, text, options = {}) {
  try {
    if (!text || !String(text).trim()) {
    throw new Error('Text cannot be empty');
    }

    if (!answers || !answers.title) {
    throw new Error('Answers must have title');
    }

    const snippet = this._buildSnippetFromText(answers, text, options);
    this.logger.log('Snippet created from text', { title: answers.title });
    return snippet;
  } catch (e) {
    this.logger.error('Create snippet from text failed', { error: e.message });
    return null;
  }
  }

  /**
   * 从多个来源创建 snippet
   * @param {Object} answers - 用户答案
   * @param {Array<Object>} sources - 代码来源数组
   * @param {Object} options - 选项
   * @returns {Array<Object>} snippet 对象数组
   */
  fromSources(answers, sources, options = {}) {
  try {
    if (!Array.isArray(sources) || sources.length === 0) {
    return [];
    }

    return sources
    .map(source => this.fromText(answers, source.content, options))
    .filter(s => s !== null);
  } catch (e) {
    this.logger.error('Create snippets from sources failed', { error: e.message });
    return [];
  }
  }

  /**
   * 验证 snippet 对象
   * @param {Object} snippet - snippet 对象
   * @returns {boolean}
   */
  validateSnippet(snippet) {
  try {
    if (!snippet || typeof snippet !== 'object') {
    return false;
    }

    const required = ['identifier', 'title', 'content', 'language'];
    return required.every(key => key in snippet && snippet[key]);
  } catch (e) {
    return false;
  }
  }

  /**
   * 规范化 snippet 结构
   * @param {Object} snippet - snippet 对象
   * @returns {Object} 规范化后的对象
   */
  normalizeSnippet(snippet) {
  try {
    if (!this.validateSnippet(snippet)) {
    throw new Error('Invalid snippet');
    }

    return {
    identifier: snippet.identifier,
    title: String(snippet.title).trim(),
    content: String(snippet.content).trim(),
    language: String(snippet.language).toLowerCase(),
    description: snippet.description || '',
    triggers: snippet.triggers || [],
    tags: Array.isArray(snippet.tags) ? snippet.tags : [],
    category: snippet.category || 'general'
    };
  } catch (e) {
    this.logger.error('Normalize snippet failed', { error: e.message });
    return null;
  }
  }

  /**
   * 生成 snippet 唯一标识
   * @param {Object} answers - 用户答案
   * @returns {string} 标识符
   */
  generateIdentifier(answers) {
  try {
    if (!answers || !answers.title) {
    throw new Error('Answers must have title');
    }

    const completionFirst = String(answers.completion_first || '').trim();
    const completionMore = Array.isArray(answers.completion_more)
    ? answers.completion_more.join('')
    : String(answers.completion_more || '');

    const answersKeys = completionFirst + completionMore + answers.title;
    const answersIdBuff = Buffer.from(answersKeys, 'utf-8');
    return 'AutoSnip_' + answersIdBuff.toString('base64').replace(/\//g, '');
  } catch (e) {
    this.logger.error('Generate identifier failed', { error: e.message });
    return null;
  }
  }

  /**
   * 获取 snippet 摘要
   * @param {Object} snippet - snippet 对象
   * @returns {Object} 摘要信息
   */
  getSnippetSummary(snippet) {
  try {
    if (!this.validateSnippet(snippet)) {
    return null;
    }

    return {
    title: snippet.title,
    language: snippet.language,
    length: String(snippet.content).length,
    lines: String(snippet.content).split('\n').length,
    triggers: (snippet.triggers || []).length
    };
  } catch (e) {
    this.logger.error('Get snippet summary failed', { error: e.message });
    return null;
  }
  }

  // ============ Private Methods ============

  /**
   * 解析配置
   * @private
   */
  _parseConfig(config) {
  return {
    escapeHtml: config.escapeHtml !== false,
    enableTriggerSymbol: config.enableTriggerSymbol !== false,
    ...config
  };
  }

  /**
   * 创建日志器
   * @private
   */
  _createLogger() {
  const debug = process.env.DEBUG && process.env.DEBUG.includes('SnippetFactoryV2');
  return {
    log: (msg, data) => debug && console.log(`[SnippetFactoryV2] ✓ ${msg}`, data || ''),
    warn: (msg, data) => console.warn(`[SnippetFactoryV2] ⚠️ ${msg}`, data || ''),
    error: (msg, data) => console.error(`[SnippetFactoryV2] ❌ ${msg}`, data || '')
  };
  }

  /**
   * 从文本构建 snippet
   * @private
   */
  _buildSnippetFromText(answers, text, options) {
  const completionMoreStr = Array.isArray(answers.completion_more)
    ? answers.completion_more.join('')
    : (answers.completion_more || '');

  // 处理分类
  let categoryPart = '';
  if (answers.category) {
    const cat = triggerSymbol.hasTriggerPrefix(answers.category)
    ? answers.category
    : triggerSymbol.TRIGGER_SYMBOL + answers.category;
    if (!completionMoreStr.includes(cat)) {
    categoryPart = cat;
    }
  }

  const identifier = this.generateIdentifier(answers);
  const isSwift = options && options.language === 'swift';

  const snippet = {
    identifier: identifier,
    title: answers.title,
    language: options.language || 'text',
    content: this._escapeContent(text, this.config.escapeHtml),
    description: answers.description || '',
    triggers: [
    answers.completion_first || '',
    completionMoreStr,
    categoryPart
    ].filter(t => t),
    tags: answers.tags || [],
    category: answers.category || 'general',
    createdAt: new Date().toISOString(),
    source: 'manual'
  };

  return snippet;
  }

  /**
   * 转义内容
   * @private
   */
  _escapeContent(content, shouldEscape) {
  if (!shouldEscape) return content;

  let result = String(content);
  result = result.replace(/&/g, '&amp;');
  result = result.replace(/</g, '&lt;');
  result = result.replace(/>/g, '&gt;');
  return result;
  }
}

module.exports = SnippetFactoryV2;
