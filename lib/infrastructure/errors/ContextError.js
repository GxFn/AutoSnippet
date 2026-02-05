/**
 * Context 相关错误类
 */

const BaseError = require('./BaseError');

/**
 * Context 服务基础错误
 */
class ContextError extends BaseError {
  constructor(message, details = {}) {
  super(message, 'CONTEXT_ERROR', details);
  Object.setPrototypeOf(this, ContextError.prototype);
  }
}

/**
 * Context Adapter 未找到错误
 */
class ContextAdapterNotFoundError extends ContextError {
  constructor(adapterName) {
  super(
    `Context Adapter '${adapterName}' not found`,
    { adapterName }
  );
  this.code = 'CONTEXT_ADAPTER_NOT_FOUND';
  Object.setPrototypeOf(this, ContextAdapterNotFoundError.prototype);
  }
}

/**
 * 索引错误
 */
class IndexError extends ContextError {
  constructor(message, details = {}) {
  super(message, details);
  this.code = 'INDEX_ERROR';
  Object.setPrototypeOf(this, IndexError.prototype);
  }
}

/**
 * 搜索错误
 */
class SearchError extends ContextError {
  constructor(message, details = {}) {
  super(message, details);
  this.code = 'SEARCH_ERROR';
  Object.setPrototypeOf(this, SearchError.prototype);
  }
}

module.exports = {
  ContextError,
  ContextAdapterNotFoundError,
  IndexError,
  SearchError
};
