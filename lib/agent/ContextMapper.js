/**
 * ContextMapper - 将用户输入映射到Agent所需的执行上下文
 * 这是协调层与Agent之间的适配器
 */

class ContextMapper {
  constructor(options = {}) {
    this.logger = options.logger || console;
  }

  /**
   * 将用户请求转换为Agent执行上下文
   * @param {string} userInput - 用户原始输入
   * @param {string} intent - 分类的意图
   * @param {Object} sessionContext - 会话上下文
   * @param {Object} knowledgeGraph - 知识图谱（可选）
   * @returns {Object} Agent执行所需的上下文
   */
  mapUserInputToContext(userInput, intent, sessionContext, knowledgeGraph) {
    const baseContext = {
      userInput,
      intent,
      sessionContext,
      timestamp: new Date().toISOString()
    };

    // 根据意图类型生成特定的Agent上下文
    switch (intent) {
      case 'lint':
        return this._mapLintContext(userInput, baseContext);
      case 'generate':
        return this._mapGenerateContext(userInput, baseContext);
      case 'search':
        return this._mapSearchContext(userInput, baseContext);
      case 'learn':
        return this._mapLearnContext(userInput, baseContext);
      case 'analyze':
        return this._mapAnalyzeContext(userInput, baseContext);
      default:
        return baseContext;
    }
  }

  /**
   * 为 Lint Agent 生成上下文
   * @private
   */
  _mapLintContext(userInput, baseContext) {
    // 从用户输入中提取代码（如果有）
    const codeMatch = userInput.match(/```[\s\S]*?```|<code>[\s\S]*?<\/code>/);
    const code = codeMatch ? codeMatch[0] : this._generateSampleCode(userInput);

    // 从输入中推断文件类型
    const fileType = this._detectLanguage(userInput) || 'js';
    const filePath = this._extractFilePath(userInput) || `file.${fileType}`;

    return {
      ...baseContext,
      code,
      filePath,
      fileType,
      severity: this._extractSeverity(userInput) || 'all'
    };
  }

  /**
   * 为 Generate Agent 生成上下文
   * @private
   */
  _mapGenerateContext(userInput, baseContext) {
    // 提取生成需求
    const requirement = this._extractRequirement(userInput);
    
    // 推断生成类型
    const type = this._inferGenerationType(userInput);

    // 提取参数（如果有）
    const inputs = this._extractInputParameters(userInput) || [];
    const outputType = this._extractOutputType(userInput) || 'any';

    return {
      ...baseContext,
      requirement,
      type,
      inputs,
      outputType,
      language: this._detectLanguage(userInput) || 'javascript',
      style: 'modern'
    };
  }

  /**
   * 为 Search Agent 生成上下文
   * @private
   */
  _mapSearchContext(userInput, baseContext) {
    // 提取搜索查询
    const query = this._extractSearchQuery(userInput);

    // 推断搜索类型
    const type = this._inferSearchType(userInput);

    // 提取过滤条件
    const filters = this._extractFilters(userInput);

    return {
      ...baseContext,
      query,
      type,
      filters,
      maxResults: 10,
      minRelevance: 0.5
    };
  }

  /**
   * 为 Learn Agent 生成上下文
   * @private
   */
  _mapLearnContext(userInput, baseContext) {
    // 提取学习主题
    const topic = this._extractTopic(userInput);

    // 推断学习类型
    const type = this._inferLearningType(userInput);

    // 推断用户水平
    const currentLevel = this._inferUserLevel(baseContext.sessionContext);

    return {
      ...baseContext,
      topic,
      type,
      currentLevel,
      format: 'comprehensive'
    };
  }

  /**
   * 为 Analyze Agent 生成上下文
   * @private
   */
  _mapAnalyzeContext(userInput, baseContext) {
    // 提取要分析的代码或数据
    const codeMatch = userInput.match(/```[\s\S]*?```|<code>[\s\S]*?<\/code>/);
    const code = codeMatch ? codeMatch[0] : '';

    // 推断分析类型
    const type = this._inferAnalysisType(userInput);

    // 提取分析参数
    const parameters = this._extractAnalysisParameters(userInput);

    return {
      ...baseContext,
      code,
      type,
      parameters,
      focus: this._extractAnalysisFocus(userInput) || 'performance'
    };
  }

  /**
   * 提取代码要求
   * @private
   */
  _extractRequirement(userInput) {
    // 移除常见前缀，获取核心需求
    const cleaned = userInput
      .replace(/^(create|generate|write|implement|build|make)\s+/i, '')
      .replace(/^a\s+|^an\s+|^the\s+/i, '');
    
    return cleaned.trim();
  }

  /**
   * 推断生成类型
   * @private
   */
  _inferGenerationType(userInput) {
    const input = userInput.toLowerCase();

    if (input.includes('function') || input.includes('method')) {
      return 'function';
    } else if (input.includes('class')) {
      return 'class';
    } else if (input.includes('component') || input.includes('react')) {
      return 'component';
    } else if (input.includes('documentation') || input.includes('readme')) {
      return 'document';
    } else if (input.includes('test')) {
      return 'test';
    }

    return 'function'; // 默认为函数
  }

  /**
   * 提取搜索查询
   * @private
   */
  _extractSearchQuery(userInput) {
    // 移除搜索相关的动词
    return userInput
      .replace(/^(find|search|look\s+for|get|fetch)\s+/i, '')
      .replace(/\s+examples?\s*$/i, '')
      .trim();
  }

  /**
   * 推断搜索类型
   * @private
   */
  _inferSearchType(userInput) {
    const input = userInput.toLowerCase();

    if (input.includes('recipe')) return 'recipe';
    if (input.includes('snippet')) return 'snippet';
    if (input.includes('pattern')) return 'pattern';
    if (input.includes('example')) return 'example';

    return 'general';
  }

  /**
   * 提取过滤条件
   * @private
   */
  _extractFilters(userInput) {
    const filters = {};

    // 语言过滤
    const langMatch = userInput.match(/\b(javascript|typescript|python|java|go|rust)\b/i);
    if (langMatch) {
      filters.language = langMatch[1].toLowerCase();
    }

    // 难度过滤
    if (userInput.includes('advanced')) filters.difficulty = 'advanced';
    if (userInput.includes('beginner')) filters.difficulty = 'beginner';
    if (userInput.includes('intermediate')) filters.difficulty = 'intermediate';

    return filters;
  }

  /**
   * 提取学习主题
   * @private
   */
  _extractTopic(userInput) {
    // 移除学习相关的动词
    return userInput
      .replace(/^(learn|teach|explain|understand|study)\s+(?:me\s+)?(?:about\s+)?/i, '')
      .replace(/\?$/i, '')
      .trim();
  }

  /**
   * 推断学习类型
   * @private
   */
  _inferLearningType(userInput) {
    const input = userInput.toLowerCase();

    if (input.includes('explain') || input.includes('understand')) {
      return 'explain';
    } else if (input.includes('tutorial') || input.includes('guide')) {
      return 'tutorial';
    } else if (input.includes('path') || input.includes('roadmap')) {
      return 'path';
    } else if (input.includes('test') || input.includes('quiz') || input.includes('assess')) {
      return 'assessment';
    }

    return 'explain'; // 默认解释
  }

  /**
   * 推断用户水平
   * @private
   */
  _inferUserLevel(sessionContext) {
    if (!sessionContext) return 'intermediate';

    const requestCount = sessionContext.requestCount || 0;

    if (requestCount < 10) return 'beginner';
    if (requestCount < 50) return 'intermediate';
    return 'advanced';
  }

  /**
   * 推断分析类型
   * @private
   */
  _inferAnalysisType(userInput) {
    const input = userInput.toLowerCase();

    if (input.includes('performance') || input.includes('optimize')) return 'performance';
    if (input.includes('complexity') || input.includes('big-o')) return 'complexity';
    if (input.includes('security')) return 'security';
    if (input.includes('maintainability') || input.includes('quality')) return 'quality';

    return 'performance';
  }

  /**
   * 提取分析参数
   * @private
   */
  _extractAnalysisParameters(userInput) {
    // 简单的参数提取
    const params = {};

    if (userInput.includes('memory')) params.includeMemory = true;
    if (userInput.includes('time')) params.includeTime = true;
    if (userInput.includes('space')) params.includeSpace = true;

    return params;
  }

  /**
   * 提取分析焦点
   * @private
   */
  _extractAnalysisFocus(userInput) {
    const input = userInput.toLowerCase();

    if (input.includes('performance')) return 'performance';
    if (input.includes('security')) return 'security';
    if (input.includes('maintainability')) return 'maintainability';
    if (input.includes('scalability')) return 'scalability';

    return 'performance';
  }

  /**
   * 检测编程语言
   * @private
   */
  _detectLanguage(userInput) {
    const input = userInput.toLowerCase();

    if (input.includes('typescript') || input.includes('ts ')) return 'typescript';
    if (input.includes('python')) return 'python';
    if (input.includes('java')) return 'java';
    if (input.includes('go ') || input.includes('golang')) return 'go';
    if (input.includes('rust')) return 'rust';
    if (input.includes('c++') || input.includes('cpp')) return 'cpp';
    if (input.includes('javascript') || input.includes('js ')) return 'javascript';
    if (input.includes('react')) return 'javascript'; // React默认为JavaScript
    if (input.includes('swift') || input.includes('ios')) return 'swift';

    return 'javascript'; // 默认JavaScript
  }

  /**
   * 提取文件路径
   * @private
   */
  _extractFilePath(userInput) {
    const match = userInput.match(/(?:file|path):\s*['"]?([^\s'"]+)['"]?/i);
    return match ? match[1] : null;
  }

  /**
   * 提取严重程度
   * @private
   */
  _extractSeverity(userInput) {
    const input = userInput.toLowerCase();

    if (input.includes('error')) return 'error';
    if (input.includes('warning')) return 'warning';
    if (input.includes('all')) return 'all';

    return null;
  }

  /**
   * 提取输入参数
   * @private
   */
  _extractInputParameters(userInput) {
    // 简单的参数提取
    const paramMatch = userInput.match(/params?(?:eters?)?\s*[:=]?\s*\{([^}]+)\}/i);
    
    if (!paramMatch) return [];

    const params = paramMatch[1]
      .split(',')
      .map(p => {
        const [name, type] = p.trim().split(':').map(s => s.trim());
        return { name, type: type || 'any' };
      });

    return params;
  }

  /**
   * 提取返回类型
   * @private
   */
  _extractOutputType(userInput) {
    const match = userInput.match(/returns?\s*[:=]?\s*(?:type\s+)?'?(\w+)'?/i);
    return match ? match[1] : null;
  }

  /**
   * 生成示例代码
   * @private
   */
  _generateSampleCode(userInput) {
    // 根据输入生成相关的示例代码
    const input = userInput.toLowerCase();

    if (input.includes('async') || input.includes('await')) {
      return `async function example() {
  try {
    const result = await someAsyncOperation();
    return result;
  } catch (error) {
    console.error(error);
  }
}`;
    } else if (input.includes('fetch')) {
      return `fetch(url)
  .then(res => res.json())
  .then(data => console.log(data))
  .catch(err => console.error(err));`;
    } else {
      return `function example() {
  // Sample code for linting
  return null;
}`;
    }
  }
}

module.exports = ContextMapper;
