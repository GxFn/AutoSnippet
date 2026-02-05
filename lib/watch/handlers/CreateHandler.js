/**
 * CreateHandler - 处理 // as:create 触发
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const ClipboardManager = require('../../infrastructure/notification/ClipboardManager');
const AutomationOrchestrator = require('../../automation/AutomationOrchestrator');

const automationOrchestrator = new AutomationOrchestrator();

class CreateHandler {
  constructor() {
  this.createRemoveRegex = /^@?\s*\/\/\s*as:(?:create|c)(?:\s+-[cf])?\s*\r?\n?/gm;
  }

  async handle(specFile, fullPath, relativePath, createOption) {
  return automationOrchestrator.run(
    {
    type: 'create',
    handler: (context) => this._handleCreate(context)
    },
    { specFile, fullPath, relativePath, createOption }
  );
  }

  async _handleCreate(context) {
  const { specFile, fullPath, relativePath, createOption } = context;
  // projectRoot 应该是 specFile 的父目录的父目录（包含知识库目录的目录）
  // 例如：specFile = /path/to/project/AutoSnippet/AutoSnippet.boxspec.json
  //       projectRoot = /path/to/project
  const projectRoot = path.dirname(path.dirname(specFile));

  // 1. 仅 -c 时读剪贴板
  let textToExtract = '';
  if (createOption === 'c') {
    try {
    if (process.platform === 'darwin') {
      textToExtract = execSync('pbpaste', { encoding: 'utf8' }).trim();
    }
    } catch (e) {
    console.warn('[Watcher] Failed to read clipboard:', e.message);
    }
  }

  // 2. 自动剪切触发行（优先），失败则回退为文件内移除 (默认开启)
  let cutSucceeded = false;
  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    const lineNumber = this._findCreateLineNumber(content);
    const autoMode = process.env.ASD_AUTO_PASTE_MODE !== '0';
    const autoCut = autoMode || process.env.ASD_AUTO_CUT !== '0' || (process.env.ASD_AUTO_CUT === undefined);
    if (process.platform === 'darwin' && autoCut && lineNumber > 0) {
    cutSucceeded = this._tryAutoCutXcodeAtLine(lineNumber);
    }

    if (!cutSucceeded) {
    const newContent = content.replace(this.createRemoveRegex, '');
    fs.writeFileSync(fullPath, newContent, 'utf8');
    }
  } catch (err) {
    console.error('[Watcher] Failed to remove as:create mark', err);
  }

  if (createOption !== 'c') {
    const autoScan = createOption === 'f' ? '&autoScan=1' : '';
    console.log(createOption === 'f' ? '[as:create -f] 已打开 Dashboard，自动执行 Scan File' : '[as:create] 已打开 Dashboard，请选择 Scan File（按当前文件）或 Use Copied Code（按剪贴板）');
    const url = `http://localhost:3000/?action=create&path=${encodeURIComponent(relativePath)}${autoScan}`;
    const openBrowser = require('../../infrastructure/external/OpenBrowser');
    openBrowser.openBrowserReuseTab(url, 'http://localhost:3000');
    return;
  }

  if (textToExtract.length === 0) {
    console.log('[as:create -c] 剪贴板为空，已打开 Dashboard，可粘贴后点 Use Copied Code');
    const url = `http://localhost:3000/?action=create&path=${encodeURIComponent(relativePath)}`;
    const openBrowser = require('../../infrastructure/external/OpenBrowser');
    openBrowser.openBrowserReuseTab(url, 'http://localhost:3000');
    return;
  }

  // 3. 静默创建候选
  const useSilent = process.env.ASD_CREATE_SILENT !== '0';
  if (useSilent) {
    try {
    const parseRecipeMd = require('../../recipe/parseRecipeMd');
    const candidateService = require('../../ai/candidateService');
    const headerResolution = require('../../ai/headerResolution');

    const normalized = (arr) => arr.map(r => ({
      title: r.title,
      summary: r.summary || r.summary_cn || '',
      trigger: r.trigger,
      category: r.category || 'Utility',
      language: r.language === 'swift' ? 'swift' : 'objc',
      code: r.code,
      usageGuide: r.usageGuide || '',
      headers: r.headers || []
    }));

    const allRecipes = parseRecipeMd.parseRecipeMdAll(textToExtract);
    if (allRecipes.length > 0) {
      const items = normalized(allRecipes);
      if (relativePath && items[0] && (!items[0].headers || items[0].headers.length === 0)) {
      try {
        const resolved = await headerResolution.resolveHeadersForText(projectRoot, relativePath, textToExtract);
        if (resolved && resolved.headers && resolved.headers.length > 0) {
        items[0].headers = resolved.headers;
        items[0].headerPaths = resolved.headerPaths;
        items[0].moduleName = resolved.moduleName;
        }
      } catch (_) {}
      }
      await candidateService.appendCandidates(projectRoot, '_watch', items, 'watch-create');
      const msg = allRecipes.length === 1
      ? `已创建候选「${allRecipes[0].title}」，请在 Dashboard Candidates 页审核`
      : `已创建 ${allRecipes.length} 条候选，请在 Dashboard Candidates 页审核`;
      console.log(`✅ [as:create] ${msg}`);
      this._notify(msg);
      return;
    }

    if (parseRecipeMd.isCompleteRecipeMd(textToExtract)) {
      const one = parseRecipeMd.parseRecipeMd(textToExtract);
      if (one) {
      const item = normalized([one])[0];
      if (relativePath && (!item.headers || item.headers.length === 0)) {
        try {
        const resolved = await headerResolution.resolveHeadersForText(projectRoot, relativePath, textToExtract);
        if (resolved && resolved.headers && resolved.headers.length > 0) {
          item.headers = resolved.headers;
          item.headerPaths = resolved.headerPaths;
          item.moduleName = resolved.moduleName;
        }
        } catch (_) {}
      }
      await candidateService.appendCandidates(projectRoot, '_watch', [item], 'watch-create');
      console.log(`✅ [as:create] 已静默创建候选「${one.title}」，请在 Dashboard Candidates 页审核`);
      this._notify(`已创建候选「${one.title}」，请在 Candidates 页审核`);
      return;
      }
    }

    const AiFactory = require('../../ai/AiFactory');
    const ai = await AiFactory.getProvider(projectRoot);
    if (ai) {
      const lang = relativePath && /\.swift$/i.test(relativePath) ? 'swift' : 'objc';
      const result = await ai.summarize(textToExtract, lang);
      if (result && !result.error && result.title && result.code) {
      await candidateService.appendCandidates(projectRoot, '_watch', [result], 'watch-create');
      console.log(`✅ [as:create] 已静默创建候选「${result.title}」，请在 Dashboard Candidates 页审核`);
      this._notify(`已创建候选「${result.title}」，请在 Candidates 页审核`);
      return;
      }
    }
    } catch (e) {
    console.warn('[Watcher] 静默创建候选失败，回退到打开浏览器:', e.message);
    }
  }

  const url = `http://localhost:3000/?action=create&path=${encodeURIComponent(relativePath)}&source=clipboard`;
  const openBrowser = require('../../infrastructure/external/OpenBrowser');
  openBrowser.openBrowserReuseTab(url, 'http://localhost:3000');
  }

  _notify(msg) {
  if (process.platform === 'darwin') {
    try {
    execSync(`osascript -e 'display notification "${msg.replace(/"/g, '\\"')}" with title "AutoSnippet"'`, { encoding: 'utf8' });
    } catch (_) {}
  }
  }

  _findCreateLineNumber(content) {
  if (!content) return -1;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('// as:create') || t.startsWith('// as:c')) {
    return i + 1; // 1-based
    }
  }
  return -1;
  }

  _tryAutoCutXcodeAtLine(lineNumber) {
  try {
    const previousClipboard = ClipboardManager.read();
    const safeLineNumber = Number.isFinite(lineNumber) && lineNumber > 0 ? lineNumber : 1;
    const args = [
    '-e', 'tell application "Xcode" to activate',
    '-e', 'delay 0.3',
    '-e', 'tell application "System Events"',
    '-e', 'keystroke "l" using command down',
    '-e', 'delay 0.2',
    '-e', `keystroke "${String(safeLineNumber).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    '-e', 'delay 0.2',
    '-e', 'key code 36',
    '-e', 'delay 0.2',
    '-e', 'key code 123 using command down',
    '-e', 'delay 0.1',
    '-e', 'key code 124 using {command down, shift down}',
    '-e', 'delay 0.1',
    '-e', 'keystroke "x" using command down',
    '-e', 'end tell'
    ];
    const res = spawnSync('osascript', args, { stdio: 'ignore' });
    if (typeof previousClipboard === 'string') {
    ClipboardManager.write(previousClipboard);
    }
    return res.status === 0;
  } catch (_) {
    return false;
  }
  }
}

module.exports = new CreateHandler();
