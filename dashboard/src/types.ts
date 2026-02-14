export interface Snippet {
  identifier: string;
  title: string;
  completionKey: string;
  summary: string;
  category?: string;
  language: string;
  content: string[];
  body?: string[];
  headers?: string[];
  /** 每条 header 相对于 target 根目录的路径，用于 // as:include <M/H.h> [path] */
  headerPaths?: string[];
  /** target/模块名，用于角括号格式 // as:include <TargetName/Header.h> */
  moduleName?: string;
  includeHeaders?: boolean;
  link?: string;
}

export interface RecipeStats {
  authority: number;
  guardUsageCount: number;
  humanUsageCount: number;
  aiUsageCount: number;
  lastUsedAt: string | null;
  authorityScore: number;
}

/** Recipe 结构化内容（API 返回对象形式时） */
export interface RecipeContent {
  pattern?: string;
  markdown?: string;
  rationale?: string;
  steps?: Array<string | { title?: string; description?: string; code?: string }>;
  codeChanges?: Array<{ file: string; before: string; after: string; explanation: string }>;
  verification?: { method?: string; expectedResult?: string; testCode?: string } | null;
}

export interface Recipe {
  id?: string;
  name: string;
  trigger?: string;
  content: string;
  category?: string;
  language?: string;
  description?: string;
  status?: string;
  kind?: 'rule' | 'pattern' | 'fact';
  metadata?: any;
  /** 使用统计与权威分（来自 recipe-stats.json） */
  stats?: RecipeStats | null;
  // ── V2 structured fields (passed through by v1-compat) ──
  knowledgeType?: string;
  v2Content?: {
    pattern?: string;
    rationale?: string;
    steps?: Array<{ title?: string; description?: string; code?: string }>;
    codeChanges?: Array<{ file: string; before: string; after: string; explanation: string }>;
    verification?: { method?: string; expectedResult?: string; testCode?: string } | null;
    markdown?: string;
  } | null;
  relations?: Record<string, any[]> | null;
  constraints?: {
    guards?: Array<{ pattern: string; severity: string; message?: string }>;
    boundaries?: string[];
    preconditions?: string[];
    sideEffects?: string[];
  } | null;
  tags?: string[];
  /** 使用指南 */
  usageGuide?: string;
  usageGuide_cn?: string;
  usageGuide_en?: string;
}

export interface ProjectData {
  rootSpec: {
  list: Snippet[];
  recipes?: {
    dir: string;
  };
  };
  recipes: Recipe[];
  candidates: Record<string, {
  targetName: string;
  scanTime: number;
  items: CandidateItem[];
  }>;
  projectRoot: string;
  watcherStatus?: string;
  /** 当前使用的 AI 提供商与模型（供 UI 展示） */
  aiConfig?: { provider: string; model: string };
}

export interface SPMTarget {
  name: string;
  packageName: string;
  packagePath: string;
  targetDir: string;
  info: any;
}

export interface ExtractedRecipe {
  title: string;
  summary: string;
  summary_cn?: string;
  summary_en?: string;
  trigger: string;
  category?: string;
  language: string;
  code: string;
  usageGuide: string;
  usageGuide_cn?: string;
  usageGuide_en?: string;
  headers?: string[];
  /** 每条 header 相对于 target 根目录的路径，与 create/headName 一致，用于 // as:include <M/H.h> [path] */
  headerPaths?: string[];
  /** target/模块名，用于角括号格式 // as:include <TargetName/Header.h> */
  moduleName?: string;
  /** 是否引入头文件：true 时 snippet 内写入 // as:include 标记，watch 按标记注入依赖 */
  includeHeaders?: boolean;
  /** 难度等级：beginner / intermediate / advanced */
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  /** 权威分 1～5，审核人员可设置初始值 */
  authority?: number;
  /** 知识类型 */
  knowledgeType?: 'code-pattern' | 'architecture' | 'best-practice' | 'rule';
  /** 复杂度 */
  complexity?: 'beginner' | 'intermediate' | 'advanced';
  /** 适用范围 */
  scope?: 'universal' | 'project-specific' | 'target-specific';
  /** 设计原理（英文） */
  rationale?: string;
  /** 实施步骤 */
  steps?: string[];
  /** 前置条件 */
  preconditions?: string[];
  /** 质量评分 (0-1) */
  qualityScore?: number;
  /** 质量等级 (A-F) */
  qualityGrade?: string;
  /** 自由标签 */
  tags?: string[];
  /** 版本号 */
  version?: string;
  /** 更新时间戳（毫秒） */
  updatedAt?: number;
}

// ── V2 Candidate 扩展字段 ──

export interface CandidateQuality {
  overallScore?: number;
  codeQuality?: number;
  documentation?: number;
  reusability?: number;
  [key: string]: number | undefined;
}

export interface CandidateReviewNotes {
  priority?: 'high' | 'medium' | 'low';
  notes?: string;
  reviewer?: string;
  reviewedAt?: string;
}

export interface CandidateReasoning {
  whyStandard: string;
  sources: string[];
  confidence: number | null;
}

export interface CandidateRelatedRecipe {
  id?: string;
  title?: string;
  similarity: number;
}

/** V1+V2 融合的候选项类型 */
export type CandidateItem = ExtractedRecipe & {
  id: string;
  status: string;
  source?: string;
  createdAt?: string | number;
  quality?: CandidateQuality | null;
  reviewNotes?: CandidateReviewNotes | null;
  relatedRecipes?: CandidateRelatedRecipe[];
  reasoning?: CandidateReasoning | null;
  // ── 润色产生的额外字段 ──
  agentNotes?: string[] | null;
  aiInsight?: string | null;
  relations?: Array<{ type: string; target: string; description: string }> | null;
  refinedConfidence?: number | null;
};

/** Guard 审计摘要（全项目扫描返回） */
export interface GuardAuditSummary {
  totalFiles: number;
  totalViolations: number;
  errors: number;
  warnings: number;
}

/** 相似 Recipe 条目 */
export interface SimilarRecipe {
  recipeName: string;
  similarity: number;
}

export interface GuardAuditResult {
  summary: GuardAuditSummary;
  files?: Array<{
    filePath: string;
    violations: Array<{ rule: string; severity: string; message: string; line?: number }>;
    summary: { errors: number; warnings: number };
  }>;
}

/** 候选池中的候选项（含 id）或 SPM 审核页中的项（含 candidateId/candidateTargetName） */
export type ScanResultItem = ExtractedRecipe & {
  mode: 'full' | 'preview';
  lang: 'cn' | 'en';
  includeHeaders?: boolean;
  id?: string;
  candidateId?: string;
  candidateTargetName?: string;
  /** 标识此结果来自 target 扫描还是全项目扫描 */
  scanMode?: 'target' | 'project';
};
