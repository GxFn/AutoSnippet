/**
 * MarkerLineV2 - 标记行转换服务
 * 
 * 职责：
 * - 将导入/include 语句转换为标记行格式
 * - 支持 Swift 和 Objective-C 格式
 * 
 * @class MarkerLineV2
 */

const path = require('path');

class MarkerLineV2 {
  constructor(projectRoot, config = {}) {
    this.projectRoot = projectRoot;
    this.config = this._parseConfig(config);
    this.logger = this._createLogger();
  }

  // ============ Public API ============

  /**
   * 转换为标记行
   * @param {string} headerStr - 导入语句
   * @param {boolean} isSwift - 是否 Swift
   * @param {string} relativePath - 相对路径
   * @param {string} moduleName - 模块名
   * @returns {string} 标记行
   */
  toAsMarkerLine(headerStr, isSwift, relativePath, moduleName) {
    try {
      return this._convertToMarkerLine(headerStr, isSwift, relativePath, moduleName);
    } catch (e) {
      this.logger.error('Convert to marker line failed', { headerStr, error: e.message });
      return '';
    }
  }

  /**
   * 批量转换标记行
   * @param {Array<Object>} headers - 导入列表
   * @param {boolean} isSwift - 是否 Swift
   * @returns {Array<string>} 标记行列表
   */
  toAsMarkerLines(headers, isSwift) {
    try {
      if (!Array.isArray(headers)) return [];
      return headers.map(h => 
        this._convertToMarkerLine(h.content, isSwift, h.path, h.module)
      );
    } catch (e) {
      this.logger.error('Convert headers failed', { count: headers.length, error: e.message });
      return [];
    }
  }

  /**
   * 从标记行提取信息
   * @param {string} markerLine - 标记行
   * @returns {Object} 解析结果
   */
  parseMarkerLine(markerLine) {
    try {
      const line = String(markerLine || '').trim();
      if (!line.startsWith('// as:')) {
        return null;
      }

      const match = line.match(/\/\/\s*as:(\w+)\s+(.*)/);
      if (!match) return null;

      return {
        type: match[1], // 'import' 或 'include'
        content: match[2].trim(),
        raw: line
      };
    } catch (e) {
      this.logger.error('Parse marker line failed', { error: e.message });
      return null;
    }
  }

  /**
   * 验证是否为标记行
   * @param {string} line - 代码行
   * @returns {boolean}
   */
  isMarkerLine(line) {
    try {
      return /^\/\/\s*as:(import|include)/.test(String(line || ''));
    } catch (e) {
      return false;
    }
  }

  /**
   * 获取标记行类型
   * @param {string} markerLine - 标记行
   * @returns {string} 'import' 或 'include'
   */
  getMarkerType(markerLine) {
    try {
      const parsed = this.parseMarkerLine(markerLine);
      return parsed ? parsed.type : null;
    } catch (e) {
      return null;
    }
  }

  // ============ Private Methods ============

  /**
   * 解析配置
   * @private
   */
  _parseConfig(config) {
    return {
      angleFormat: config.angleFormat || false,
      ...config
    };
  }

  /**
   * 创建日志器
   * @private
   */
  _createLogger() {
    const debug = process.env.DEBUG && process.env.DEBUG.includes('MarkerLineV2');
    return {
      log: (msg, data) => debug && console.log(`[MarkerLineV2] ✓ ${msg}`, data || ''),
      warn: (msg, data) => console.warn(`[MarkerLineV2] ⚠️ ${msg}`, data || ''),
      error: (msg, data) => console.error(`[MarkerLineV2] ❌ ${msg}`, data || '')
    };
  }

  /**
   * 转换为标记行的核心逻辑
   * @private
   */
  _convertToMarkerLine(headerStr, isSwift, relativePath, moduleName) {
    const s = String(headerStr || '').trim();
    if (!s) return '';

    const pathPart = (relativePath && String(relativePath).trim()) ? ` ${String(relativePath).trim()}` : '';

    // Swift 处理
    if (isSwift) {
      const m = s.match(/^import\s+(.+)$/);
      return m ? `// as:import ${m[1].trim()}${pathPart}` : `// as:import ${s}${pathPart}`;
    }

    // Objective-C 处理
    // 尖括号格式: #import <Foundation/Foundation.h>
    const angle = s.match(/#import\s+<([^>]+)>/);
    if (angle) return `// as:include <${angle[1]}>${pathPart}`;

    // 引号格式: #import "MyHeader.h"
    const quote = s.match(/#import\s+"([^"]+)"/);
    if (quote) {
      const fileName = path.basename(quote[1], '.h') + '.h';
      if (moduleName) return `// as:include <${moduleName}/${fileName}>${pathPart}`;
      return `// as:include "${quote[1]}"${pathPart}`;
    }

    // 已是尖括号格式
    if (s.startsWith('<') && s.includes('>')) {
      return `// as:include ${s}${pathPart}`;
    }

    // 默认处理
    return `// as:include ${s}${pathPart}`;
  }
}

module.exports = MarkerLineV2;
