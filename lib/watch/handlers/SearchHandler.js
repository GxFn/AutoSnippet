/**
 * SearchHandler - 处理 // as:search 触发
 */

const fs = require('fs');
const path = require('path');

class SearchHandler {
  async handle(specFile, fullPath, relativePath, searchLine) {
    if (process.env.ASD_SEARCH_USE_BROWSER === '1') {
      const keyword = searchLine.replace(/^\/\/\s*(?:autosnippet:search|as:search|as:s)\s*/, '').trim();
      const url = `http://localhost:3000/?action=search&q=${encodeURIComponent(keyword)}&path=${encodeURIComponent(relativePath)}`;
      const openBrowser = require('../../infrastructure/external/OpenBrowser');
      openBrowser.openBrowserReuseTab(url, 'http://localhost:3000');
      return;
    }

    let keyword = searchLine
      .replace(/^\/\/\s*(?:autosnippet:search|as:search|as:s)\s*/, '')
      .trim();

    // 从文件中重新定位触发行，避免使用旧 searchLine 导致结果不刷新
    try {
      const raw = fs.readFileSync(fullPath, 'utf8');
      const lines = raw.split(/\r?\n/);
      const triggerSymbol = require('../../infrastructure/config/TriggerSymbol');
      const searchMark = /\/\/\s*(?:autosnippet|as):(?:search|s)(\s|$)/;
      let foundLine = '';
      const normalizedSearchLine = triggerSymbol.stripTriggerPrefix(String(searchLine || '').trim()).trim();
      if (normalizedSearchLine) {
        for (let i = lines.length - 1; i >= 0; i--) {
          const t = triggerSymbol.stripTriggerPrefix(lines[i].trim()).trim();
          if (t === normalizedSearchLine) {
            foundLine = lines[i];
            break;
          }
        }
      }
      for (let i = lines.length - 1; i >= 0; i--) {
        if (foundLine) break;
        const t = triggerSymbol.stripTriggerPrefix(lines[i].trim()).trim();
        if (searchMark.test(t) || t === '// as:search' || t.startsWith('// as:search ') || t === '// as:s' || t.startsWith('// as:s ') || t.startsWith('// autosnippet:search')) {
          foundLine = lines[i];
          break;
        }
      }
      if (foundLine) {
        const extracted = foundLine
          .replace(/^\/\/\s*(?:autosnippet:search|as:search|as:s)\s*/, '')
          .trim();
        if (extracted) keyword = extracted;
      }
    } catch (_) {}

    // projectRoot 应该是 specFile 的父目录的父目录（包含 AutoSnippet/ 子目录的目录）
    // 例如：specFile = /path/to/project/AutoSnippet/AutoSnippet.boxspec.json
    //       projectRoot = /path/to/project
    const projectRoot = path.dirname(path.dirname(specFile));
    const SearchServiceV2 = require('../../search/SearchServiceV2');
    const nativeUi = require('../../infrastructure/notification/NativeUi');

    const filter = {};
    const ext = path.extname(fullPath).toLowerCase();
    if (ext === '.swift') filter.language = 'swift';
    else if (ext === '.m' || ext === '.h') filter.language = 'objc';

    const searchService = new SearchServiceV2(projectRoot);
    try { searchService.clearCache(); } catch (_) {}

    if (!keyword) {
      const msg = '未检测到搜索关键词，请在 // as:s 后输入关键词';
      console.log(`[as:search] ${msg}`);
      this._notify(msg);
      return;
    }
    const results = await searchService.search(keyword, { 
      semantic: true,
      ranking: true,  // 使用综合排序（关键词+语义+新鲜度+热度）
      limit: 8, 
      cache: false,
      filter: Object.keys(filter).length > 0 ? filter : undefined 
    });

    if (results.length === 0) {
      const msg = keyword ? `「${keyword}」未找到匹配的 Recipe/Snippet` : '未找到匹配内容';
      console.log(`[as:search] ${msg}`);
      this._notify(msg);
      return;
    }

    console.log(`[as:search] 找到 ${results.length} 个匹配，请选择...`);
    const titles = results.map(r => r.title);
    const title = `AutoSnippet 搜索结果 - ${keyword}`;
    const idx = await nativeUi.pickFromList(titles, title, '请选择要插入的代码:');
    if (idx < 0) return;

    const selected = results[idx];
    let code = selected.code || selected.content || '';
    if (selected.type === 'recipe' && selected.content) {
      try {
        const { parseRecipeMd } = require('../../recipe/parseRecipeMd');
        const parsed = parseRecipeMd(selected.content);
        if (parsed?.code) {
          code = parsed.code;
        }
      } catch (_) {}
    }
    const confirmed = await nativeUi.showPreview(selected.title, code);
    if (!confirmed) return;

    const triggerSymbol = require('../../infrastructure/config/TriggerSymbol');
    const raw = fs.readFileSync(fullPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const searchMark = /\/\/\s*(?:autosnippet|as):(?:search|s)(\s|$)/;
    let found = -1;
    const normalizedSearchLine = triggerSymbol.stripTriggerPrefix(String(searchLine || '').trim()).trim();
    if (normalizedSearchLine) {
      for (let i = lines.length - 1; i >= 0; i--) {
        const t = triggerSymbol.stripTriggerPrefix(lines[i].trim()).trim();
        if (t === normalizedSearchLine) {
          found = i;
          break;
        }
      }
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      if (found >= 0) break;
      const t = triggerSymbol.stripTriggerPrefix(lines[i].trim()).trim();
      if (searchMark.test(t) || t === '// as:search' || t.startsWith('// as:search ') || t === '// as:s' || t.startsWith('// as:s ') || t.startsWith('// autosnippet:search')) {
        found = i;
        break;
      }
    }
    if (found >= 0) {
      const insertLines = String(code).split(/\r?\n/);
      const newLines = [...lines.slice(0, found), ...insertLines, ...lines.slice(found + 1)];
      fs.writeFileSync(fullPath, newLines.join('\n'), 'utf8');
      console.log(`✅ 已插入到 ${path.basename(fullPath)}`);
      try {
        const recipeStats = require('../../recipe/recipeStats');
        recipeStats.recordRecipeUsage(projectRoot, {
          trigger: selected.trigger,
          recipeFilePath: selected.name,
          source: 'human'
        });
      } catch (_) {}
    }
  }

  _notify(msg) {
    if (process.platform === 'darwin') {
      try {
        const notifier = require('../../infrastructure/notification/Notifier');
        notifier.notify(msg, { title: 'AutoSnippet', subtitle: 'as:search' });
      } catch (_) {}
    }
  }
}

module.exports = new SearchHandler();
