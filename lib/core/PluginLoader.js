/**
 * PluginLoader - 插件加载器
 * 支持动态加载、卸载插件和 Hook 系统
 */

const fs = require('fs');
const path = require('path');

class PluginLoader {
  constructor(container, config, logger) {
    this.container = container;
    this.config = config;
    this.logger = logger;
    this.plugins = new Map();        // 插件名 => 插件实例
    this.hooks = new Map();          // Hook 名 => [callbacks]
    this.aliases = new Map();        // 插件别名
  }

  /**
   * 加载插件
   * @param {string} pluginPath - 插件路径或名称
   * @param {Object} [options] - 加载选项
   * @returns {Promise<any>} 加载的插件实例
   */
  async loadPlugin(pluginPath, options = {}) {
    try {
      // 解析插件路径
      const resolvedPath = this.resolvePluginPath(pluginPath);

      // 读取插件 package.json
      const packagePath = path.join(resolvedPath, 'package.json');
      if (!fs.existsSync(packagePath)) {
        throw new Error(`No package.json found at ${resolvedPath}`);
      }

      const packageContent = fs.readFileSync(packagePath, 'utf8');
      const packageJson = JSON.parse(packageContent);

      // 验证插件元数据
      if (!packageJson.autosnippet || !packageJson.autosnippet.plugin) {
        throw new Error(`Invalid plugin: missing autosnippet.plugin in package.json`);
      }

      const pluginMeta = packageJson.autosnippet.plugin;
      const pluginName = pluginMeta.name || packageJson.name;

      // 检查是否已加载
      if (this.plugins.has(pluginName)) {
        this.logger.warn(`Plugin '${pluginName}' already loaded, skipping`);
        return this.plugins.get(pluginName);
      }

      // 加载插件主文件
      const mainFile = packageJson.main || 'index.js';
      const mainPath = path.join(resolvedPath, mainFile);

      if (!fs.existsSync(mainPath)) {
        throw new Error(`Plugin main file not found: ${mainPath}`);
      }

      // 清除 require 缓存（开发模式）
      delete require.cache[path.resolve(mainPath)];

      const PluginClass = require(mainPath);

      // 实例化插件
      const plugin = new PluginClass(this.container, pluginMeta);

      // 调用插件的 register 方法
      if (typeof plugin.register === 'function') {
        await plugin.register();
      }

      // 缓存插件实例
      this.plugins.set(pluginName, plugin);

      this.logger.info(`Plugin '${pluginName}' loaded successfully`);
      this.container.resolve('event-bus').emit('plugin:loaded', pluginName, plugin);

      return plugin;
    } catch (error) {
      this.logger.error(`Failed to load plugin '${pluginPath}': ${error.message}`);
      this.container.resolve('event-bus').emit('plugin:error', pluginPath, error);
      throw error;
    }
  }

  /**
   * 卸载插件
   * @param {string} pluginName - 插件名称
   * @returns {Promise<void>}
   */
  async unloadPlugin(pluginName) {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin '${pluginName}' not loaded`);
    }

    try {
      // 调用插件的 unregister 方法
      if (typeof plugin.unregister === 'function') {
        await plugin.unregister();
      }

      // 清理资源
      if (typeof plugin.cleanup === 'function') {
        await plugin.cleanup();
      }

      this.plugins.delete(pluginName);

      this.logger.info(`Plugin '${pluginName}' unloaded`);
      this.container.resolve('event-bus').emit('plugin:unloaded', pluginName);
    } catch (error) {
      this.logger.error(`Failed to unload plugin '${pluginName}': ${error.message}`);
      throw error;
    }
  }

  /**
   * 注册 Hook
   * @param {string} hookName - Hook 名称
   * @param {Function} callback - 回调函数
   * @param {number} [priority=10] - 优先级（数字越小优先级越高）
   * @returns {PluginLoader}
   */
  registerHook(hookName, callback, priority = 10) {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, []);
    }

    this.hooks.get(hookName).push({ callback, priority });

    // 按优先级排序
    this.hooks.get(hookName).sort((a, b) => a.priority - b.priority);

    return this;
  }

  /**
   * 执行 Hook（同步）
   * @param {string} hookName - Hook 名称
   * @param {...any} args - 传给 Hook 的参数
   * @returns {any} Hook 处理后的结果
   */
  runHook(hookName, ...args) {
    const callbacks = this.hooks.get(hookName) || [];

    let result = args[0]; // 第一个参数作为初始结果
    const remainingArgs = args.slice(1);

    for (const { callback } of callbacks) {
      try {
        result = callback(result, ...remainingArgs);
      } catch (error) {
        this.logger.error(`Error in hook '${hookName}': ${error.message}`);
        this.container.resolve('event-bus').emit('hook:error', hookName, error);
      }
    }

    return result;
  }

  /**
   * 执行 Hook（异步）
   * @param {string} hookName - Hook 名称
   * @param {...any} args - 传给 Hook 的参数
   * @returns {Promise<any>} Hook 处理后的结果
   */
  async runHookAsync(hookName, ...args) {
    const callbacks = this.hooks.get(hookName) || [];

    let result = args[0]; // 第一个参数作为初始结果
    const remainingArgs = args.slice(1);

    for (const { callback } of callbacks) {
      try {
        const res = callback(result, ...remainingArgs);
        if (res instanceof Promise) {
          result = await res;
        } else {
          result = res;
        }
      } catch (error) {
        this.logger.error(`Error in hook '${hookName}': ${error.message}`);
        this.container.resolve('event-bus').emit('hook:error', hookName, error);
        throw error;
      }
    }

    return result;
  }

  /**
   * 解析插件路径
   * @private
   */
  resolvePluginPath(pluginPath) {
    // 如果是绝对路径，直接返回
    if (path.isAbsolute(pluginPath)) {
      if (fs.existsSync(pluginPath)) {
        return pluginPath;
      }
    }

    // 尝试从当前目录解析
    const localPath = path.resolve(pluginPath);
    if (fs.existsSync(localPath)) {
      return localPath;
    }

    // 尝试从 node_modules 解析
    try {
      const resolved = require.resolve(pluginPath);
      return path.dirname(resolved);
    } catch (e) {
      // 忽略
    }

    // 尝试从插件目录解析
    const pluginDir = this.config.get('plugins.dir', 'lib/plugins');
    const pluginDirPath = path.resolve(pluginDir, pluginPath);
    if (fs.existsSync(pluginDirPath)) {
      return pluginDirPath;
    }

    throw new Error(`Cannot resolve plugin path: ${pluginPath}`);
  }

  /**
   * 自动加载所有插件
   * @returns {Promise<void>}
   */
  async loadAllPlugins() {
    const pluginConfig = this.config.get('plugins', {});
    const plugins = pluginConfig.list || [];

    for (const pluginName of plugins) {
      try {
        await this.loadPlugin(pluginName);
      } catch (error) {
        this.logger.error(`Failed to load plugin '${pluginName}': ${error.message}`);
        // 继续加载其他插件
      }
    }
  }

  /**
   * 获取已加载的插件
   * @param {string} [name] - 可选的插件名称
   * @returns {any}
   */
  getPlugin(name) {
    return this.plugins.get(name);
  }

  /**
   * 获取所有已加载的插件
   * @returns {Array}
   */
  getAllPlugins() {
    return Array.from(this.plugins.entries());
  }

  /**
   * 检查插件是否已加载
   * @param {string} name - 插件名称
   * @returns {boolean}
   */
  isLoaded(name) {
    return this.plugins.has(name);
  }

  /**
   * 获取所有已注册的 Hook
   * @returns {string[]}
   */
  getHooks() {
    return Array.from(this.hooks.keys());
  }

  /**
   * 获取特定 Hook 的回调数
   * @param {string} hookName - Hook 名称
   * @returns {number}
   */
  getHookCount(hookName) {
    const hooks = this.hooks.get(hookName) || [];
    return hooks.length;
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      pluginsLoaded: this.plugins.size,
      hooksRegistered: this.hooks.size,
      totalCallbacks: Array.from(this.hooks.values())
        .reduce((sum, callbacks) => sum + callbacks.length, 0)
    };
  }
}

module.exports = PluginLoader;
