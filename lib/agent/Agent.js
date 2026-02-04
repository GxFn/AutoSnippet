/**
 * Agent - 智能代理系统
 * 
 * 功能：
 * - 任务执行和调度
 * - Hub 协作与数据流
 * - 异步工作流管理
 * - 错误处理和重试
 * - 性能监控与统计
 */

const { Task, TaskQueue } = require('./Task');

class Agent {
  constructor(options = {}) {
    this.id = options.id || Math.random().toString(36).substr(2, 9);
    this.name = options.name || 'Agent';
    this.description = options.description || '';
    
    // 任务队列
    this.queue = new TaskQueue({ maxConcurrent: options.maxConcurrent || 5 });
    
    // 注册的 Hub
    this.hubs = new Map(); // name -> hub instance
    
    // 执行状态
    this.state = 'idle'; // idle, running, paused, stopped
    this.isRunning = false;
    
    // 统计信息
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      totalDuration: 0,
      avgDuration: 0,
      startTime: null,
      endTime: null
    };
    
    // 消息回调
    this.listeners = new Map(); // event -> handlers[]
  }

  /**
   * 注册 Hub
   */
  registerHub(name, hub) {
    this.hubs.set(name, hub);
    return this;
  }

  /**
   * 获取已注册的 Hub
   */
  getHub(name) {
    return this.hubs.get(name) || null;
  }

  /**
   * 获取所有 Hub
   */
  getAllHubs() {
    return Array.from(this.hubs.entries());
  }

  /**
   * 添加任务
   */
  addTask(options = {}) {
    const task = new Task(options);
    this.queue.enqueue(task);
    this.stats.totalTasks++;
    this._emit('task:added', { taskId: task.id, taskName: task.name });
    return task;
  }

  /**
   * 添加多个任务
   */
  addTasks(tasksList) {
    const tasks = [];
    for (const taskOptions of tasksList) {
      const task = this.addTask(taskOptions);
      tasks.push(task);
    }
    return tasks;
  }

  /**
   * 执行单个任务
   */
  async executeTask(task) {
    try {
      this._emit('task:start', { taskId: task.id });
      task.start();

      // 设置超时
      const result = await Promise.race([
        this._executeTaskHandler(task),
        this._timeout(task.timeout)
      ]);

      task.complete(result);
      this.stats.completedTasks++;
      this._emit('task:completed', { taskId: task.id, result });

      return result;
    } catch (error) {
      task.fail(error);

      if (task.shouldRetry()) {
        this._emit('task:retry', { taskId: task.id, retriesRemaining: task.retriesRemaining });
        // 重新加入队列
        this.queue.enqueue(task);
      } else {
        this.stats.failedTasks++;
        this._emit('task:failed', { taskId: task.id, error: error.message });
      }

      throw error;
    }
  }

  /**
   * 执行任务处理器
   */
  async _executeTaskHandler(task) {
    if (task.handler && typeof task.handler === 'function') {
      return await task.handler.call(this, task.params, this.hubs);
    }

    // 使用内置处理器
    switch (task.type) {
      case 'recipe':
        return this._handleRecipeTask(task);
      case 'search':
        return this._handleSearchTask(task);
      case 'metric':
        return this._handleMetricTask(task);
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
  }

  /**
   * 处理 Recipe 任务
   */
  async _handleRecipeTask(task) {
    const hub = this.getHub('recipe');
    if (!hub) throw new Error('RecipeHub not registered');

    const { action, ...params } = task.params;

    switch (action) {
      case 'create':
        return hub.create(params);
      case 'update':
        return hub.get(params.id).update(params.content, params);
      case 'publish':
        return hub.get(params.id).publish();
      default:
        throw new Error(`Unknown recipe action: ${action}`);
    }
  }

  /**
   * 处理搜索任务
   */
  async _handleSearchTask(task) {
    const hub = this.getHub('search');
    if (!hub) throw new Error('SearchHub not registered');

    const { action, ...params } = task.params;

    switch (action) {
      case 'index':
        return hub.index(params.doc);
      case 'search':
        return hub.search(params.query, params.options);
      case 'searchKeyword':
        return hub.searchKeyword(params.query, params.options);
      case 'searchSemantic':
        return hub.searchSemantic(params.query, params.options);
      default:
        throw new Error(`Unknown search action: ${action}`);
    }
  }

  /**
   * 处理指标任务
   */
  async _handleMetricTask(task) {
    const hub = this.getHub('metrics');
    if (!hub) throw new Error('MetricsHub not registered');

    const { action, ...params } = task.params;

    switch (action) {
      case 'record':
        return hub.record(params.name, params.value, params.tags, params.unit);
      case 'gauge':
        return hub.gauge(params.name, params.value, params.tags, params.unit);
      case 'counter':
        return hub.counter(params.name, params.delta, params.tags);
      case 'histogram':
        return hub.histogram(params.name, params.value, params.tags, params.unit);
      default:
        throw new Error(`Unknown metric action: ${action}`);
    }
  }

  /**
   * 启动 Agent（开始执行队列中的任务）
   */
  async start() {
    if (this.isRunning) return;

    this.state = 'running';
    this.isRunning = true;
    this.stats.startTime = new Date().toISOString();

    this._emit('agent:started', {
      agentId: this.id,
      agentName: this.name
    });

    while (this.isRunning) {
      // 检查并发限制
      const running = this.queue.getRunning();
      if (running.length >= this.queue.maxConcurrent) {
        await this._sleep(100);
        continue;
      }

      // 获取下一个任务
      const task = this.queue.dequeue();
      if (!task) {
        // 队列为空且没有运行中的任务，等待
        if (running.length === 0) {
          await this._sleep(100);
        } else {
          await this._sleep(100);
        }
        continue;
      }

      // 执行任务（异步，不阻塞）
      this.executeTask(task).catch(err => {
        // 错误已在 executeTask 中处理
      });
    }

    this.state = 'idle';
    this.stats.endTime = new Date().toISOString();

    if (this.stats.completedTasks > 0) {
      this.stats.avgDuration = this.stats.totalDuration / this.stats.completedTasks;
    }

    this._emit('agent:stopped', {
      agentId: this.id,
      stats: this.getStats()
    });
  }

  /**
   * 停止 Agent
   */
  stop() {
    this.isRunning = false;
    this.state = 'stopped';
    return this;
  }

  /**
   * 暂停 Agent
   */
  pause() {
    this.state = 'paused';
    return this;
  }

  /**
   * 继续运行 Agent
   */
  resume() {
    if (this.state === 'paused') {
      this.state = 'running';
    }
    return this;
  }

  /**
   * 事件监听
   */
  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(handler);
    return this;
  }

  /**
   * 事件发送
   */
  _emit(event, data) {
    const handlers = this.listeners.get(event) || [];
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (error) {
        // 忽略监听器错误
      }
    }
  }

  /**
   * 获取队列信息
   */
  getQueueInfo() {
    return this.queue.getInfo();
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const queueStats = this.queue.getStats();
    return {
      ...this.stats,
      ...queueStats,
      state: this.state
    };
  }

  /**
   * 获取 Agent 信息
   */
  getInfo() {
    return {
      id: this.id,
      name: this.name,
      state: this.state,
      stats: this.getStats(),
      hubs: Array.from(this.hubs.keys()),
      queue: this.getQueueInfo()
    };
  }

  /**
   * 内部：延迟执行
   */
  async _timeout(ms) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Task timeout after ${ms}ms`)), ms);
    });
  }

  /**
   * 内部：睡眠
   */
  async _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 内部：记录任务持续时间
   */
  _recordDuration(duration) {
    this.stats.totalDuration += duration;
  }

  /**
   * 清空队列
   */
  clear() {
    this.queue.clear();
    return this;
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      totalDuration: 0,
      avgDuration: 0,
      startTime: null,
      endTime: null
    };
    return this;
  }
}

module.exports = {
  Agent
};
