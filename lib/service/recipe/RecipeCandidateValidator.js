/**
 * RecipeCandidateValidator — Recipe 候选校验器
 * 验证候选 Recipe 是否满足最低字段要求
 */

const REQUIRED_FIELDS = ['title', 'trigger', 'category', 'language', 'code'];

const VALID_CATEGORIES = new Set([
  'swift', 'objc', 'javascript', 'typescript', 'python',
  'swiftui', 'uikit', 'combine', 'concurrency', 'testing',
  'networking', 'persistence', 'security', 'architecture',
  'performance', 'debugging', 'general',
]);

const VALID_LANGUAGES = new Set([
  'swift', 'objective-c', 'objc', 'javascript', 'typescript',
  'python', 'c', 'cpp', 'c++', 'shell', 'bash', 'markdown',
]);

export class RecipeCandidateValidator {

  /**
   * 验证单个候选
   * @param {object} candidate
   * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
   */
  validate(candidate) {
    const errors = [];
    const warnings = [];

    if (!candidate || typeof candidate !== 'object') {
      return { valid: false, errors: ['候选为空或类型错误'], warnings: [] };
    }

    // 必填字段
    for (const field of REQUIRED_FIELDS) {
      if (!candidate[field] || (typeof candidate[field] === 'string' && !candidate[field].trim())) {
        errors.push(`缺少必填字段: ${field}`);
      }
    }

    // trigger 格式 — 建议以 as: 或 asd- 开头
    if (candidate.trigger && typeof candidate.trigger === 'string') {
      if (candidate.trigger.length < 2) errors.push('trigger 过短');
      if (candidate.trigger.length > 64) errors.push('trigger 过长 (>64)');
      if (!/^[a-zA-Z0-9_\-:.]+$/.test(candidate.trigger)) {
        warnings.push('trigger 含特殊字符，建议仅使用字母/数字/下划线/连字符');
      }
    }

    // category 合法性
    if (candidate.category && !VALID_CATEGORIES.has(candidate.category.toLowerCase())) {
      warnings.push(`category "${candidate.category}" 不在推荐列表中`);
    }

    // language 合法性
    if (candidate.language && !VALID_LANGUAGES.has(candidate.language.toLowerCase())) {
      warnings.push(`language "${candidate.language}" 不在推荐列表中`);
    }

    // code 质量检查
    if (candidate.code && typeof candidate.code === 'string') {
      if (candidate.code.trim().length < 10) {
        warnings.push('code 内容过短 (<10 字符)');
      }
      if (candidate.code.length > 50000) {
        warnings.push('code 内容过长 (>50000 字符)，建议拆分');
      }
    }

    // 摘要/描述（非必填但建议）
    if (!candidate.summary && !candidate.description) {
      warnings.push('建议提供 summary 或 description');
    }

    // 标签
    if (candidate.tags && !Array.isArray(candidate.tags)) {
      warnings.push('tags 应为数组');
    }

    // 推理依据 (reasoning)
    if (!candidate.reasoning) {
      warnings.push('缺少 reasoning（推理依据）— 需要 whyStandard + sources + confidence');
    } else {
      if (!candidate.reasoning.whyStandard?.trim()) {
        errors.push('reasoning.whyStandard 不能为空');
      }
      if (!Array.isArray(candidate.reasoning.sources) || candidate.reasoning.sources.length === 0) {
        errors.push('reasoning.sources 至少包含一项来源');
      }
      if (typeof candidate.reasoning.confidence !== 'number' || candidate.reasoning.confidence < 0 || candidate.reasoning.confidence > 1) {
        warnings.push('reasoning.confidence 应为 0-1 的数字');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 批量验证
   * @param {object[]} candidates
   * @returns {{ valid: object[], invalid: object[], summary: { total: number, validCount: number, invalidCount: number } }}
   */
  validateBatch(candidates) {
    const valid = [];
    const invalid = [];

    for (const candidate of candidates) {
      const result = this.validate(candidate);
      if (result.valid) {
        valid.push({ candidate, ...result });
      } else {
        invalid.push({ candidate, ...result });
      }
    }

    return {
      valid,
      invalid,
      summary: {
        total: candidates.length,
        validCount: valid.length,
        invalidCount: invalid.length,
      },
    };
  }

  /**
   * 获取有效类别列表
   */
  getValidCategories() {
    return [...VALID_CATEGORIES];
  }

  /**
   * 获取有效语言列表
   */
  getValidLanguages() {
    return [...VALID_LANGUAGES];
  }
}
