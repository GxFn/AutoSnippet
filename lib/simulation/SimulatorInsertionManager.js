/**
 * SimulatorInsertionManager - 模拟器代码插入管理
 * 
 * 职责：
 * - 存储模拟器搜索结果的插入指令
 * - SearchHandler 将代码写入这里
 * - 模拟器前端读取并在编辑器中插入
 */

class SimulatorInsertionManager {
  constructor() {
    this.insertions = new Map(); // sessionId -> insertionData
    this.sessionTimeout = 60000; // 60秒超时
  }

  /**
   * 记录插入数据（从 SearchHandler 调用）
   * @param {string} sessionId - 会话 ID
   * @param {string} code - 要插入的代码
   * @param {array} headers - 头文件
   * @param {object} metadata - 额外的元数据
   * @returns {boolean} 是否记录成功
   */
  recordInsertion(sessionId, code, headers = [], metadata = {}) {
    if (!sessionId) {
      console.warn(`[SimulatorInsertion] sessionId 不能为空`);
      return false;
    }

    const insertionData = {
      code,
      headers,
      metadata,
      recordedAt: Date.now()
    };

    if (process.env.ASD_DEBUG === '1') {
      console.log(`[SimulatorInsertion] 记录插入: ${sessionId}`);
      console.log(`  代码行数: ${code.split('\n').length}`);
      console.log(`  头文件数: ${headers.length}`);
    }

    // 存储插入数据
    this.insertions.set(sessionId, insertionData);

    // 设置超时自动删除
    setTimeout(() => {
      if (this.insertions.has(sessionId)) {
        this.insertions.delete(sessionId);
        if (process.env.ASD_DEBUG === '1') {
          console.log(`[SimulatorInsertion] 会话已过期并删除: ${sessionId}`);
        }
      }
    }, this.sessionTimeout);

    return true;
  }

  /**
   * 获取插入数据
   * @param {string} sessionId - 会话 ID
   * @returns {object|null} 插入数据或 null
   */
  getInsertion(sessionId) {
    if (!sessionId) return null;
    const data = this.insertions.get(sessionId);
    if (data) {
      // 获取后立即删除，只能使用一次
      this.insertions.delete(sessionId);
    }
    return data;
  }

  /**
   * 清理会话
   * @param {string} sessionId - 会话 ID
   */
  clearSession(sessionId) {
    this.insertions.delete(sessionId);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      activeSessions: this.insertions.size
    };
  }
}

// 单例实例
module.exports = new SimulatorInsertionManager();
