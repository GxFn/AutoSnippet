import DatabaseConnection from '../infrastructure/database/DatabaseConnection.js';
import Logger from '../infrastructure/logging/Logger.js';
import AuditStore from '../infrastructure/audit/AuditStore.js';
import AuditLogger from '../infrastructure/audit/AuditLogger.js';
import Gateway from '../core/gateway/Gateway.js';

import { CandidateRepositoryImpl } from '../repository/candidate/CandidateRepository.impl.js';
import { RecipeRepositoryImpl } from '../repository/recipe/RecipeRepository.impl.js';
import { SnippetFactory } from '../service/snippet/SnippetFactory.js';
import { RecipeService } from '../service/recipe/RecipeService.js';
import { GuardService } from '../service/guard/GuardService.js';
import { KnowledgeGraphService } from '../service/knowledge/KnowledgeGraphService.js';
import { SearchEngine } from '../service/search/SearchEngine.js';
import { GuardCheckEngine } from '../service/guard/GuardCheckEngine.js';

// ─── P0: Advanced Search ──────────────────────────────
import { RetrievalFunnel } from '../service/search/RetrievalFunnel.js';

// ─── P0: Vector Storage ──────────────────────────────
import { JsonVectorAdapter } from '../infrastructure/vector/JsonVectorAdapter.js';
import { IndexingPipeline } from '../infrastructure/vector/IndexingPipeline.js';

// ─── P1: Injection / Snippet / Recipe ─────────────────
import { RecipeParser } from '../service/recipe/RecipeParser.js';
import { RecipeStatsTracker } from '../service/recipe/RecipeStatsTracker.js';
import { RecipeCandidateValidator } from '../service/recipe/RecipeCandidateValidator.js';
import { RecipeFileWriter } from '../service/recipe/RecipeFileWriter.js';
import { CandidateFileWriter } from '../service/candidate/CandidateFileWriter.js';
import { CandidateService } from '../service/candidate/CandidateService.js';
import { SnippetInstaller } from '../service/snippet/SnippetInstaller.js';

// ─── P1: Guard Advanced ──────────────────────────────
import { ExclusionManager } from '../service/guard/ExclusionManager.js';
import { RuleLearner } from '../service/guard/RuleLearner.js';
import { ViolationsStore } from '../service/guard/ViolationsStore.js';

// ─── P2: Quality ──────────────────────────────────────
import { QualityScorer } from '../service/quality/QualityScorer.js';
import { FeedbackCollector } from '../service/quality/FeedbackCollector.js';

// ─── P2: SPM ──────────────────────────────────────────
import { SpmService } from '../service/spm/SpmService.js';
// ─── P2: Content Extraction ─────────────────────────────────────
import { RecipeExtractor } from '../service/context/RecipeExtractor.js';
// ─── P2: Automation ───────────────────────────────────
import { AutomationOrchestrator } from '../service/automation/AutomationOrchestrator.js';

// ─── P2: ChatAgent (统一 AI Agent) ────────────────────
import { ToolRegistry } from '../service/chat/ToolRegistry.js';
import { ChatAgent } from '../service/chat/ChatAgent.js';
import { ALL_TOOLS } from '../service/chat/tools.js';

// ─── P3: Infrastructure ──────────────────────────────
import { EventBus } from '../infrastructure/event/EventBus.js';
import { PluginManager } from '../infrastructure/plugin/PluginManager.js';

/**
 * DependencyInjection 容器
 * 管理所有应用层的仓储、服务和基础设施依赖的创建和注入
 */
export class ServiceContainer {
  constructor() {
    this.services = {};
    this.singletons = {};
    this.logger = Logger.getInstance();
  }

  /**
   * 静态单例获取（路由层使用）
   */
  static getInstance() {
    return getServiceContainer();
  }

  /**
   * 初始化所有服务和仓储
   * @param {object} bootstrapComponents - Bootstrap 初始化的组件（db, auditLogger, gateway 等）
   */
  async initialize(bootstrapComponents = {}) {
    try {
      // 如果提供了 bootstrap 组件，将它们注入到单例缓存中
      if (bootstrapComponents.db) {
        this.singletons.database = bootstrapComponents.db;
      }
      if (bootstrapComponents.auditLogger) {
        this.singletons.auditLogger = bootstrapComponents.auditLogger;
      }
      if (bootstrapComponents.gateway) {
        this.singletons.gateway = bootstrapComponents.gateway;
      }
      if (bootstrapComponents.reasoningLogger) {
        this.singletons.reasoningLogger = bootstrapComponents.reasoningLogger;
      }
      if (bootstrapComponents.roleDriftMonitor) {
        this.singletons.roleDriftMonitor = bootstrapComponents.roleDriftMonitor;
      }
      if (bootstrapComponents.complianceEvaluator) {
        this.singletons.complianceEvaluator = bootstrapComponents.complianceEvaluator;
      }
      if (bootstrapComponents.sessionManager) {
        this.singletons.sessionManager = bootstrapComponents.sessionManager;
      }
      if (bootstrapComponents.projectRoot) {
        this.singletons._projectRoot = bootstrapComponents.projectRoot;
      }

      // AiFactory 模块引用（用于 SpmService AI 扫描）
      try {
        this.singletons._aiFactory = await import('../external/ai/AiFactory.js');
      } catch {
        this.singletons._aiFactory = null;
      }

      // 自动探测 AI Provider（供 SearchEngine / Agent / IndexingPipeline 等常驻服务使用）
      if (!this.singletons.aiProvider && this.singletons._aiFactory) {
        try {
          const { autoDetectProvider } = this.singletons._aiFactory;
          if (typeof autoDetectProvider === 'function') {
            this.singletons.aiProvider = autoDetectProvider();
            this.logger.info('AI provider injected into container', {
              provider: this.singletons.aiProvider?.constructor?.name || 'unknown',
            });
          }
        } catch {
          // AI 不可用不阻塞启动
          this.singletons.aiProvider = null;
        }
      }

      // 如果主 provider 不支持 embedding（如 Claude），尝试创建备用 embedding provider
      if (this.singletons.aiProvider && !this.singletons.aiProvider.supportsEmbedding?.()) {
        try {
          const { getAvailableFallbacks, createProvider } = this.singletons._aiFactory;
          const providerName = this.singletons.aiProvider.name?.replace('-', '') || '';
          const fbCandidates = typeof getAvailableFallbacks === 'function'
            ? getAvailableFallbacks(providerName) : [];
          for (const fb of fbCandidates) {
            try {
              const fbProvider = createProvider({ provider: fb });
              if (fbProvider.supportsEmbedding?.()) {
                this.singletons._embedProvider = fbProvider;
                this.logger.info('Embedding fallback provider created', { provider: fb });
                break;
              }
            } catch { /* skip */ }
          }
        } catch { /* no embed fallback available */ }
      }

      // RecipeExtractor 实例（用于工具增强）
      this.singletons._recipeExtractor = new RecipeExtractor();

      // 注册基础设施依赖
      this._registerInfrastructure();

      // 注册仓储
      this._registerRepositories();

      // 注册服务
      this._registerServices();

      this.logger.info('Service container initialized successfully');
    } catch (error) {
      this.logger.error('Error initializing service container', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 注册基础设施依赖
   */
  _registerInfrastructure() {
    // Database（使用 Bootstrap 注入的实例，或延迟报错）
    this.register('database', () => {
      if (!this.singletons.database) {
        throw new Error('Database not initialized. Ensure Bootstrap.initialize() is called before using ServiceContainer.');
      }
      return this.singletons.database;
    });

    // Logger
    this.register('logger', () => Logger.getInstance());

    // AuditStore
    this.register('auditStore', () => {
      if (!this.singletons.auditStore) {
        const database = this.get('database');
        this.singletons.auditStore = new AuditStore(database);
      }
      return this.singletons.auditStore;
    });

    // AuditLogger
    this.register('auditLogger', () => {
      if (!this.singletons.auditLogger) {
        const auditStore = this.get('auditStore');
        this.singletons.auditLogger = new AuditLogger(auditStore);
      }
      return this.singletons.auditLogger;
    });

    // Gateway
    this.register('gateway', () => {
      if (!this.singletons.gateway) {
        this.singletons.gateway = new Gateway();
      }
      return this.singletons.gateway;
    });

    // ReasoningLogger
    this.register('reasoningLogger', () => this.singletons.reasoningLogger || null);

    // RoleDriftMonitor
    this.register('roleDriftMonitor', () => this.singletons.roleDriftMonitor || null);

    // ComplianceEvaluator
    this.register('complianceEvaluator', () => this.singletons.complianceEvaluator || null);

    // SessionManager
    this.register('sessionManager', () => this.singletons.sessionManager || null);
  }

  /**
   * 注册仓储
   */
  _registerRepositories() {
    // CandidateRepository
    this.register('candidateRepository', () => {
      if (!this.singletons.candidateRepository) {
        const database = this.get('database');
        this.singletons.candidateRepository = new CandidateRepositoryImpl(database);
      }
      return this.singletons.candidateRepository;
    });

    // RecipeRepository
    this.register('recipeRepository', () => {
      if (!this.singletons.recipeRepository) {
        const database = this.get('database');
        this.singletons.recipeRepository = new RecipeRepositoryImpl(database);
      }
      return this.singletons.recipeRepository;
    });
  }

  /**
   * 注册服务
   */
  _registerServices() {
    // CandidateService
    this.register('candidateService', () => {
      if (!this.singletons.candidateService) {
        const candidateRepository = this.get('candidateRepository');
        const auditLogger = this.get('auditLogger');
        const gateway = this.get('gateway');
        const projectRoot = this.singletons._projectRoot || process.cwd();
        const candidateFileWriter = new CandidateFileWriter(projectRoot);
        this.singletons.candidateService = new CandidateService(
          candidateRepository,
          auditLogger,
          gateway,
          { fileWriter: candidateFileWriter }
        );
      }
      return this.singletons.candidateService;
    });

    // RecipeService
    this.register('recipeService', () => {
      if (!this.singletons.recipeService) {
        const recipeRepository = this.get('recipeRepository');
        const auditLogger = this.get('auditLogger');
        const gateway = this.get('gateway');
        const knowledgeGraphService = this.get('knowledgeGraphService');
        const projectRoot = this.singletons._projectRoot || process.cwd();
        const fileWriter = new RecipeFileWriter(projectRoot);
        this.singletons.recipeService = new RecipeService(
          recipeRepository,
          auditLogger,
          gateway,
          knowledgeGraphService,
          { fileWriter }
        );
      }
      return this.singletons.recipeService;
    });

    // GuardService (now uses recipeRepository)
    this.register('guardService', () => {
      if (!this.singletons.guardService) {
        const recipeRepository = this.get('recipeRepository');
        const auditLogger = this.get('auditLogger');
        const gateway = this.get('gateway');
        this.singletons.guardService = new GuardService(
          recipeRepository,
          auditLogger,
          gateway
        );
      }
      return this.singletons.guardService;
    });

    // KnowledgeGraphService
    this.register('knowledgeGraphService', () => {
      if (!this.singletons.knowledgeGraphService) {
        const database = this.get('database');
        this.singletons.knowledgeGraphService = new KnowledgeGraphService(database);
      }
      return this.singletons.knowledgeGraphService;
    });

    // SearchEngine
    this.register('searchEngine', () => {
      if (!this.singletons.searchEngine) {
        const database = this.get('database');
        const aiProvider = this.singletons.aiProvider || null;
        const embedProvider = this.singletons._embedProvider || aiProvider;
        const vectorStore = this.get('vectorStore');
        this.singletons.searchEngine = new SearchEngine(database, { aiProvider: embedProvider, vectorStore });
      }
      return this.singletons.searchEngine;
    });

    // GuardCheckEngine
    this.register('guardCheckEngine', () => {
      if (!this.singletons.guardCheckEngine) {
        const database = this.get('database');
        this.singletons.guardCheckEngine = new GuardCheckEngine(database);
      }
      return this.singletons.guardCheckEngine;
    });

    // ─── 新迁移的服务 ────────────────────────────────────

    // EventBus
    this.register('eventBus', () => {
      if (!this.singletons.eventBus) {
        this.singletons.eventBus = new EventBus();
      }
      return this.singletons.eventBus;
    });

    // PluginManager
    this.register('pluginManager', () => {
      if (!this.singletons.pluginManager) {
        this.singletons.pluginManager = new PluginManager();
      }
      return this.singletons.pluginManager;
    });

    // RetrievalFunnel (Advanced Search)
    this.register('retrievalFunnel', () => {
      if (!this.singletons.retrievalFunnel) {
        const vectorStore = this.get('vectorStore');
        const aiProvider = this.singletons.aiProvider || null;
        const embedProvider = this.singletons._embedProvider || aiProvider;
        this.singletons.retrievalFunnel = new RetrievalFunnel({ vectorStore, aiProvider: embedProvider });
      }
      return this.singletons.retrievalFunnel;
    });

    // JsonVectorAdapter
    this.register('vectorStore', () => {
      if (!this.singletons.vectorStore) {
        const projectRoot = this.singletons._projectRoot || process.cwd();
        this.singletons.vectorStore = new JsonVectorAdapter(projectRoot);
      }
      return this.singletons.vectorStore;
    });

    // IndexingPipeline
    this.register('indexingPipeline', () => {
      if (!this.singletons.indexingPipeline) {
        const vectorStore = this.get('vectorStore');
        const aiProvider = this.singletons.aiProvider || null;
        const embedProvider = this.singletons._embedProvider || aiProvider;
        this.singletons.indexingPipeline = new IndexingPipeline({ vectorStore, aiProvider: embedProvider });
      }
      return this.singletons.indexingPipeline;
    });

    // RecipeParser
    this.register('recipeParser', () => {
      if (!this.singletons.recipeParser) {
        this.singletons.recipeParser = new RecipeParser();
      }
      return this.singletons.recipeParser;
    });

    // RecipeStatsTracker
    this.register('recipeStatsTracker', () => {
      if (!this.singletons.recipeStatsTracker) {
        const projectRoot = this.singletons._projectRoot || process.cwd();
        this.singletons.recipeStatsTracker = new RecipeStatsTracker(projectRoot);
      }
      return this.singletons.recipeStatsTracker;
    });

    // RecipeCandidateValidator
    this.register('recipeCandidateValidator', () => {
      if (!this.singletons.recipeCandidateValidator) {
        this.singletons.recipeCandidateValidator = new RecipeCandidateValidator();
      }
      return this.singletons.recipeCandidateValidator;
    });

    // SnippetFactory (no DB — generates from recipes on-the-fly)
    this.register('snippetFactory', () => {
      if (!this.singletons.snippetFactory) {
        const recipeRepo = this.get('recipeRepository');
        this.singletons.snippetFactory = new SnippetFactory(recipeRepo);
      }
      return this.singletons.snippetFactory;
    });

    // SnippetInstaller
    this.register('snippetInstaller', () => {
      if (!this.singletons.snippetInstaller) {
        const factory = this.get('snippetFactory');
        this.singletons.snippetInstaller = new SnippetInstaller({ snippetFactory: factory });
      }
      return this.singletons.snippetInstaller;
    });

    // Guard: ExclusionManager
    this.register('exclusionManager', () => {
      if (!this.singletons.exclusionManager) {
        const projectRoot = this.singletons._projectRoot || process.cwd();
        this.singletons.exclusionManager = new ExclusionManager(projectRoot);
      }
      return this.singletons.exclusionManager;
    });

    // Guard: RuleLearner
    this.register('ruleLearner', () => {
      if (!this.singletons.ruleLearner) {
        const projectRoot = this.singletons._projectRoot || process.cwd();
        this.singletons.ruleLearner = new RuleLearner(projectRoot);
      }
      return this.singletons.ruleLearner;
    });

    // Guard: ViolationsStore (DB版)
    this.register('violationsStore', () => {
      if (!this.singletons.violationsStore) {
        const db = this.get('database').getDb();
        this.singletons.violationsStore = new ViolationsStore(db);
      }
      return this.singletons.violationsStore;
    });

    // QualityScorer
    this.register('qualityScorer', () => {
      if (!this.singletons.qualityScorer) {
        this.singletons.qualityScorer = new QualityScorer();
      }
      return this.singletons.qualityScorer;
    });

    // FeedbackCollector
    this.register('feedbackCollector', () => {
      if (!this.singletons.feedbackCollector) {
        const projectRoot = this.singletons._projectRoot || process.cwd();
        this.singletons.feedbackCollector = new FeedbackCollector(projectRoot);
      }
      return this.singletons.feedbackCollector;
    });

    // SpmService (with AI + tool injection)
    this.register('spmService', () => {
      if (!this.singletons.spmService) {
        const projectRoot = this.singletons._projectRoot || process.cwd();
        this.singletons.spmService = new SpmService(projectRoot, {
          aiFactory: this.singletons._aiFactory || null,
          chatAgent: this.singletons.chatAgent || null,
          qualityScorer: this.get('qualityScorer'),
          recipeExtractor: this.singletons._recipeExtractor || null,
          guardCheckEngine: this.get('guardCheckEngine'),
          violationsStore: this.get('violationsStore'),
        });
      }
      return this.singletons.spmService;
    });

    // AutomationOrchestrator
    this.register('automationOrchestrator', () => {
      if (!this.singletons.automationOrchestrator) {
        this.singletons.automationOrchestrator = new AutomationOrchestrator();
      }
      return this.singletons.automationOrchestrator;
    });

    // ToolRegistry (ChatAgent 的工具注册表)
    this.register('toolRegistry', () => {
      if (!this.singletons.toolRegistry) {
        const registry = new ToolRegistry();
        registry.registerAll(ALL_TOOLS);
        this.singletons.toolRegistry = registry;
      }
      return this.singletons.toolRegistry;
    });

    // ChatAgent (统一 AI Agent — 单 Agent + ToolRegistry 覆盖全部 AI 能力)
    this.register('chatAgent', () => {
      if (!this.singletons.chatAgent) {
        const toolRegistry = this.get('toolRegistry');
        const aiProvider = this.singletons.aiProvider || null;
        this.singletons.chatAgent = new ChatAgent({
          toolRegistry,
          aiProvider,
          container: this,
        });
      }
      return this.singletons.chatAgent;
    });
  }

  /**
   * 注册服务或工厂函数
   */
  register(name, factory) {
    this.services[name] = factory;
  }

  /**
   * 获取服务（通过工厂函数）
   */
  get(name) {
    if (!this.services[name]) {
      throw new Error(`Service '${name}' not found in container`);
    }
    return this.services[name]();
  }

  /**
   * 清除所有单例（用于测试）
   */
  reset() {
    this.singletons = {};
  }

  /**
   * 获取所有已注册的服务名
   */
  getServiceNames() {
    return Object.keys(this.services);
  }
}

let containerInstance = null;

/**
 * 获取全局服务容器实例
 */
export function getServiceContainer() {
  if (!containerInstance) {
    containerInstance = new ServiceContainer();
  }
  return containerInstance;
}

/**
 * 重置全局服务容器（主要用于测试）
 */
export function resetServiceContainer() {
  if (containerInstance) {
    containerInstance.reset();
  }
}

export default ServiceContainer;
