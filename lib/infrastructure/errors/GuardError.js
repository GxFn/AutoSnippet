/**
 * Guard 错误类
 */

const BaseError = require('./BaseError');

class GuardError extends BaseError {
  constructor(message, details = {}) {
  super(message, 'GUARD_ERROR', details);
  this.name = 'GuardError';
  }
}

module.exports = GuardError;
