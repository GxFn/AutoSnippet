/**
 * EventBus - 事件总线
 * 用于服务间解耦通信
 */

const EventEmitter = require('events');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.maxListeners = 20;
    this.setMaxListeners(this.maxListeners);
    this.eventHistory = [];
    this.historyLimit = 100;
  }

  /**
   * 发射事件
   * @param {string} eventName - 事件名称
   * @param {...any} args - 事件参数
   * @returns {boolean} 是否有监听者处理
   */
  emit(eventName, ...args) {
    // 记录到历史
    this.recordEvent(eventName, args);

    return super.emit(eventName, ...args);
  }

  /**
   * 异步发射事件（等待所有监听者完成）
   * @param {string} eventName - 事件名称
   * @param {...any} args - 事件参数
   * @returns {Promise<void>}
   */
  async emitAsync(eventName, ...args) {
    this.recordEvent(eventName, args);

    const listeners = this.listeners(eventName);
    
    for (const listener of listeners) {
      try {
        const result = listener(...args);
        if (result instanceof Promise) {
          await result;
        }
      } catch (error) {
        this.emit('error', error, eventName);
        throw error;
      }
    }
  }

  /**
   * 记录事件到历史
   * @private
   */
  recordEvent(eventName, args) {
    if (this.historyLimit > 0) {
      this.eventHistory.push({
        name: eventName,
        args: args,
        timestamp: Date.now()
      });

      // 保持历史记录大小
      if (this.eventHistory.length > this.historyLimit) {
        this.eventHistory.shift();
      }
    }
  }

  /**
   * 获取事件历史
   * @param {number} [limit=10] - 返回最近的条数
   * @returns {Array}
   */
  getHistory(limit = 10) {
    return this.eventHistory.slice(-limit);
  }

  /**
   * 清空事件历史
   */
  clearHistory() {
    this.eventHistory = [];
  }

  /**
   * 设置历史记录限制
   * @param {number} limit - 限制条数（0 表示不记录）
   */
  setHistoryLimit(limit) {
    this.historyLimit = limit;
  }

  /**
   * 获取所有监听的事件名称
   * @returns {string[]}
   */
  getEventNames() {
    return Array.from(super.eventNames());
  }

  /**
   * 获取特定事件的监听者数量
   * @param {string} eventName - 事件名称
   * @returns {number}
   */
  getListenerCount(eventName) {
    return this.listenerCount(eventName);
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      events: this.getEventNames().length,
      totalListeners: this.eventNames()
        .reduce((sum, event) => sum + this.listenerCount(event), 0),
      historySize: this.eventHistory.length
    };
  }
}

module.exports = EventBus;
