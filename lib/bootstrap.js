/**
 * Bootstrap - 应用启动配置
 * 负责初始化服务容器、注册所有服务
 */

const { ServiceContainer } = require('./core/ServiceContainer');
const ConfigManager = require('./core/ConfigManager');
const EventBus = require('./core/EventBus');
const Logger = require('./core/Logger');
const PluginLoader = require('./core/PluginLoader');
const AiService = require('./services/ai/AiService');
const ContextService = require('./services/context/ContextService');
const AgentService = require('./services/agent/AgentService');
const path = require('path');

/**
 * 创建和配置服务容器
 * @param {string} [projectRoot] - 项目根目录
 * @returns {ServiceContainer} 配置好的容器
 */
function createContainer(projectRoot = null) {
  const container = new ServiceContainer();

  // ============ 基础设施服务 ============

  /**
   * 注册配置管理器
   */
  container.register('config', (c) => {
  const config = new ConfigManager(projectRoot || process.cwd());
  config.load();
  return config;
  }, true);

  /**
   * 注册事件总线
   */
  container.register('event-bus', (c) => {
  const eventBus = new EventBus();
  return eventBus;
  }, true);

  /**
   * 注册日志系统
   */
  container.register('logger', (c) => {
  const config = c.resolve('config');
  const eventBus = c.resolve('event-bus');

  const logger = new Logger(eventBus, {
    level: config.get('log.level', 'info'),
    file: config.get('log.file'),
    enableConsole: true
  });

  return logger;
  }, true);

  /**
   * 注册插件加载器
   */
  container.register('plugin-loader', (c) => {
  const config = c.resolve('config');
  const logger = c.resolve('logger');

  return new PluginLoader(container, config, logger);
  }, true);

  // ============ 核心业务服务（Phase 3+） ============

  /**
   * 注册 AI 服务（Phase 3 实现）
   */
  container.register('ai-service', (c) => {
  const logger = c.resolve('logger');
  const config = c.resolve('config');

  const aiService = new AiService({
    container,
    logger,
    config,
    providersPath: path.join(__dirname, './ai/providers')
  });

  return aiService;
  }, true);

  /**
   * 注册 Context 服务（Phase 4 实现）
   */
  container.register('context-service', (c) => {
  const logger = c.resolve('logger');
  const config = c.resolve('config');

  const contextService = new ContextService({
    container,
    logger,
    config
  });

  return contextService;
  }, true);

  /**
   * 注册 Recipe 服务（Phase 3 实现）
   */
  container.register('recipe-service', (c) => {
  // TODO: 实现 RecipeService
  return {
    name: 'recipe-service',
    status: 'placeholder'
  };
  }, true);

  /**
   * 注册 Lint 服务（Phase 3 实现）
   */
  container.register('lint-service', (c) => {
  // TODO: 实现 LintService
  return {
    name: 'lint-service',
    status: 'placeholder'
  };
  }, true);

  /**
   * 注册 Agent 服务（Phase 5完成）
   */
  container.register('agent-service', (c) => {
  const logger = c.resolve('logger');
  const config = c.resolve('config');

  const agentService = new AgentService({
    container,
    logger,
    config
  });

  return agentService;
  }, true);

  // ============ 服务别名（向后兼容） ============

  container.alias('ai-service', 'ai');
  container.alias('context-service', 'context');
  container.alias('recipe-service', 'recipe');
  container.alias('lint-service', 'guard'); // 兼容旧名称

  return container;
}

/**
 * 启动应用
 * @param {Object} [options] - 启动选项
 * @param {string} [options.projectRoot] - 项目根目录
 * @param {boolean} [options.autoLoadPlugins=true] - 是否自动加载插件
 * @returns {Promise<ServiceContainer>} 启动后的容器
 */
async function bootstrap(options = {}) {
  const {
  projectRoot = null,
  autoLoadPlugins = true
  } = options;

  // 创建容器
  const container = createContainer(projectRoot);

  // 启动容器（初始化所有单例）
  container.boot();

  const logger = container.resolve('logger');
  const config = container.resolve('config');

  logger.info('✅ ServiceContainer booted');
  logger.info(`📁 Project root: ${config.projectRoot}`);
  logger.info(`📊 Services registered: ${container.getStats().registered}`);

  // 初始化 AI Service
  try {
  const aiService = container.resolve('ai-service');
  await aiService.initialize({
    autoLoad: true
  });
  logger.info('✅ AI Service initialized');
  } catch (error) {
  logger.error(`Failed to initialize AI Service: ${error.message}`);
  }

  // 初始化 Context Service
  try {
  const contextService = container.resolve('context-service');
  await contextService.initialize({
    autoLoad: true,
    adaptersPath: path.join(__dirname, './context/adapters'),
    defaultAdapter: config.get('context.storage.adapter', 'json')
  });
  logger.info('✅ Context Service initialized');
  } catch (error) {
  logger.error(`Failed to initialize Context Service: ${error.message}`);
  }

  // 初始化 Agent Service
  try {
    const agentService = container.resolve('agent-service');
    await agentService.initialize({
    autoLoad: false // 暂不自动加载agents和tools
    });
    logger.info('✅ Agent Service initialized');
  } catch (error) {
    logger.error(`Failed to initialize Agent Service: ${error.message}`);
  }

  // 自动加载插件
  if (autoLoadPlugins && config.get('plugins.autoload', true)) {
  try {
    const pluginLoader = container.resolve('plugin-loader');
    await pluginLoader.loadAllPlugins();

    const stats = pluginLoader.getStats();
    logger.info(`🔌 Plugins loaded: ${stats.pluginsLoaded}`);
  } catch (error) {
    logger.error(`Failed to load plugins: ${error.message}`);
  }
  }

  return container;
}

/**
 * 创建测试用的容器（不加载插件）
 * @returns {ServiceContainer}
 */
function createTestContainer(projectRoot = null) {
  const container = createContainer(projectRoot);
  container.boot();
  return container;
}

module.exports = {
  createContainer,
  bootstrap,
  createTestContainer
};
