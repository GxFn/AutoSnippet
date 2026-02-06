/**
 * FileWatchService - 文件监听主服务
 */

const chokidar = require('chokidar');
const path = require('path');

const FileWatchConfig = require('./FileWatchConfig');
const FileDebouncer = require('./FileDebouncer');
const DirectiveDetector = require('./DirectiveDetector');

const CreateHandler = require('./handlers/CreateHandler');
const GuardHandler = require('./handlers/GuardHandler');
const SearchHandler = require('./handlers/SearchHandler');
const AlinkHandler = require('./handlers/AlinkHandler');
const HeaderHandler = require('./handlers/HeaderHandler');
const DraftHandler = require('./handlers/DraftHandler');

class FileWatchService {
  constructor() {
  this.debouncer = new FileDebouncer(FileWatchConfig.DEBOUNCE_DELAY);
  this.timeoutLink = null;
  this.timeoutHead = null;
  }

  watch(specFile, watchRootPath, options = {}) {
  const filePath = watchRootPath || FileWatchConfig.CMD_PATH;

  const pathPrefix = options && options.pathPrefix ? String(options.pathPrefix) : null;
  const onlyFile = options && options.file ? path.resolve(String(options.file)) : null;
  const exts = Array.isArray(options && options.exts) ? options.exts.map(e => (e.startsWith('.') ? e : `.${e}`)) : null;
  const quiet = !!(options && options.quiet);
  const summary = !!(options && options.summary);
  const summaryState = summary ? { files: new Set(), headers: 0, links: 0, startedAt: Date.now() } : null;

  const filePattern = (exts && exts.length)
    ? exts.map((e) => `**/*${e}`)
    : FileWatchConfig.DEFAULT_FILE_PATTERN;

  // 始终输出启动消息，用于测试和调试
  console.log(`✅ 文件监听已启动: ${filePath}`);
  if (pathPrefix) console.log(`ℹ️  仅监听目录前缀: ${pathPrefix}`);
  if (onlyFile) console.log(`ℹ️  仅监听文件: ${onlyFile}`);
  if (exts && exts.length) console.log(`ℹ️  仅监听后缀: ${exts.join(',')}`);

  const watcher = chokidar.watch(filePattern, {
    cwd: filePath,
    ignored: FileWatchConfig.IGNORED,
    ...FileWatchConfig.CHOKIDAR_OPTIONS
  });

  const handleEvent = (relativePath) => {
    const fullPath = path.join(filePath, relativePath);
    
    // 调试日志：显示检测到的文件变化
    if (process.env.ASD_DEBUG === '1') {
    console.log(`[Watch] 检测到文件变化: ${relativePath}`);
    }
    
    if (onlyFile && path.resolve(fullPath) !== onlyFile) return;
    if (pathPrefix && !path.normalize(relativePath).startsWith(path.normalize(pathPrefix))) return;
    this._handleFileChange(specFile, fullPath, relativePath, options, summaryState);
  };

  watcher.on('change', handleEvent);
  watcher.on('add', handleEvent);

  watcher.on('error', (error) => {
    console.error('文件监听错误:', error.message);
  });

  watcher.on('ready', () => {
    // 始终输出就绪消息
    console.log('文件监听器已就绪，等待文件变更...');
    if (process.env.ASD_DEBUG === '1') {
    console.log(`[Watch] 监听目录: ${filePath}`);
    console.log(`[Watch] 监听模式: ${filePattern.join(', ')}`);
    }
  });

  if (summaryState) {
    this._setupSummary(summaryState, filePath, pathPrefix, onlyFile, exts, options);
  }

  return watcher;
  }

  _handleFileChange(specFile, fullPath, relativePath, options, summaryState) {
  this.debouncer.debounce(fullPath, () => {
    this._processFileChange(specFile, fullPath, relativePath, options, summaryState);
  });
  }

  _processFileChange(specFile, updateFile, relativePath, options, summaryState) {
  const fs = require('fs');

  if (process.env.ASD_DEBUG === '1') {
    console.log(`[Watch] 处理文件: ${relativePath}`);
  }

  fs.access(updateFile, fs.constants.F_OK, (err) => {
    if (err) return;
    fs.stat(updateFile, (statErr, stats) => {
    if (statErr || stats.isDirectory()) return;
    fs.readFile(updateFile, 'utf8', async (readErr, data) => {
      if (readErr) {
      console.error(`❌ 读取文件失败: ${updateFile}`, readErr.message);
      return;
      }

      if (process.env.ASD_DEBUG === '1') {
      console.log(`[Watch] 读取文件内容成功，检查指令...`);
      }

      const filename = path.basename(updateFile);
      const isDraftFile = DirectiveDetector.REGEX.DRAFT_FILE.test(filename);
      if (isDraftFile) {
      await DraftHandler.handle(specFile, updateFile, relativePath, data);
      }

      const triggers = DirectiveDetector.detectTriggers(data, filename);
      
      // 检测文件来源（模拟器或真实 Xcode）
      const source = DirectiveDetector.detectSourceMarker(data);

      if (process.env.ASD_DEBUG === '1') {
      console.log(`[Watch] 指令检测结果:`, {
        createLine: !!triggers.createLine,
        guardLine: !!triggers.guardLine,
        searchLine: !!triggers.searchLine,
        alinkLine: !!triggers.alinkLine,
        headerLine: !!triggers.headerLine,
        source: source || 'Unknown'
      });
      if (triggers.searchLine) {
        console.log(`[Watch] 检测到搜索指令: ${triggers.searchLine}`);
        if (source) {
        console.log(`[Watch] 来源: ${source === 'simulator' ? '✨ Xcode 模拟器' : source}`);
        }
      }
      }

      if (triggers.createLine) {
      await CreateHandler.handle(specFile, updateFile, relativePath, triggers.createOption);
      }

      if (triggers.guardLine) {
      await GuardHandler.handle(specFile, updateFile, data, triggers.guardLine);
      }

      if (triggers.searchLine) {
      await SearchHandler.handle(specFile, updateFile, relativePath, triggers.searchLine, { source });
      }

      if (triggers.alinkLine) {
      clearTimeout(this.timeoutLink);
      this.timeoutLink = setTimeout(async () => {
        await AlinkHandler.handle(specFile, triggers.alinkLine);
        this._emitEvent(options, { type: 'alink', file: updateFile, relativePath }, summaryState);
      }, FileWatchConfig.DEBOUNCE_DELAY);
      }

      if (triggers.headerLine) {
      const isMatch = triggers.isSwift ? DirectiveDetector.REGEX.HEADER_SWIFT.test(triggers.headerLine) : DirectiveDetector.REGEX.HEADER_OBJC.test(triggers.headerLine);
      if (isMatch) {
        clearTimeout(this.timeoutHead);
        this.timeoutHead = setTimeout(async () => {
        await HeaderHandler.handle(specFile, updateFile, triggers.headerLine, triggers.importArray, triggers.isSwift);
        this._emitEvent(options, { type: 'header', file: updateFile, relativePath }, summaryState);
        }, FileWatchConfig.DEBOUNCE_DELAY);
      }
      }
    });
    });
  });
  }

  _emitEvent(options, evt, summaryState) {
  try {
    if (summaryState && evt && evt.file) summaryState.files.add(evt.file);
    if (summaryState && evt && evt.type === 'header') summaryState.headers++;
    if (summaryState && evt && evt.type === 'alink') summaryState.links++;
  } catch {}

  if (options && typeof options.onEvent === 'function') {
    try { options.onEvent(evt); } catch {}
  }
  }

  _setupSummary(summaryState, filePath, pathPrefix, onlyFile, exts, options) {
  const printSummaryOnce = () => {
    const ms = Date.now() - summaryState.startedAt;
    console.log('');
    console.log('======== AutoSnippet watch summary ========');
    console.log(`watchedRoot: ${filePath}`);
    if (pathPrefix) console.log(`pathPrefix: ${pathPrefix}`);
    if (onlyFile) console.log(`file: ${onlyFile}`);
    if (exts && exts.length) console.log(`exts: ${exts.join(',')}`);
    console.log(`events: header=${summaryState.headers}, link=${summaryState.links}`);
    console.log(`touchedFiles: ${summaryState.files.size}`);
    console.log(`elapsed: ${ms}ms`);
    console.log('==========================================');
  };

  process.once('exit', printSummaryOnce);
  process.once('SIGINT', () => { try { printSummaryOnce(); } finally { process.exit(130); } });

  const oldOnEvent = options.onEvent;
  options.onEvent = (evt) => {
    if (typeof oldOnEvent === 'function') {
    try { oldOnEvent(evt); } catch {}
    }
  };
  }
}

module.exports = new FileWatchService();
