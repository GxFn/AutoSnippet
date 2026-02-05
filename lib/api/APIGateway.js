/**
 * API Gateway - Agent REST API 服务器
 * 
 * 职责：
 * 1. HTTP 服务器启动和配置
 * 2. 路由定义和管理
 * 3. 请求验证和序列化
 * 4. 响应格式标准化
 * 5. 错误处理和中间件
 */

const http = require('http');
const url = require('url');
const querystring = require('querystring');

/**
 * API Gateway 类 - HTTP 服务器和路由管理
 */
class APIGateway {
  constructor(agent, options = {}) {
  this.agent = agent;
  this.port = options.port || 8080;
  this.host = options.host || 'localhost';
  this.server = null;
  this.routes = new Map();
  this.middlewares = [];
  
  // 初始化标准路由
  this._initializeRoutes();
  }

  /**
   * 初始化标准路由
   */
  _initializeRoutes() {
  // 健康检查
  this.register('GET', '/api/health', this._handleHealth.bind(this));

  // Agent 信息
  this.register('GET', '/api/agent/info', this._handleGetAgentInfo.bind(this));
  this.register('GET', '/api/agent/stats', this._handleGetStats.bind(this));
  this.register('GET', '/api/agent/queue', this._handleGetQueueInfo.bind(this));

  // 任务管理
  this.register('POST', '/api/agent/tasks', this._handleAddTask.bind(this));
  this.register('POST', '/api/agent/tasks/batch', this._handleBatchAddTasks.bind(this));
  this.register('POST', '/api/agent/tasks/:id/execute', this._handleExecuteTask.bind(this));
  this.register('GET', '/api/agent/tasks/:id', this._handleGetTask.bind(this));

  // Agent 控制
  this.register('POST', '/api/agent/start', this._handleStartAgent.bind(this));
  this.register('POST', '/api/agent/stop', this._handleStopAgent.bind(this));
  this.register('POST', '/api/agent/pause', this._handlePauseAgent.bind(this));
  this.register('POST', '/api/agent/resume', this._handleResumeAgent.bind(this));
  this.register('POST', '/api/agent/clear', this._handleClearQueue.bind(this));
  }

  /**
   * 注册路由处理器
   * @param {string} method HTTP 方法 (GET, POST, PUT, DELETE)
   * @param {string} path 路由路径 (支持 :id 动态参数)
   * @param {Function} handler 处理函数
   */
  register(method, path, handler) {
  const key = `${method} ${path}`;
  this.routes.set(key, { method, path, handler });
  }

  /**
   * 添加中间件
   * @param {Function} middleware 中间件函数
   */
  use(middleware) {
  this.middlewares.push(middleware);
  }

  /**
   * 启动服务器
   */
  start() {
  return new Promise((resolve, reject) => {
    this.server = http.createServer(async (req, res) => {
    try {
      // 执行中间件
      for (const middleware of this.middlewares) {
      await middleware(req, res);
      if (res.writableEnded) return;
      }

      // 解析请求
      const parsedUrl = url.parse(req.url, true);
      const pathname = parsedUrl.pathname;
      const queryParams = parsedUrl.query;

      // 查找匹配的路由
      const match = this._matchRoute(req.method, pathname);

      if (!match) {
      return this._sendError(res, 404, 'Not Found', `路由 ${req.method} ${pathname} 不存在`);
      }

      // 解析请求体
      let body = '';
      if (req.method === 'POST' || req.method === 'PUT') {
      body = await this._readBody(req);
      }

      // 构建请求对象
      const request = {
      method: req.method,
      url: req.url,
      pathname,
      params: match.params,
      query: queryParams,
      headers: req.headers,
      body: body ? this._parseBody(body, req.headers['content-type']) : null,
      };

      // 执行路由处理器
      const response = await match.handler(request);

      // 发送响应
      this._sendResponse(res, response);
    } catch (error) {
      console.error('API Gateway error:', error);
      this._sendError(res, 500, 'Internal Server Error', error.message);
    }
    });

    this.server.listen(this.port, this.host, () => {
    console.log(`🚀 API Gateway started on http://${this.host}:${this.port}`);
    resolve(this.server);
    });

    this.server.on('error', reject);
  });
  }

  /**
   * 停止服务器
   */
  stop() {
  return new Promise((resolve) => {
    if (this.server) {
    this.server.close(() => {
      console.log('API Gateway stopped');
      resolve();
    });
    } else {
    resolve();
    }
  });
  }

  /**
   * 匹配路由
   * @private
   */
  _matchRoute(method, pathname) {
  // 精确匹配
  const key = `${method} ${pathname}`;
  if (this.routes.has(key)) {
    return {
    handler: this.routes.get(key).handler,
    params: {},
    };
  }

  // 动态参数匹配
  for (const [routeKey, route] of this.routes) {
    const [routeMethod, routePath] = routeKey.split(' ');

    if (routeMethod !== method) continue;

    const params = this._matchPath(routePath, pathname);
    if (params !== null) {
    return {
      handler: route.handler,
      params,
    };
    }
  }

  return null;
  }

  /**
   * 匹配路径模式
   * @private
   */
  _matchPath(pattern, pathname) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathnameParts = pathname.split('/').filter(Boolean);

  if (patternParts.length !== pathnameParts.length) {
    return null;
  }

  const params = {};

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const pathnamePart = pathnameParts[i];

    if (patternPart.startsWith(':')) {
    params[patternPart.substring(1)] = pathnamePart;
    } else if (patternPart !== pathnamePart) {
    return null;
    }
  }

  return params;
  }

  /**
   * 读取请求体
   * @private
   */
  _readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
    body += chunk.toString();
    });

    req.on('end', () => {
    resolve(body);
    });

    req.on('error', reject);
  });
  }

  /**
   * 解析请求体
   * @private
   */
  _parseBody(body, contentType) {
  if (!body) return null;

  if (contentType && contentType.includes('application/json')) {
    try {
    return JSON.parse(body);
    } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
    }
  }

  if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
    return querystring.parse(body);
  }

  return body;
  }

  /**
   * 发送响应
   * @private
   */
  _sendResponse(res, response) {
  const statusCode = response.statusCode || 200;
  const headers = response.headers || { 'Content-Type': 'application/json' };

  res.writeHead(statusCode, headers);

  if (response.body) {
    if (typeof response.body === 'string') {
    res.end(response.body);
    } else {
    res.end(JSON.stringify(response.body));
    }
  } else {
    res.end();
  }
  }

  /**
   * 发送错误响应
   * @private
   */
  _sendError(res, statusCode, error, message) {
  const body = {
    error,
    message,
    timestamp: new Date().toISOString(),
  };

  this._sendResponse(res, {
    statusCode,
    body,
  });
  }

  // ===== 路由处理器 =====

  /**
   * GET /api/health - 健康检查
   */
  async _handleHealth(req) {
  return {
    statusCode: 200,
    body: {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    },
  };
  }

  /**
   * GET /api/agent/info - 获取 Agent 信息
   */
  async _handleGetAgentInfo(req) {
  try {
    const info = this.agent.getInfo();
    return {
    statusCode: 200,
    body: {
      success: true,
      data: info,
    },
    };
  } catch (error) {
    return {
    statusCode: 500,
    body: {
      success: false,
      error: error.message,
    },
    };
  }
  }

  /**
   * GET /api/agent/stats - 获取统计信息
   */
  async _handleGetStats(req) {
  try {
    const stats = this.agent.getStats();
    return {
    statusCode: 200,
    body: {
      success: true,
      data: stats,
    },
    };
  } catch (error) {
    return {
    statusCode: 500,
    body: {
      success: false,
      error: error.message,
    },
    };
  }
  }

  /**
   * GET /api/agent/queue - 获取队列信息
   */
  async _handleGetQueueInfo(req) {
  try {
    const queueInfo = this.agent.getQueueInfo();
    return {
    statusCode: 200,
    body: {
      success: true,
      data: queueInfo,
    },
    };
  } catch (error) {
    return {
    statusCode: 500,
    body: {
      success: false,
      error: error.message,
    },
    };
  }
  }

  /**
   * POST /api/agent/tasks - 添加单个任务
   */
  async _handleAddTask(req) {
  try {
    if (!req.body || typeof req.body !== 'object') {
    return {
      statusCode: 400,
      body: {
      success: false,
      error: '请求体必须是有效的 JSON 对象',
      },
    };
    }

    // 验证必填字段
    if (!req.body.name) {
    return {
      statusCode: 400,
      body: {
      success: false,
      error: '字段 "name" 是必填的',
      },
    };
    }

    const task = this.agent.addTask(req.body);

    return {
    statusCode: 201,
    body: {
      success: true,
      data: task.getInfo(),
    },
    };
  } catch (error) {
    return {
    statusCode: 500,
    body: {
      success: false,
      error: error.message,
    },
    };
  }
  }

  /**
   * POST /api/agent/tasks/batch - 批量添加任务
   */
  async _handleBatchAddTasks(req) {
  try {
    if (!Array.isArray(req.body)) {
    return {
      statusCode: 400,
      body: {
      success: false,
      error: '请求体必须是数组',
      },
    };
    }

    const tasks = this.agent.addTasks(req.body);
    const taskInfos = tasks.map(t => t.getInfo());

    return {
    statusCode: 201,
    body: {
      success: true,
      data: taskInfos,
    },
    };
  } catch (error) {
    return {
    statusCode: 500,
    body: {
      success: false,
      error: error.message,
    },
    };
  }
  }

  /**
   * POST /api/agent/tasks/:id/execute - 执行任务
   */
  async _handleExecuteTask(req) {
  try {
    const taskId = req.params.id;

    if (!taskId) {
    return {
      statusCode: 400,
      body: {
      success: false,
      error: '参数 "id" 是必填的',
      },
    };
    }

    const task = this.agent.queue.getTask(taskId);

    if (!task) {
    return {
      statusCode: 404,
      body: {
      success: false,
      error: `任务 ${taskId} 不存在`,
      },
    };
    }

    const result = await this.agent.executeTask(task);

    return {
    statusCode: 200,
    body: {
      success: true,
      data: {
      taskId: task.id,
      result,
      },
    },
    };
  } catch (error) {
    return {
    statusCode: 500,
    body: {
      success: false,
      error: error.message,
    },
    };
  }
  }

  /**
   * GET /api/agent/tasks/:id - 获取任务信息
   */
  async _handleGetTask(req) {
  try {
    const taskId = req.params.id;

    if (!taskId) {
    return {
      statusCode: 400,
      body: {
      success: false,
      error: '参数 "id" 是必填的',
      },
    };
    }

    const task = this.agent.queue.getTask(taskId);

    if (!task) {
    return {
      statusCode: 404,
      body: {
      success: false,
      error: `任务 ${taskId} 不存在`,
      },
    };
    }

    return {
    statusCode: 200,
    body: {
      success: true,
      data: task.getInfo(),
    },
    };
  } catch (error) {
    return {
    statusCode: 500,
    body: {
      success: false,
      error: error.message,
    },
    };
  }
  }

  /**
   * POST /api/agent/start - 启动 Agent
   */
  async _handleStartAgent(req) {
  try {
    this.agent.start();

    return {
    statusCode: 200,
    body: {
      success: true,
      message: 'Agent started',
    },
    };
  } catch (error) {
    return {
    statusCode: 500,
    body: {
      success: false,
      error: error.message,
    },
    };
  }
  }

  /**
   * POST /api/agent/stop - 停止 Agent
   */
  async _handleStopAgent(req) {
  try {
    this.agent.stop();

    return {
    statusCode: 200,
    body: {
      success: true,
      message: 'Agent stopped',
    },
    };
  } catch (error) {
    return {
    statusCode: 500,
    body: {
      success: false,
      error: error.message,
    },
    };
  }
  }

  /**
   * POST /api/agent/pause - 暂停 Agent
   */
  async _handlePauseAgent(req) {
  try {
    this.agent.pause();

    return {
    statusCode: 200,
    body: {
      success: true,
      message: 'Agent paused',
    },
    };
  } catch (error) {
    return {
    statusCode: 500,
    body: {
      success: false,
      error: error.message,
    },
    };
  }
  }

  /**
   * POST /api/agent/resume - 恢复 Agent
   */
  async _handleResumeAgent(req) {
  try {
    this.agent.resume();

    return {
    statusCode: 200,
    body: {
      success: true,
      message: 'Agent resumed',
    },
    };
  } catch (error) {
    return {
    statusCode: 500,
    body: {
      success: false,
      error: error.message,
    },
    };
  }
  }

  /**
   * POST /api/agent/clear - 清空队列
   */
  async _handleClearQueue(req) {
  try {
    this.agent.queue.clear();

    return {
    statusCode: 200,
    body: {
      success: true,
      message: 'Queue cleared',
    },
    };
  } catch (error) {
    return {
    statusCode: 500,
    body: {
      success: false,
      error: error.message,
    },
    };
  }
  }
}

module.exports = { APIGateway };
