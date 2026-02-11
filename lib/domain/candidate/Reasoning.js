/**
 * Reasoning - 值对象，代表 AI 决策的理由
 * 包含 Candidate 创建时的决策信息
 */
export class Reasoning {
  constructor(props) {
    this.whyStandard = props.whyStandard; // 为什么遵循标准
    this.sources = props.sources || []; // 来源列表
    this.qualitySignals = props.qualitySignals || {}; // 质量信号（如 clarity, reusability）
    this.alternatives = props.alternatives || []; // 备选方案
    this.confidence = props.confidence || 0.7; // 置信度 0-1（统一默认值）
    this.generatedAt = props.generatedAt || new Date().toISOString();
  }

  /**
   * 验证推理信息的完整性
   */
  isValid() {
    return (
      this.whyStandard &&
      this.whyStandard.trim().length > 0 &&
      Array.isArray(this.sources) &&
      this.sources.length > 0 &&
      typeof this.confidence === 'number' &&
      this.confidence >= 0 &&
      this.confidence <= 1
    );
  }

  /**
   * 转换为 JSON
   */
  toJSON() {
    return {
      whyStandard: this.whyStandard,
      sources: this.sources,
      qualitySignals: this.qualitySignals,
      alternatives: this.alternatives,
      confidence: this.confidence,
      generatedAt: this.generatedAt,
    };
  }

  /**
   * 从 JSON 创建 Reasoning
   */
  static fromJSON(data) {
    return new Reasoning(data);
  }
}

export default Reasoning;
