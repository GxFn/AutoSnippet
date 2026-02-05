/**
 * BaseError - 基础错误类
 * 所有自定义错误都应继承此类
 */

class BaseError extends Error {
  /**
   * @param {string} message - 错误信息
   * @param {string} code - 错误代码
   * @param {Object} [details] - 详细信息
   */
  constructor(message, code, details = {}) {
  super(message);

  // 保持原型链
  Object.setPrototypeOf(this, BaseError.prototype);

  this.name = this.constructor.name;
  this.code = code;
  this.details = details;
  this.timestamp = Date.now();

  // 保持堆栈跟踪
  Error.captureStackTrace(this, this.constructor);
  }

  /**
   * 转换为 JSON
   * @returns {Object}
   */
  toJSON() {
  return {
    name: this.name,
    message: this.message,
    code: this.code,
    details: this.details,
    timestamp: this.timestamp
  };
  }

  /**
   * 转换为字符串
   * @returns {string}
   */
  toString() {
  return `[${this.code}] ${this.message}`;
  }
}

module.exports = BaseError;
