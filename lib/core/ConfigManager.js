/**
 * ConfigManager - 配置管理器
 * 统一管理应用配置，支持多个配置源
 */

const fs = require('fs');
const path = require('path');

class ConfigManager {
  constructor(projectRoot = null) {
    this.projectRoot = projectRoot || process.cwd();
    this.config = {};
    this.loaded = false;
  }

  /**
   * 加载配置
   * 加载顺序：默认 → .autosnippetrc.json → 环境变量
   * @returns {ConfigManager}
   */
  load() {
    if (this.loaded) {
      return this;
    }

    this.config = {
      ...this.getDefaultConfig(),
      ...this.loadRcFile(),
      ...this.loadEnvVars()
    };

    this.loaded = true;
    return this;
  }

  /**
   * 默认配置
   * @private
   */
  getDefaultConfig() {
    return {
      ai: {
        provider: 'auto',
        timeout: 30000,
        retries: 2,
        batchSize: 10
      },
      context: {
        adapter: 'milvus',
        chunkSize: 500,
        chunkOverlap: 50,
        embeddingBatch: 10
      },
      recipe: {
        dir: 'AutoSnippet/recipes',
        autoEmbed: true
      },
      lint: {
        rulesFile: 'guard-rules.json',
        autoFix: false
      },
      plugins: {
        enabled: true,
        dir: 'lib/plugins',
        autoload: true
      },
      cache: {
        enabled: true,
        ttl: 3600,
        maxSize: 1000
      },
      log: {
        level: 'info',
        file: '.autosnippet/logs/app.log',
        format: 'json'
      },
      watch: {
        enabled: true,
        debounce: 500
      }
    };
  }

  /**
   * 加载 .autosnippetrc.json
   * @private
   */
  loadRcFile() {
    const rcPath = path.join(this.projectRoot, '.autosnippetrc.json');

    if (!fs.existsSync(rcPath)) {
      return {};
    }

    try {
      const content = fs.readFileSync(rcPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      console.warn(`Failed to load .autosnippetrc.json: ${error.message}`);
      return {};
    }
  }

  /**
   * 加载环境变量
   * @private
   */
  loadEnvVars() {
    const envConfig = {};

    // AI 配置
    if (process.env.AUTOSNIPPET_AI_PROVIDER) {
      envConfig.ai = { provider: process.env.AUTOSNIPPET_AI_PROVIDER };
    }
    if (process.env.AUTOSNIPPET_API_KEY) {
      envConfig.ai = { ...envConfig.ai, apiKey: process.env.AUTOSNIPPET_API_KEY };
    }

    // Context 配置
    if (process.env.AUTOSNIPPET_CONTEXT_ADAPTER) {
      envConfig.context = { adapter: process.env.AUTOSNIPPET_CONTEXT_ADAPTER };
    }

    // Log 配置
    if (process.env.AUTOSNIPPET_LOG_LEVEL) {
      envConfig.log = { level: process.env.AUTOSNIPPET_LOG_LEVEL };
    }

    return envConfig;
  }

  /**
   * 获取配置值（支持点号路径）
   * @param {string} key - 配置键，支持点号分隔（如 'ai.provider'）
   * @param {any} [defaultValue] - 默认值
   * @returns {any} 配置值
   */
  get(key, defaultValue = undefined) {
    if (!this.loaded) {
      this.load();
    }

    const keys = key.split('.');
    let value = this.config;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return defaultValue;
      }
    }

    return value;
  }

  /**
   * 设置配置值
   * @param {string} key - 配置键，支持点号分隔
   * @param {any} value - 配置值
   * @returns {ConfigManager}
   */
  set(key, value) {
    if (!this.loaded) {
      this.load();
    }

    const keys = key.split('.');
    const lastKey = keys.pop();
    let obj = this.config;

    for (const k of keys) {
      if (!(k in obj) || typeof obj[k] !== 'object') {
        obj[k] = {};
      }
      obj = obj[k];
    }

    obj[lastKey] = value;
    return this;
  }

  /**
   * 获取所有配置
   * @returns {Object}
   */
  getAll() {
    if (!this.loaded) {
      this.load();
    }
    return JSON.parse(JSON.stringify(this.config));
  }

  /**
   * 合并配置（深层合并）
   * @param {Object} updates - 要合并的配置
   * @returns {ConfigManager}
   */
  merge(updates) {
    if (!this.loaded) {
      this.load();
    }

    this.config = this.deepMerge(this.config, updates);
    return this;
  }

  /**
   * 深层合并对象
   * @private
   */
  deepMerge(target, source) {
    const result = { ...target };

    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (
          typeof source[key] === 'object' &&
          source[key] !== null &&
          !Array.isArray(source[key]) &&
          typeof result[key] === 'object' &&
          result[key] !== null &&
          !Array.isArray(result[key])
        ) {
          result[key] = this.deepMerge(result[key], source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }

    return result;
  }

  /**
   * 检查配置键是否存在
   * @param {string} key - 配置键
   * @returns {boolean}
   */
  has(key) {
    if (!this.loaded) {
      this.load();
    }

    const keys = key.split('.');
    let value = this.config;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return false;
      }
    }

    return true;
  }

  /**
   * 重置为默认配置
   * @returns {ConfigManager}
   */
  reset() {
    this.config = this.getDefaultConfig();
    this.loaded = true;
    return this;
  }

  /**
   * 将配置保存到文件
   * @param {string} [filePath] - 保存路径，默认为 .autosnippetrc.json
   */
  save(filePath = null) {
    const path_to_save = filePath || path.join(this.projectRoot, '.autosnippetrc.json');

    try {
      const dir = path.dirname(path_to_save);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(path_to_save, JSON.stringify(this.config, null, 2));
      return true;
    } catch (error) {
      console.error(`Failed to save config to ${path_to_save}: ${error.message}`);
      return false;
    }
  }
}

module.exports = ConfigManager;
