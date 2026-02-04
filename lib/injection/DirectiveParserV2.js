/**
 * DirectiveParserV2 - 指令解析服务 V2
 * 
 * 职责：
 * - 解析 autosnippet 指令（include/import）
 * - 提供 ObjC/Swift 头文件指令解析为结构化对象
 * - 提供指令行判断功能
 * 
 * @class DirectiveParserV2
 */

const triggerSymbol = require('../infrastructure/config/TriggerSymbol.js');

/**
 * 指令解析器 V2
 * 
 * 使用示例：
 * ```javascript
 * const parser = new DirectiveParserV2();
 * 
 * // 解析指令行
 * const result = parser.parse('// as:include <Module/Header.h> path/to/file.h');
 * 
 * // 判断是否为指令
 * if (parser.isDirective(line)) {
 *   // 处理指令
 * }
 * 
 * // 创建 header 对象
 * const header = parser.createHeader(line);
 * ```
 */
class DirectiveParserV2 {
  constructor(config = {}) {
    this.config = this._parseConfig(config);
    this.logger = this._createLogger();
    
    // 指令标记常量
    this.MARKS = {
      INCLUDE_LONG: '// autosnippet:include ',
      IMPORT_LONG: '// autosnippet:import ',
      INCLUDE_SHORT: '// as:include ',
      IMPORT_SHORT: '// as:import '
    };
    
    // ObjC 头文件名正则（支持 +、-、. 等字符）
    this.HEADER_PATTERN = /^<([A-Za-z0-9_]+)\/([A-Za-z0-9_+.-]+\.h)>(?:\s+(.+))?$/;
  }

  // ============ Public API ============

  /**
   * 解析指令行
   * 
   * @param {string} line - 指令行
   * @returns {Object} 解析结果 { kind: 'include'|'import'|'unknown', content: string }
   */
  parse(line) {
    try {
      const normalized = this._normalize(line);
      
      if (normalized.startsWith(this.MARKS.INCLUDE_LONG)) {
        return {
          kind: 'include',
          content: normalized.slice(this.MARKS.INCLUDE_LONG.length).trim()
        };
      }
      
      if (normalized.startsWith(this.MARKS.IMPORT_LONG)) {
        return {
          kind: 'import',
          content: normalized.slice(this.MARKS.IMPORT_LONG.length).trim()
        };
      }
      
      if (normalized.startsWith(this.MARKS.INCLUDE_SHORT)) {
        return {
          kind: 'include',
          content: normalized.slice(this.MARKS.INCLUDE_SHORT.length).trim()
        };
      }
      
      if (normalized.startsWith(this.MARKS.IMPORT_SHORT)) {
        return {
          kind: 'import',
          content: normalized.slice(this.MARKS.IMPORT_SHORT.length).trim()
        };
      }
      
      return { kind: 'unknown', content: normalized };
    } catch (e) {
      this.logger.error('解析指令行失败', { line, error: e.message });
      return { kind: 'unknown', content: '' };
    }
  }

  /**
   * 判断是否为指令标记行
   * 
   * @param {string} line - 行内容
   * @returns {boolean}
   */
  isDirective(line) {
    try {
      const normalized = this._normalize(line);
      return normalized.startsWith(this.MARKS.INCLUDE_LONG) ||
             normalized.startsWith(this.MARKS.IMPORT_LONG) ||
             normalized.startsWith(this.MARKS.INCLUDE_SHORT) ||
             normalized.startsWith(this.MARKS.IMPORT_SHORT);
    } catch (e) {
      return false;
    }
  }

  /**
   * 创建 header 对象
   * 
   * @param {string} headerLine - 头文件指令行
   * @returns {Object|null} header 对象，如果解析失败返回 null
   *   @returns {string} name - 完整名称 <Module/Header.h>
   *   @returns {string} specName - 规格名称
   *   @returns {string} moduleName - 模块名
   *   @returns {string} headerName - 头文件名
   *   @returns {string} moduleStrName - 模块字符串名 "Module.h"
   *   @returns {string} headerStrName - 头文件字符串名 "Header.h"
   *   @returns {string|null} headRelativePathFromMark - 相对路径（如果有）
   */
  createHeader(headerLine) {
    try {
      const parsed = this.parse(headerLine);
      const content = parsed?.content || '';
      
      // 匹配 <Module/Header.h> 以及可选的相对路径
      const match = content.match(this.HEADER_PATTERN);
      if (!match) {
        this.logger.warn('无法匹配 header 格式', { content });
        return null;
      }
      
      const moduleName = match[1];
      const headerName = match[2];
      const headRelativePathFromMark = match[3] || null;
      
      return {
        name: `<${moduleName}/${headerName}>`,
        specName: `<${moduleName}/${headerName}>`,
        moduleName,
        headerName,
        moduleStrName: `"${moduleName}.h"`,
        headerStrName: `"${headerName}"`,
        headRelativePathFromMark
      };
    } catch (e) {
      this.logger.error('创建 header 失败', { headerLine, error: e.message });
      return null;
    }
  }

  /**
   * 获取指令标记常量
   * 
   * @returns {Object} 标记常量对象
   */
  getMarks() {
    return { ...this.MARKS };
  }

  // ============ Private Methods ============

  /**
   * 规范化指令行（去掉触发符前缀）
   */
  _normalize(line) {
    const s = String(line || '').trim();
    return triggerSymbol.stripTriggerPrefix(s);
  }

  /**
   * 解析配置
   */
  _parseConfig(config) {
    return {
      debug: config.debug || false,
      ...config
    };
  }

  /**
   * 创建日志记录器
   */
  _createLogger() {
    const debug = process.env.DEBUG && process.env.DEBUG.includes('DirectiveParserV2');
    return {
      log: (msg, data) => debug && console.log(`[DirectiveParserV2] ✓ ${msg}`, data || ''),
      warn: (msg, data) => console.warn(`[DirectiveParserV2] ⚠️ ${msg}`, data || ''),
      error: (msg, data) => console.error(`[DirectiveParserV2] ❌ ${msg}`, data || '')
    };
  }
}

module.exports = DirectiveParserV2;
