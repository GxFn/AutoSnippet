/**
 * SearchHandler - 处理 // as:search 触发
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const AutomationOrchestrator = require('../../automation/AutomationOrchestrator');
const WindowContextManager = require('../../context/WindowContextManager');
const HeaderHandler = require('./HeaderHandler');

const automationOrchestrator = new AutomationOrchestrator();

class SearchHandler {
  _extractStructuredContext(lines, ext, lineIndex, options = {}) {
  const result = {
    imports: [],
    types: [],
    functions: [],
    variables: []
  };

  if (!Array.isArray(lines) || lines.length === 0) return result;

  const radius = 80;
  const start = Math.max(0, lineIndex - radius);
  const end = Math.min(lines.length, lineIndex + radius + 1);
  const slice = lines.slice(start, end);

  const addUnique = (arr, value, limit = 6) => {
    if (!value) return;
    if (!arr.includes(value)) arr.push(value);
    if (arr.length > limit) arr.splice(limit);
  };

  const includeImports = options.includeImports !== false;
  const includeTypes = options.includeTypes !== false;
  const includeFunctions = options.includeFunctions !== false;
  const includeVars = options.includeVars !== false;

  if (ext === '.swift') {
    slice.forEach((line) => {
    const t = line.trim();
    if (includeImports) {
      const imp = t.match(/^import\s+([A-Za-z0-9_\.]+)/);
      if (imp) addUnique(result.imports, imp[1]);
    }

    if (includeTypes) {
      const type = t.match(/^(class|struct|enum|protocol|extension)\s+([A-Za-z0-9_]+)/);
      if (type) addUnique(result.types, type[2]);
    }

    if (includeFunctions) {
      const fn = t.match(/^func\s+([A-Za-z0-9_]+)/);
      if (fn) addUnique(result.functions, fn[1]);
    }

    if (includeVars) {
      const v = t.match(/^(let|var)\s+([A-Za-z0-9_]+)/);
      if (v) addUnique(result.variables, v[2]);
    }
    });
  } else if (ext === '.m' || ext === '.h') {
    slice.forEach((line) => {
    const t = line.trim();
    if (includeImports) {
      const imp = t.match(/^#import\s+[<"]([^>"]+)[>"]/);
      if (imp) addUnique(result.imports, imp[1]);

      const mod = t.match(/^@import\s+([A-Za-z0-9_\.]+)\s*;/);
      if (mod) addUnique(result.imports, mod[1]);
    }

    if (includeTypes) {
      const type = t.match(/^@(interface|implementation)\s+([A-Za-z0-9_]+)/);
      if (type) addUnique(result.types, type[2]);
    }

    if (includeFunctions) {
      const method = t.match(/^[-+]\s*\([^\)]*\)\s*([A-Za-z0-9_]+)/);
      if (method) addUnique(result.functions, method[1]);
    }

    if (includeVars) {
      const v = t.match(/\b[A-Za-z_][A-Za-z0-9_]*\s*\*?\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (v) addUnique(result.variables, v[1]);
    }
    });
  } else {
    slice.forEach((line) => {
    const t = line.trim();
    if (includeImports) {
      const imp = t.match(/^import\s+.*from\s+['"]([^'"]+)['"]/);
      if (imp) addUnique(result.imports, imp[1]);
    }

    if (includeTypes) {
      const type = t.match(/^class\s+([A-Za-z0-9_]+)/);
      if (type) addUnique(result.types, type[1]);
    }

    if (includeFunctions) {
      const fn = t.match(/^function\s+([A-Za-z0-9_]+)/) || t.match(/^const\s+([A-Za-z0-9_]+)\s*=\s*(async\s*)?\(.*\)\s*=>/);
      if (fn) addUnique(result.functions, fn[1]);
    }

    if (includeVars) {
      const v = t.match(/^(const|let|var)\s+([A-Za-z0-9_]+)/);
      if (v) addUnique(result.variables, v[2]);
    }
    });
  }

  return result;
  }

  _formatStructuredContext(ctx) {
  const parts = [];
  if (ctx.imports?.length) parts.push(`imports: ${ctx.imports.join(', ')}`);
  if (ctx.types?.length) parts.push(`types: ${ctx.types.join(', ')}`);
  if (ctx.functions?.length) parts.push(`functions: ${ctx.functions.join(', ')}`);
  if (ctx.variables?.length) parts.push(`variables: ${ctx.variables.join(', ')}`);
  return parts.join(' | ');
  }

  _parseSearchInput(rawLine) {
  const raw = String(rawLine || '').trim();
  
  // 直接移除所有可能的搜索指令前缀，保留关键词
  // 支持: //, @, #, 以及 autosnippet:search, as:search, as:s 等各种组合
  let stripped = raw
    .replace(/^[\/\/@#]+\s*/, '')  // 移除开头的注释符号
    .replace(/^(?:autosnippet|as)\s*:\s*(?:search|s)\s*/i, '')  // 移除搜索指令
    .trim();
  
  const qualifiers = {};
  let keyword = stripped;

  // 提取限定符（lang:, type:, category:, path:, trigger: 等）
  const re = /(\w+):(?:"([^"]+)"|(\S+))/g;
  let match;
  while ((match = re.exec(stripped)) !== null) {
    const key = match[1].toLowerCase();
    const value = match[2] || match[3] || '';
    qualifiers[key] = value;
  }

  // 移除限定符，剩下的就是关键词
  if (Object.keys(qualifiers).length > 0) {
    keyword = stripped.replace(re, '').replace(/\s{2,}/g, ' ').trim();
  }

  return { keyword, qualifiers };
  }

  _applyResultFilters(results, filters) {
  if (!filters || Object.keys(filters).length === 0) return results;
  let out = results;

  if (filters.type) {
    const t = String(filters.type).toLowerCase();
    out = out.filter(r => String(r.type || '').toLowerCase() === t);
  }

  if (filters.trigger) {
    const t = String(filters.trigger).toLowerCase();
    out = out.filter(r => String(r.trigger || '').toLowerCase().includes(t) || String(r.title || '').toLowerCase().includes(t));
  }

  if (filters.path) {
    const p = String(filters.path).toLowerCase();
    out = out.filter(r => String(r.name || r.title || '').toLowerCase().includes(p));
  }

  if (filters.category) {
    const c = String(filters.category).toLowerCase();
    out = out.filter(r => String(r.category || '').toLowerCase() === c);
  }

  return out;
  }

  async handle(specFile, fullPath, relativePath, searchLine, options = {}) {
  // 调用链路（Xcode Watch）:
  // SearchHandler.handle -> _handleSearch -> SearchServiceV2.search
  // -> (可选) IntelligentServiceLayer.intelligentSearch -> SearchServiceV2.search
  // -> _rankingSearch/_semanticSearch/_keywordSearch -> _searchRecipes/_searchSnippets
  
  const { windowContext } = options;
  
  return automationOrchestrator.run(
    {
    type: 'search',
    handler: (context) => this._handleSearch(context, { windowContext })
    },
    { specFile, fullPath, relativePath, searchLine }
  );
  }

  async _handleSearch(context, options = {}) {
  const { windowContext } = options;
  const { specFile, fullPath, relativePath, searchLine } = context;
  if (process.env.ASD_SEARCH_USE_BROWSER === '1') {
    const keyword = searchLine.replace(/^\/\/\s*(?:autosnippet:search|as:search|as:s)\s*/, '').trim();
    const url = `http://localhost:3000/?action=search&q=${encodeURIComponent(keyword)}&path=${encodeURIComponent(relativePath)}`;
    const openBrowser = require('../../infrastructure/external/OpenBrowser');
    openBrowser.openBrowserReuseTab(url, 'http://localhost:3000');
    return;
  }

  const parsed = this._parseSearchInput(searchLine);
  let keyword = parsed.keyword;
  const qualifiers = parsed.qualifiers || {};

  // 从文件中重新定位触发行，避免使用旧 searchLine 导致结果不刷新
  let fileLines = null;
  let foundLineIndex = -1;
  let contextSnippet = '';
  let structuredContext = null;
  try {
    const raw = fs.readFileSync(fullPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    fileLines = lines;
    const triggerSymbol = require('../../infrastructure/config/TriggerSymbol');
    const searchMark = /\/\/\s*(?:autosnippet|as):(?:search|s)(\s|$)/;
    let foundLine = '';
    const normalizedSearchLine = triggerSymbol.stripTriggerPrefix(String(searchLine || '').trim()).trim();
    if (normalizedSearchLine) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const t = triggerSymbol.stripTriggerPrefix(lines[i].trim()).trim();
      if (t === normalizedSearchLine) {
      foundLine = lines[i];
      foundLineIndex = i;
      break;
      }
    }
    }
    for (let i = lines.length - 1; i >= 0; i--) {
    if (foundLine) break;
    const t = triggerSymbol.stripTriggerPrefix(lines[i].trim()).trim();
    if (searchMark.test(t) || t === '// as:search' || t.startsWith('// as:search ') || t === '// as:s' || t.startsWith('// as:s ') || t.startsWith('// autosnippet:search')) {
      foundLine = lines[i];
      foundLineIndex = i;
      break;
    }
    }
    // 如果从文件中找到了搜索行，重新解析它（可能用户已经修改了）
    if (foundLine) {
    const freshParsed = this._parseSearchInput(foundLine);
    // 只有当新解析的关键词不为空时才覆盖
    if (freshParsed.keyword) {
      keyword = freshParsed.keyword;
      Object.assign(qualifiers, freshParsed.qualifiers || {});
    }
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

  if (qualifiers.lang || qualifiers.language) {
    filter.language = qualifiers.lang || qualifiers.language;
  }

  if (qualifiers.type) {
    filter.type = qualifiers.type;
  }

  if (qualifiers.category) {
    filter.category = qualifiers.category;
  }

  // 使用统一搜索函数（确保 CLI 和 Xcode 完全一致）
  const { performUnifiedSearch } = require('../../search/unifiedSearch');

  if (!keyword) {
    const msg = '未检测到搜索关键词，请在 // as:s 后输入关键词';
    console.log(`[as:search] ${msg}`);
    this._notify(msg);
    return;
  }

  // 可选：上下文联想（从触发行附近提取上下文，默认关闭）
  const contextEnabled = process.env.ASD_SEARCH_CONTEXT !== '0' || qualifiers.context === '1' || qualifiers.scope === 'near';
  const contextLines = Number(qualifiers.lines || process.env.ASD_SEARCH_CONTEXT_LINES || 5);
  const structuredEnabled = process.env.ASD_SEARCH_STRUCTURED !== '0';
  const structuredOptions = {
    includeImports: process.env.ASD_SEARCH_STRUCTURED_IMPORTS !== '0',
    includeTypes: process.env.ASD_SEARCH_STRUCTURED_TYPES !== '0',
    includeFunctions: process.env.ASD_SEARCH_STRUCTURED_FUNCTIONS !== '0',
    includeVars: process.env.ASD_SEARCH_STRUCTURED_VARS !== '0'
  };
  if (contextEnabled && fileLines && foundLineIndex >= 0) {
    const radius = Number.isFinite(contextLines) && contextLines > 0 ? contextLines : 5;
    const start = Math.max(0, foundLineIndex - radius);
    const end = Math.min(fileLines.length, foundLineIndex + radius + 1);
    const aroundLines = fileLines.slice(start, end)
    .filter((_, idx) => (start + idx) !== foundLineIndex);
    contextSnippet = aroundLines.join('\n').trim();
    if (contextSnippet.length > 600) {
    contextSnippet = contextSnippet.slice(0, 600);
    }
    if (structuredEnabled) {
    structuredContext = this._extractStructuredContext(fileLines, ext, foundLineIndex, structuredOptions);
    }
  }

  // 记录搜索上下文
  const langType = filter.language || 'all';
  const limitOverride = Number(qualifiers.limit);
  console.log(`[as:search] 搜索关键词: "${keyword}" | 文件: ${relativePath} | 语言: ${langType}`);
  if (Object.keys(qualifiers).length > 0) {
    console.log(`[as:search] 限定符: ${JSON.stringify(qualifiers)}`);
  }
  if (contextEnabled) {
    console.log(`[as:search] 上下文联想: ${contextSnippet ? '已启用' : '未获取到上下文'}`);
  }

  const structuredSummary = structuredContext ? this._formatStructuredContext(structuredContext) : '';
  const query = keyword;
  
  // 搜索模式，默认 hybrid 混合模式（合并 ranking/keyword/AI 前3名）
  const mode = qualifiers.mode || 'hybrid';

  const searchSessionId = `${relativePath}`;
  const userId = process.env.ASD_USER_ID || process.env.USER || process.env.USERNAME;

  if (process.env.ASD_DEBUG === '1') {
    console.log('[CHAIN] Xcode->SearchHandler', {
    specFile,
    projectRoot,
    keyword,
    mode: mode.toLowerCase(),
    sessionId: searchSessionId,
    userId
    });
  }

  // 使用统一搜索函数，hybrid 模式返回最多 9 条去重结果
  const enableAiAssist = process.env.ASD_DISABLE_AI_ASSIST !== '1'; // 默认启用，可通过环境变量禁用
  const searchResult = await performUnifiedSearch(projectRoot, query, {
    mode,
    limit: Number.isFinite(limitOverride) ? limitOverride : 9, 
    cache: false,
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    sessionId: searchSessionId,
    userId,
    context: {
    language: filter.language,
    filePath: relativePath,
    around: contextSnippet || undefined,
    structured: structuredContext || undefined,
    source: 'xcode'
    },
    enableAiAssist // 传递 AI 辅助开关
  });

  let results = searchResult.results;
  const intelligentLayer = searchResult.intelligentLayer;

  results = this._applyResultFilters(results, {
    type: qualifiers.type,
    trigger: qualifiers.trigger,
    path: qualifiers.path,
    category: qualifiers.category
  });

  if (results.length === 0) {
    const msg = keyword ? `「${keyword}」未找到匹配的 Recipe/Snippet` : '未找到匹配内容';
    console.log(`[as:search] ${msg}`);
    this._notify(msg);
    return;
  }

  console.log(`[as:search] 找到 ${results.length} 个匹配，请选择...`);
  if (intelligentLayer && (sessionId || userId)) {
    console.log('[as:search] 🤖 智能搜索已启用');
  }
  
  // 使用新的组合窗口（列表 + 预览一体）
  const items = results.map(r => {
    let code = r.code || r.content || '';
    let headers = r.headers || [];
    if (r.type === 'recipe' && r.content) {
    try {
      const { parseRecipeMd } = require('../../recipe/parseRecipeMd');
      const parsed = parseRecipeMd(r.content);
      if (parsed?.code) {
      code = parsed.code;
      }
      if (parsed?.headers) {
      headers = parsed.headers;
      }
    } catch (_) {}
    }
    const qualityLabel = r.qualityScore !== undefined
    ? `🤖 质量: ${Math.round(r.qualityScore * 100)}% `
    : '';
    const displayTitle = r.title || r.name || '';
    const recommendReason = r.recommendReason || r.explanation || '';
    const baseExplanation = r.recommendReason ? (r.explanation || '') : '';
    const agentLines = [];
    if (intelligentLayer && (r.qualityScore !== undefined || recommendReason)) {
    agentLines.push('🤖 智能搜索已启用 (Agent 增强结果)');
    }
    if (r.qualityScore !== undefined) {
    agentLines.push(`质量: ${Math.round(r.qualityScore * 100)}%`);
    }
    if (recommendReason) {
    agentLines.push(`推荐理由: ${recommendReason}`);
    }
    const agentExplanation = agentLines.join('\n');
    const explanation = agentExplanation
    ? (baseExplanation ? `${baseExplanation}\n${agentExplanation}` : agentExplanation)
    : baseExplanation;
    return {
    title: `${qualityLabel}${displayTitle}`,
    code: code,
    headers: headers,
    explanation: explanation,
    groupSize: r.groupSize || 0
    };
  });
  
  const selectedIndex = await nativeUi.showCombinedWindow(items, keyword);
  if (selectedIndex < 0) {
    if (intelligentLayer && userId) {
    results.slice(0, 3).forEach((item) => {
      intelligentLayer.recordSearchFeedback({
      userId,
      item,
      query: keyword,
      positive: false
      });
    });
    }
    return;
  }
  
  const selected = results[selectedIndex];
    if (intelligentLayer && userId) {
      intelligentLayer.recordSearchFeedback({
      userId,
      item: selected,
      query: keyword,
      positive: true
      });
    }

  // 验证窗口一致性
  if (windowContext && process.env.ASD_VERIFY_WINDOW !== '0') {
    const verification = await WindowContextManager.verifyWindowConsistency(fullPath, {
      strict: process.env.ASD_STRICT_WINDOW_CHECK !== '0'  // 默认启用严格模式
    });

    if (!verification.consistent) {
      const warnMsg = `⚠️  窗口不一致警告\n保存时应用: ${verification.savedContext.appName}\n当前应用: ${verification.currentContext.appName}`;
      console.warn(`[as:search] ${warnMsg}`);
      this._notify(warnMsg);
      
      // 如果启用严格模式，中止执行
      if (process.env.ASD_STRICT_WINDOW_CHECK !== '0') {
        console.log('[as:search] 严格模式已启用，中止代码插入');
        return;
      }

      if (process.env.ASD_DEBUG === '1') {
        console.log('[as:search] 窗口验证详情:', {
        reason: verification.reason,
        savedApp: verification.savedContext.appName,
        currentApp: verification.currentContext.appName,
        recordedAt: new Date(verification.savedContext.recordedAt).toISOString()
        });
      }
    } else if (process.env.ASD_DEBUG === '1') {
      console.log(`[as:search] 窗口验证通过 (${verification.reason})`);
    }
  }

  const selectedCode = items[selectedIndex].code;  // 获取选中项的代码
  const selectedHeaders = items[selectedIndex].headers || [];  // 获取头文件

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
    // 1. 只提取 Recipe 中的代码块部分，不包括简介
    let codeToInsert = selectedCode;
    if (selectedCode.includes('## AI Context') || selectedCode.includes('## AI Context / Usage Guide')) {
    const codeMatch = selectedCode.match(/```[\s\S]*?```/);
    if (codeMatch) {
      // 提取代码块内容，去掉反引号标记和语言标识符（任意字符串，可包含-）
      codeToInsert = codeMatch[0].replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '');
    }
    }

    // 2. 计算触发行的缩进，用于对齐插入的代码
    const triggerLine = lines[found];
    const indentMatch = triggerLine.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';

    // 3. 分离头文件和代码
    let headersToInsert = selectedHeaders.filter(h => h && h.trim());
    let codeLines = String(codeToInsert).split(/\r?\n/);

    // 3.1 从代码中提取 #import/#include/@import 头文件（如果 snippet 内包含）
    const extractedHeaders = [];
    const filteredCodeLines = [];
    for (const line of codeLines) {
    const trimmed = String(line || '').trim();
    if (trimmed.startsWith('#import ') || trimmed.startsWith('#include ') || trimmed.startsWith('@import ')) {
      extractedHeaders.push(trimmed);
      continue;
    }
    filteredCodeLines.push(line);
    }
    if (extractedHeaders.length > 0) {
    headersToInsert = [...headersToInsert, ...extractedHeaders];
    }
    codeLines = filteredCodeLines;

    // 3.2 兜底：如果仍然没有 headers，尝试从原始 Recipe 内容解析
    if (headersToInsert.length === 0 && selected && selected.content) {
    try {
      const { parseRecipeMd } = require('../../recipe/parseRecipeMd');
      const parsed = parseRecipeMd(selected.content);
      if (parsed && Array.isArray(parsed.headers) && parsed.headers.length > 0) {
      headersToInsert = parsed.headers.filter(h => h && String(h).trim());
      }
    } catch (_) {}
    }

    // 4. 对代码进行缩进处理（头文件不需要缩进，始终放在文件顶部）
    // 移除末尾的所有空行
    while (codeLines.length > 0 && !codeLines[codeLines.length - 1].trim()) {
      codeLines.pop();
    }
    const insertLines = codeLines.map((line, idx) => {
    if (!line) return line;
    // 保持每一行的一致缩进，包括第一行
    return indent + line;
    });

    // 5. 构建最终的插入内容：仅代码（headers 自动写入文件顶部）
    let finalInsertLines = [...insertLines];
    
    // 最后再确保末尾没有空行
    while (finalInsertLines.length > 0 && !finalInsertLines[finalInsertLines.length - 1].trim()) {
      finalInsertLines.pop();
    }
    
    // 🔍 调试：记录代码块信息
    console.log(`\n[CodeDebug] 代码块处理:`);
    console.log(`   触发行号: ${found + 1}`);
    console.log(`   触发内容: "${lines[found]}"`);
    console.log(`   代码行数: ${finalInsertLines.length}`);
    console.log(`   代码缩进: "${indent}" (${indent.length} 个字符)`);
    if (finalInsertLines.length > 0) {
      finalInsertLines.forEach((line, idx) => {
        const preview = line.substring(0, 80).replace(/\n/g, '\\n');
        console.log(`      [lines ${idx}] ${preview}${line.length > 80 ? '...' : ''}`);
      });
    }

    // 6. 判断是否使用剪贴板模式来保留撤销历史 (默认开启，可通过环境变量禁用)
    const autoMode = process.env.ASD_AUTO_PASTE_MODE !== '0';
    const useClipboard = autoMode || process.env.ASD_USE_CLIPBOARD !== '0' || (process.env.ASD_USE_CLIPBOARD === undefined && process.platform === 'darwin');
    
    if (useClipboard && process.platform === 'darwin') {
    // 使用剪贴板方案：复制代码，弹窗提示用户 Cmd+V 粘贴
    const ClipboardManager = require('../../infrastructure/notification/ClipboardManager');
    
    // 添加注释标记
    const commentMarker = this._generateInsertMarker(fullPath, selected);
    let markedLines = commentMarker ? [indent + commentMarker, ...finalInsertLines] : finalInsertLines;
    
    const autoPaste = autoMode || process.env.ASD_AUTO_PASTE !== '0' || (process.env.ASD_AUTO_PASTE === undefined);
    const autoCut = autoMode || process.env.ASD_AUTO_CUT !== '0' || (process.env.ASD_AUTO_CUT === undefined);

    // 先初始化 headers 提示（剪贴板模式下用 Xcode 自动插入）
    let headersTip = '';

    if (autoPaste && autoCut) {
      const notifyMsg = '将尝试自动剪切触发行并粘贴代码\n\n用途：触发 Cmd+X / Cmd+V 以保留撤销历史\n如未授权，请在系统设置启用"辅助功能"后重试' + headersTip;
      this._notify(notifyMsg);
      const triggerLineNumber = found + 1;
      
      // 先进行依赖弹窗提示（不改动文件）
      const preflightResult = await HeaderHandler.handleHeadersBatch(
        specFile,
        fullPath,
        headersToInsert,
        { debug: true, isSwift: fullPath.endsWith('.swift'), preflight: true }
      );
      if (preflightResult.blocked) return;

      const suggestionNoteLines = HeaderHandler.formatSuggestionNotes(
        preflightResult.suggestionNotes,
        indent
      );
      markedLines = this._buildMarkedLines(finalInsertLines, commentMarker, suggestionNoteLines, indent);
      const insertLinesForFile = this._buildMarkedLines(finalInsertLines, null, suggestionNoteLines, indent);
      const indentedCode = markedLines.join('\n');

      // 弹窗提示完成后再删除触发行（保持原有插入流程）
      const cutOk = this._tryAutoCutXcode(triggerLineNumber, triggerLine);
      if (!cutOk) {
      console.warn('⚠️  自动剪切失败，已降级为直接插入');
      await this._runFileInsertFlow(fullPath, lines, found, finalInsertLines, selected, projectRoot, headersToInsert, indent, specFile);
      return;
      }

      // 按照预先决策插入头文件（不再弹窗）
      const headerResult = await HeaderHandler.handleHeadersBatch(
        specFile,
        fullPath,
        headersToInsert,
        { debug: true, isSwift: fullPath.endsWith('.swift'), decisions: preflightResult.decisions }
      );
      if (headerResult.blocked) return;

      const pasteLineNumber = HeaderHandler.computePasteLineNumber(
        triggerLineNumber,
        headerResult.headerInsertCount,
        fullPath,
        { forceOffset: true, expectedHeaderCount: headersToInsert.length }
      );

      // 插入头文件后跳回触发位置
      this._tryJumpToLineXcode(pasteLineNumber);

      const wrote = ClipboardManager.write(indentedCode);
      if (!wrote) {
      console.warn('⚠️  剪贴板写入失败，已降级为直接插入');
      await this._runFileInsertFlow(fullPath, lines, found, finalInsertLines, selected, projectRoot, headersToInsert, indent, specFile);
      return;
      }

      // 注意：需要包括注释标记行
      const actualInsertLines = commentMarker ? markedLines.length : finalInsertLines.length;
      const pasted = this._tryAutoPasteXcode(actualInsertLines);
      if (pasted) {
      console.log('✅ 代码已自动粘贴到 Xcode（可 Cmd+Z 撤销）');
      // 🔍 调试：记录粘贴后的状态（不写入文件，避免与 Xcode 冲突）
      this._logAutoPasteCompletion(fullPath, found, markedLines, headersToInsert, selected);
      if (headersTip) {
        this._notify('代码已粘贴' + headersTip);
      }
      } else {
      console.warn('⚠️  自动粘贴失败，请在 Xcode 中按 Cmd+V 完成粘贴');
      const fallbackMsg = '代码已复制到剪贴板，请在 Xcode 中按 Cmd+V 粘贴\n\n提示：通过剪贴板粘贴可以保留撤销历史' + headersTip;
      this._notify(fallbackMsg);
      }
    } else if (autoPaste) {
      const triggerLineNumber = found + 1;
      
      const headerResult = await HeaderHandler.handleHeadersBatch(
        specFile,
        fullPath,
        headersToInsert,
        { isSwift: fullPath.endsWith('.swift') }
      );
      if (headerResult.blocked) return;

      const suggestionNoteLines = HeaderHandler.formatSuggestionNotes(
        headerResult.suggestionNotes,
        indent
      );
      markedLines = this._buildMarkedLines(finalInsertLines, commentMarker, suggestionNoteLines, indent);
      const insertLinesForFile = this._buildMarkedLines(finalInsertLines, null, suggestionNoteLines, indent);
      const indentedCode = markedLines.join('\n');
      
      const pasteLineNumber = HeaderHandler.computePasteLineNumber(
        triggerLineNumber,
        headerResult.headerInsertCount,
        fullPath,
        { forceOffset: true, expectedHeaderCount: headersToInsert.length }
      );
      
      this._tryJumpToLineXcode(pasteLineNumber);
      if (!ClipboardManager.write(indentedCode)) {
      console.warn('⚠️  剪贴板写入失败，已降级为直接插入');
      this._performDirectInsert(fullPath, lines, found, insertLinesForFile, selected, projectRoot);
      return;
      }
      const autoPasteMsg = '将尝试自动粘贴到 Xcode\n\n用途：触发 Cmd+V 以保留撤销历史\n如未授权，请在系统设置启用"辅助功能"后重试' + headersTip;
      this._notify(autoPasteMsg);
      // 注意：需要包括注释标记行
      const actualInsertLines2 = commentMarker ? markedLines.length : finalInsertLines.length;
      const pasted = this._tryAutoPasteXcode(actualInsertLines2);
      if (pasted) {
      console.log('✅ 代码已自动粘贴到 Xcode（可 Cmd+Z 撤销）');
      // 🔍 调试：记录粘贴后的状态（不写入文件，避免与 Xcode 冲突）
      this._logAutoPasteCompletion(fullPath, found, markedLines, headersToInsert, selected);
      if (headersTip) {
        this._notify('代码已粘贴' + headersTip);
      }
      } else {
      console.warn('⚠️  自动粘贴失败，请在 Xcode 中按 Cmd+V 完成粘贴');
      const fallbackMsg = '代码已复制到剪贴板，请在 Xcode 中按 Cmd+V 粘贴\n\n提示：通过剪贴板粘贴可以保留撤销历史' + headersTip;
      this._notify(fallbackMsg);
      }
    } else {
      const triggerLineNumber = found + 1;
      
      const headerResult = await HeaderHandler.handleHeadersBatch(
        specFile,
        fullPath,
        headersToInsert,
        { isSwift: fullPath.endsWith('.swift') }
      );
      if (headerResult.blocked) return;
      
      const pasteLineNumber = HeaderHandler.computePasteLineNumber(
        triggerLineNumber,
        headerResult.headerInsertCount,
        fullPath,
        { forceOffset: true, expectedHeaderCount: headersToInsert.length }
      );
      
      this._tryJumpToLineXcode(pasteLineNumber);
      if (!ClipboardManager.write(indentedCode)) {
      console.warn('⚠️  剪贴板写入失败，已降级为直接插入');
      await this._runFileInsertFlow(fullPath, lines, found, finalInsertLines, selected, projectRoot, headersToInsert, indent, specFile);
      return;
      }
      this._logAutoPasteCompletion(fullPath, found, markedLines, headersToInsert, selected);
      const clipboardMsg = '代码已复制到剪贴板，按 Cmd+V 粘贴\n\n提示：通过剪贴板粘贴可以保留撤销历史' + headersTip;
      this._notify(clipboardMsg);
    }

    try {
      const recipeStats = require('../../recipe/recipeStats');
      recipeStats.recordRecipeUsage(projectRoot, {
      trigger: selected.trigger,
      recipeFilePath: selected.name,
      source: 'human'
      });
    } catch (_) {}
    } else {
    // 默认方案：直接写入文件（向后兼容）
    await this._runFileInsertFlow(fullPath, lines, found, finalInsertLines, selected, projectRoot, headersToInsert, indent, specFile);
    }
  }
  }

  /**
   * 记录 AutoPaste 完成时的诊断信息（不写入文件）
   * 用于剪贴板模式，避免与 Xcode 编辑器冲突
   */
  _logAutoPasteCompletion(fullPath, found, markedLines, headersToInsert, selected) {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('🚀 [AutoSnippet] ===== 代码自动粘贴过程（诊断日志） =====');
    console.log('='.repeat(80));
    console.log(`📄 目标文件: ${fullPath}`);
    console.log(`📍 触发行号: ${found + 1} (0-based index: ${found})`);
    console.log(`📊 要粘贴的代码行数: ${markedLines.length}`);
    console.log(`\n📋 完整代码块 (${markedLines.length} 行):`);
    markedLines.slice(0, 3).forEach((line, idx) => {
    const preview = line.substring(0, 100).replace(/\n/g, '\\n');
    console.log(`   ${idx === 0 ? '⭐' : '  '} [行 ${idx}] ${preview}${line.length > 100 ? '...' : ''}`);
    });
    if (markedLines.length > 3) {
    console.log(`   ... (还有 ${markedLines.length - 3} 行)`);
    }
    
    console.log(`\n📌 诊断信息:`);
    console.log(`   标记在第 ${found + 1} 行（该行会被替换）`);
    console.log(`   插入的代码块首行: "${markedLines[0] || ''}"`);
    console.log(`   头文件定义: ${headersToInsert.length} 个`);
    console.log(`   代码已粘贴到编辑器，请在 Xcode 中按 Cmd+S 保存`);
    
    console.log('='.repeat(80));
    console.log('✅ [AutoSnippet] ===== 代码自动粘贴过程结束 =====');
    console.log('='.repeat(80) + '\n');
  } catch (err) {
    console.warn('⚠️  诊断日志输出失败:', err.message);
  }
  }

  _buildMarkedLines(finalInsertLines, commentMarker, suggestionNoteLines, indent) {
  const baseLines = commentMarker
    ? [indent + commentMarker, ...finalInsertLines]
    : finalInsertLines;
  if (Array.isArray(suggestionNoteLines) && suggestionNoteLines.length > 0) {
    return [...suggestionNoteLines, ...baseLines];
  }
  return baseLines;
  }

  async _runFileInsertFlow(fullPath, lines, found, finalInsertLines, selected, projectRoot, headersToInsert, indent, specFile) {
  const headerResult = await HeaderHandler.handleHeadersBatch(
    specFile,
    fullPath,
    headersToInsert,
    { isSwift: fullPath.endsWith('.swift') }
  );
  if (headerResult.blocked) return;
  const suggestionNoteLines = HeaderHandler.formatSuggestionNotes(
    headerResult.suggestionNotes,
    indent
  );
  const insertLinesForFile = this._buildMarkedLines(finalInsertLines, null, suggestionNoteLines, indent);
  this._performDirectInsert(fullPath, lines, found, insertLinesForFile, selected, projectRoot);
  }

  _performDirectInsert(fullPath, lines, found, insertLines, selected, projectRoot) {
  // 🔍 调试：记录自动化过程开始
  console.log('\n' + '='.repeat(80));
  console.log('🚀 [AutoSnippet] ===== 代码自动插入过程开始 =====');
  console.log('='.repeat(80));
  console.log(`📄 目标文件: ${fullPath}`);
  console.log(`📍 触发行号: ${found + 1} (0-based index: ${found})`);
  console.log(`📍 触发内容: ${lines[found]}`);
  console.log(`📊 要插入的代码行数: ${insertLines.length}`);
  
  // 添加注释标记：表示这是由 AutoSnippet 自动插入的代码
  const commentMarker = this._generateInsertMarker(fullPath, selected);
  // 获取第一行代码的缩进，用于注释标记
  const firstLineIndent = insertLines.length > 0 && insertLines[0] 
    ? insertLines[0].match(/^(\s*)/)[1] 
    : '';
  let markedInsertLines = commentMarker ? [firstLineIndent + commentMarker, ...insertLines] : insertLines;
  
  // ⚠️  第三关：确保末尾没有空行（防止 // as:s 行被替换成空行）
  while (markedInsertLines.length > 0 && !markedInsertLines[markedInsertLines.length - 1].trim()) {
    markedInsertLines.pop();
  }
  
  console.log(`\n📝 标记注释: "${commentMarker}"`);
  console.log(`📋 完整代码块 (${markedInsertLines.length} 行):`);
  markedInsertLines.forEach((line, idx) => {
    console.log(`   ${idx === 0 ? '⭐' : '  '} [行 ${idx}] ${line.substring(0, 100)}${line.length > 100 ? '...' : ''}`);
  });
  
  const newLines = [...lines.slice(0, found), ...markedInsertLines, ...lines.slice(found + 1)];
  fs.writeFileSync(fullPath, newLines.join('\n'), 'utf8');
  
  // 🔍 调试：文件写入后查找标记位置
  const fileContent = fs.readFileSync(fullPath, 'utf8');
  const fileLines = fileContent.split('\n');
  let markerLineNumber = -1;
  fileLines.forEach((line, idx) => {
    if (line.includes('🤖 AutoSnippet')) {
      markerLineNumber = idx + 1; // 1-based
      console.log(`\n✅ 找到标记行！`);
      console.log(`   行号: ${markerLineNumber} (0-based: ${idx})`);
      console.log(`   内容: ${line}`);
    }
  });
  
  console.log(`\n📊 文件插入后统计:`);
  console.log(`   原文件行数: ${lines.length}`);
  console.log(`   新文件行数: ${newLines.length}`);
  console.log(`   增加行数: ${newLines.length - lines.length}`);
  
  if (markerLineNumber > 0) {
    console.log(`   📌 标记在第 ${markerLineNumber} 行`);
    console.log(`   📌 原触发行在第 ${found + 1} 行`);
    console.log(`   📌 差异: ${markerLineNumber - (found + 1)} 行`);
  }
  
  console.log('='.repeat(80));
  console.log('✅ [AutoSnippet] ===== 代码自动插入过程结束 =====');
  console.log('='.repeat(80) + '\n');
  
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

  /**
   * 生成插入标记注释
   * 根据文件类型返回对应的注释格式
   */
  _generateInsertMarker(filePath, selected) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath);
    
    // 获取 recipe 触发词和名称
    const trigger = selected.trigger ? `[${selected.trigger}]` : '';
    const recipeName = selected.name ? ` from ${selected.name}` : '';
    const timestamp = new Date().toLocaleString('zh-CN', { 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
    });
    
    // 根据文件类型选择注释格式
    if (['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'].includes(ext)) {
    return `// 🤖 AutoSnippet${trigger}${recipeName} @ ${timestamp}`;
    } else if (['.swift', '.m', '.h', '.c', '.cpp', '.cc', '.java'].includes(ext)) {
    return `// 🤖 AutoSnippet${trigger}${recipeName} @ ${timestamp}`;
    } else if (['.py'].includes(ext)) {
    return `# 🤖 AutoSnippet${trigger}${recipeName} @ ${timestamp}`;
    } else if (['.rb'].includes(ext)) {
    return `# 🤖 AutoSnippet${trigger}${recipeName} @ ${timestamp}`;
    } else if (['.lua'].includes(ext)) {
    return `-- 🤖 AutoSnippet${trigger}${recipeName} @ ${timestamp}`;
    } else if (['.html', '.xml', '.svg'].includes(ext)) {
    return `<!-- 🤖 AutoSnippet${trigger}${recipeName} @ ${timestamp} -->`;
    } else if (['.css', '.scss', '.less'].includes(ext)) {
    return `/* 🤖 AutoSnippet${trigger}${recipeName} @ ${timestamp} */`;
    } else if (['.sql'].includes(ext)) {
    return `-- 🤖 AutoSnippet${trigger}${recipeName} @ ${timestamp}`;
    }
    
    // 默认使用 //
    return `// 🤖 AutoSnippet${trigger}${recipeName} @ ${timestamp}`;
  } catch (_) {
    return null;
  }
  }

  _tryAutoPasteXcode(lineCount = 0) {
  try {
    // 需要辅助功能权限；失败时回退到提示用户手动粘贴
    const reindent = false;
    const selectLines = false;
    const moveCursor = false;
    const args = [
    '-e', 'tell application "Xcode" to activate',
    '-e', 'delay 0.5',
    '-e', 'tell application "System Events"',
    // 光标已在行首（来自 _tryJumpToLineXcode）
    // 选中整行（从行首到行尾，不含换行符）后粘贴替代
    '-e', 'key code 123 using command down',  // Cmd+Home 到行首
    '-e', 'delay 0.1',
    '-e', 'key code 124 using {command down, shift down}',  // Cmd+Shift+End 选到行尾
    '-e', 'delay 0.2',
    '-e', 'keystroke "v" using command down'  // Cmd+V 粘贴替代（多行代码会替代该行）
    ];

    if (selectLines) {
    // 粘贴后，选择刚粘贴的行（从当前行向上选 lineCount-1 行）
    args.push('-e', 'delay 0.5');
    // 将光标移到插入行的开头
    args.push('-e', 'key code 123 using command down');  // Cmd+Home
    args.push('-e', 'delay 0.5');
    // 向下选择所有粘贴的行
    for (let i = 1; i < lineCount; i++) {
      args.push('-e', 'key code 125 using shift down');  // Shift+Down
      args.push('-e', 'delay 0.2');
    }
    }

    if (moveCursor) {
    args.push('-e', 'delay 0.1');
    args.push('-e', 'key code 124 using command down');
    }

    args.push('-e', 'end tell');
    const res = spawnSync('osascript', args, { stdio: 'ignore' });
    if (res.status !== 0) throw new Error('osascript failed');
    return true;
  } catch (err) {
    console.warn('⚠️  自动粘贴异常:', err.message);
    return false;
  }
  }

  _tryAutoCutXcode(lineNumber, triggerLine) {
  try {
    const safeLineNumber = Number(lineNumber);
    if (!Number.isFinite(safeLineNumber) || safeLineNumber <= 0) {
    console.warn('⚠️  无效行号，无法自动剪切');
    return false;
    }
    console.log(`⏳ [AppleScript] 激活 Xcode 并跳转到第 ${safeLineNumber} 行...`);
    const escapedLine = this._escapeAppleScriptString(String(safeLineNumber));
    const args = [
    '-e', 'tell application "Xcode" to activate',
    '-e', 'delay 0.5',
    '-e', 'tell application "System Events"',
    '-e', 'keystroke "l" using command down',
    '-e', 'delay 0.5',
    '-e', `keystroke "${escapedLine}"`,
    '-e', 'delay 0.5',
    '-e', 'key code 36',  // Return
    '-e', 'delay 0.5',
    '-e', 'key code 123 using command down',  // Cmd+Home (line start)
    '-e', 'delay 0.5',
    '-e', 'key code 124 using {command down, shift down}',  // Cmd+Shift+End (select to line end)
    '-e', 'delay 0.5',
    '-e', 'keystroke "x" using command down',  // Cmd+X (cut)
    '-e', 'end tell'
    ];
    const res = spawnSync('osascript', args, { stdio: 'ignore' });
    if (res.status !== 0) throw new Error('osascript failed');
    return true;
  } catch (err) {
    console.warn('⚠️  自动剪切异常:', err.message);
    return false;
  }
  }

  _escapeAppleScriptString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  _tryJumpToLineXcode(lineNumber) {
  try {
    const safeLineNumber = Number.isFinite(lineNumber) && lineNumber > 0 ? lineNumber : 1;
    const args = [
    '-e', 'tell application "Xcode" to activate',
    '-e', 'delay 0.3',
    '-e', 'tell application "System Events"',
    '-e', 'keystroke "l" using command down',  // Cmd+L 打开"Go to Line"对话框
    '-e', 'delay 0.3',
    '-e', `keystroke "${this._escapeAppleScriptString(String(safeLineNumber))}"`,  // 输入行号
    '-e', 'delay 0.2',
    '-e', 'key code 36',  // Return 键：跳转到该行（光标在行首）
    '-e', 'delay 0.2',
    '-e', 'end tell'
    ];
    const res = spawnSync('osascript', args, { stdio: 'ignore' });
    if (res.status !== 0) throw new Error('osascript failed');
    return true;
  } catch (_) {
    return false;
  }
  }

  /**
   * 从文件中读取已有的 #import 语句
   * @param {string} filePath - 文件路径
   * @returns {Array<string>}
   */

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
