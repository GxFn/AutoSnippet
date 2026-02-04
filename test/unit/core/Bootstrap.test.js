/**
 * Bootstrap 集成测试
 */

const assert = require('assert');
const { createContainer, createTestContainer, bootstrap } = require('../../../lib/bootstrap');

describe('Bootstrap', () => {
  describe('createContainer', () => {
    it('should create container with core services', () => {
      const container = createContainer();

      assert(container.has('config'));
      assert(container.has('event-bus'));
      assert(container.has('logger'));
      assert(container.has('plugin-loader'));
    });

    it('should register business services', () => {
      const container = createContainer();

      assert(container.has('ai-service'));
      assert(container.has('context-service'));
      assert(container.has('recipe-service'));
      assert(container.has('lint-service'));
      assert(container.has('agent-service'));
    });

    it('should create aliases for backward compatibility', () => {
      const container = createContainer();

      assert(container.has('ai'));
      assert(container.has('context'));
      assert(container.has('recipe'));
      assert(container.has('guard')); // 兼容旧名称
    });

    it('should resolve services with correct dependencies', () => {
      const container = createContainer();
      container.boot();

      const config = container.resolve('config');
      const logger = container.resolve('logger');
      const eventBus = container.resolve('event-bus');

      assert(config);
      assert(logger);
      assert(eventBus);
    });

    it('should share singleton instances across resolution', () => {
      const container = createContainer();
      container.boot();

      const config1 = container.resolve('config');
      const config2 = container.resolve('config');

      assert.strictEqual(config1, config2);
    });
  });

  describe('createTestContainer', () => {
    it('should create container without plugins', () => {
      const container = createTestContainer();

      assert(container.isBooted());
      assert(container.has('config'));
      assert(container.has('logger'));
    });
  });

  describe('bootstrap', () => {
    it('should bootstrap application', async () => {
      const container = await bootstrap({ autoLoadPlugins: false });

      assert(container.isBooted());
      assert(container.has('config'));
      assert(container.has('logger'));
    });

    it('should resolve services after bootstrap', async () => {
      const container = await bootstrap({ autoLoadPlugins: false });

      const config = container.resolve('config');
      const logger = container.resolve('logger');

      assert(config);
      assert(logger);
      assert(config.has('ai.provider'));
    });

    it('should initialize logger with config', async () => {
      const container = await bootstrap({ autoLoadPlugins: false });

      const logger = container.resolve('logger');
      const config = container.resolve('config');

      assert.equal(logger.getLevel(), config.get('log.level'));
    });
  });

  describe('service integration', () => {
    it('should access services via aliases', () => {
      const container = createContainer();
      container.boot();

      const aiByName = container.resolve('ai-service');
      const aiByAlias = container.resolve('ai');

      assert.strictEqual(aiByName, aiByAlias);
    });

    it('should provide logger to services', async () => {
      const container = await bootstrap({ autoLoadPlugins: false });

      const logger = container.resolve('logger');

      // 检查 logger 是否能正常工作
      assert(typeof logger.info === 'function');
      assert(typeof logger.error === 'function');
    });

    it('should provide event bus to services', async () => {
      const container = await bootstrap({ autoLoadPlugins: false });

      const eventBus = container.resolve('event-bus');

      // 检查 event bus 是否能正常工作
      assert(typeof eventBus.emit === 'function');
      assert(typeof eventBus.on === 'function');
    });
  });
});
