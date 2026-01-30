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
		return items.map(item => {
			let score = 0;
			if (metric === 'cosine') {
				score = this.cosineSimilarity(queryVector, item.vector);
			} else {
				// 欧氏距离越小相关性越高，这里取反方便排序
				score = 1 / (1 + this.euclideanDistance(queryVector, item.vector));
			}
			return { ...item, _score: score };
		}).sort((a, b) => b._score - a._score);
	}
};

module.exports = VectorMath;
