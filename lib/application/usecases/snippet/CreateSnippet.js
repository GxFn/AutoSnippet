/**
 * CreateSnippet Use Case
 * 创建 Snippet 的业务用例
 */

const { ValidationError } = require('../../../infrastructure/errors');

class CreateSnippet {
  constructor(snippetFactory, specRepository, logger) {
    this.snippetFactory = snippetFactory;
    this.specRepository = specRepository;
    this.logger = logger;
  }

  /**
   * 创建 Snippet
   * @param {Object} data - Snippet 数据
   * @param {string} data.content - 代码内容
   * @param {string} data.language - 编程语言
   * @param {string} [data.name] - Snippet 名称
   * @param {string} [data.trigger] - 触发词
   * @param {Object} [data.metadata] - 元数据
   * @returns {Promise<Object>} 创建的 Snippet
   */
  async execute(data) {
    this._validate(data);

    try {
      // 使用 factory 创建 snippet
      const snippet = this.snippetFactory.createFromText(data.content, {
        language: data.language,
        name: data.name,
        trigger: data.trigger,
        metadata: data.metadata
      });

      // 保存到仓库
      await this.specRepository.save(snippet);

      if (this.logger) {
        this.logger.info('Snippet created', {
          id: snippet.identifier,
          language: snippet.language
        });
      }

      return snippet;
    } catch (error) {
      if (this.logger) {
        this.logger.error('Snippet creation failed', { error: error.message });
      }
      throw error;
    }
  }

  /**
   * 验证输入数据
   * @private
   */
  _validate(data) {
    if (!data.content || typeof data.content !== 'string') {
      throw new ValidationError('Content is required and must be a string', {
        field: 'content'
      });
    }

    if (!data.language || typeof data.language !== 'string') {
      throw new ValidationError('Language is required and must be a string', {
        field: 'language'
      });
    }

    const validLanguages = ['swift', 'objc', 'javascript', 'typescript', 'python', 'java'];
    if (!validLanguages.includes(data.language.toLowerCase())) {
      throw new ValidationError(`Language must be one of: ${validLanguages.join(', ')}`, {
        field: 'language',
        value: data.language
      });
    }
  }
}

module.exports = CreateSnippet;
