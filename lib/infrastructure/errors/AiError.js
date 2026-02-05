/**
 * AI 相关错误类
 */

const BaseError = require('./BaseError');

/**
 * AI 服务基础错误
 */
class AiError extends BaseError {
  constructor(message, details = {}) {
  super(message, 'AI_ERROR', details);
  Object.setPrototypeOf(this, AiError.prototype);
  }
}

/**
 * AI Provider 未找到错误
 */
class AiProviderNotFoundError extends AiError {
  constructor(providerName) {
  super(
    `AI Provider '${providerName}' not found`,
    { providerName }
  );
  this.code = 'AI_PROVIDER_NOT_FOUND';
  Object.setPrototypeOf(this, AiProviderNotFoundError.prototype);
  }
}

/**
 * AI API 调用错误
 */
class AiApiError extends AiError {
  constructor(message, statusCode, response) {
  super(message, {
    statusCode,
    response
  });
  this.code = 'AI_API_ERROR';
  Object.setPrototypeOf(this, AiApiError.prototype);
  }
}

/**
 * AI 配置错误
 */
class AiConfigError extends AiError {
  constructor(message, details = {}) {
  super(message, details);
  this.code = 'AI_CONFIG_ERROR';
  Object.setPrototypeOf(this, AiConfigError.prototype);
  }
}

/**
 * AI 超时错误
 */
class AiTimeoutError extends AiError {
  constructor(timeout) {
  super(`AI request timeout after ${timeout}ms`, { timeout });
  this.code = 'AI_TIMEOUT';
  Object.setPrototypeOf(this, AiTimeoutError.prototype);
  }
}

module.exports = {
  AiError,
  AiProviderNotFoundError,
  AiApiError,
  AiConfigError,
  AiTimeoutError
};
