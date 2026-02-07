/**
 * HeaderHandler - 处理头文件注入
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const injection = require('../../injection/injectionService.js');
const AutomationOrchestrator = require('../../automation/AutomationOrchestrator');
const notifier = require('../../infrastructure/notification/Notifier');

const accessAsync = promisify(fs.access);
const readFileAsync = promisify(fs.readFile);

const automationOrchestrator = new AutomationOrchestrator();

class HeaderHandler {
  constructor() {
  this.importReg = /^\#import\s*<[A-Za-z0-9_]+\/[A-Za-z0-9_+.-]+\.h>$/;
  }

  async handle(specFile, updateFile, headerLine, importArray, isSwift) {
  return automationOrchestrator.run(
    {
    type: 'header',
    handler: (context) => this._handleHeader(context)
    },
    { specFile, updateFile, headerLine, importArray, isSwift }
  );
  }

  async handleHeadersBatch(specFile, updateFile, headersToInsert, options = {}) {
  const safeHeaders = Array.isArray(headersToInsert) ? headersToInsert : [];
  const isSwift = options.isSwift === true || updateFile.endsWith('.swift');
  const debug = options.debug === true;
  const suggestionNotes = [];
  const decisions = options.decisions || {};
  const preflight = options.preflight === true;

  if (debug) {
    console.log(`\n[HeaderDebug] 头文件处理:`);
    console.log(`   总共定义头文件: ${safeHeaders.length} 个`);
    if (safeHeaders.length > 0) {
    safeHeaders.forEach((h, idx) => {
      console.log(`      [${idx + 1}] ${h}`);
    });
    }
  }

  let headerInsertCount = 0;
  if (safeHeaders.length === 0) return { blocked: false, headerInsertCount, suggestionNotes, decisions };

  const importArray = this._collectImportsFromFile(updateFile, isSwift);
  if (!isSwift && !updateFile.endsWith('.h')) {
    await this._collectImportsFromHeaderFile(updateFile, importArray);
  }

  for (const header of safeHeaders) {
    try {
    if (debug) {
      console.log(`   处理头文件: ${header}`);
    }
    let directiveLine = header;
    if (isSwift) {
      directiveLine = header.replace(/^import\s+/, '// as:import ');
    } else {
      directiveLine = header.replace(/^#import\s+/, '// as:include ');
    }
    const decision = decisions[header];
    const handleResult = await injection.handleHeaderLine(
      specFile,
      updateFile,
      directiveLine,
      importArray,
      isSwift,
      {
      preflight,
      skipPrompt: !!decision,
      decisionAction: decision ? decision.action : null,
      suggestionNote: decision ? decision.suggestionNote : null
      }
    );
    if (handleResult && handleResult.suggestionNote) {
      suggestionNotes.push(handleResult.suggestionNote);
      if (preflight) {
      decisions[header] = {
        action: handleResult.decisionAction || 'suggestPatch',
        suggestionNote: handleResult.suggestionNote
      };
      }
    } else if (preflight) {
      decisions[header] = {
      action: handleResult && handleResult.decisionAction ? handleResult.decisionAction : 'insertAnyway',
      suggestionNote: null
      };
    }
    if (!importArray.includes(header)) {
      importArray.push(header);
      headerInsertCount++;
    }
    } catch (err) {
    console.error(`   ❌ 处理头文件失败: ${header}`, err.message);
    if (err.name === 'DependencyBlockedError') {
      notifier.notify(`操作已取消: ${err.message}`, { title: 'AutoSnippet - 头文件注入' });
      return { blocked: true, headerInsertCount, suggestionNotes };
    }
    if (process.env.ASD_SPM_CHECK_STRICT === '1') {
      notifier.notify(`依赖缺失: ${header}${err.message ? `\n\n${err.message}` : ''}`, { title: 'AutoSnippet' });
      return { blocked: true, headerInsertCount, suggestionNotes };
    }
    }
  }

  if (debug) {
    console.log(`   ✅ 已处理 ${headerInsertCount} 个头文件`);
  }

  return { blocked: false, headerInsertCount, suggestionNotes, decisions };
  }

  formatSuggestionNotes(suggestionNotes, indent = '') {
  if (!Array.isArray(suggestionNotes) || suggestionNotes.length === 0) return [];
  const lines = [];
  const seen = new Set();
  for (const note of suggestionNotes) {
    if (!note) continue;
    String(note)
    .split(/\r?\n/)
    .forEach((line) => {
      if (!line || !line.trim()) return;
      const key = line.trim();
      if (seen.has(key)) return;
      seen.add(key);
      lines.push(indent + line);
    });
  }
  return lines;
  }

  _collectImportsFromFile(filePath, isSwift) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const imports = [];
    for (const line of lines) {
    const trimmed = line.trim();
    if (isSwift) {
      if (trimmed.startsWith('import ')) {
      imports.push(trimmed);
      }
    } else {
      if (trimmed.startsWith('#import ') || trimmed.startsWith('@import ') || trimmed.startsWith('#include ')) {
      imports.push(trimmed);
      }
    }
    }
    return imports;
  } catch (err) {
    console.warn('读取文件 imports 失败:', err.message);
    return [];
  }
  }

  async _collectImportsFromHeaderFile(updateFile, importArray) {
  const dotIndex = updateFile.lastIndexOf('.');
  if (dotIndex <= 0) return;
  const mainPathFile = updateFile.substring(0, dotIndex) + '.h';
  try {
    await accessAsync(mainPathFile, fs.constants.F_OK);
    const data = await readFileAsync(mainPathFile, 'utf8');
    const lineArray = data.split('\n');
    lineArray.forEach(element => {
    const lineVal = element.trim();
    if (this.importReg.test(lineVal)) {
      importArray.push(lineVal);
    }
    });
  } catch (err) {
    console.log(`   ℹ️  无法读取 ${path.basename(mainPathFile)}，使用现有 importArray`);
  }
  }

  computePasteLineNumber(triggerLineNumber, headerInsertCount, filePath, options = {}) {
  const expectedCount = Number.isFinite(options.expectedHeaderCount)
    ? options.expectedHeaderCount
    : headerInsertCount;
  if (expectedCount > 0) {
    if (options.forceOffset) {
    return triggerLineNumber + expectedCount;
    }
    const headerInsertPosition = this._getLastImportLine(filePath);
    if (headerInsertPosition > 0 && headerInsertPosition < triggerLineNumber) {
    return triggerLineNumber + expectedCount;
    }
  }
  return triggerLineNumber;
  }

  _getLastImportLine(filePath) {
  try {
    if (!fs.existsSync(filePath)) return 0;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    let lastImportIdx = -1;
    for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('#import ') || trimmed.startsWith('@import ') || trimmed.startsWith('#include ') || trimmed.startsWith('import ')) {
      lastImportIdx = i;
    }
    }
    return lastImportIdx >= 0 ? lastImportIdx + 1 : 0;
  } catch (err) {
    return 0;
  }
  }

  async _handleHeader(context) {
  const { specFile, updateFile, headerLine, importArray, isSwift } = context;
  
  try {
    if (isSwift || updateFile.endsWith('.h')) {
    await injection.handleHeaderLine(specFile, updateFile, headerLine, importArray, isSwift);
    return;
    }

    const dotIndex = updateFile.lastIndexOf('.');
    const mainPathFile = updateFile.substring(0, dotIndex) + '.h';

    // 尝试读取 .h 文件中已有的 imports
    try {
    await accessAsync(mainPathFile, fs.constants.F_OK);
    const data = await readFileAsync(mainPathFile, 'utf8');
    const lineArray = data.split('\n');
    
    lineArray.forEach(element => {
      const lineVal = element.trim();
      if (this.importReg.test(lineVal)) {
      importArray.push(lineVal);
      }
    });
    } catch (err) {
    // .h 文件不存在或读取失败，继续处理
    console.log(`   ℹ️  无法读取 ${path.basename(mainPathFile)}，使用现有 importArray`);
    }

    // 调用 injection 服务处理头文件
    await injection.handleHeaderLine(specFile, updateFile, headerLine, importArray, isSwift);
    
  } catch (err) {
    // DependencyBlockedError: 依赖被阻止（循环/反向/用户取消）
    if (err.name === 'DependencyBlockedError') {
    console.error(`   ❌ 头文件注入被阻止: ${err.message}`);
    notifier.notify(`操作已取消: ${err.message}`, { 
      title: 'AutoSnippet - 头文件注入' 
    });
    // 不抛出异常，避免中断 watch 流程
    return;
    }
    
    // 其他错误：记录并通知
    console.error(`   ❌ 头文件注入失败:`, err.message);
    notifier.notify(`头文件注入失败: ${err.message}`, { 
    title: 'AutoSnippet' 
    });
  }
  }
}

module.exports = new HeaderHandler();
