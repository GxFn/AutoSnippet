/**
 * API 客户端库 - 与 AutoSnippet HTTP API 通信
 */

import axios from 'axios';
import type { AxiosInstance, AxiosError } from 'axios';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface Reasoning {
  whyStandard?: string;
  sources?: string[];
  qualitySignals?: Record<string, number>;
  alternatives?: string[];
  confidence?: number;
  generatedAt?: string;
}

export interface Candidate {
  id: string;
  code: string;
  language: string;
  category: string;
  source: string;
  reasoning?: Reasoning;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  statusHistory?: Array<{ from: string; to: string; changedAt: number }>;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
  approvedAt?: number;
  approvedBy?: string;
  rejectionReason?: string;
  rejectedBy?: string;
  appliedRecipeId?: string;
  metadata?: Record<string, any>;
}

export interface RecipeQuality {
  codeCompleteness: number;
  projectAdaptation: number;
  documentationClarity: number;
  overall: number;
}

export interface RecipeStatistics {
  adoptionCount: number;
  applicationCount: number;
  guardHitCount: number;
}

export interface RecipeContent {
  pattern?: string;
  rationale?: string;
  steps?: Array<{ title?: string; description?: string; code?: string }>;
  codeChanges?: Array<{ file: string; before: string; after: string; explanation: string }>;
  verification?: { method?: string; expectedResult?: string; testCode?: string } | null;
  markdown?: string;
}

export interface Recipe {
  id: string;
  title: string;
  trigger?: string;
  description: string;
  language: string;
  category: string;
  kind?: 'rule' | 'pattern' | 'fact';
  knowledgeType: 'code-pattern' | 'architecture' | 'best-practice' | 'rule';
  complexity: 'beginner' | 'intermediate' | 'advanced';
  scope?: string;
  content: RecipeContent;
  relations?: Record<string, any[]>;
  constraints?: Record<string, any[]>;
  status: 'draft' | 'active' | 'deprecated';
  quality: RecipeQuality;
  dimensions?: Record<string, string>;
  tags?: string[];
  statistics: RecipeStatistics;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
  publishedBy?: string;
  deprecation?: { reason: string; deprecatedAt: number };
  sourceCandidate?: string;
  sourceFile?: string;
  /** @deprecated V1 compat — 前端创建时的扁平字段，API 实际返回 content.pattern */
  codePattern?: string;
}

export interface GuardRuleStatistics {
  totalMatches: number;
  matchesThisWeek: number;
  affectedFiles: number;
}

export interface GuardRule {
  id: string;
  name: string;
  description: string;
  pattern: string;
  severity: 'info' | 'warning' | 'error';
  category?: string;
  enabled: boolean;
  sourceRecipeId?: string;
  sourceReason?: string;
  statistics: GuardRuleStatistics;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
  disabledBy?: string;
  disabledAt?: number;
  disabledReason?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

// ---- Snippet ----
export interface Snippet {
  id: string;
  identifier: string;
  title: string;
  language: string;
  category?: string;
  completion?: string;
  summary?: string;
  code: string;
  /** V1 compat: code split into lines */
  body?: string[];
  installed: boolean;
  installedPath?: string;
  sourceRecipeId?: string;
  sourceCandidateId?: string;
  metadata?: Record<string, any>;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
}

// ---- AI ----
export interface AiProvider {
  id: string;
  label: string;
  defaultModel: string;
}

export interface AiConfig {
  provider: string;
  model: string;
  name: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ---- SPM ----
export interface SpmTarget {
  name: string;
  type?: string;
  path?: string;
  packageName?: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  packageName?: string;
  packageDir?: string;
  targets?: string[];
}

export interface GraphEdge {
  from: string;
  to: string;
  source?: string;
}

// ---- Violations ----
export interface Violation {
  id?: string;
  ruleId: string;
  message: string;
  severity: string;
  file?: string;
  line?: number;
  timestamp?: number;
}

// ---- Solution ----
export interface SolutionQuality {
  completeness: number;
  accuracy: number;
  helpfulness: number;
  overall: number;
}

export interface SolutionStatistics {
  viewCount: number;
  applyCount: number;
  successCount: number;
  feedbackScore: number;
}

export interface Solution {
  id: string;
  title: string;
  problemDescription: string;
  symptoms?: string[];
  rootCause?: string;
  environment?: Record<string, any>;
  steps?: Array<{ order: number; title: string; description: string; code?: string; language?: string }>;
  codeChanges?: Array<{ file: string; before: string; after: string; explanation: string }>;
  commands?: Array<{ command: string; description: string }>;
  configChanges?: Array<{ file: string; key: string; oldValue: string; newValue: string }>;
  verification?: Record<string, any>;
  sideEffects?: string[];
  alternatives?: Array<{ title: string; description: string; pros?: string[]; cons?: string[] }>;
  type: 'bug-fix' | 'performance' | 'architecture' | 'migration' | 'integration' | 'troubleshoot' | 'workaround' | 'best-practice';
  language?: string;
  category?: string;
  tags?: string[];
  severity?: 'low' | 'medium' | 'high' | 'critical';
  relatedRecipeIds?: string[];
  relatedSolutionIds?: string[];
  sourceCandidateId?: string;
  quality: SolutionQuality;
  statistics: SolutionStatistics;
  status: 'draft' | 'verified' | 'published' | 'deprecated';
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
  verifiedBy?: string;
  verifiedAt?: number;
}

// ---- Monitoring ----
export interface HealthInfo {
  status: string;
  uptime: number;
  timestamp: number;
}

export interface PerformanceInfo {
  requestsPerMinute?: number;
  avgResponseTime?: number;
  errorRate?: number;
  memoryUsage?: Record<string, number>;
}

/**
 * 创建 API 客户端实例
 */
export class ApiClient {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor(baseURL: string = 'http://localhost:3000/api/v1', token?: string) {
    this.client = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.token = token || localStorage.getItem('auth_token');
    this.setupInterceptors();
  }

  /**
   * 设置拦截器
   */
  private setupInterceptors() {
    // 请求拦截器
    this.client.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }
      return config;
    });

    // 响应拦截器
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 401) {
          // 令牌过期，清除并重定向
          this.clearToken();
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * 设置认证令牌
   */
  setToken(token: string) {
    this.token = token;
    localStorage.setItem('auth_token', token);
  }

  /**
   * 清除认证令牌
   */
  clearToken() {
    this.token = null;
    localStorage.removeItem('auth_token');
  }

  /**
   * 获取一个候选人
   */
  async getCandidate(id: string): Promise<Candidate> {
    const response = await this.client.get<ApiResponse<Candidate>>(
      `/candidates/${id}`
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
    return response.data.data!;
  }

  /**
   * 获取候选人列表
   */
  async getCandidates(
    page: number = 1,
    limit: number = 20,
    status?: string
  ): Promise<PaginatedResponse<Candidate>> {
    const params: Record<string, any> = { page, limit };
    if (status) params.status = status;

    const response = await this.client.get<ApiResponse<any>>(
      '/candidates',
      { params }
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }

    const { data: candidates, pagination } = response.data.data;
    return {
      items: candidates || [],
      ...(pagination || {}),
    };
  }

  /**
   * 创建候选人
   */
  async createCandidate(candidate: Omit<Candidate, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<Candidate> {
    const response = await this.client.post<ApiResponse<Candidate>>(
      '/candidates',
      candidate
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
    return response.data.data!;
  }

  /**
   * 批准候选人
   */
  async approveCandidate(id: string, reasoning?: string): Promise<Candidate> {
    const response = await this.client.patch<ApiResponse<Candidate>>(
      `/candidates/${id}/approve`,
      { reasoning }
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
    return response.data.data!;
  }

  /**
   * 拒绝候选人
   */
  async rejectCandidate(id: string, reasoning?: string): Promise<Candidate> {
    const response = await this.client.patch<ApiResponse<Candidate>>(
      `/candidates/${id}/reject`,
      { reasoning }
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
    return response.data.data!;
  }

  /**
   * 批量批准候选人
   */
  async batchApproveCandidate(
    ids: string[],
    reasoning?: string
  ): Promise<{ approved: Candidate[]; failed: string[]; successCount: number; failureCount: number }> {
    const response = await this.client.post<ApiResponse<any>>(
      '/candidates/batch-approve',
      { ids, reasoning }
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
    return response.data.data;
  }

  /**
   * 批量拒绝候选人
   */
  async batchRejectCandidate(
    ids: string[],
    reasoning?: string
  ): Promise<{ rejected: Candidate[]; failed: string[]; successCount: number; failureCount: number }> {
    const response = await this.client.post<ApiResponse<any>>(
      '/candidates/batch-reject',
      { ids, reasoning }
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
    return response.data.data;
  }

  /**
   * 应用候选人到食谱
   */
  async applyToRecipe(candidateId: string, recipeId: string): Promise<any> {
    const response = await this.client.post<ApiResponse<any>>(
      `/candidates/${candidateId}/apply-to-recipe`,
      { recipeId }
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
    return response.data.data;
  }

  /**
   * 获取候选人统计
   */
  async getCandidateStats(): Promise<any> {
    const response = await this.client.get<ApiResponse>('/candidates/stats');
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data;
  }

  /**
   * 获取食谱列表
   */
  async getRecipes(
    page: number = 1,
    limit: number = 20,
    category?: string,
    filters?: { status?: string; language?: string; knowledgeType?: string; keyword?: string }
  ): Promise<PaginatedResponse<Recipe>> {
    const params: Record<string, any> = { page, limit };
    if (category) params.category = category;
    if (filters?.status) params.status = filters.status;
    if (filters?.language) params.language = filters.language;
    if (filters?.knowledgeType) params.knowledgeType = filters.knowledgeType;
    if (filters?.keyword) params.keyword = filters.keyword;

    const response = await this.client.get<ApiResponse<any>>(
      '/recipes',
      { params }
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }

    const { data: recipes, pagination } = response.data.data;
    return {
      items: recipes || [],
      ...(pagination || {}),
    };
  }

  /**
   * 获取食谱统计
   */
  async getRecipeStats(): Promise<any> {
    const response = await this.client.get<ApiResponse>('/recipes/stats');
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data;
  }

  /**
   * 获取一个食谱
   */
  async getRecipe(id: string): Promise<Recipe> {
    const response = await this.client.get<ApiResponse<Recipe>>(
      `/recipes/${id}`
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
    return response.data.data!;
  }

  /**
   * 创建食谱
   */
  async createRecipe(recipe: Omit<Recipe, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<Recipe> {
    const response = await this.client.post<ApiResponse<Recipe>>(
      '/recipes',
      recipe
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
    return response.data.data!;
  }

  /**
   * 更新食谱
   */
  async updateRecipe(id: string, recipe: Partial<Recipe>): Promise<Recipe> {
    const response = await this.client.patch<ApiResponse<Recipe>>(
      `/recipes/${id}`,
      recipe
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
    return response.data.data!;
  }

  /**
   * 发布食谱
   */
  async publishRecipe(id: string, version?: string, releaseNotes?: string): Promise<Recipe> {
    const response = await this.client.patch<ApiResponse<Recipe>>(
      `/recipes/${id}/publish`,
      { version, releaseNotes }
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
    return response.data.data!;
  }

  /**
   * 弃用食谱
   */
  async deprecateRecipe(id: string, reason?: string, replacement?: string): Promise<Recipe> {
    const response = await this.client.patch<ApiResponse<Recipe>>(
      `/recipes/${id}/deprecate`,
      { reason, replacement }
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
    return response.data.data!;
  }

  /**
   * 删除食谱
   */
  async deleteRecipe(id: string): Promise<void> {
    const response = await this.client.delete<ApiResponse>(
      `/recipes/${id}`
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
  }

  /**
   * AI 批量发现 Recipe 知识图谱关系
   */
  async discoverRelations(batchSize: number = 20): Promise<any> {
    const response = await this.client.post<ApiResponse>(
      '/recipes/discover-relations',
      { batchSize }
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
    return response.data.data;
  }

  /**
   * 获取防护规则列表
   */
  async getGuardRules(
    page: number = 1,
    limit: number = 20,
    status?: string
  ): Promise<PaginatedResponse<GuardRule>> {
    const params: Record<string, any> = { page, limit };
    if (status) params.status = status;

    const response = await this.client.get<ApiResponse<any>>(
      '/rules',
      { params }
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }

    const { data: rules, pagination } = response.data.data;
    return {
      items: rules || [],
      ...(pagination || {}),
    };
  }

  /**
   * 获取一个防护规则
   */
  async getGuardRule(id: string): Promise<GuardRule> {
    const response = await this.client.get<ApiResponse<GuardRule>>(
      `/rules/${id}`
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
    return response.data.data!;
  }

  /**
   * 创建防护规则
   */
  async createGuardRule(rule: Omit<GuardRule, 'id' | 'createdAt'>): Promise<GuardRule> {
    const response = await this.client.post<ApiResponse<GuardRule>>(
      '/rules',
      rule
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
    return response.data.data!;
  }

  /**
   * 启用防护规则
   */
  async enableGuardRule(id: string): Promise<GuardRule> {
    const response = await this.client.patch<ApiResponse<GuardRule>>(
      `/rules/${id}/enable`
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
    return response.data.data!;
  }

  /**
   * 禁用防护规则
   */
  async disableGuardRule(id: string, reason?: string): Promise<GuardRule> {
    const response = await this.client.patch<ApiResponse<GuardRule>>(
      `/rules/${id}/disable`,
      { reason }
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
    return response.data.data!;
  }

  /**
   * 批量启用防护规则
   */
  async batchEnableGuardRule(
    ids: string[]
  ): Promise<{ enabled: GuardRule[]; failed: string[]; successCount: number; failureCount: number }> {
    const response = await this.client.post<ApiResponse<any>>(
      '/rules/batch-enable',
      { ids }
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
    return response.data.data;
  }

  /**
   * 批量禁用防护规则
   */
  async batchDisableGuardRule(
    ids: string[],
    reason?: string
  ): Promise<{ disabled: GuardRule[]; failed: string[]; successCount: number; failureCount: number }> {
    const response = await this.client.post<ApiResponse<any>>(
      '/rules/batch-disable',
      { ids, reason }
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
    return response.data.data;
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<HealthInfo> {
    const response = await this.client.get<ApiResponse>(
      '/health'
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message);
    }
    return response.data.data!;
  }

  // =============================================
  // Snippet API
  // =============================================

  /**
   * 获取 Snippet 列表
   */
  async getSnippets(filters?: { language?: string; category?: string; keyword?: string }): Promise<Snippet[]> {
    const response = await this.client.get<ApiResponse<{ snippets: Snippet[] }>>(
      '/snippets',
      { params: filters }
    );
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data!.snippets;
  }

  /**
   * 获取单个 Snippet
   */
  async getSnippet(id: string): Promise<Snippet> {
    const response = await this.client.get<ApiResponse<Snippet>>(`/snippets/${id}`);
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data!;
  }

  /**
   * 保存 Snippet
   */
  async saveSnippet(snippet: Partial<Snippet>): Promise<Snippet> {
    const response = await this.client.post<ApiResponse<Snippet>>('/snippets', { snippet });
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data!;
  }

  /**
   * 更新 Snippet
   */
  async updateSnippet(id: string, snippet: Partial<Snippet>): Promise<Snippet> {
    const response = await this.client.put<ApiResponse<Snippet>>(`/snippets/${id}`, { snippet });
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data!;
  }

  /**
   * 删除 Snippet
   */
  async deleteSnippet(id: string): Promise<void> {
    const response = await this.client.delete<ApiResponse>(`/snippets/${id}`);
    if (!response.data.success) throw new Error(response.data.error?.message);
  }

  /**
   * 同步 Snippet 到 Xcode
   */
  async installSnippets(): Promise<any> {
    const response = await this.client.post<ApiResponse>('/snippets/install');
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data;
  }

  // =============================================
  // AI API
  // =============================================

  /**
   * 获取可用的 AI 提供商列表
   */
  async getAiProviders(): Promise<AiProvider[]> {
    const response = await this.client.get<ApiResponse<AiProvider[]>>('/ai/providers');
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data!;
  }

  /**
   * 更新 AI 配置
   */
  async setAiConfig(provider: string, model?: string): Promise<AiConfig> {
    const response = await this.client.post<ApiResponse<AiConfig>>('/ai/config', { provider, model });
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data!;
  }

  /**
   * AI 摘要
   */
  async aiSummarize(code: string, language?: string): Promise<any> {
    const response = await this.client.post<ApiResponse>('/ai/summarize', { code, language });
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data;
  }

  /**
   * AI 翻译
   */
  async aiTranslate(summary?: string, usageGuide?: string): Promise<{ summary_en: string; usageGuide_en: string }> {
    const response = await this.client.post<ApiResponse<{ summary_en: string; usageGuide_en: string }>>(
      '/ai/translate', { summary, usageGuide }
    );
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data!;
  }

  /**
   * AI 对话（RAG 模式）
   */
  async aiChat(prompt: string, history?: ChatMessage[]): Promise<{ reply: string; hasContext: boolean }> {
    const response = await this.client.post<ApiResponse<{ reply: string; hasContext: boolean }>>(
      '/ai/chat', { prompt, history }
    );
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data!;
  }

  /**
   * 格式化 usageGuide
   */
  async aiFormatUsageGuide(text: string, lang?: string): Promise<{ formatted: string }> {
    const response = await this.client.post<ApiResponse<{ formatted: string }>>(
      '/ai/format-usage-guide', { text, lang }
    );
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data!;
  }

  // =============================================
  // SPM API
  // =============================================

  /**
   * 获取 SPM Target 列表
   */
  async getSpmTargets(): Promise<SpmTarget[]> {
    const response = await this.client.get<ApiResponse<{ targets: SpmTarget[] }>>('/spm/targets');
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data!.targets;
  }

  /**
   * 获取依赖关系图
   */
  async getDepGraph(level: 'package' | 'target' = 'package'): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; projectRoot: string | null }> {
    const response = await this.client.get<ApiResponse<{ nodes: GraphNode[]; edges: GraphEdge[]; projectRoot: string | null }>>(
      '/spm/dep-graph', { params: { level } }
    );
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data!;
  }

  /**
   * 获取 Target 文件列表
   */
  async getSpmTargetFiles(targetName: string): Promise<{ target: string; files: string[]; total: number }> {
    const response = await this.client.post<ApiResponse<{ target: string; files: string[]; total: number }>>(
      '/spm/target-files', { targetName }
    );
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data!;
  }

  /**
   * AI 扫描 Target
   */
  async spmScan(targetName: string, options?: Record<string, any>): Promise<any> {
    const response = await this.client.post<ApiResponse>('/spm/scan', { targetName, options });
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data;
  }

  // =============================================
  // Extract API
  // =============================================

  /**
   * 从文件路径提取
   */
  async extractFromPath(relativePath: string, projectRoot?: string): Promise<{ result: any[]; isMarked: boolean }> {
    const response = await this.client.post<ApiResponse<{ result: any[]; isMarked: boolean }>>(
      '/extract/path', { relativePath, projectRoot }
    );
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data!;
  }

  /**
   * 从文本提取
   */
  async extractFromText(text: string, language?: string, relativePath?: string): Promise<{ result: any[] }> {
    const response = await this.client.post<ApiResponse<{ result: any[] }>>(
      '/extract/text', { text, language, relativePath }
    );
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data!;
  }

  // =============================================
  // Commands API
  // =============================================

  /**
   * 执行 Install（同步到 Xcode）
   */
  async commandInstall(): Promise<any> {
    const response = await this.client.post<ApiResponse>('/commands/install');
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data;
  }

  /**
   * 刷新 SPM Map
   */
  async commandSpmMap(): Promise<any> {
    const response = await this.client.post<ApiResponse>('/commands/spm-map');
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data;
  }

  /**
   * 全量重建语义索引
   */
  async commandEmbed(clear?: boolean): Promise<{ indexed: number; skipped: number; removed: number }> {
    const response = await this.client.post<ApiResponse<{ indexed: number; skipped: number; removed: number }>>(
      '/commands/embed', { clear }
    );
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data!;
  }

  /**
   * 获取命令执行状态
   */
  async getCommandStatus(): Promise<any> {
    const response = await this.client.get<ApiResponse>('/commands/status');
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data;
  }

  // =============================================
  // Violations API
  // =============================================

  /**
   * 获取违规记录列表
   */
  async getViolations(
    page?: number,
    limit?: number,
    filters?: { severity?: string; ruleId?: string; file?: string }
  ): Promise<any> {
    const params: Record<string, any> = { page: page || 1, limit: limit || 50 };
    if (filters?.severity) params.severity = filters.severity;
    if (filters?.ruleId) params.ruleId = filters.ruleId;
    if (filters?.file) params.file = filters.file;

    const response = await this.client.get<ApiResponse>('/violations', { params });
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data;
  }

  /**
   * 获取违规统计
   */
  async getViolationStats(): Promise<any> {
    const response = await this.client.get<ApiResponse>('/violations/stats');
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data;
  }

  /**
   * 清除违规记录
   */
  async clearViolations(options?: { ruleId?: string; file?: string; all?: boolean }): Promise<{ cleared: number }> {
    const response = await this.client.post<ApiResponse<{ cleared: number }>>('/violations/clear', options || { all: true });
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data!;
  }

  /**
   * AI 生成 Guard 规则
   */
  async generateGuardRule(description: string): Promise<any> {
    const response = await this.client.post<ApiResponse>('/violations/rules/generate', { description });
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data;
  }

  // =============================================
  // Search API (补齐)
  // =============================================

  /**
   * 统一搜索
   */
  async search(q: string, type?: string, limit?: number): Promise<any> {
    const response = await this.client.get<ApiResponse>('/search', { params: { q, type, limit } });
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data;
  }

  /**
   * 知识图谱查询
   */
  async searchGraph(nodeId: string, nodeType: string): Promise<any> {
    const response = await this.client.get<ApiResponse>('/search/graph', { params: { nodeId, nodeType } });
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data;
  }

  // =============================================
  // Solutions API
  // =============================================

  /**
   * 获取 Solution 列表
   */
  async getSolutions(page?: number, limit?: number, status?: string): Promise<PaginatedResponse<Solution>> {
    const params: Record<string, any> = { page: page || 1, limit: limit || 20 };
    if (status) params.status = status;
    const response = await this.client.get<ApiResponse<any>>('/solutions', { params });
    if (!response.data.success) throw new Error(response.data.error?.message);
    const { data: solutions, pagination } = response.data.data;
    return { items: solutions || [], ...(pagination || {}) };
  }

  /**
   * 获取单个 Solution
   */
  async getSolution(id: string): Promise<Solution> {
    const response = await this.client.get<ApiResponse<Solution>>(`/solutions/${id}`);
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data!;
  }

  // =============================================
  // Monitoring API
  // =============================================

  /**
   * 获取性能指标
   */
  async getPerformanceMetrics(): Promise<PerformanceInfo> {
    const response = await this.client.get<ApiResponse<PerformanceInfo>>('/monitoring/performance');
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data!;
  }

  /**
   * 获取错误列表
   */
  async getErrors(page?: number, limit?: number): Promise<any> {
    const response = await this.client.get<ApiResponse>('/monitoring/errors', { params: { page, limit } });
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data;
  }

  /**
   * 获取 Dashboard 聚合数据
   */
  async getDashboardData(): Promise<any> {
    const response = await this.client.get<ApiResponse>('/monitoring/dashboard');
    if (!response.data.success) throw new Error(response.data.error?.message);
    return response.data.data;
  }
}

// 导出单例实例
export const apiClient = new ApiClient();

export default ApiClient;
