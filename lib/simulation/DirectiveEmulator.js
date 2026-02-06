/**
 * DirectiveEmulator
 * 
 * 职责：
 * - 模拟 DirectiveDetector 的功能
 * - 检测并解析 MarkerLine（// as:search, // as:create, // as:audit）
 * - 支持多种方言（// as:*, // autosnippet:*, etc）
 * - 返回规范化的指令对象
 */

class DirectiveEmulator {
  constructor(options = {}) {
    this.logger = options.logger || console;
    
    // 支持的指令及其别名
    this.DIRECTIVES = {
      SEARCH: {
        names: ['search', 's'],
        patterns: [/\/\/\s*as:search\s*(.*?)(?=\n|$)/, /\/\/\s*as:s\s*(.*?)(?=\n|$)/]
      },
      CREATE: {
        names: ['create', 'c'],
        patterns: [/\/\/\s*as:create\s*(.*?)(?=\n|$)/, /\/\/\s*as:c\s*(.*?)(?=\n|$)/]
      },
      AUDIT: {
        names: ['audit', 'a'],
        patterns: [/\/\/\s*as:audit\s*(.*?)(?=\n|$)/, /\/\/\s*as:a\s*(.*?)(?=\n|$)/]
      }
    };
  }

  /**
   * 扫描文件内容，检测所有 MarkerLine
   * @param {string} fileContent - 文件内容
   * @param {string} filePath - 文件路径（用于调试）
   * @returns {array} - 指令数组
   */
  scan(fileContent, filePath = '') {
    if (!fileContent) return [];
    
    const directives = [];
    const lines = fileContent.split('\n');
    
    lines.forEach((line, lineIndex) => {
      const directive = this._parseLine(line, lineIndex, filePath);
      if (directive) {
        directives.push(directive);
      }
    });
    
    return directives;
  }

  /**
   * 检测单行是否包含 MarkerLine
   * @param {string} line - 行内容
   * @param {number} lineNumber - 行号（0-based）
   * @param {string} filePath - 文件路径
   * @returns {object | null}
   */
  _parseLine(line, lineNumber = 0, filePath = '') {
    if (!line.includes('//') || !line.includes('as:')) {
      return null;
    }

    const trimmed = line.trim();
    
    // 检查 SEARCH 指令
    for (const pattern of this.DIRECTIVES.SEARCH.patterns) {
      const match = line.match(pattern);
      if (match) {
        return {
          type: 'SEARCH',
          shortType: 's',
          keyword: (match[1] || '').trim(),
          lineNumber,
          markerLine: trimmed,
          filePath,
          fullLine: line
        };
      }
    }
    
    // 检查 CREATE 指令
    for (const pattern of this.DIRECTIVES.CREATE.patterns) {
      const match = line.match(pattern);
      if (match) {
        return {
          type: 'CREATE',
          shortType: 'c',
          lineNumber,
          markerLine: trimmed,
          filePath,
          fullLine: line
        };
      }
    }
    
    // 检查 AUDIT 指令
    for (const pattern of this.DIRECTIVES.AUDIT.patterns) {
      const match = line.match(pattern);
      if (match) {
        return {
          type: 'AUDIT',
          shortType: 'a',
          keyword: (match[1] || '').trim(),
          lineNumber,
          markerLine: trimmed,
          filePath,
          fullLine: line
        };
      }
    }
    
    return null;
  }

  /**
   * 生成 MarkerLine（反向操作）
   * @param {string} type - 指令类型 ('SEARCH', 'CREATE', 'AUDIT')
   * @param {string} keyword - 关键字（可选）
   * @returns {string}
   */
  generate(type, keyword = '') {
    const typeUpper = type.toUpperCase();
    
    if (!this.DIRECTIVES[typeUpper]) {
      throw new Error(`Unknown directive type: ${type}`);
    }
    
    if (keyword) {
      return `// as:${this.DIRECTIVES[typeUpper].names[0]} ${keyword}`;
    } else {
      return `// as:${this.DIRECTIVES[typeUpper].names[0]}`;
    }
  }

  /**
   * 验证指令是否有效
   * @param {object} directive - 指令对象
   * @returns {object} - { valid: boolean, errors: [] }
   */
  validate(directive) {
    const errors = [];
    
    if (!directive.type) {
      errors.push('Missing directive type');
    }
    
    if (!['SEARCH', 'CREATE', 'AUDIT'].includes(directive.type)) {
      errors.push(`Invalid directive type: ${directive.type}`);
    }
    
    if (directive.type === 'SEARCH' && !directive.keyword) {
      errors.push('SEARCH directive requires a keyword');
    }
    
    if (directive.lineNumber === undefined || directive.lineNumber < 0) {
      errors.push('Invalid lineNumber');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 规范化指令对象（填充缺失字段）
   * @param {object} directive
   * @returns {object}
   */
  normalize(directive) {
    return {
      type: directive.type || 'UNKNOWN',
      shortType: directive.shortType || '',
      keyword: directive.keyword || null,
      lineNumber: directive.lineNumber ?? -1,
      markerLine: directive.markerLine || '',
      filePath: directive.filePath || '',
      fullLine: directive.fullLine || directive.markerLine || '',
      timestamp: directive.timestamp || Date.now()
    };
  }

  /**
   * 从文本中提取关键字
   * @param {string} text - 包含关键字的文本
   * @returns {string}
   */
  extractKeyword(text) {
    if (!text) return '';
    
    // 移除注释符号，只保留关键字部分
    return text
      .replace(/^\/\/\s*as:[a-z]+\s*/, '')
      .replace(/^\/\/\s*as:[a-z]\s*/, '')
      .trim();
  }

  /**
   * 解析完整的指令行（包含上下文）
   * @param {string} fileContent - 文件内容
   * @param {number} lineNumber - 指令所在行号
   * @param {number} contextLines - 上下文行数（前后各几行）
   * @returns {object}
   */
  parseWithContext(fileContent, lineNumber, contextLines = 3) {
    const lines = fileContent.split('\n');
    const directive = this._parseLine(lines[lineNumber] || '', lineNumber);
    
    if (!directive) return null;
    
    const startLine = Math.max(0, lineNumber - contextLines);
    const endLine = Math.min(lines.length - 1, lineNumber + contextLines);
    
    directive.context = {
      before: lines.slice(startLine, lineNumber),
      after: lines.slice(lineNumber + 1, endLine + 1),
      fullContext: lines.slice(startLine, endLine + 1)
    };
    
    return directive;
  }

  /**
   * 获取所有支持的指令类型
   */
  getSupportedDirectives() {
    return Object.keys(this.DIRECTIVES);
  }

  /**
   * 检查文本是否包含任何 MarkerLine
   */
  hasDirective(text) {
    return !!(text && (
      text.includes('// as:search') ||
      text.includes('// as:s') ||
      text.includes('// as:create') ||
      text.includes('// as:c') ||
      text.includes('// as:audit') ||
      text.includes('// as:a')
    ));
  }

  /**
   * 移除指令行
   * @param {string} fileContent - 文件内容
   * @param {number} lineNumber - 行号
   * @returns {string}
   */
  removeDirectiveLine(fileContent, lineNumber) {
    const lines = fileContent.split('\n');
    
    if (lineNumber < 0 || lineNumber >= lines.length) {
      return fileContent;
    }
    
    lines.splice(lineNumber, 1);
    return lines.join('\n');
  }

  /**
   * 替换指令行中的关键字
   * @param {string} line - 指令行
   * @param {string} newKeyword - 新关键字
   * @returns {string}
   */
  updateKeyword(line, newKeyword) {
    // 识别指令类型
    for (const [type, config] of Object.entries(this.DIRECTIVES)) {
      for (const pattern of config.patterns) {
        if (pattern.test(line)) {
          const baseName = config.names[0];
          
          if (newKeyword) {
            return line.replace(
              pattern,
              `// as:${baseName} ${newKeyword}`
            );
          } else {
            return line.replace(
              pattern,
              `// as:${baseName}`
            );
          }
        }
      }
    }
    
    return line;
  }

  /**
   * 统计文件中的指令类型分布
   */
  getStats(fileContent) {
    const directives = this.scan(fileContent);
    const stats = {
      total: directives.length,
      SEARCH: 0,
      CREATE: 0,
      AUDIT: 0
    };
    
    directives.forEach(d => {
      if (d.type in stats) {
        stats[d.type]++;
      }
    });
    
    stats.byLine = directives.map(d => ({
      type: d.type,
      line: d.lineNumber,
      keyword: d.keyword
    }));
    
    return stats;
  }
}

module.exports = DirectiveEmulator;
