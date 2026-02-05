class CoarseRanker {
  constructor(weights = {}) {
  this.weights = {
    bm25: weights.bm25 ?? 0.3,          // 关键词匹配
    semantic: weights.semantic ?? 0.3,   // 语义相似度
    quality: weights.quality ?? 0.2,     // Recipe 质量 (新增)
    freshness: weights.freshness ?? 0.1, // 新鲜度
    popularity: weights.popularity ?? 0.1 // 热度/使用次数
  };
  }

  score(candidate) {
  const bm25 = candidate.scores?.bm25 || 0;
  const semantic = candidate.scores?.semantic || 0;
  const freshness = this._computeFreshness(candidate);
  const popularity = candidate.usageCount ? Math.log(candidate.usageCount + 1) / 10 : 0;
  const quality = this._computeQuality(candidate);

  return (
    bm25 * this.weights.bm25 +
    semantic * this.weights.semantic +
    quality * this.weights.quality +
    freshness * this.weights.freshness +
    popularity * this.weights.popularity
  );
  }

  rank(candidates) {
  return candidates
    .map((c) => {
    const bm25 = c.scores?.bm25 || 0;
    const semantic = c.scores?.semantic || 0;
    const freshness = this._computeFreshness(c);
    const popularity = c.usageCount ? Math.log(c.usageCount + 1) / 10 : 0;
    const quality = this._computeQuality(c);
    
    const score = 
      bm25 * this.weights.bm25 +
      semantic * this.weights.semantic +
      quality * this.weights.quality +
      freshness * this.weights.freshness +
      popularity * this.weights.popularity;
    
    return {
      ...c,
      score,
      // 保存所有维度的分数到 breakdown
      scores: {
      ...c.scores,
      quality,
      freshness,
      popularity
      }
    };
    })
    .sort((a, b) => b.score - a.score);
  }

  _computeFreshness(candidate) {
  const updatedAt = candidate.updatedAt || candidate.modifiedAt || candidate.createdAt;
  if (!updatedAt) return 0;
  const days = (Date.now() - updatedAt) / (1000 * 60 * 60 * 24);
  return Math.exp(-days / 30);
  }

  /**
   * 计算 Recipe 质量分数 (0-1)
   * 基于 Google E-E-A-T 和代码质量业界标准:
   * 
   * Google E-E-A-T 标准:
   * - Experience (经验): 内容展示实际使用经验
   * - Expertise (专业性): 代码和文档的专业水平
   * - Authoritativeness (权威性): 结构完整性和最佳实践
   * - Trustworthiness (可信度): 代码可读性和可维护性
   * 
   * 代码质量标准 (StackOverflow/Martin Fowler):
   * - Encapsulation (封装性): 代码是否自包含
   * - Idiomatic code (惯用法): 使用语言内置特性
   * - Meaningful names (有意义的命名): 变量/函数命名
   * - Low complexity (低复杂度): 避免深层嵌套
   * - Documentation (文档): 注释和使用说明
   * 
   * 评估维度:
   * - 内容完整性 (40%): 代码长度、文档丰富度、示例完整性
   * - 结构质量 (30%): 是否有代码、描述、触发器等关键部分
   * - 代码可读性 (30%): 代码行数、注释比例、命名质量
   */
  _computeQuality(candidate) {
  let score = 0;
  const content = candidate.content || '';
  const code = candidate.code || '';
  
  // 1. 内容完整性 (40%) - Google E-E-A-T: Experience & Expertise
  const totalLength = content.length + code.length;
  if (totalLength === 0) return 0; // 空文件质量分为 0
  
  // 权威来源: Google 推荐文档应"提供实质性、完整性描述"
  // 2000字符约等于 300-400 英文单词，足够表达一个完整 Recipe
  const lengthScore = Math.min(totalLength / 2000, 1);
  
  // 内容与代码的平衡性 (有代码但无文档，或有文档但无代码都会降低分数)
  const hasCode = code.length > 10;
  const hasDoc = content.length > 50;
  const balance = (hasCode && hasDoc) ? 1.0 : (hasCode || hasDoc) ? 0.7 : 0.3;
  
  score += lengthScore * balance * 0.4;
  
  // 2. 结构质量 (30%) - Google E-E-A-T: Authoritativeness
  let structureScore = 0;
  
  // 代码存在性和充实度
  if (code.length > 100) structureScore += 0.4;  // 有实质性代码
  else if (code.length > 10) structureScore += 0.2; // 有简单代码
  
  // 文档存在性和深度 (Google: "内容是否提供富有洞察力的深刻见解")
  if (content.length > 200) structureScore += 0.3;  // 详细文档
  else if (content.length > 50) structureScore += 0.15; // 简单文档
  
  // Trigger 存在性 (AutoSnippet 特定: 有触发器说明 Recipe 可被复用)
  if (candidate.trigger && candidate.trigger.length > 0) structureScore += 0.15;
  
  // Title 质量 (Google: "标题是否对内容进行了实用的描述性总结")
  const title = candidate.title || candidate.name || '';
  if (title.length > 10 && title.length < 100) structureScore += 0.15;
  
  score += Math.min(structureScore, 1) * 0.3;
  
  // 3. 代码可读性 (30%) - 代码质量标准: Readability & Maintainability
  if (hasCode) {
    const codeLines = code.split('\n').filter(line => line.trim()).length;
    
    // 注释行检测 (支持多种注释风格)
    const commentLines = code.split('\n').filter(line => {
    const trimmed = line.trim();
    return trimmed.startsWith('//') ||    // JavaScript/C++
         trimmed.startsWith('#') ||      // Python/Ruby
         trimmed.startsWith('/*') ||     // 多行注释开始
         trimmed.startsWith('*') ||      // 多行注释中间
         trimmed.startsWith('<!--');     // HTML/XML
    }).length;
    
    // StackOverflow: "高质量代码能快速被理解"
    // 20行是一个合理的函数/方法长度 (Martin Fowler: Keep functions small)
    const codeLengthScore = Math.min(codeLines / 20, 1);
    
    // 注释比例 (10-30% 为最佳实践)
    const commentRatio = codeLines > 0 ? commentLines / codeLines : 0;
    let commentScore = 0;
    if (commentRatio > 0.1 && commentRatio < 0.5) {
    commentScore = 0.4; // 适度注释
    } else if (commentRatio > 0) {
    commentScore = 0.2; // 有注释但比例不理想
    }
    
    // 代码结构检测 (是否有函数/类定义 - 表示良好组织)
    const hasStructure = /\b(function|class|def|const|let|var)\s+\w+/.test(code);
    const structureBonus = hasStructure ? 0.2 : 0;
    
    score += (codeLengthScore * 0.4 + commentScore + structureBonus) * 0.3;
  } else {
    // 无代码时，这 30% 分数完全失去
    // 这符合 Recipe 定位: Snippet 应该包含可复用的代码
  }
  
  return Math.min(score, 1);
  }
}

module.exports = CoarseRanker;
