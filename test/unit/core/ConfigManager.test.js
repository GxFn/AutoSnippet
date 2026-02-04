/**
 * ConfigManager 单元测试
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ConfigManager = require('../../../lib/core/ConfigManager');

describe('ConfigManager', () => {
  const testDir = path.join(__dirname, '../../fixtures/config-test');

  beforeEach(() => {
    // 创建测试目录
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    // 清理测试文件
    const files = [
      path.join(testDir, '.autosnippetrc.json'),
      path.join(testDir, 'AutoSnippet', 'AutoSnippet.boxspec.json')
    ];

    files.forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  });

  describe('default config', () => {
    it('should have default config', () => {
      const config = new ConfigManager(testDir);
      config.load();

      assert(config.has('ai.provider'));
      assert(config.has('context.adapter'));
      assert(config.has('recipe.dir'));
      assert(config.has('log.level'));
    });

    it('should return default values', () => {
      const config = new ConfigManager(testDir);
      config.load();

      assert.equal(config.get('ai.provider'), 'auto');
      assert.equal(config.get('context.adapter'), 'milvus');
      assert.equal(config.get('ai.timeout'), 30000);
    });
  });

  describe('get and set', () => {
    it('should get config value', () => {
      const config = new ConfigManager(testDir);
      config.load();

      const provider = config.get('ai.provider');

      assert.equal(provider, 'auto');
    });

    it('should return default value if key not found', () => {
      const config = new ConfigManager(testDir);
      config.load();

      const value = config.get('non.existent.key', 'default');

      assert.equal(value, 'default');
    });

    it('should set config value', () => {
      const config = new ConfigManager(testDir);
      config.load();

      config.set('ai.provider', 'openai');

      assert.equal(config.get('ai.provider'), 'openai');
    });

    it('should create nested path on set', () => {
      const config = new ConfigManager(testDir);
      config.load();

      config.set('custom.nested.value', 42);

      assert.equal(config.get('custom.nested.value'), 42);
    });

    it('should check if config key exists', () => {
      const config = new ConfigManager(testDir);
      config.load();

      assert(config.has('ai.provider'));
      assert(!config.has('non.existent'));
    });
  });

  describe('load and merge', () => {
    it('should load default config only if no files exist', () => {
      const config = new ConfigManager(testDir);
      config.load();

      assert.equal(config.get('ai.provider'), 'auto');
    });

    it('should load from .autosnippetrc.json if exists', () => {
      const rcFile = path.join(testDir, '.autosnippetrc.json');
      fs.writeFileSync(rcFile, JSON.stringify({
        ai: { provider: 'openai' }
      }));

      const config = new ConfigManager(testDir);
      config.load();

      assert.equal(config.get('ai.provider'), 'openai');
    });

    it('should merge config from multiple sources', () => {
      const rcFile = path.join(testDir, '.autosnippetrc.json');
      fs.writeFileSync(rcFile, JSON.stringify({
        ai: { provider: 'openai', timeout: 30000 }
      }));

      const config = new ConfigManager(testDir);
      config.load();

      // 默认值应该被保留
      const allConfig = config.getAll();
      assert(allConfig.ai.timeout !== undefined);
      // 合并值
      assert.equal(config.get('ai.provider'), 'openai');
    });

    it('should merge config object', () => {
      const config = new ConfigManager(testDir);
      config.load();

      config.merge({
        ai: { provider: 'claude' },
        log: { level: 'debug' }
      });

      assert.equal(config.get('ai.provider'), 'claude');
      assert.equal(config.get('log.level'), 'debug');
    });
  });

  describe('reset and getAll', () => {
    it('should get all config', () => {
      const config = new ConfigManager(testDir);
      config.load();

      const all = config.getAll();

      assert(all.ai);
      assert(all.context);
      assert(all.log);
    });

    it('should reset to default', () => {
      const config = new ConfigManager(testDir);
      config.load();

      config.set('ai.provider', 'custom');
      config.reset();

      assert.equal(config.get('ai.provider'), 'auto');
    });
  });

  describe('save', () => {
    it('should save config to file', () => {
      const config = new ConfigManager(testDir);
      config.load();

      config.set('ai.provider', 'openai');
      config.save();

      const rcFile = path.join(testDir, '.autosnippetrc.json');
      assert(fs.existsSync(rcFile));

      const saved = JSON.parse(fs.readFileSync(rcFile, 'utf8'));
      assert.equal(saved.ai.provider, 'openai');
    });

    it('should save to custom path', () => {
      const config = new ConfigManager(testDir);
      config.load();

      config.set('custom', 'value');

      const customPath = path.join(testDir, 'custom-config.json');
      config.save(customPath);

      assert(fs.existsSync(customPath));
    });

    it('should create directory if not exists', () => {
      const config = new ConfigManager(testDir);
      config.load();

      const customPath = path.join(testDir, 'deep/nested/config.json');
      config.save(customPath);

      assert(fs.existsSync(customPath));
    });
  });

  describe('env vars', () => {
    const originalEnv = process.env;

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should load from environment variables', () => {
      process.env.AUTOSNIPPET_AI_PROVIDER = 'claude';
      process.env.AUTOSNIPPET_LOG_LEVEL = 'debug';

      const config = new ConfigManager(testDir);
      config.load();

      assert.equal(config.get('ai.provider'), 'claude');
      assert.equal(config.get('log.level'), 'debug');
    });
  });

  describe('load idempotency', () => {
    it('should not reload if already loaded', () => {
      const config = new ConfigManager(testDir);

      config.load();
      const config1 = config.getAll();

      config.set('test', 'value1');
      config.load();
      const config2 = config.getAll();

      assert.equal(config2.test, 'value1');
    });
  });
});
