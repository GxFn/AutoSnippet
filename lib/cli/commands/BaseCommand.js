/**
 * 基础命令类
 * 职责：
 * - 定义所有命令的通用接口
 * - 提供通用的错误处理和日志记录
 */

class BaseCommand {
  constructor(options = {}) {
    this.options = options;
    this.name = 'unknown';
    this.description = '';
  }

  /**
   * 执行命令的主方法（由子类实现）
   * @async
   * @returns {Promise<void>}
   */
  async execute() {
    throw new Error(`Command ${this.name} must implement execute() method`);
  }

  /**
   * 执行命令前的检查
   * @returns {boolean} - 通过返回 true，失败返回 false
   */
  async validate() {
    return true;
  }

  /**
   * 输出成功日志
   * @param {string} message - 日志消息
   */
  logSuccess(message) {
    console.log(`✅ ${message}`);
  }

  /**
   * 输出警告日志
   * @param {string} message - 日志消息
   */
  logWarn(message) {
    console.warn(`⚠️  ${message}`);
  }

  /**
   * 输出错误日志
   * @param {string} message - 日志消息
   */
  logError(message) {
    console.error(`❌ ${message}`);
  }

  /**
   * 输出信息日志
   * @param {string} message - 日志消息
   */
  logInfo(message) {
    console.log(`ℹ️  ${message}`);
  }
}

module.exports = BaseCommand;
