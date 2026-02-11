import EventEmitter from 'events';
import { v4 as uuidv4 } from 'uuid';
import Logger from '../../infrastructure/logging/Logger.js';
import { InternalError } from '../../shared/errors/BaseError.js';

/**
 * Gateway - 统一网关
 * 所有操作的唯一入口，负责：
 * 1. 权限检查
 * 2. 宪法验证
 * 3. 审计日志
 * 4. 会话管理
 * 5. 事件分发
 */
export class Gateway extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.logger = Logger.getInstance();
    this.routes = new Map();
    this.plugins = [];

    // 依赖注入（稍后设置）
    this.constitution = null;
    this.constitutionValidator = null;
    this.permissionManager = null;
    this.auditLogger = null;
    this.sessionManager = null;
  }

  /**
   * 设置依赖
   */
  setDependencies({
    constitution,
    constitutionValidator,
    permissionManager,
    auditLogger,
    sessionManager,
  }) {
    this.constitution = constitution;
    this.constitutionValidator = constitutionValidator;
    this.permissionManager = permissionManager;
    this.auditLogger = auditLogger;
    this.sessionManager = sessionManager;
  }

  /**
   * 注册路由处理器
   */
  register(action, handler) {
    if (this.routes.has(action)) {
      throw new Error(`Action '${action}' is already registered`);
    }
    this.routes.set(action, handler);
    this.logger.debug(`Route registered: ${action}`);
  }

  /**
   * 获取已注册的 action 列表
   */
  getRegisteredActions() {
    return [...this.routes.keys()];
  }

  /**
   * 注册插件
   */
  use(plugin) {
    this.plugins.push(plugin);
    this.logger.debug(`Plugin registered: ${plugin.name}`);
  }

  /**
   * 执行操作（主入口）
   */
  async execute(request) {
    const requestId = uuidv4();
    const startTime = Date.now();

    const context = {
      requestId,
      actor: request.actor,
      action: request.action,
      resource: request.resource,
      data: request.data || {},
      session: request.session,
      startTime,
    };

    this.logger.info('Gateway: Request received', {
      requestId,
      actor: context.actor,
      action: context.action,
    });

    try {
      // 1. 验证请求
      this.validateRequest(request);

      // 2. 权限检查
      await this.checkPermission(context);

      // 3. 宪法验证
      await this.validateConstitution(context);

      // 4. 执行插件（pre-hook）
      await this.runPlugins('pre', context);

      // 5. 路由到处理器
      const result = await this.routeToHandler(context);

      // 6. 执行插件（post-hook）
      await this.runPlugins('post', context, result);

      // 7. 审计日志（成功）
      await this.auditSuccess(context, result);

      // 8. 返回结果
      const duration = Date.now() - startTime;
      this.logger.info('Gateway: Request completed', {
        requestId,
        duration: `${duration}ms`,
      });

      return {
        success: true,
        requestId,
        data: result,
        duration,
      };
    } catch (error) {
      // 审计日志（失败）
      await this.auditFailure(context, error);

      const duration = Date.now() - startTime;
      this.logger.error('Gateway: Request failed', {
        requestId,
        error: error.message,
        duration: `${duration}ms`,
      });

      return {
        success: false,
        requestId,
        error: {
          message: error.message,
          code: error.code || 'INTERNAL_ERROR',
          statusCode: error.statusCode || 500,
        },
        duration,
      };
    }
  }

  /**
   * 仅检查权限与宪法（不执行业务逻辑）
   * 用于 MCP Gateway gating — 只做 permission + constitution + audit，不路由到 handler
   */
  async checkOnly(request) {
    const requestId = uuidv4();
    const startTime = Date.now();

    const context = {
      requestId,
      actor: request.actor,
      action: request.action,
      resource: request.resource,
      data: request.data || {},
      session: request.session,
      startTime,
    };

    try {
      this.validateRequest(request);
      await this.checkPermission(context);
      await this.validateConstitution(context);
      await this.runPlugins('pre', context);

      // 记录成功的 checkOnly 审计日志（供 MCP Gateway gating 审计追踪）
      await this.auditSuccess(context, { checkOnly: true });

      return { success: true, requestId };
    } catch (error) {
      await this.auditFailure(context, error);
      return {
        success: false,
        requestId,
        error: {
          message: error.message,
          code: error.code || 'INTERNAL_ERROR',
          statusCode: error.statusCode || 500,
        },
      };
    }
  }

  /**
   * 验证请求格式
   */
  validateRequest(request) {
    if (!request.actor) {
      throw new InternalError('Missing required field: actor');
    }
    if (!request.action) {
      throw new InternalError('Missing required field: action');
    }
  }

  /**
   * 权限检查
   */
  async checkPermission(context) {
    if (!this.permissionManager) {
      this.logger.warn('PermissionManager not set, skipping permission check');
      return;
    }

    this.permissionManager.enforce(context.actor, context.action, context.resource);
  }

  /**
   * 宪法验证
   */
  async validateConstitution(context) {
    if (!this.constitutionValidator) {
      this.logger.warn('ConstitutionValidator not set, skipping validation');
      return;
    }

    const request = {
      actor: context.actor,
      action: context.action,
      resource: context.resource,
      data: context.data,
    };

    await this.constitutionValidator.enforce(request);
  }

  /**
   * 路由到处理器
   */
  async routeToHandler(context) {
    const handler = this.routes.get(context.action);

    if (!handler) {
      throw new InternalError(`No handler found for action: ${context.action}`);
    }

    return await handler(context);
  }

  /**
   * 执行插件
   */
  async runPlugins(phase, context, result = null) {
    for (const plugin of this.plugins) {
      if (plugin[phase]) {
        await plugin[phase](context, result);
      }
    }
  }

  /**
   * 审计成功
   */
  async auditSuccess(context, result) {
    if (!this.auditLogger) {
      return;
    }

    await this.auditLogger.log({
      requestId: context.requestId,
      actor: context.actor,
      action: context.action,
      resource: context.resource,
      result: 'success',
      duration: Date.now() - context.startTime,
      context: {
        session: context.session,
      },
    });
  }

  /**
   * 审计失败
   */
  async auditFailure(context, error) {
    if (!this.auditLogger) {
      return;
    }

    await this.auditLogger.log({
      requestId: context.requestId,
      actor: context.actor,
      action: context.action,
      resource: context.resource,
      result: 'failure',
      error: error.message,
      duration: Date.now() - context.startTime,
      context: {
        session: context.session,
      },
    });
  }

  /**
   * 获取所有注册的路由
   */
  getRoutes() {
    return Array.from(this.routes.keys());
  }

  /**
   * 获取所有插件
   */
  getPlugins() {
    return this.plugins.map((p) => p.name || 'anonymous');
  }
}

export default Gateway;
