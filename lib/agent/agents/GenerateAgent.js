/**
 * GenerateAgent - 代码生成和实现Agent
 * 负责根据输入生成代码、文档和实现方案
 */

const { EventEmitter } = require('events');

class GenerateAgent extends EventEmitter {
  constructor(options = {}) {
    super();
    this.name = 'generate';
    this.version = '1.0.0';
    this.capabilities = [
      'code-generation',
      'snippet-creation',
      'documentation',
      'template-instantiation'
    ];

    // 配置
    this.config = {
      timeout: options.timeout || 10000,
      language: options.language || 'javascript',
      style: options.style || 'modern', // 'modern', 'legacy', 'compact'
      quality: options.quality || 'production', // 'prototype', 'production', 'research'
      ...options
    };

    // 依赖注入
    this.aiProvider = options.aiProvider; // 可选的AI提供商
    this.snippetFactory = options.snippetFactory; // 代码片段工厂
    this.templateEngine = options.templateEngine; // 模板引擎
    this.knowledgeGraph = options.knowledgeGraph; // 知识图谱
    this.logger = options.logger || console;

    // 生成历史记录
    this.generationHistory = [];
    this.historyLimit = 50;

    // 统计
    this.stats = {
      totalGenerations: 0,
      successfulGenerations: 0,
      failedGenerations: 0,
      linesOfCodeGenerated: 0,
      avgGenerationTime: 0,
      generationsByType: {},
      lastGeneration: null
    };
  }

  /**
   * 执行代码生成
   * @param {Object} context - 执行上下文
   * @param {string} context.requirement - 生成需求
   * @param {string} context.type - 生成类型 ('function', 'class', 'component', 'document')
   * @param {Array} context.inputs - 函数输入参数
   * @param {string} context.outputType - 返回类型
   * @param {Object} context.sessionContext - 会话上下文
   * @returns {Promise<Object>} 生成结果
   */
  async execute(context) {
    const startTime = Date.now();
    this.stats.totalGenerations++;

    try {
      // 参数验证
      if (!context || !context.requirement) {
        throw new Error('Missing required context.requirement');
      }

      const requirement = context.requirement;
      const type = context.type || 'function';
      const language = context.language || this.config.language;
      const style = context.style || this.config.style;

      // 生成代码
      let generatedCode = '';
      let generationType = 'default';

      if (type === 'function') {
        generatedCode = await this._generateFunction(requirement, context);
        generationType = 'function';
      } else if (type === 'class') {
        generatedCode = await this._generateClass(requirement, context);
        generationType = 'class';
      } else if (type === 'component') {
        generatedCode = await this._generateComponent(requirement, context);
        generationType = 'component';
      } else if (type === 'document') {
        generatedCode = await this._generateDocumentation(requirement, context);
        generationType = 'document';
      } else {
        generatedCode = await this._generateCode(requirement, context);
        generationType = 'generic';
      }

      // 代码质量检查和优化
      const analysis = await this._analyzeGeneratedCode(generatedCode, context);
      const optimized = this.config.quality === 'production' 
        ? await this._optimizeCode(generatedCode, analysis)
        : generatedCode;

      // 生成说明和用法
      const documentation = this._generateInstructions(optimized, type, requirement);

      // 生成相关片段
      const relatedSnippets = await this._findRelatedSnippets(requirement);

      const executionTime = Date.now() - startTime;
      this.stats.successfulGenerations++;
      this.stats.linesOfCodeGenerated += (optimized.match(/\n/g) || []).length;
      this._updateStats(type, executionTime);

      const result = {
        agentId: this.name,
        success: true,
        requirement,
        type,
        language,
        generationType,
        generatedCode: optimized,
        codeLength: optimized.length,
        codeLines: (optimized.match(/\n/g) || []).length,
        analysis,
        documentation,
        relatedSnippets,
        quality: analysis.score,
        executionTime,
        timestamp: new Date().toISOString()
      };

      // 保存到历史记录
      this._saveToHistory(result);

      this.emit('generation_complete', { context, result });
      return result;
    } catch (error) {
      this.stats.failedGenerations++;
      const executionTime = Date.now() - startTime;
      this._updateStats(context.type || 'unknown', executionTime, true);

      const errorResult = {
        agentId: this.name,
        success: false,
        requirement: context.requirement,
        error: error.message,
        generatedCode: '',
        codeLength: 0,
        codeLines: 0,
        executionTime,
        timestamp: new Date().toISOString()
      };

      this.emit('generation_error', { context, error, result: errorResult });
      throw error;
    }
  }

  /**
   * 生成函数
   * @private
   */
  async _generateFunction(requirement, context) {
    const inputs = context.inputs || [];
    const outputType = context.outputType || 'any';
    const style = context.style || this.config.style;

    // 从需求中提取函数名
    const functionName = this._extractFunctionName(requirement);
    const description = this._parseDescription(requirement);

    // 构建函数签名
    let functionSignature = '';
    if (this.config.language === 'typescript') {
      const inputParams = inputs.map((inp, idx) => 
        `${inp.name || `param${idx}`}: ${inp.type || 'any'}`
      ).join(', ');
      functionSignature = `function ${functionName}(${inputParams}): ${outputType}`;
    } else {
      const inputParams = inputs.map((inp, idx) => 
        inp.name || `param${idx}`
      ).join(', ');
      functionSignature = `function ${functionName}(${inputParams})`;
    }

    // 生成函数体
    let functionBody = this._generateFunctionBody(requirement, inputs, outputType, style);

    // 生成JSDoc注释
    const jsdoc = this._generateJSDoc(functionName, description, inputs, outputType);

    // 组合完整函数
    const code = `${jsdoc}\n${functionSignature} {\n${functionBody}\n}`;
    return code;
  }

  /**
   * 生成函数体
   * @private
   */
  _generateFunctionBody(requirement, inputs, outputType, style) {
    // 简化的函数体生成逻辑
    const requirementLower = requirement.toLowerCase();
    
    let body = '';

    if (requirementLower.includes('fetch') || requirementLower.includes('http')) {
      body = this._generateFetchBody(inputs);
    } else if (requirementLower.includes('array') || requirementLower.includes('filter')) {
      body = this._generateArrayBody(inputs);
    } else if (requirementLower.includes('async') || requirementLower.includes('await')) {
      body = this._generateAsyncBody(inputs);
    } else if (requirementLower.includes('error') || requirementLower.includes('try')) {
      body = this._generateErrorHandlingBody(inputs);
    } else {
      // 默认实现
      body = style === 'compact' 
        ? '  return null;'
        : `  // TODO: Implement ${requirement}\n  return null;`;
    }

    return body;
  }

  /**
   * 生成获取数据的函数体
   * @private
   */
  _generateFetchBody(inputs) {
    return `  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(\`HTTP error! status: \${response.status}\`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Fetch error:', error);
    throw error;
  }`;
  }

  /**
   * 生成数组处理的函数体
   * @private
   */
  _generateArrayBody(inputs) {
    return `  if (!Array.isArray(array)) {
    throw new TypeError('Input must be an array');
  }
  
  return array
    .filter(item => item !== null && item !== undefined)
    .map(item => item);`;
  }

  /**
   * 生成异步函数体
   * @private
   */
  _generateAsyncBody(inputs) {
    return `  try {
    const result = await Promise.resolve(data);
    return result;
  } catch (error) {
    console.error('Async error:', error);
    throw error;
  }`;
  }

  /**
   * 生成错误处理的函数体
   * @private
   */
  _generateErrorHandlingBody(inputs) {
    return `  try {
    // Main logic here
    return null;
  } catch (error) {
    console.error('Error occurred:', error.message);
    // Handle error appropriately
    throw error;
  }`;
  }

  /**
   * 生成类
   * @private
   */
  async _generateClass(requirement, context) {
    const className = this._extractClassName(requirement);
    const methods = this._extractMethods(requirement);
    const properties = context.properties || [];

    let classCode = `class ${className} {\n`;

    // 构造函数
    classCode += `  constructor() {\n`;
    properties.forEach(prop => {
      classCode += `    this.${prop.name} = ${prop.defaultValue || 'null'};\n`;
    });
    classCode += `  }\n\n`;

    // 方法
    methods.forEach(method => {
      classCode += `  ${method}(args) {\n    // TODO: Implement ${method}\n  }\n\n`;
    });

    classCode += `}`;
    classCode += `\n\nmodule.exports = ${className};`;

    return classCode;
  }

  /**
   * 生成组件（React）
   * @private
   */
  async _generateComponent(requirement, context) {
    const componentName = this._extractClassName(requirement);
    const props = context.props || [];

    let component = `import React from 'react';\n\n`;
    component += `interface ${componentName}Props {\n`;
    props.forEach(prop => {
      component += `  ${prop.name}: ${prop.type};\n`;
    });
    component += `}\n\n`;

    component += `const ${componentName}: React.FC<${componentName}Props> = ({\n`;
    props.forEach(prop => {
      component += `  ${prop.name},\n`;
    });
    component += `}) => {\n`;
    component += `  return (\n`;
    component += `    <div className="${componentName}">\n`;
    component += `      {/* Component content */}\n`;
    component += `    </div>\n`;
    component += `  );\n`;
    component += `};\n\n`;
    component += `export default ${componentName};`;

    return component;
  }

  /**
   * 生成文档
   * @private
   */
  async _generateDocumentation(requirement, context) {
    const title = this._parseTitle(requirement);
    
    let doc = `# ${title}\n\n`;
    doc += `## Overview\n`;
    doc += `${requirement}\n\n`;
    doc += `## Usage\n\`\`\`javascript\n`;
    doc += `// Example usage\nconst result = yourFunction();\n`;
    doc += `\`\`\`\n\n`;
    doc += `## Parameters\n`;
    doc += `- None\n\n`;
    doc += `## Returns\n`;
    doc += `- {any} Result value\n\n`;
    doc += `## Examples\n`;
    doc += `### Example 1\n`;
    doc += `Describe example here.\n`;
    doc += `\`\`\`javascript\ncode here\n\`\`\`\n`;

    return doc;
  }

  /**
   * 生成通用代码
   * @private
   */
  async _generateCode(requirement, context) {
    // 尝试使用AI提供商（如果可用）
    if (this.aiProvider && this.aiProvider.generate) {
      try {
        return await this.aiProvider.generate(requirement, {
          language: this.config.language,
          style: this.config.style,
          quality: this.config.quality
        });
      } catch (err) {
        this.logger.warn('[GenerateAgent] AI generation failed:', err.message);
      }
    }

    // 降级：返回模板
    return `// Generated code for: ${requirement}\n// TODO: Implement this requirement\n\nfunction generated() {\n  return null;\n}`;
  }

  /**
   * 分析生成的代码
   * @private
   */
  async _analyzeGeneratedCode(code, context) {
    const lines = code.split('\n').length;
    const hasComments = /\/\/|\/\*|\*\//.test(code);
    const hasErrorHandling = /try|catch|throw/.test(code);
    const hasTypeAnnotations = /:\s*(string|number|boolean|any|void|object)/.test(code);
    const complexity = this._estimateCodeComplexity(code);

    // 计算质量分数 (0-100)
    let score = 50;
    if (hasComments) score += 15;
    if (hasErrorHandling) score += 15;
    if (hasTypeAnnotations) score += 10;
    if (complexity < 7) score += 10;
    score = Math.min(score, 100);

    return {
      lines,
      hasComments,
      hasErrorHandling,
      hasTypeAnnotations,
      complexity,
      score,
      issues: this._identifyCodeIssues(code),
      improvements: this._suggestImprovements(code)
    };
  }

  /**
   * 优化代码
   * @private
   */
  async _optimizeCode(code, analysis) {
    let optimized = code;

    // 如果缺少错误处理，添加
    if (!analysis.hasErrorHandling && code.includes('fetch')) {
      optimized = optimized.replace(
        /fetch\((.*?)\)/,
        'fetch($1).catch(err => console.error(err))'
      );
    }

    // 如果缺少类型注释（TypeScript）
    if (!analysis.hasTypeAnnotations && this.config.language === 'typescript') {
      optimized = optimized.replace(/function (\w+)\((.*?)\)/, 'function $1($2): any');
    }

    return optimized;
  }

  /**
   * 估算代码复杂度
   * @private
   */
  _estimateCodeComplexity(code) {
    let complexity = 1;
    complexity += (code.match(/if\s*\(|else/g) || []).length;
    complexity += (code.match(/for|while|do\s+while/g) || []).length;
    complexity += (code.match(/\?\s*:/g) || []).length;
    return Math.min(complexity, 10);
  }

  /**
   * 识别代码问题
   * @private
   */
  _identifyCodeIssues(code) {
    const issues = [];

    if (code.includes('TODO') || code.includes('FIXME')) {
      issues.push('Contains TODO/FIXME comments');
    }

    if (!code.includes('return')) {
      issues.push('Function does not return a value');
    }

    if (code.includes('var ')) {
      issues.push('Uses var instead of const/let');
    }

    return issues;
  }

  /**
   * 建议改进
   * @private
   */
  _suggestImprovements(code) {
    const suggestions = [];

    if (!code.includes('//')) {
      suggestions.push('Add comments for clarity');
    }

    if (!code.includes('error') && code.includes('fetch')) {
      suggestions.push('Add error handling for API calls');
    }

    if (code.length > 500) {
      suggestions.push('Consider breaking into smaller functions');
    }

    return suggestions;
  }

  /**
   * 生成说明
   * @private
   */
  _generateInstructions(code, type, requirement) {
    const instructions = {
      usage: `To use this ${type}, import and call it with the required parameters.`,
      integration: `Integrate this code into your project by copying it to the appropriate file.`,
      testing: `Test this code with various inputs to ensure it works correctly.`,
      deployment: `Review the generated code before deploying to production.`,
      examples: [
        `Example 1: Basic usage`,
        `Example 2: With error handling`,
        `Example 3: Advanced usage`
      ]
    };

    return instructions;
  }

  /**
   * 查找相关片段
   * @private
   */
  async _findRelatedSnippets(requirement) {
    // 在实际系统中，这会查询代码库
    const relatedPatterns = {
      'fetch': ['error-handling', 'async-await', 'promise'],
      'async': ['promise', 'callback', 'error-handling'],
      'class': ['constructor', 'methods', 'inheritance'],
      'array': ['filter', 'map', 'reduce']
    };

    const keywords = requirement.toLowerCase().split(' ');
    const related = [];

    for (const keyword of keywords) {
      if (relatedPatterns[keyword]) {
        related.push(...relatedPatterns[keyword]);
      }
    }

    return [...new Set(related)].slice(0, 5);
  }

  /**
   * 提取函数名
   * @private
   */
  _extractFunctionName(requirement) {
    // 尝试从需求中提取函数名
    const match = requirement.match(/function\s+(\w+)|(\w+)\s+function|generate\s+(\w+)/i);
    if (match) {
      return match[1] || match[2] || match[3] || 'generated';
    }

    // 从需求词创建函数名
    return 'generated' + requirement.split(' ').slice(0, 2).join('').charAt(0).toUpperCase();
  }

  /**
   * 提取类名
   * @private
   */
  _extractClassName(requirement) {
    const match = requirement.match(/class\s+(\w+)|(\w+)\s+class/i);
    if (match) {
      return match[1] || match[2];
    }

    const words = requirement.split(' ').slice(0, 2);
    return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  }

  /**
   * 提取方法名
   * @private
   */
  _extractMethods(requirement) {
    const methodPatterns = ['constructor', 'get', 'set', 'init', 'destroy', 'render'];
    const methods = [];

    methodPatterns.forEach(pattern => {
      if (requirement.toLowerCase().includes(pattern)) {
        methods.push(pattern);
      }
    });

    return methods.length > 0 ? methods : ['execute', 'process'];
  }

  /**
   * 解析描述
   * @private
   */
  _parseDescription(requirement) {
    // 移除技术关键词，提取自然语言描述
    return requirement
      .replace(/function|class|component|document|generate/gi, '')
      .trim();
  }

  /**
   * 解析标题
   * @private
   */
  _parseTitle(requirement) {
    const words = requirement.split(' ').slice(0, 5);
    return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  /**
   * 生成JSDoc注释
   * @private
   */
  _generateJSDoc(functionName, description, inputs, outputType) {
    let jsdoc = '/**\n';
    jsdoc += ` * ${description || functionName}\n`;
    jsdoc += ` * \n`;

    inputs.forEach(input => {
      jsdoc += ` * @param {${input.type || 'any'}} ${input.name} - ${input.description || input.name}\n`;
    });

    jsdoc += ` * @returns {${outputType}} Result value\n`;
    jsdoc += ' */';

    return jsdoc;
  }

  /**
   * 保存到历史记录
   * @private
   */
  _saveToHistory(result) {
    this.generationHistory.push({
      ...result,
      savedAt: new Date().toISOString()
    });

    if (this.generationHistory.length > this.historyLimit) {
      this.generationHistory.shift();
    }
  }

  /**
   * 更新统计信息
   * @private
   */
  _updateStats(type, executionTime, isError = false) {
    if (!this.stats.generationsByType[type]) {
      this.stats.generationsByType[type] = 0;
    }
    this.stats.generationsByType[type]++;

    this.stats.lastGeneration = {
      timestamp: new Date().toISOString(),
      executionTime,
      type,
      success: !isError
    };

    const totalTime = this.stats.avgGenerationTime * (this.stats.totalGenerations - 1) + executionTime;
    this.stats.avgGenerationTime = totalTime / this.stats.totalGenerations;
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    return {
      ...this.stats,
      name: this.name,
      version: this.version,
      capabilities: this.capabilities,
      historySize: this.generationHistory.length
    };
  }

  /**
   * 获取生成历史
   */
  getHistory(limit = 10) {
    return this.generationHistory.slice(-limit).reverse();
  }

  /**
   * 重置统计信息
   */
  resetStatistics() {
    this.stats = {
      totalGenerations: 0,
      successfulGenerations: 0,
      failedGenerations: 0,
      linesOfCodeGenerated: 0,
      avgGenerationTime: 0,
      generationsByType: {},
      lastGeneration: null
    };
  }
}

module.exports = GenerateAgent;
