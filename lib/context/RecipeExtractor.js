/**
 * Recipe 元数据自动提取器
 * 从 Recipe Markdown 文件自动提取、推断和增强元数据
 * 支持 frontmatter、代码分析、语义标签生成、关系推断
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RecipeSchema } = require('./recipe-schema');

class RecipeExtractor {
  constructor(options = {}) {
  this.options = {
    extractSemanticTags: true,
    analyzeCodeQuality: true,
    inferDependencies: true,
    computeQualityScore: true,
    contentHashEnabled: true,
    ...options
  };
  
  // 语义关键词映射（用于自动标签生成）
  this.semanticTagMaps = {
    async: ['asynchronous-programming', 'promise-handling', 'concurrency'],
    promise: ['promise-based', 'asynchronous-programming', 'error-handling'],
    error: ['error-handling', 'exception-management', 'resilience'],
    cache: ['caching-strategy', 'performance-optimization', 'memory-management'],
    api: ['http-communication', 'data-fetching', 'network-operations'],
    database: ['database-operations', 'persistence', 'data-management'],
    security: ['security', 'authentication', 'authorization', 'encryption'],
    testing: ['testing', 'unit-testing', 'integration-testing', 'quality-assurance'],
    performance: ['performance-optimization', 'optimization', 'efficiency'],
    refactor: ['code-refactoring', 'maintainability', 'clean-code']
  };
  
  // 常见的 Recipe ID 模式
  this.idPattern = /^recipe_[a-z0-9_]+_\d{3}$/;
  }

  /**
   * 从文件路径提取元数据
   * @param {string} filePath - Recipe 文件路径
   * @returns {object} 提取的元数据
   */
  extractFromFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const filename = path.basename(filePath, '.md');
  
  return this.extractFromContent(content, filename, filePath);
  }

  /**
   * 从 Markdown 内容提取元数据
   * @param {string} content - Markdown 内容
   * @param {string} filename - 文件名（用于生成ID）
   * @param {string} filePath - 文件路径（可选）
   * @returns {object} 提取的元数据
   */
  extractFromContent(content, filename, filePath = null) {
  try {
    // 1. 解析 Frontmatter 和基础信息
    const frontmatter = this.parseFrontmatter(content);
    const basicInfo = this.extractBasicInfo(content, filename, frontmatter);
    
    // 2. 提取代码块和结构
    const codeBlocks = this.extractCodeBlocks(content);
    const codeStructure = this.analyzeCodeStructure(codeBlocks);
    
    // 3. 语义分析
    const semanticTags = this.extractSemanticTags(content, codeBlocks);
    const keywords = this.extractKeywords(content, codeBlocks, semanticTags);
    const topics = this.inferTopics(content, semanticTags);
    
    // 4. 使用语境提取
    const contextInfo = this.extractContextInfo(content);
    
    // 5. 代码质量分析
    const quality = this.analyzeCodeQuality(codeBlocks, content);
    
    // 6. 内容哈希（用于变化检测）
    const contentHash = this.options.contentHashEnabled 
    ? this.computeContentHash(content)
    : null;
    
    // 7. 组合最终元数据
    const metadata = {
    // 基础信息
    ...basicInfo,
    
    // 内容
    code: codeBlocks.length > 0 ? codeBlocks[0].content : '',
    codeBlocks,
    documentation: this.extractDocumentation(content),
    
    // 语义信息
    semanticTags,
    keywords,
    topics,
    
    // 使用语境
    ...contextInfo,
    
    // 质量信息
    quality,
    
    // 技术细节
    security: this.analyzeSecurityConcerns(content, codeBlocks),
    performance: this.analyzePerformance(codeBlocks, content),
    compatibility: this.inferCompatibility(content),
    
    // 依赖关系（需要与现有Recipe库交叉引用）
    dependencies: {
      requires: [],
      usedBy: [],
      conflicts: []
    },
    
    // 元数据
    version: basicInfo.version || '1.0.0',
    lastModified: new Date().toISOString(),
    author: basicInfo.author || 'unknown',
    deprecated: basicInfo.deprecated || false,
    
    // 统计数据初始化
    stats: {
      guardUsageCount: 0,
      humanUsageCount: 0,
      aiUsageCount: 0,
      usageHeat: 0
    },
    
    // 额外元数据
    contentHash,
    sourcePath: filePath,
    extraction: {
      extractedAt: new Date().toISOString(),
      version: '1.0.0',
      confidence: this.computeExtractionConfidence(codeBlocks, content)
    }
    };
    
    return metadata;
    
  } catch (err) {
    console.error(`提取元数据失败: ${filename}`, err);
    throw err;
  }
  }

  /**
   * 解析 Frontmatter（YAML 头部）
   */
  parseFrontmatter(content) {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return {};
  }
  
  const frontmatterStr = frontmatterMatch[1];
  const frontmatter = {};
  
  // 简单的 YAML 解析
  for (const line of frontmatterStr.split('\n')) {
    const [key, ...valueParts] = line.split(':');
    if (key && valueParts.length > 0) {
    const value = valueParts.join(':').trim();
    // 简单类型转换
    if (value === 'true') frontmatter[key.trim()] = true;
    else if (value === 'false') frontmatter[key.trim()] = false;
    else if (!isNaN(value)) frontmatter[key.trim()] = Number(value);
    else frontmatter[key.trim()] = value.replace(/^["']|["']$/g, '');
    }
  }
  
  return frontmatter;
  }

  /**
   * 提取基础信息
   */
  extractBasicInfo(content, filename, frontmatter) {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = (frontmatter.title || titleMatch?.[1] || filename).trim();
  
  // 推断 ID
  let id = frontmatter.id || this.generateRecipeId(title, filename);
  
  // 推断编程语言
  let language = frontmatter.language || this.inferLanguage(content, filename);
  
  // 推断分类
  let category = frontmatter.category || this.inferCategory(title, content, language);
  
  return {
    id,
    title,
    language,
    category,
    description: frontmatter.description || this.generateDescription(title, content),
    version: frontmatter.version || '1.0.0',
    author: frontmatter.author || null,
    deprecated: frontmatter.deprecated || false,
    deprecationReason: frontmatter.deprecationReason || null,
    replacedBy: frontmatter.replacedBy || null
  };
  }

  /**
   * 提取代码块
   */
  extractCodeBlocks(content) {
  const codeBlockPattern = /```(\w+)?\n([\s\S]*?)```/g;
  const blocks = [];
  let match;
  
  while ((match = codeBlockPattern.exec(content)) !== null) {
    blocks.push({
    language: match[1] || 'text',
    content: match[2].trim(),
    description: this.findCodeBlockDescription(content, match.index)
    });
  }
  
  return blocks;
  }

  /**
   * 查找代码块前的描述
   */
  findCodeBlockDescription(content, codeIndex) {
  const beforeCode = content.substring(Math.max(0, codeIndex - 300), codeIndex);
  const lines = beforeCode.split('\n');
  
  // 寻找最后一个非空行作为描述
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line && !line.startsWith('#') && !line.startsWith('-')) {
    return line;
    }
  }
  
  return '';
  }

  /**
   * 分析代码结构
   */
  analyzeCodeStructure(codeBlocks) {
  const structure = {
    blockCount: codeBlocks.length,
    languages: new Set(),
    patterns: [],
    functions: [],
    classes: [],
    imports: []
  };
  
  for (const block of codeBlocks) {
    structure.languages.add(block.language);
    
    // 提取函数
    const funcPattern = /function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\(/g;
    let match;
    while ((match = funcPattern.exec(block.content)) !== null) {
    structure.functions.push(match[1] || match[2]);
    }
    
    // 提取类
    const classPattern = /class\s+(\w+)/g;
    while ((match = classPattern.exec(block.content)) !== null) {
    structure.classes.push(match[1]);
    }
    
    // 提取 imports
    const importPattern = /import\s+.*from\s+['"]([^'"]+)['"]/g;
    while ((match = importPattern.exec(block.content)) !== null) {
    structure.imports.push(match[1]);
    }
  }
  
  structure.languages = Array.from(structure.languages);
  return structure;
  }

  /**
   * 提取语义标签
   */
  extractSemanticTags(content, codeBlocks) {
  const tags = new Set();
  const contentLower = content.toLowerCase();
  
  // 基于关键词的标签提取
  for (const [keyword, tagList] of Object.entries(this.semanticTagMaps)) {
    if (contentLower.includes(keyword)) {
    tagList.forEach(tag => tags.add(tag));
    }
  }
  
  // 基于代码块内容的标签
  for (const block of codeBlocks) {
    const blockLower = block.content.toLowerCase();
    
    // 异步处理
    if (blockLower.includes('async') || blockLower.includes('await')) {
    tags.add('asynchronous-programming');
    }
    
    // 错误处理
    if (blockLower.includes('try') || blockLower.includes('catch') || blockLower.includes('throw')) {
    tags.add('error-handling');
    }
    
    // 类型检查
    if (block.language === 'typescript' || blockLower.includes('interface') || blockLower.includes(':')) {
    tags.add('type-safety');
    }
    
    // 并发
    if (blockLower.includes('promise.all') || blockLower.includes('promise.race')) {
    tags.add('concurrency');
    }
  }
  
  return Array.from(tags).sort();
  }

  /**
   * 提取关键词
   */
  extractKeywords(content, codeBlocks, semanticTags) {
  const keywords = new Set(semanticTags);
  
  // 从代码块提取技术关键词
  const allCode = codeBlocks.map(b => b.content).join('\n');
  const techKeywords = this.extractTechKeywords(allCode);
  techKeywords.forEach(kw => keywords.add(kw));
  
  // 从标题和文本提取关键词
  const titleKeywords = this.extractTextKeywords(content);
  titleKeywords.forEach(kw => keywords.add(kw));
  
  return Array.from(keywords)
    .filter(kw => kw.length > 2)
    .slice(0, 30);  // 限制数量
  }

  /**
   * 提取技术关键词
   */
  extractTechKeywords(code) {
  const keywords = new Set();
  
  // 常见库和框架
  const patterns = [
    /\b(react|vue|angular|express|fastapi|django)\b/gi,
    /\b(node|python|javascript|typescript|java|swift)\b/gi,
    /\b(mongodb|postgresql|mysql|redis|elasticsearch)\b/gi,
    /\b(docker|kubernetes|aws|gcp|azure)\b/gi
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(code)) !== null) {
    keywords.add(match[1].toLowerCase());
    }
  }
  
  return Array.from(keywords);
  }

  /**
   * 从文本提取关键词
   */
  extractTextKeywords(text) {
  // 提取英文单词
  const wordPattern = /\b[a-z]{3,15}\b/gi;
  const words = new Map();
  let match;
  
  while ((match = wordPattern.exec(text)) !== null) {
    const word = match[0].toLowerCase();
    words.set(word, (words.get(word) || 0) + 1);
  }
  
  // 排序并获取频率最高的
  return Array.from(words.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word]) => word)
    .filter(word => !this.isCommonWord(word));
  }

  /**
   * 检查是否是常见词
   */
  isCommonWord(word) {
  const commonWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'is', 'are', 'was', 'be', 'have', 'has', 'do', 'does', 'did',
    'will', 'can', 'could', 'should', 'would', 'may', 'might', 'must',
    'this', 'that', 'these', 'those', 'what', 'which', 'who', 'when', 'where', 'why'
  ]);
  return commonWords.has(word);
  }

  /**
   * 推断主题
   */
  inferTopics(content, semanticTags) {
  const topics = new Set();
  
  // 从语义标签推断主题
  const topicMappings = {
    'asynchronous-programming': 'concurrency',
    'error-handling': 'resilience',
    'performance-optimization': 'optimization',
    'security': 'security',
    'testing': 'quality-assurance'
  };
  
  for (const tag of semanticTags) {
    if (topicMappings[tag]) {
    topics.add(topicMappings[tag]);
    }
  }
  
  // 从内容推断主题
  const contentLower = content.toLowerCase();
  if (contentLower.includes('best practice')) topics.add('best-practices');
  if (contentLower.includes('pattern')) topics.add('design-patterns');
  if (contentLower.includes('example')) topics.add('examples');
  if (contentLower.includes('tutorial')) topics.add('tutorial');
  
  return Array.from(topics);
  }

  /**
   * 提取使用语境信息
   */
  extractContextInfo(content) {
  const contextInfo = {
    whenToUse: {
    description: '',
    conditions: [],
    scenarioScores: {}
    },
    whenNotToUse: {
    cases: [],
    antiPatterns: []
    },
    useCases: [],
    prerequisites: []
  };
  
  // 查找 "When to use" 部分
  const whenToUseMatch = content.match(/##\s*When to Use[\s\S]*?(?=##|$)/i);
  if (whenToUseMatch) {
    const section = whenToUseMatch[0];
    contextInfo.whenToUse.description = this.extractSectionContent(section, 1);
    contextInfo.whenToUse.conditions = this.extractBulletPoints(section);
  }
  
  // 查找 "When not to use" 部分
  const whenNotMatch = content.match(/##\s*When Not to Use[\s\S]*?(?=##|$)/i);
  if (whenNotMatch) {
    const section = whenNotMatch[0];
    contextInfo.whenNotToUse.cases = this.extractBulletPoints(section);
  }
  
  // 查找 "Prerequisites" 部分
  const prereqMatch = content.match(/##\s*Prerequisites?[\s\S]*?(?=##|$)/i);
  if (prereqMatch) {
    const section = prereqMatch[0];
    contextInfo.prerequisites = this.extractBulletPoints(section);
  }
  
  return contextInfo;
  }

  /**
   * 提取小节内容
   */
  extractSectionContent(section, lines = 1) {
  const contentLines = section
    .split('\n')
    .slice(1)
    .filter(line => !line.startsWith('#') && line.trim())
    .slice(0, lines);
  
  return contentLines.join(' ').trim();
  }

  /**
   * 提取项目符号列表
   */
  extractBulletPoints(text) {
  const points = [];
  const lines = text.split('\n');
  
  for (const line of lines) {
    const match = line.match(/^\s*[-*]\s+(.+)$/);
    if (match) {
    points.push(match[1].trim());
    }
  }
  
  return points;
  }

  /**
   * 提取文档说明
   */
  extractDocumentation(content) {
  // 移除 frontmatter
  let doc = content.replace(/^---[\s\S]*?---\n/, '');
  
  // 移除代码块
  doc = doc.replace(/```[\s\S]*?```/g, '[Code Block]');
  
  // 限制长度
  return doc.substring(0, 5000).trim();
  }

  /**
   * 分析代码质量
   */
  analyzeCodeQuality(codeBlocks, content) {
  const quality = {
    codeReviewStatus: 'pending',
    testCoverage: 0,
    securityAudit: 'pending',
    performanceScore: 0.5,
    maintenanceScore: 0.5,
    authorityScore: 3  // 默认中等权威
  };
  
  if (codeBlocks.length === 0) {
    return quality;
  }
  
  // 检测测试代码
  const codeStr = codeBlocks.map(b => b.content).join('\n');
  const testPatterns = [
    /describe\s*\(/i,
    /it\s*\(/i,
    /test\s*\(/i,
    /assert/i,
    /expect\s*\(/i
  ];
  
  quality.testCoverage = testPatterns.filter(p => p.test(codeStr)).length > 0 ? 0.7 : 0.3;
  
  // 检测代码长度和复杂度
  const codeLength = codeStr.length;
  const lineCount = codeStr.split('\n').length;
  
  if (lineCount < 50) {
    quality.maintenanceScore = 0.9;
  } else if (lineCount < 200) {
    quality.maintenanceScore = 0.7;
  } else {
    quality.maintenanceScore = 0.5;
  }
  
  // 性能得分基于代码特性
  if (codeStr.includes('cache') || codeStr.includes('optimize')) {
    quality.performanceScore = 0.8;
  }
  
  return quality;
  }

  /**
   * 分析安全问题
   */
  analyzeSecurityConcerns(content, codeBlocks) {
  const security = {
    riskLevel: 'low',
    commonPitfalls: [],
    bestPractices: [],
    securityConsiderations: []
  };
  
  const codeStr = codeBlocks.map(b => b.content).join('\n');
  const contentLower = content.toLowerCase();
  
  // 检测安全相关内容
  if (contentLower.includes('password') || contentLower.includes('secret')) {
    security.riskLevel = 'medium';
    security.commonPitfalls.push('Exposing sensitive data in logs');
  }
  
  if (contentLower.includes('sql') || contentLower.includes('query')) {
    security.securityConsiderations.push('Check for SQL injection vulnerability');
  }
  
  if (codeStr.includes('eval') || codeStr.includes('dangerouslySetInnerHTML')) {
    security.riskLevel = 'high';
    security.commonPitfalls.push('Code injection vulnerability');
  }
  
  return security;
  }

  /**
   * 分析性能特征
   */
  analyzePerformance(codeBlocks, content) {
  const performance = {
    timeComplexity: 'Unknown',
    spaceComplexity: 'Unknown',
    typicalExecutionTime: 'ms',
    scalabilityNotes: ''
  };
  
  const codeStr = codeBlocks.map(b => b.content).join('\n');
  
  // 简单的复杂度推断
  if (codeStr.includes('for') || codeStr.includes('while')) {
    if (codeStr.includes('for') && codeStr.match(/for.*for/)) {
    performance.timeComplexity = 'O(n²)';
    } else {
    performance.timeComplexity = 'O(n)';
    }
  } else {
    performance.timeComplexity = 'O(1)';
  }
  
  return performance;
  }

  /**
   * 推断兼容性
   */
  inferCompatibility(content) {
  const compatibility = {
    minVersion: null,
    maxVersion: null,
    platforms: [],
    runtimes: []
  };
  
  const contentLower = content.toLowerCase();
  
  // 推断平台
  if (contentLower.includes('browser') || contentLower.includes('dom')) {
    compatibility.platforms.push('Web');
  }
  if (contentLower.includes('node') || contentLower.includes('server')) {
    compatibility.platforms.push('Node.js');
  }
  if (contentLower.includes('ios') || contentLower.includes('swift')) {
    compatibility.platforms.push('iOS');
  }
  
  return compatibility;
  }

  /**
   * 计算提取置信度
   */
  computeExtractionConfidence(codeBlocks, content) {
  let confidence = 0.5;
  
  if (codeBlocks.length > 0) confidence += 0.2;
  if (content.length > 500) confidence += 0.15;
  if (content.includes('##')) confidence += 0.1;
  if (content.includes('```')) confidence += 0.05;
  
  return Math.min(confidence, 1.0);
  }

  /**
   * 生成 Recipe ID
   */
  generateRecipeId(title, filename) {
  // 从标题生成 slug
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 30);
  
  // 生成随机数字后缀
  const randomSuffix = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  
  return `recipe_${slug}_${randomSuffix}`;
  }

  /**
   * 推断编程语言
   */
  inferLanguage(content, filename) {
  const languageMap = {
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    swift: 'swift',
    kt: 'kotlin',
    java: 'java',
    cpp: 'cpp',
    rs: 'rust',
    go: 'go',
    rb: 'ruby'
  };
  
  // 从文件扩展名推断
  const ext = path.extname(filename).substring(1);
  if (languageMap[ext]) {
    return languageMap[ext];
  }
  
  // 从内容推断
  const contentLower = content.toLowerCase();
  if (contentLower.includes('```typescript')) return 'typescript';
  if (contentLower.includes('```javascript') || contentLower.includes('```js')) return 'javascript';
  if (contentLower.includes('```python') || contentLower.includes('```py')) return 'python';
  if (contentLower.includes('```swift')) return 'swift';
  
  return 'other';
  }

  /**
   * 推断分类
   */
  inferCategory(title, content, language) {
  const titleLower = title.toLowerCase();
  const contentLower = content.toLowerCase();
  
  // 分类映射
  const patterns = {
    'async-patterns': /async|promise|await|concurrent/i,
    'error-handling': /error|exception|try|catch|throw/i,
    'performance': /performance|optimize|cache|efficient/i,
    'security': /security|authentication|encrypt|safe/i,
    'testing': /test|unit|mock|assert/i,
    'design-patterns': /pattern|strategy|factory|singleton/i,
    'data-structures': /array|map|set|list|hash/i,
    'api': /api|http|request|response|fetch/i,
    'database': /database|sql|query|persist|store/i
  };
  
  const text = titleLower + ' ' + contentLower;
  
  for (const [category, pattern] of Object.entries(patterns)) {
    if (pattern.test(text)) {
    return category;
    }
  }
  
  // 默认分类
  if (language === 'swift') return 'ios-development';
  if (language === 'python') return 'python-utilities';
  
  return 'general';
  }

  /**
   * 生成简短描述
   */
  generateDescription(title, content) {
  // 查找第一段非标题文本
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('```')) {
    return trimmed.substring(0, 200);
    }
  }
  
  return `Recipe: ${title}`;
  }

  /**
   * 计算内容哈希
   */
  computeContentHash(content) {
  return crypto
    .createHash('sha256')
    .update(content)
    .digest('hex')
    .substring(0, 16);
  }
}

module.exports = RecipeExtractor;
