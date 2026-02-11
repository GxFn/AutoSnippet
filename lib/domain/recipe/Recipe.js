import { v4 as uuidv4 } from 'uuid';
import Logger from '../../infrastructure/logging/Logger.js';

/* ═══════════════════════════════════════════════════════════
 * Recipe — 统一知识实体
 *
 * 通过 kind 字段实现三层知识分类（Backstage Kind 模式）：
 *   kind = 'rule'    → 规约性知识 (Guard 引擎消费)
 *   kind = 'pattern' → 模式性知识 (搜索/代码生成消费)
 *   kind = 'fact'    → 结构性知识 (图遍历/RAG 消费)
 *
 * 子仓库文件 (Source of Truth):
 *   AutoSnippet/recipes/<id>.md  →  Markdown + YAML front-matter
 *
 * DB 缓存:
 *   .autosnippet/autosnippet.db recipes 表  →  索引 + 查询加速
 * ═══════════════════════════════════════════════════════════ */

// ─── 枚举 ────────────────────────────────────────────────

/**
 * Kind — 一级分类（Backstage 风格）
 * 决定知识的消费者和生命周期
 */
export const Kind = {
  /** 规约: 代码规范/最佳实践/边界约束 → Guard 引擎 */
  RULE:    'rule',
  /** 模式: 可复用代码/架构方案/解决办法 → 搜索/AI代码生成 */
  PATTERN: 'pattern',
  /** 事实: 结构性知识(继承/调用/依赖) → 图遍历/影响分析 */
  FACT:    'fact',
};

/** knowledgeType → kind 映射 */
const KIND_MAP = {
  'code-standard':       Kind.RULE,
  'code-style':          Kind.RULE,
  'best-practice':       Kind.RULE,
  'boundary-constraint': Kind.RULE,
  'code-pattern':        Kind.PATTERN,
  'architecture':        Kind.PATTERN,
  'solution':            Kind.PATTERN,
  'code-relation':       Kind.FACT,
  'inheritance':         Kind.FACT,
  'call-chain':          Kind.FACT,
  'data-flow':           Kind.FACT,
  'module-dependency':   Kind.FACT,
};

/** 从 knowledgeType 推导 kind */
export function inferKind(knowledgeType) {
  return KIND_MAP[knowledgeType] || Kind.PATTERN;
}

/** Recipe 状态 */
export const RecipeStatus = {
  DRAFT:      'draft',       // 草稿
  ACTIVE:     'active',      // 已发布
  DEPRECATED: 'deprecated',  // 已弃用
};

/**
 * 知识类型 — 10 种维度，统一覆盖所有项目知识
 */
export const KnowledgeType = {
  /** 代码规范: 命名规则、格式约定、编码标准 */
  CODE_STANDARD:       'code-standard',
  /** 代码模式: 可复用的代码片段/模板/idiom */
  CODE_PATTERN:        'code-pattern',
  /** 代码关联: 文件/类/方法间的引用与关系 */
  CODE_RELATION:       'code-relation',
  /** 继承与接口: 协议、接口、基类、实现关系 */
  INHERITANCE:         'inheritance',
  /** 调用链路: 方法/函数调用路径、生命周期流转 */
  CALL_CHAIN:          'call-chain',
  /** 数据流向: 数据从产生到消费的完整路径 */
  DATA_FLOW:           'data-flow',
  /** 模块与依赖: 包/模块/Target 间的依赖关系 */
  MODULE_DEPENDENCY:   'module-dependency',
  /** 模式与架构: 设计模式、架构模式、分层策略 */
  ARCHITECTURE:        'architecture',
  /** 最佳实践: 推荐做法、Anti-pattern 警告 */
  BEST_PRACTICE:       'best-practice',
  /** 边界约束: 限制条件、前/后置约束、不变量 */
  BOUNDARY_CONSTRAINT: 'boundary-constraint',
  /** 代码风格: 排版、缩进、注释风格、文件组织 */
  CODE_STYLE:          'code-style',
  /** 问题解决方案: 具体 Bug/性能/迁移问题的解决办法 */
  SOLUTION:            'solution',
};

/** 复杂度 */
export const Complexity = {
  BEGINNER:     'beginner',
  INTERMEDIATE: 'intermediate',
  ADVANCED:     'advanced',
};

/**
 * 统一关系类型 — 涵盖结构性 + 语义性关系
 * (合并原 Recipe.RelationType 和 KnowledgeGraphService.RelationType)
 */
export const RelationType = {
  // ── 结构性关系 (自动发现, Graph 层) ──
  INHERITS:      'inherits',       // 继承
  IMPLEMENTS:    'implements',     // 实现接口/协议
  CALLS:         'calls',          // 调用
  DEPENDS_ON:    'depends_on',     // 依赖
  DATA_FLOW_TO:  'data_flow_to',   // 数据流向
  REFERENCES:    'references',     // 引用

  // ── 语义性关系 (人工/AI 标注, Recipe 间) ──
  EXTENDS:       'extends',        // 扩展
  CONFLICTS:     'conflicts',      // 冲突
  RELATED:       'related',        // 弱关联
  ALTERNATIVE:   'alternative',    // 替代方案
  PREREQUISITE:  'prerequisite',   // 前置条件
  DEPRECATED_BY: 'deprecated_by',  // 被取代
  SOLVES:        'solves',         // 解决问题
  ENFORCES:      'enforces',       // 强制约束
};

// ─── 实体 ────────────────────────────────────────────────

export class Recipe {
  /**
   * @param {Object} props
   */
  constructor(props) {
    // ── 标识 ──
    this.id           = props.id || uuidv4();
    this.title        = props.title;
    this.description  = props.description || '';
    this.language     = props.language || '';
    this.category     = props.category || '';

    // ── 国际化摘要 & 使用指南（一级字段）──
    this.summaryCn    = props.summaryCn    ?? '';
    this.summaryEn    = props.summaryEn    ?? '';
    this.usageGuideCn = props.usageGuideCn ?? '';
    this.usageGuideEn = props.usageGuideEn ?? '';

    // ── 分类 ──
    this.knowledgeType = props.knowledgeType || KnowledgeType.CODE_PATTERN;
    this.kind          = props.kind || inferKind(this.knowledgeType);
    this.complexity    = props.complexity || Complexity.INTERMEDIATE;
    this.scope         = props.scope || null;  // universal | project-specific | target-specific

    // ── 内容 ──
    this.content = {
      /** 代码模式/示例代码（Markdown / literal code） */
      pattern:      props.content?.pattern      ?? '',
      /** 设计原理/架构说明 */
      rationale:    props.content?.rationale     ?? '',
      /** 步骤说明（解决方案、实施指南） */
      steps:        props.content?.steps         ?? [],
      /** 代码变更 [{ file, before, after, explanation }] */
      codeChanges:  props.content?.codeChanges   ?? [],
      /** 验证方式 { method, expectedResult, testCode } */
      verification: props.content?.verification  ?? null,
      /** 原始 Markdown 全文（从 .md 文件同步时保存） */
      markdown:     props.content?.markdown      ?? '',
    };

    // ── 关系图 ──
    this.relations = {
      /** 继承关系 [{ target, description }] */
      inherits:    props.relations?.inherits    ?? [],
      /** 接口/协议实现 */
      implements:  props.relations?.implements  ?? [],
      /** 调用链路 */
      calls:       props.relations?.calls       ?? [],
      /** 依赖关系 */
      dependsOn:   props.relations?.dependsOn   ?? [],
      /** 数据流向 */
      dataFlow:    props.relations?.dataFlow    ?? [],
      /** 冲突 */
      conflicts:   props.relations?.conflicts   ?? [],
      /** 扩展 */
      extends:     props.relations?.extends     ?? [],
      /** 相关知识 */
      related:     props.relations?.related     ?? [],
    };

    // ── 约束 ──
    this.constraints = {
      /** 边界约束 ["最大并发数 100", "仅限 iOS 15+"] */
      boundaries:    props.constraints?.boundaries    ?? [],
      /** 前置条件 */
      preconditions: props.constraints?.preconditions ?? [],
      /** 副作用 */
      sideEffects:   props.constraints?.sideEffects   ?? [],
      /** 内联 Guard 规则 [{ pattern, severity, message }] */
      guards:        props.constraints?.guards        ?? [],
    };

    // ── 快捷激活关键词 ──
    this.trigger    = props.trigger    ?? '';    // @forEach, @singleton 等

    // ── 多维分类（扩展标签系统）──
    this.dimensions = props.dimensions || {};   // { platform, framework, paradigm, ... }
    this.tags       = props.tags       || [];   // 自由标签

    // ── 状态 ──
    this.status = props.status || RecipeStatus.DRAFT;

    // ── 质量指标 (0-1) ──
    this.quality = {
      codeCompleteness:      props.quality?.codeCompleteness      ?? 0,
      projectAdaptation:     props.quality?.projectAdaptation     ?? 0,
      documentationClarity:  props.quality?.documentationClarity  ?? 0,
      overall:               props.quality?.overall               ?? 0,
    };

    // ── 统计 ──
    this.statistics = {
      adoptionCount:     props.statistics?.adoptionCount     ?? 0,
      applicationCount:  props.statistics?.applicationCount  ?? 0,
      guardHitCount:     props.statistics?.guardHitCount     ?? 0,
      viewCount:         props.statistics?.viewCount         ?? 0,
      successCount:      props.statistics?.successCount      ?? 0,
      feedbackScore:     props.statistics?.feedbackScore     ?? 0,
    };

    // ── 元数据 ──
    this.createdBy        = props.createdBy        || 'system';
    this.createdAt        = props.createdAt        || Math.floor(Date.now() / 1000);
    this.updatedAt        = props.updatedAt        || Math.floor(Date.now() / 1000);
    this.publishedAt      = props.publishedAt      ?? null;
    this.publishedBy      = props.publishedBy      ?? null;
    this.deprecation      = props.deprecation      ?? null;   // { reason, deprecatedAt }

    // ── 来源追踪 ──
    this.sourceCandidate  = props.sourceCandidate  ?? null;   // Candidate ID
    this.sourceFile       = props.sourceFile       ?? null;   // 子仓库文件路径

    this.logger = Logger.getInstance();
  }

  /* ═══ 验证 ═══════════════════════════════════════════ */

  isValid() {
    return Boolean(
      this.title?.trim() &&
      (this.content.pattern || this.content.rationale ||
       this.content.steps.length > 0 || this.content.markdown)
    );
  }

  /* ═══ 状态转换 ═══════════════════════════════════════ */

  publish(publishedBy) {
    if (!this.isValid()) {
      return { success: false, error: '内容不完整，无法发布' };
    }
    if (this.status === RecipeStatus.ACTIVE) {
      return { success: false, error: '已经是发布状态' };
    }

    this.status = RecipeStatus.ACTIVE;
    this.publishedAt = Math.floor(Date.now() / 1000);
    this.publishedBy = publishedBy;
    this.updatedAt = Math.floor(Date.now() / 1000);

    this.logger.info('Recipe published', { recipeId: this.id, publishedBy });
    return { success: true, recipe: this };
  }

  deprecate(reason = '') {
    if (this.status === RecipeStatus.DEPRECATED) {
      return { success: false, error: '已经是弃用状态' };
    }

    this.status = RecipeStatus.DEPRECATED;
    this.updatedAt = Math.floor(Date.now() / 1000);
    this.deprecation = { reason, deprecatedAt: Math.floor(Date.now() / 1000) };

    this.logger.info('Recipe deprecated', { recipeId: this.id, reason });
    return { success: true, recipe: this };
  }

  /* ═══ 质量 ═══════════════════════════════════════════ */

  updateQuality(metrics) {
    const cc = metrics.codeCompleteness    ?? this.quality.codeCompleteness;
    const pa = metrics.projectAdaptation   ?? this.quality.projectAdaptation;
    const dc = metrics.documentationClarity ?? this.quality.documentationClarity;
    const overall = Math.round(((cc + pa + dc) / 3) * 100) / 100;

    this.quality = { codeCompleteness: cc, projectAdaptation: pa, documentationClarity: dc, overall };
    this.updatedAt = Math.floor(Date.now() / 1000);

    this.logger.debug('Recipe quality updated', { recipeId: this.id, quality: this.quality });
    return { success: true, recipe: this };
  }

  /* ═══ 统计 ═══════════════════════════════════════════ */

  incrementAdoption()    { this.statistics.adoptionCount++;    this.updatedAt = Math.floor(Date.now() / 1000); }
  incrementApplication() { this.statistics.applicationCount++; this.updatedAt = Math.floor(Date.now() / 1000); }

  /**
   * 通用使用计数递增
   * @param {'adoption'|'application'} type
   */
  incrementUsage(type) {
    if (type === 'application') { this.incrementApplication(); }
    else { this.incrementAdoption(); }
  }
  incrementView()        { this.statistics.viewCount++;         this.updatedAt = Math.floor(Date.now() / 1000); }

  /* ═══ 关系管理 ═══════════════════════════════════════ */

  /**
   * 添加关系
   * @param {'inherits'|'implements'|'calls'|'dependsOn'|'dataFlow'|'conflicts'|'extends'|'related'} type
   * @param {{ target: string, description?: string }} relation
   */
  addRelation(type, relation) {
    if (!this.relations[type]) {
      return { success: false, error: `未知关系类型: ${type}` };
    }
    // 避免重复
    const exists = this.relations[type].some(r => r.target === relation.target);
    if (exists) {
      return { success: false, error: `关系已存在: ${relation.target}` };
    }
    this.relations[type].push(relation);
    this.updatedAt = Math.floor(Date.now() / 1000);
    return { success: true };
  }

  /**
   * 移除关系
   */
  removeRelation(type, targetId) {
    if (!this.relations[type]) return { success: false, error: `未知关系类型: ${type}` };
    const before = this.relations[type].length;
    this.relations[type] = this.relations[type].filter(r => r.target !== targetId);
    if (this.relations[type].length < before) {
      this.updatedAt = Math.floor(Date.now() / 1000);
      return { success: true };
    }
    return { success: false, error: '关系不存在' };
  }

  /**
   * 获取所有关系（扁平化）
   */
  getAllRelations() {
    const all = [];
    for (const [type, list] of Object.entries(this.relations)) {
      for (const r of list) {
        all.push({ type, ...r });
      }
    }
    return all;
  }

  /* ═══ 约束管理 ═══════════════════════════════════════ */

  /**
   * 添加 Guard 规则（内联在 Recipe 中）
   * @param {{ pattern: string, severity?: string, message?: string }} guard
   */
  addGuard(guard) {
    if (!guard.pattern) return { success: false, error: '缺少 pattern' };
    this.constraints.guards.push({
      pattern:  guard.pattern,
      severity: guard.severity || 'warning',
      message:  guard.message || '',
    });
    this.updatedAt = Math.floor(Date.now() / 1000);
    return { success: true };
  }

  /* ═══ 序列化 ═════════════════════════════════════════ */

  toJSON() {
    return {
      id:             this.id,
      title:          this.title,
      description:    this.description,
      language:       this.language,
      category:       this.category,
      summaryCn:      this.summaryCn,
      summaryEn:      this.summaryEn,
      usageGuideCn:   this.usageGuideCn,
      usageGuideEn:   this.usageGuideEn,
      kind:           this.kind,
      knowledgeType:  this.knowledgeType,
      complexity:     this.complexity,
      scope:          this.scope,
      content:        this.content,
      relations:      this.relations,
      constraints:    this.constraints,
      dimensions:     this.dimensions,
      tags:           this.tags,
      status:         this.status,
      quality:        this.quality,
      statistics:     this.statistics,
      createdBy:      this.createdBy,
      createdAt:      this.createdAt,
      updatedAt:      this.updatedAt,
      publishedAt:    this.publishedAt,
      publishedBy:    this.publishedBy,
      deprecation:    this.deprecation,
      sourceCandidate: this.sourceCandidate,
      sourceFile:     this.sourceFile,
    };
  }

  static fromJSON(data) {
    return new Recipe(data);
  }
}

export default Recipe;
