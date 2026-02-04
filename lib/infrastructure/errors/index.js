/**
 * 错误类型导出
 * 统一的错误处理入口
 */

module.exports = {
  BaseError: require('./BaseError'),
  ValidationError: require('./ValidationError'),
  ContextError: require('./ContextError'),
  AiError: require('./AiError'),
  InjectionError: require('./InjectionError'),
  GuardError: require('./GuardError'),
  ErrorHandler: require('./ErrorHandler')
};
