/**
 * 底层向量数学工具库
 * 提供基础的线性代数运算，用于支持上层的向量搜索和 AI 分析
 */
const VectorMath = {
  /**
   * 计算两个向量的点积
   */
  dotProduct(vecA, vecB) {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same length');
  }
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
  },

  /**
   * 计算向量的 L2 范数 (模长)
   */
  norm(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) {
    sum += vec[i] * vec[i];
  }
  return Math.sqrt(sum);
  },

  /**
   * 计算余弦相似度 (Cosine Similarity)
   * 范围 [-1, 1]，1 表示完全相同
   */
  cosineSimilarity(vecA, vecB) {
  const dot = this.dotProduct(vecA, vecB);
  const normA = this.norm(vecA);
  const normB = this.norm(vecB);
  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
  },

  /**
   * 计算欧氏距离 (Euclidean Distance)
   * 0 表示完全相同
   */
  euclideanDistance(vecA, vecB) {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same length');
  }
  let sum = 0;
  for (let i = 0; i < vecA.length; i++) {
    const diff = vecA[i] - vecB[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
  },

  /**
   * 向量归一化 (Normalization)
   */
  normalize(vec) {
  const n = this.norm(vec);
  if (n === 0) return vec;
  return vec.map(v => v / n);
  },

  /**
   * 批量计算相似度并排序
   * @param {number[]} queryVector 目标向量
   * @param {Array<{vector: number[]}>} items 待比对项
   * @param {string} metric 'cosine' | 'euclidean'
   */
  rank(queryVector, items, metric = 'cosine') {
  // 安全检查：确保查询向量有效
  if (!queryVector || queryVector.length === 0) {
    console.warn('[VectorMath] 查询向量为空，返回空结果');
    return [];
  }

  const queryDim = queryVector.length;
  const validItems = [];
  const invalidItems = [];

  // 过滤维度不匹配的项目
  for (const item of items) {
    if (!item.vector || item.vector.length === 0) {
    invalidItems.push({ id: item.id, reason: '向量为空' });
    continue;
    }
    if (item.vector.length !== queryDim) {
    invalidItems.push({ 
      id: item.id, 
      reason: `维度不匹配 (${item.vector.length} vs ${queryDim})` 
    });
    continue;
    }
    validItems.push(item);
  }

  // 记录无效项目
  if (invalidItems.length > 0 && process.env.ASD_DEBUG === '1') {
    console.warn(`[VectorMath] 过滤了 ${invalidItems.length} 个维度不匹配的项目:`);
    invalidItems.slice(0, 5).forEach(item => {
    console.warn(`  - ${item.id}: ${item.reason}`);
    });
    if (invalidItems.length > 5) {
    console.warn(`  ...还有 ${invalidItems.length - 5} 个项目`);
    }
  }

  // 计算相似度
  return validItems.map(item => {
    let score = 0;
    try {
    if (metric === 'cosine') {
      score = this.cosineSimilarity(queryVector, item.vector);
    } else {
      // 欧氏距离越小相关性越高，这里取反方便排序
      score = 1 / (1 + this.euclideanDistance(queryVector, item.vector));
    }
    } catch (err) {
    console.error(`[VectorMath] 计算相似度失败 (${item.id}):`, err.message);
    score = 0;
    }
    return { ...item, similarity: score };
  }).sort((a, b) => b.similarity - a.similarity);
  }
};

module.exports = VectorMath;
