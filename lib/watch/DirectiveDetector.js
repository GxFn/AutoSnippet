/**
 * DirectiveDetector - 指令检测器
 */

const triggerSymbol = require('../infrastructure/config/TriggerSymbol');

class DirectiveDetector {
  constructor() {
    this.MARKS = {
      HEADER_INCLUDE: '// autosnippet:include ',
      HEADER_IMPORT: '// autosnippet:import ',
      HEADER_INCLUDE_SHORT: '// as:include ',
      HEADER_IMPORT_SHORT: '// as:import ',
      CREATE_SHORT: '// as:create',
      CREATE_ALIAS: '// as:c',
      AUDIT_SHORT: '// as:audit',
      AUDIT_ALIAS: '// as:a',
      SEARCH_SHORT: '// as:search',
      SEARCH_LONG: '// autosnippet:search',
      SEARCH_ALIAS: '// as:s',
      ALINK: 'alink'
    };

    this.REGEX = {
      CREATE_LINE: /^\/\/\s*as:(?:create|c)(?:\s+(-[cf]))?\s*$/,
      CREATE_REMOVE: /^@?\s*\/\/\s*as:(?:create|c)(?:\s+-[cf])?\s*\r?\n?/gm,
      HEADER_OBJC: /^@?\/\/\s*(?:autosnippet|as):include\s+(?:<([A-Za-z0-9_]+)\/([A-Za-z0-9_+.-]+\.h)>|"([A-Za-z0-9_+./-]+\.h)")(\s+.+)?$/,
      HEADER_SWIFT: /^@?\/\/\s*(?:autosnippet|as):import\s+\w+$/,
      IMPORT_OBJC: /^\#import\s*<[A-Za-z0-9_]+\/[A-Za-z0-9_+.-]+\.h>$/,
      IMPORT_SWIFT: /^import\s*\w+$/,
      SEARCH_MARK: /\/\/\s*(?:autosnippet|as):(?:search|s)(\s|$)/,
      DRAFT_FILE: /^_draft_.*\.md$/i
    };
    
    this.WELL_MARK = triggerSymbol.TRIGGER_SYMBOL;
    this.AT_MARK = triggerSymbol.TRIGGER_SYMBOL;
  }

  detectTriggers(data, filename) {
    const isSwift = filename.endsWith('.swift');
    const currImportReg = isSwift ? this.REGEX.IMPORT_SWIFT : this.REGEX.IMPORT_OBJC;
    const currHeaderReg = isSwift ? this.REGEX.HEADER_SWIFT : this.REGEX.HEADER_OBJC;

    const triggers = {
      importArray: [],
      headerLine: null,
      alinkLine: null,
      createLine: null,
      createOption: null,
      guardLine: null,
      searchLine: null,
      isSwift
    };

    const lines = data.split('\n');
    for (const line of lines) {
      const lineVal = line.trim();
      const normalizedLineVal = triggerSymbol.stripTriggerPrefix(lineVal);

      if (currImportReg.test(lineVal)) {
        triggers.importArray.push(lineVal);
      }

      if (this._isHeaderDirective(normalizedLineVal)) {
        triggers.headerLine = normalizedLineVal;
      }

      if (lineVal.startsWith(this.AT_MARK) && lineVal.endsWith(this.WELL_MARK + this.MARKS.ALINK)) {
        triggers.alinkLine = lineVal;
      }

      const createMatch = normalizedLineVal.match(this.REGEX.CREATE_LINE);
      if (createMatch) {
        triggers.createLine = lineVal;
        triggers.createOption = createMatch[1] === '-c' ? 'c' : (createMatch[1] === '-f' ? 'f' : null);
      }

      if (this._isGuardDirective(normalizedLineVal)) {
        triggers.guardLine = normalizedLineVal;
      }

      if (this._isSearchDirective(normalizedLineVal)) {
        triggers.searchLine = normalizedLineVal;
      }
    }

    return triggers;
  }

  _isHeaderDirective(line) {
    return line.startsWith(this.MARKS.HEADER_INCLUDE) || 
           line.startsWith(this.MARKS.HEADER_IMPORT) ||
           line.startsWith(this.MARKS.HEADER_INCLUDE_SHORT) || 
           line.startsWith(this.MARKS.HEADER_IMPORT_SHORT);
  }

  _isGuardDirective(line) {
    return line.startsWith(this.MARKS.AUDIT_SHORT) || 
           line.startsWith(this.MARKS.AUDIT_ALIAS);
  }

  _isSearchDirective(line) {
    return line.startsWith(this.MARKS.SEARCH_SHORT) || 
           line.startsWith(this.MARKS.SEARCH_LONG) || 
           line.startsWith(this.MARKS.SEARCH_ALIAS);
  }
}

module.exports = new DirectiveDetector();
