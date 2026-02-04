/**
 * ErrorManager - 错误分类和管理系统
 * 
 * 支持：
 * - 错误分类（API、系统、业务、验证）
 * - 自定义错误类
 * - 错误代码映射
 * - 用户友好的消息
 * - 错误链和堆栈跟踪
 */

class AppError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code || 'UNKNOWN_ERROR';
    this.category = options.category || 'SYSTEM';
    this.statusCode = options.statusCode || 500;
    this.userMessage = options.userMessage || '发生了错误，请稍后重试';
    this.cause = options.cause || null;
    this.details = options.details || {};
    this.timestamp = new Date().toISOString();

    // 保留堆栈跟踪
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * 获取完整的错误信息（包括嵌套原因）
   */
  getFullMessage() {
    let message = `${this.code}: ${this.message}`;
    if (this.cause) {
      const causeMsg = this.cause instanceof AppError 
        ? this.cause.getFullMessage() 
        : this.cause.message || String(this.cause);
      message += ` (caused by: ${causeMsg})`;
    }
    return message;
  }

  /**
   * 转换为 JSON（用于日志输出）
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      message: this.message,
      userMessage: this.userMessage,
      statusCode: this.statusCode,
      details: this.details,
      timestamp: this.timestamp,
      fullMessage: this.getFullMessage(),
      stack: this.stack
    };
  }
}

/**
 * API 错误（4xx、5xx 响应相关）
 */
class ApiError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      category: 'API',
      statusCode: options.statusCode || 400,
      userMessage: options.userMessage || '请求处理失败',
      ...options
    });
  }
}

/**
 * 验证错误（输入验证失败）
 */
class ValidationError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      category: 'VALIDATION',
      code: options.code || 'VALIDATION_ERROR',
      statusCode: 400,
      userMessage: options.userMessage || '输入参数不合法',
      ...options
    });
  }
}

/**
 * 系统错误（内部系统问题）
 */
class SystemError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      category: 'SYSTEM',
      code: options.code || 'SYSTEM_ERROR',
      statusCode: 500,
      userMessage: options.userMessage || '系统内部错误',
      ...options
    });
  }
}

/**
 * 业务逻辑错误
 */
class BusinessError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      category: 'BUSINESS',
      code: options.code || 'BUSINESS_ERROR',
      statusCode: options.statusCode || 422,
      userMessage: options.userMessage || '业务流程错误',
      ...options
    });
  }
}

/**
 * 认证错误
 */
class AuthError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      category: 'AUTH',
      code: options.code || 'AUTH_ERROR',
      statusCode: 401,
      userMessage: options.userMessage || '请重新登录',
      ...options
    });
  }
}

/**
 * 权限错误
 */
class PermissionError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      category: 'PERMISSION',
      code: options.code || 'PERMISSION_DENIED',
      statusCode: 403,
      userMessage: options.userMessage || '您没有权限执行此操作',
      ...options
    });
  }
}

/**
 * 资源未找到错误
 */
class NotFoundError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      category: 'NOT_FOUND',
      code: options.code || 'RESOURCE_NOT_FOUND',
      statusCode: 404,
      userMessage: options.userMessage || '请求的资源不存在',
      ...options
    });
  }
}

class ErrorManager {
  constructor(options = {}) {
    this.errorMap = new Map(); // 错误代码 -> 配置映射
    this.stats = {
      total: 0,
      byCategory: {},
      byCode: {}
    };
    this.defaultUserMessage = options.defaultUserMessage || '发生了错误，请稍后重试';

    // 注册默认的错误代码
    this._registerDefaultErrors();
  }

  /**
   * 注册默认的错误映射
   */
  _registerDefaultErrors() {
    const defaults = {
      // API 错误
      'API_BAD_REQUEST': {
        category: 'API',
        statusCode: 400,
        userMessage: '请求格式不正确'
      },
      'API_UNAUTHORIZED': {
        category: 'API',
        statusCode: 401,
        userMessage: '请重新登录'
      },
      'API_FORBIDDEN': {
        category: 'API',
        statusCode: 403,
        userMessage: '您没有权限访问此资源'
      },
      'API_NOT_FOUND': {
        category: 'API',
        statusCode: 404,
        userMessage: '请求的资源不存在'
      },
      'API_TIMEOUT': {
        category: 'API',
        statusCode: 408,
        userMessage: '请求超时，请重试'
      },
      'API_SERVER_ERROR': {
        category: 'API',
        statusCode: 500,
        userMessage: '服务器错误，请稍后重试'
      },

      // 验证错误
      'VALIDATION_REQUIRED_FIELD': {
        category: 'VALIDATION',
        statusCode: 400,
        userMessage: '缺少必填字段'
      },
      'VALIDATION_INVALID_FORMAT': {
        category: 'VALIDATION',
        statusCode: 400,
        userMessage: '字段格式不正确'
      },
      'VALIDATION_INVALID_RANGE': {
        category: 'VALIDATION',
        statusCode: 400,
        userMessage: '字段值超出允许范围'
      },

      // 业务错误
      'BUSINESS_DUPLICATE': {
        category: 'BUSINESS',
        statusCode: 409,
        userMessage: '资源已存在'
      },
      'BUSINESS_INVALID_STATE': {
        category: 'BUSINESS',
        statusCode: 422,
        userMessage: '当前状态不允许此操作'
      },
      'BUSINESS_INSUFFICIENT_BALANCE': {
        category: 'BUSINESS',
        statusCode: 422,
        userMessage: '余额不足'
      },

      // 系统错误
      'SYSTEM_DATABASE_ERROR': {
        category: 'SYSTEM',
        statusCode: 500,
        userMessage: '数据库错误'
      },
      'SYSTEM_FILE_ERROR': {
        category: 'SYSTEM',
        statusCode: 500,
        userMessage: '文件操作错误'
      },
      'SYSTEM_MEMORY_ERROR': {
        category: 'SYSTEM',
        statusCode: 500,
        userMessage: '内存不足'
      }
    };

    for (const [code, config] of Object.entries(defaults)) {
      this.register(code, config);
    }
  }

  /**
   * 注册错误代码映射
   */
  register(code, config) {
    this.errorMap.set(code, config);
    return this;
  }

  /**
   * 创建错误
   */
  create(code, message, options = {}) {
    const config = this.errorMap.get(code) || {};
    
    const errorOptions = {
      code,
      category: config.category || 'SYSTEM',
      statusCode: config.statusCode || 500,
      userMessage: config.userMessage || this.defaultUserMessage,
      ...options
    };

    // 选择错误类
    let ErrorClass = AppError;
    const category = errorOptions.category;

    switch (category) {
      case 'API':
        ErrorClass = ApiError;
        break;
      case 'VALIDATION':
        ErrorClass = ValidationError;
        break;
      case 'BUSINESS':
        ErrorClass = BusinessError;
        break;
      case 'AUTH':
        ErrorClass = AuthError;
        break;
      case 'PERMISSION':
        ErrorClass = PermissionError;
        break;
      case 'NOT_FOUND':
        ErrorClass = NotFoundError;
        break;
      case 'SYSTEM':
      default:
        ErrorClass = SystemError;
    }

    const error = new ErrorClass(message, errorOptions);
    
    // 更新统计
    this._updateStats(error);

    return error;
  }

  /**
   * 包装现有错误
   */
  wrap(err, code, userMessage, options = {}) {
    const wrappedError = this.create(code, err.message, {
      ...options,
      userMessage: userMessage || options.userMessage,
      cause: err,
      details: options.details || {}
    });

    return wrappedError;
  }

  /**
   * 捕获和转换错误
   */
  catch(err) {
    // 如果已经是 AppError，直接返回
    if (err instanceof AppError) {
      this._updateStats(err);
      return err;
    }

    // 否则包装为 SystemError
    return this.wrap(err, 'SYSTEM_ERROR', this.defaultUserMessage);
  }

  /**
   * 检查错误是否属于某个分类
   */
  isCategory(err, category) {
    return err instanceof AppError && err.category === category;
  }

  /**
   * 检查错误代码
   */
  isCode(err, code) {
    return err instanceof AppError && err.code === code;
  }

  /**
   * 获取用户友好的错误响应
   */
  getUserResponse(err) {
    const appErr = this.catch(err);
    return {
      code: appErr.code,
      message: appErr.userMessage,
      statusCode: appErr.statusCode,
      details: appErr.details
    };
  }

  /**
   * 获取完整的错误响应（用于日志）
   */
  getDetailedResponse(err) {
    const appErr = this.catch(err);
    return appErr.toJSON();
  }

  /**
   * 更新统计信息
   */
  _updateStats(err) {
    this.stats.total++;

    const category = err.category || 'UNKNOWN';
    this.stats.byCategory[category] = (this.stats.byCategory[category] || 0) + 1;

    const code = err.code || 'UNKNOWN';
    this.stats.byCode[code] = (this.stats.byCode[code] || 0) + 1;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * 重置统计
   */
  resetStats() {
    this.stats = {
      total: 0,
      byCategory: {},
      byCode: {}
    };
    return this;
  }

  /**
   * 获取所有注册的错误代码
   */
  getCodes() {
    return Array.from(this.errorMap.keys());
  }

  /**
   * 获取错误配置
   */
  getConfig(code) {
    return this.errorMap.get(code) || null;
  }
}

module.exports = {
  AppError,
  ApiError,
  ValidationError,
  SystemError,
  BusinessError,
  AuthError,
  PermissionError,
  NotFoundError,
  ErrorManager
};
