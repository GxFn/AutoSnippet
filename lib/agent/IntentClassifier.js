/**
 * IntentClassifier - 用户意图分类引擎
 * 
 * 支持以下意图：
 * - lint: 代码检查和验证
 * - generate: 代码生成
 * - search: 知识检索
 * - learn: 学习路径推荐
 * - analyze: 深度分析
 * - help: 帮助和说明
 */

class IntentClassifier {
  constructor(options = {}) {
    this.useML = options.useML || false;  // 未来可以加入 ML 模型
    this.confidenceThreshold = options.confidenceThreshold || 0.5;
    
    // 意图配置和关键词
    this.intentPatterns = this.initializePatterns();
    
    // 学习存储（可用于改进分类）
    this.trainingData = [];
  }
  
  /**
   * 初始化意图模式
   */
  initializePatterns() {
    return {
      lint: {
        keywords: [
          'check', 'lint', 'validate', 'audit', 'verify', 'scan',
          'review', 'examine', 'inspect',
          '检查', '校验', '验证', '审计', '扫描'
        ],
        phrases: [
          /\b(check|lint|validate|audit|verify|review)\s+(my|this|the)?\s*(code|file|script)/i,
          /\b(code|lint)\s+(check|review|audit|validation)/i,
          /有\s*(什么|哪些)?(问题|错误|警告)/
        ],
        baseConfidence: 0.85,
        contextBoost: {
          'error': 0.1,
          'warning': 0.1,
          'issue': 0.05
        }
      },
      
      generate: {
        keywords: [
          'create', 'write', 'generate', 'implement', 'build', 'make',
          'code', 'function', 'method', 'script',
          '创建', '生成', '编写', '实现', '构建', '代码'
        ],
        phrases: [
          /\b(create|write|generate|implement|build)\s+(a|the)?\s*(function|method|code|script)/i,
          /help\s+(me\s+)?(create|write|generate)/i,
          /怎么\s*(写|实现|生成)/,
          /给我\s*(写|生成).*(代码|函数)/
        ],
        baseConfidence: 0.80,
        contextBoost: {
          'function': 0.15,
          'api': 0.1,
          'async': 0.05
        }
      },
      
      search: {
        keywords: [
          'find', 'search', 'look for', 'get', 'show', 'where',
          'find me', 'search for',
          '查找', '搜索', '找', '获取', '显示'
        ],
        phrases: [
          /\b(find|search|look for|show me).*\b(example|recipe|pattern|code)\b/i,
          /(find|search|show)\s+(me\s+)?(a|the)?\s*(example|recipe|pattern)/i,
          /怎样\s*(使用|处理)/,
          /如何\s*(实现|使用)/
        ],
        baseConfidence: 0.75,
        contextBoost: {
          'example': 0.1,
          'pattern': 0.1,
          'similar': 0.05
        }
      },
      
      learn: {
        keywords: [
          'learn', 'explain', 'tutorial', 'guide', 'how to', 'understand',
          'teach', 'help me understand',
          '学习', '解释', '教程', '指南', '怎么', '理解'
        ],
        phrases: [
          /\b(learn|understand|explain).*(about|of)?\s*/i,
          /(teach|explain|tell)\s+(me\s+)?(how\s+)?(to\s+)?/i,
          /我想\s*(学习|了解|理解)/,
          /能否\s*(解释|说明)/
        ],
        baseConfidence: 0.78,
        contextBoost: {
          'beginner': 0.1,
          'basic': 0.1,
          'understand': 0.1
        }
      },
      
      analyze: {
        keywords: [
          'analyze', 'analysis', 'performance', 'optimize', 'profile',
          'benchmark', 'compare', 'evaluate',
          '分析', '性能', '优化', '比较', '评估'
        ],
        phrases: [
          /\b(analyze|analyze the|performance analysis)\b/i,
          /(optimize|improve|benchmark)\s+(the\s+)?(code|performance)/i,
          /分析.*(性能|效率)/
        ],
        baseConfidence: 0.75,
        contextBoost: {
          'performance': 0.15,
          'optimize': 0.15,
          'benchmark': 0.1
        }
      },
      
      help: {
        keywords: [
          'help', 'assist', 'support', 'guide', 'what',
          'commands', 'usage', 'how do i',
          '帮助', '支持', '命令', '怎么', '是什么'
        ],
        phrases: [
          /^help$/i,
          /^\/help$/,
          /what\s+(can\s+you\s+)?do/i,
          /能\s*(做什么|帮助)/
        ],
        baseConfidence: 0.80,
        contextBoost: {}
      },
      
      // AutoSnippet 特有意图
      recipe: {
        keywords: [
          'recipe', 'best practice', 'pattern', 'template', 'example',
          'knowledge', 'documentation', 'doc',
          '配方', '最佳实践', '模式', '模板', '示例', '文档'
        ],
        phrases: [
          /\b(recipe|best\s+practice|pattern)\s+for/i,
          /(find|show|get)\s+(me\s+)?(a|the)?\s*recipe/i,
          /查找.*(配方|最佳实践)/,
          /有没有.*(示例|模板)/
        ],
        baseConfidence: 0.85,
        contextBoost: {
          'recipe': 0.2,
          'pattern': 0.15,
          'best': 0.1
        }
      },
      
      snippet: {
        keywords: [
          'snippet', 'code snippet', 'xcode snippet', 'shortcut',
          'completion', 'autocomplete',
          '代码片段', '快捷键', '自动补全'
        ],
        phrases: [
          /\b(code\s+)?snippet/i,
          /xcode\s+snippet/i,
          /(find|install|share)\s+snippet/i,
          /代码片段/
        ],
        baseConfidence: 0.85,
        contextBoost: {
          'snippet': 0.2,
          'xcode': 0.15,
          'completion': 0.1
        }
      },
      
      context: {
        keywords: [
          'context', 'semantic', 'embed', 'index', 'vector',
          'knowledge base', 'semantic search',
          '上下文', '语义', '索引', '知识库', '语义搜索'
        ],
        phrases: [
          /\b(semantic|context)\s+(search|index)/i,
          /(embed|index)\s+(the\s+)?(context|knowledge)/i,
          /语义.*(搜索|索引)/,
          /知识库/
        ],
        baseConfidence: 0.80,
        contextBoost: {
          'semantic': 0.15,
          'embed': 0.15,
          'vector': 0.1
        }
      },
      
      guard: {
        keywords: [
          'guard', 'safety', 'check', 'validate', 'prevent',
          'protection', 'safety rule', 'violation',
          '防护', '安全', '检查', '校验', '防止', '违规'
        ],
        phrases: [
          /\b(guard|safety)\s+(rule|check)/i,
          /(prevent|check|validate)\s+.*\s+(error|crash|violation)/i,
          /安全.*(检查|规则)/,
          /防止.*(错误|崩溃)/
        ],
        baseConfidence: 0.80,
        contextBoost: {
          'guard': 0.2,
          'safety': 0.15,
          'violation': 0.1
        }
      },
      
      injection: {
        keywords: [
          'inject', 'insert', 'add code', 'modify', 'patch',
          'apply', 'integrate',
          '注入', '插入', '添加', '修改', '应用'
        ],
        phrases: [
          /\b(inject|insert|add)\s+(code|snippet)/i,
          /(apply|integrate)\s+(the\s+)?(recipe|pattern)/i,
          /注入.*(代码|片段)/,
          /插入.*(代码|模块)/
        ],
        baseConfidence: 0.75,
        contextBoost: {
          'inject': 0.2,
          'insert': 0.15,
          'integrate': 0.1
        }
      },
      
      candidate: {
        keywords: [
          'candidate', 'suggestion', 'recommend', 'propose',
          'ai generate', 'auto generate',
          '候选', '建议', '推荐', 'AI生成', '自动生成'
        ],
        phrases: [
          /\b(candidate|suggestion|recommendation)\b/i,
          /(recommend|suggest|propose)\s+(a|some)?\s*(solution|code)/i,
          /候选.*(方案|代码)/,
          /推荐.*(实现|方案)/
        ],
        baseConfidence: 0.75,
        contextBoost: {
          'candidate': 0.2,
          'recommend': 0.15,
          'suggest': 0.1
        }
      }
    };
  }
  
  /**
   * 分类用户输入的意图
   * @param {string} userInput - 用户输入
   * @param {Object} context - 上下文信息
   * @returns {Object} 意图分类结果
   */
  classify(userInput, context = {}) {
    if (!userInput || typeof userInput !== 'string') {
      return {
        intent: 'help',
        confidence: 0.5,
        explanation: 'Invalid input'
      };
    }
    
    const inputLower = userInput.toLowerCase().trim();
    
    // 快速检查特殊命令
    const specialIntent = this.checkSpecialCommands(inputLower);
    if (specialIntent) {
      return specialIntent;
    }
    
    // 计算所有意图的分数
    const scores = new Map();
    
    for (const [intentType, config] of Object.entries(this.intentPatterns)) {
      scores.set(intentType, this.calculateIntentScore(userInput, inputLower, config, context));
    }
    
    // 找出分数最高的意图
    let bestIntent = 'search';  // 默认意图
    let bestScore = 0;
    const allScores = {};
    
    for (const [intent, score] of scores) {
      allScores[intent] = score.confidence;
      if (score.confidence > bestScore) {
        bestScore = score.confidence;
        bestIntent = intent;
      }
    }
    
    // 如果分数低于阈值，使用默认意图
    if (bestScore < this.confidenceThreshold) {
      bestIntent = 'search';
      bestScore = 0.5;
    }
    
    // 考虑对话历史改进意图分类
    const boostedIntent = this.boostByConversationHistory(bestIntent, bestScore, context);
    
    return {
      intent: boostedIntent.intent,
      confidence: Math.min(boostedIntent.confidence, 1.0),
      allScores,
      explanation: this.generateExplanation(boostedIntent.intent, allScores)
    };
  }
  
  /**
   * 检查特殊命令
   */
  checkSpecialCommands(input) {
    const commands = {
      'help': { intent: 'help', confidence: 1.0 },
      '/help': { intent: 'help', confidence: 1.0 },
      'hello': { intent: 'help', confidence: 0.9 },
      'hi': { intent: 'help', confidence: 0.9 },
      'status': { intent: 'help', confidence: 0.8 },
      '/status': { intent: 'help', confidence: 0.8 }
    };
    
    return commands[input] || null;
  }
  
  /**
   * 计算意图分数
   */
  calculateIntentScore(userInput, inputLower, config, context) {
    let score = 0;
    let matchedElements = [];
    
    // 1. 关键词匹配（比例 40%）
    const keywordScore = this.matchKeywords(inputLower, config.keywords);
    score += keywordScore * 0.4;
    if (keywordScore > 0) matchedElements.push('keywords');
    
    // 2. 短语模式匹配（比例 50%）
    const phraseScore = this.matchPhrases(userInput, config.phrases);
    score += phraseScore * 0.5;
    if (phraseScore > 0) matchedElements.push('phrases');
    
    // 3. 基础信心度（比例 10%）
    score += config.baseConfidence * 0.1;
    
    // 4. 上下文增强（可选）
    const contextBoost = this.applyContextBoost(inputLower, config.contextBoost || {});
    score += contextBoost;
    
    // 归一化分数到 0-1
    const confidence = Math.min(score, 1.0);
    
    return {
      confidence,
      matchedElements
    };
  }
  
  /**
   * 匹配关键词
   */
  matchKeywords(inputLower, keywords) {
    if (!keywords || keywords.length === 0) return 0;
    
    let matchCount = 0;
    for (const keyword of keywords) {
      if (inputLower.includes(keyword.toLowerCase())) {
        matchCount++;
      }
    }
    
    // 返回匹配的关键词比例
    return Math.min(matchCount / keywords.length, 1.0);
  }
  
  /**
   * 匹配短语模式
   */
  matchPhrases(userInput, phrases) {
    if (!phrases || phrases.length === 0) return 0;
    
    let bestMatch = 0;
    for (const pattern of phrases) {
      if (pattern.test(userInput)) {
        bestMatch = 1.0;
        break;
      }
    }
    
    return bestMatch;
  }
  
  /**
   * 应用上下文增强
   */
  applyContextBoost(inputLower, boostMap) {
    let boost = 0;
    
    for (const [keyword, boostAmount] of Object.entries(boostMap)) {
      if (inputLower.includes(keyword.toLowerCase())) {
        boost += boostAmount;
      }
    }
    
    return Math.min(boost, 0.3);  // 最多增加 30%
  }
  
  /**
   * 基于对话历史增强意图分类
   */
  boostByConversationHistory(currentIntent, currentScore, context) {
    if (!context.conversationHistory || context.conversationHistory.length === 0) {
      return { intent: currentIntent, confidence: currentScore };
    }
    
    // 获取最近 3 次的意图
    const recentIntents = context.conversationHistory
      .slice(-3)
      .map(h => h.intent);
    
    // 如果当前意图与最近意图相同，增加信心
    if (recentIntents.includes(currentIntent)) {
      const boostFactor = 1.05;
      return {
        intent: currentIntent,
        confidence: currentScore * boostFactor
      };
    }
    
    // 如果相反的意图出现（如从 generate 切换到 search），降低信心
    const oppositePairs = {
      'lint': ['generate'],
      'generate': ['search'],
      'search': ['generate', 'learn']
    };
    
    const opposites = oppositePairs[currentIntent] || [];
    if (recentIntents.some(intent => opposites.includes(intent))) {
      const reduceFactor = 0.95;
      return {
        intent: currentIntent,
        confidence: currentScore * reduceFactor
      };
    }
    
    return { intent: currentIntent, confidence: currentScore };
  }
  
  /**
   * 生成解释
   */
  generateExplanation(intent, allScores) {
    const explanation = `Classified as "${intent}" based on user input analysis.`;
    
    const sortedScores = Object.entries(allScores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    
    if (sortedScores.length > 0) {
      const topIntents = sortedScores
        .map(([intent, score]) => `${intent} (${(score * 100).toFixed(0)}%)`)
        .join(', ');
      return `${explanation} Top candidates: ${topIntents}`;
    }
    
    return explanation;
  }
  
  /**
   * 学习反馈（用于改进分类）
   * @param {string} userInput - 用户输入
   * @param {string} actualIntent - 实际意图
   */
  learnFromFeedback(userInput, actualIntent) {
    this.trainingData.push({
      input: userInput,
      intent: actualIntent,
      timestamp: Date.now()
    });
    
    // 保留最近 1000 条记录用于学习
    if (this.trainingData.length > 1000) {
      this.trainingData.shift();
    }
  }
  
  /**
   * 获取分类统计信息
   */
  getStatistics() {
    if (this.trainingData.length === 0) {
      return { status: 'No training data yet' };
    }
    
    const intentCounts = {};
    for (const record of this.trainingData) {
      intentCounts[record.intent] = (intentCounts[record.intent] || 0) + 1;
    }
    
    return {
      totalSamples: this.trainingData.length,
      intentDistribution: intentCounts
    };
  }
}

module.exports = IntentClassifier;
