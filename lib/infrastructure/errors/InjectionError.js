/**
 * 注入错误类
 */

const BaseError = require('./BaseError');

class InjectionError extends BaseError {
  constructor(message, details = {}) {
  super(message, 'INJECTION_ERROR', details);
  this.name = 'InjectionError';
  }
}

module.exports = InjectionError;
