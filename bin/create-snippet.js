#!/usr/bin/env node

/**
 * 职责：
 * - 从源码中的 // autosnippet:code 标记提取代码片段并生成 AutoSnippet 配置（AutoSnippet.boxspec.json）
 * - 支持更新已有片段（按 trigger/identifier），并可同步到项目 spec（AutoSnippet/AutoSnippet.boxspec.json）
 * - 可选生成“headerVersion”片段：写入 // autosnippet:include 标记用于后续自动注入头文件
 *
 * 核心流程：
 * - findFilesWithACode(): 扫描目录找到包含 // autosnippet:code 的文件
 * - createCodeSnippets(): 读取 code 块 → 组装 snippet 对象 → saveFromFile() 落盘
 * - saveFromFile(): 写入模块 spec + 同步 root spec + install.addCodeSnippets() 写入 Xcode CodeSnippets
 *
 * 核心方法（主要导出）：
 * - createCodeSnippets(specFile, answers, updateSnippet, selectedFilePath)
 * - updateCodeSnippets(specFile, word, key, value)
 * - saveFromFile(specFile, snippet)
 * - findFilesWithACode(filePath)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const cache = require('../lib/infrastructure/cache/CacheStore.js');
const triggerSymbol = require('../lib/infrastructure/config/TriggerSymbol.js');
const findPath = require('../lib/infrastructure/paths/PathFinder');
const Paths = require('../lib/infrastructure/config/Paths.js');
const compat = require('../lib/context/ContextServiceCompat.js');
const AiFactory = require('../lib/ai/AiFactory');
const headerResolution = require('../lib/ai/headerResolution.js');
// 全局常量
const README_NAME = 'readme.md';
// 全局路径
const CMD_PATH = process.cwd();
const CODE_MARK_NEW = '// autosnippet:code';
const CODE_MARK_SHORT = '// as:code';

/**
 * 根据文件路径确定模块名（SPM）
 * 返回路径中最近的（最深的）target 名称
 */
function determineModuleName(filePath, packageInfo) {
  // 从路径中提取模块名
  // 例如：Business/BDNetworkAPI/Code/... -> BDNetworkAPI（不是 Business）
  const packagePath = packageInfo.path;
  const relativePath = path.relative(packagePath, filePath);
  const segments = relativePath.split(path.sep);

  // ✅ 从后向前查找匹配的 target（优先匹配路径中更深的 target）
  // 这样可以避免匹配到聚合 target（如 Business），而匹配到实际的 target（如 BDNetworkAPI）
  for (let i = segments.length - 1; i >= 0; i--) {
  const segment = segments[i];
  if (packageInfo.targets.includes(segment)) {
    return segment;
  }
  }

  // 如果找不到，使用第一个 target（排除包名，如果包名也是 target）
  const firstTarget = packageInfo.targets[0];
  if (firstTarget && firstTarget !== packageInfo.name) {
  return firstTarget;
  }
  
  // 最后回退到包名
  return packageInfo.name;
}

function updateCodeSnippets(specFile, word, key, value) {
  if (key && key !== 'title' && key !== 'link' && key !== 'summary') {
  console.log('此项属性不存在或不可修改。');
  return;
  }
  if (key === 'link') {
  value = encodeURI(value);
  }
  let placeholder = null;

  try {
  // 读取AutoSnippet的占位配置
  const data = fs.readFileSync(specFile, 'utf8');
  if (data) {
    placeholder = JSON.parse(data);
  }
  } catch (err) {
  console.error(err);
  }

  if (placeholder !== null) {
  let snippet = null;

  for (let index = 0; index < placeholder.list.length; index++) {
    let placeItem = placeholder.list[index];

    const t = placeItem && placeItem.trigger ? String(placeItem.trigger) : '';
    const raw = triggerSymbol.stripTriggerPrefix(t);
    if (raw === word || t === word || t === (triggerSymbol.TRIGGER_SYMBOL + word)) {
    snippet = placeItem;
    if (key) {
      snippet[key] = value;
    }
    break;
    }
  }

  if (snippet !== null) {
    createCodeSnippets(specFile, null, snippet);
  } else {
    console.log('未找到此联想词。');
  }
  } else {
  console.log('执行异常。');
  }
}

/**
 * 查找包含 // autosnippet:code 标记的文件
 */
async function findFilesWithACode(filePath) {
  const filesWithACode = [];
  
  try {
  const files = await fs.promises.readdir(filePath);
  
  for (const filename of files) {
    const filedir = path.join(filePath, filename);
    try {
    const stats = await fs.promises.lstat(filedir);
    if (stats.isFile()) {
      // 只检查源代码文件
      if (filename.endsWith('.m') || filename.endsWith('.h') || filename.endsWith('.swift')) {
      const content = await fs.promises.readFile(filedir, 'utf8');
      const lines = content.split('\n');
      
      // 检查是否包含代码块标记（// autosnippet:code / // as:code）
      for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim().toLowerCase();
        if (t === CODE_MARK_NEW || t === CODE_MARK_SHORT) {
        filesWithACode.push({
          path: filedir,
          name: filename,
          line: i + 1
        });
        break; // 找到标记后跳出，每个文件只记录一次
        }
      }
      }
    }
    } catch (err) {
    // 忽略无法读取的文件
    continue;
    }
  }
  } catch (err) {
  console.error('Error reading directory:', err);
  }
  
  return filesWithACode;
}

function createCodeSnippets(specFile, answers, updateSnippet, selectedFilePath) {
  let snippet = updateSnippet;
  let isHaveHeader = snippet === null ? false : (snippet.headName !== undefined);

  if (snippet === null) {
  // ✅ 处理 completion_more（可能是数组或字符串）
  const completionMoreStr = Array.isArray(answers.completion_more) 
    ? answers.completion_more.join('') 
    : answers.completion_more;
  
  const answersKeys = answers.completion_first + completionMoreStr + answers.title;
  const answersIdBuff = Buffer.from(answersKeys, 'utf-8');
  const identifier = 'AutoSnip_' + answersIdBuff.toString('base64').replace(/\//g, '');

  snippet = {
    identifier: identifier,
    title: answers.title,
    trigger: triggerSymbol.TRIGGER_SYMBOL + answers.completion_first,
    completion: triggerSymbol.TRIGGER_SYMBOL + answers.completion_first + completionMoreStr,
    summary: answers.summary,
    languageShort: 'objc',
  };

  if (answers.link) {
    snippet.link = encodeURI(answers.link);
  }
  isHaveHeader = answers.header;
  }

  // ✅ 如果指定了文件路径，直接使用；否则查找当前目录下的所有文件
  let filePathArr = [];
  
  if (selectedFilePath) {
  // 使用指定的文件
  filePathArr = [selectedFilePath];
  readStream(specFile, filePathArr, snippet, isHaveHeader);
  } else {
  // 原有逻辑：查找当前目录下的所有文件
  const filePath = CMD_PATH;
  fs.readdir(filePath, function (err, files) {
    if (err) {
    console.log(err);
    return;
    }

    files.forEach(function (filename) {
    const filedir = path.join(filePath, filename);
    try {
      // 读取路径是否为文件
      const stats = fs.lstatSync(filedir);
      const isFile = stats.isFile();
      if (isFile) {
      filePathArr.push(filedir);
      }
    } catch (err) {
      console.error(err);
    }
    });

    readStream(specFile, filePathArr, snippet, isHaveHeader);
  });
  }
}

function readStream(specFile, filePathArr, snippet, isHaveHeader) {
  if (filePathArr.length === 0) {
  console.log('未找到由 // as:code 或 // autosnippet:code 标识的代码块，请检查当前文件目录。');
  return;
  }

  const filePath = filePathArr.pop();
  const rl = readline.createInterface({
  input: fs.createReadStream(filePath),
  crlfDelay: Infinity
  });

  let canPush = false;
  let codeList = [];

  let lineIndex = 0;
  let positionList = [];

  rl.on('line', function (line) {
  lineIndex++;

  if (canPush) {
    codeList.push(escapeString(line));
  }
  const t = line.trim().toLowerCase();
  if (t === CODE_MARK_NEW || t === CODE_MARK_SHORT) {
    canPush = !canPush;
    positionList.push(lineIndex - 1);
  }
  });

  rl.on('close', async function () {
  if (codeList.length > 1) {
    codeList.pop();

    if (filePath.endsWith('.swift')) {
    snippet.languageShort = 'swift';
    }

    if (isHaveHeader) {
    const dotIndex = filePath.lastIndexOf('.');
    const slashIndex = filePath.lastIndexOf('/');
    const fileName = filePath.substring(slashIndex + 1, dotIndex + 1) + 'h';
    const thePath = filePath.substring(0, slashIndex + 1);

    // ✅ 使用 SPM 的 Package.swift 查找（替代 .boxspec）
    findPath.findPackageSwiftPath(thePath).then(async function (packagePath) {
      if (!packagePath) {
      console.log('未找到 Package.swift 文件，请检查路径。');
      snippet.body = codeList;
      // ✅ 查找 target 根目录（Code 或 Sources 的父目录）
      let targetRootDir = await findPath.findTargetRootDir(filePath);
      if (!targetRootDir) {
        // 如果找不到，使用文件所在目录的父目录作为后备
        targetRootDir = path.dirname(path.dirname(filePath));
      }
      const moduleSpecFile = path.join(targetRootDir, 'AutoSnippet.boxspec.json');
      await saveFromFile(moduleSpecFile, snippet);
      return;
      }

      // 解析 Package.swift 获取模块信息
      const packageInfo = await findPath.parsePackageSwift(packagePath);
      if (!packageInfo) {
      snippet.body = codeList;
      // ✅ 查找 target 根目录（Code 或 Sources 的父目录）
      let targetRootDir = await findPath.findTargetRootDir(filePath);
      if (!targetRootDir) {
        // 如果找不到，使用 Package.swift 所在目录作为后备
        targetRootDir = path.dirname(packagePath);
      }
      const moduleSpecFile = path.join(targetRootDir, 'AutoSnippet.boxspec.json');
      await saveFromFile(moduleSpecFile, snippet);
      return;
      }

      // 根据当前文件路径确定模块名
      const moduleName = determineModuleName(filePath, packageInfo);
      const headerNameWithoutExt = fileName.substring(0, fileName.length - 2); // 移除 .h

      // ✅ 查找 target 根目录（Code 或 Sources 的父目录）
      let targetRootDir = await findPath.findTargetRootDir(filePath);
      if (!targetRootDir) {
      // 如果找不到 target 根目录，使用 Package.swift 所在目录作为后备
      targetRootDir = packageInfo.path;
      }
      const moduleRoot = targetRootDir;

      // ✅ 查找头文件（适配 SPM 的 include/ModuleName/ 结构）
      // 在 target 根目录下查找（可能包含 Code/ 或 Sources/ 这样的结构）
      const headerPath = await findPath.findSubHeaderPath(targetRootDir, headerNameWithoutExt, moduleName);

      snippet.body = codeList;
      snippet.specName = moduleName;

      if (headerPath) {
      // ✅ headName 存储相对于 target 根目录的相对路径
      // 例如：target 根目录在 BDNetworkAPI/，头文件在 BDNetworkAPI/Code/xxx.h
      // 则 headName = "Code/xxx.h"
      const headerRelativePath = path.relative(targetRootDir, headerPath);
      snippet.headName = headerRelativePath;
      } else {
      // 如果找不到头文件，使用文件名
      snippet.headName = fileName;
      }

      // 查找 README.md（在 target 根目录）
      try {
      const readmePath = path.join(targetRootDir, README_NAME);
      await fs.promises.access(readmePath);
      const readmeRelativePath = path.relative(targetRootDir, readmePath);
      snippet.readme = encodeURI(readmeRelativePath);
      } catch {
      // README.md 不存在，跳过
      }

      // ✅ SPM 模块：.boxspec 文件位置在 target 根目录（Code 或 Sources 的父目录）
      const moduleSpecFile = path.join(targetRootDir, 'AutoSnippet.boxspec.json');
      await saveFromFile(moduleSpecFile, snippet);
    }).catch(async function (err) {
      console.error('Error finding Package.swift:', err);
      snippet.body = codeList;
      await saveFromFile(specFile, snippet);
    });
    } else {
    snippet.body = codeList;
    await saveFromFile(specFile, snippet);
    }
    // 移除 code 标识
    removeAcodeMark(filePath, positionList);
  } else {
    readStream(specFile, filePathArr, snippet, isHaveHeader);
  }
  });
}

async function saveFromFile(specFile, snippet) {
  // projectRoot 应该是 specFile 的父目录的父目录（包含知识库目录的目录）
  const projectRoot = path.dirname(path.dirname(specFile));
  const repository = compat.getSpecRepositoryInstance(projectRoot);
  await repository.saveSnippet(specFile, snippet, { syncRoot: true, installSingle: true });
  console.log('create success.');
}

function removeAcodeMark(filePath, positionList) {
  if (positionList.length === 0) {
  return;
  }
  try {
  const data = fs.readFileSync(filePath, 'utf8');
  const lineArray = data.split('\n');

  positionList = positionList.reverse();
  for (let i = 0; i < positionList.length; i++) {
    const position = positionList[i];

    const t = lineArray[position].trim().toLowerCase();
    if (t === CODE_MARK_NEW || t === CODE_MARK_SHORT) {
    lineArray.splice(position, 1);
    }
  }

  fs.writeFileSync(filePath, lineArray.join('\n'), 'utf8');
  } catch (err) {
  console.error(err);
  }
}

function escapeString(string) {
  // 必须先转义 &，否则会把 &lt; 转成 &amp;lt;
  string = string.replace(/&/g, '&amp;');
  string = string.replace(/</g, '&lt;');
  string = string.replace(/>/g, '&gt;');
  return string;
}

function createCodeSnippetsFromText(specFile, answers, text, options = {}) {
  if (!text || !String(text).trim()) {
  console.error('❌ 剪贴板内容为空，无法创建 snippet。');
  return;
  }
  // projectRoot 应该是 specFile 的父目录的父目录（包含知识库目录的目录）
  const projectRoot = path.dirname(path.dirname(specFile));
  const factory = compat.getSnippetFactoryInstance(projectRoot);
  const snippet = factory.fromText(answers, text, options);
  if (!snippet) {
  console.error('❌ 剪贴板内容为空，无法创建 snippet。');
  return;
  }

  if (answers.header) {
  console.log('⚠️  传统模式：已忽略 headerVersion。建议使用 AI 模式：asd create --clipboard [--path 相对路径]');
  }

  saveFromFile(specFile, snippet);
}

/** 从 AI 提取结果创建并保存 snippet（与 web 保存逻辑一致） */
async function createFromExtracted(projectRoot, rootSpecPath, extracted) {
  if (!extracted || !extracted.title || !extracted.code) {
  console.error('❌ AI 结果不完整：需要 title / code');
  return;
  }
  const trigger = (extracted.trigger || '').trim() || (triggerSymbol.TRIGGER_SYMBOL + extracted.title.replace(/\s+/g, ''));
  const prefix = triggerSymbol.hasTriggerPrefix(trigger) ? '' : triggerSymbol.TRIGGER_SYMBOL;
  const normalizedTrigger = triggerSymbol.hasTriggerPrefix(trigger) ? trigger : prefix + trigger;
  const category = extracted.category || 'Utility';
  const categoryPart = category ? triggerSymbol.getPrefixFromTrigger(normalizedTrigger) + category : '';
  const isSwift = (extracted.language || '').toLowerCase() === 'swift';
  const codeLines = extracted.code.split('\n').map(s => s.replace(/\r$/, ''));
  let body = codeLines;
  const includeHeaders = extracted.includeHeaders !== false;
  const headers = Array.isArray(extracted.headers) ? extracted.headers : [];
  const headerPaths = Array.isArray(extracted.headerPaths) ? extracted.headerPaths : [];
  const moduleName = extracted.moduleName || null;

  if (includeHeaders && headers.length > 0) {
  const markerLineService = compat.getMarkerLineInstance(projectRoot);
  const markerLines = headers.map((h, idx) => markerLineService.toAsMarkerLine(h, isSwift, headerPaths[idx], moduleName)).filter(Boolean);
  body = [...markerLines, '', ...body];
  }

  body = body.map(line => String(line).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));

  const snippet = {
  identifier: 'AutoSnip_' + Buffer.from(Date.now() + normalizedTrigger + extracted.title, 'utf-8').toString('base64').replace(/\//g, ''),
  title: extracted.category ? `[${extracted.category}] ${(extracted.title || '').replace(/^\[.*?\]\s*/, '')}` : extracted.title,
  trigger: normalizedTrigger,
  completion: normalizedTrigger + categoryPart,
  summary: extracted.summary || extracted.summary_cn || extracted.summary_en || '',
  category: category,
  headers,
  includeHeaders,
  languageShort: isSwift ? 'swift' : 'objc',
  body
  };

  const repository = compat.getSpecRepositoryInstance(projectRoot);
  await repository.saveSnippet(rootSpecPath, snippet, { syncRoot: true, installSingle: true });
  console.log('create success (AI).');
}

/** 从带 // as:code 的文件用 AI 提取并创建（与 web 按路径提取一致） */
async function createFromFileWithAi(projectRoot, specFile, selectedFilePath) {
  const content = fs.readFileSync(selectedFilePath, 'utf8');
  const markerRegex = /\/\/\s*(?:as|autosnippet):code\s*\n([\s\S]*?)\n\s*\/\/\s*(?:as|autosnippet):code/i;
  const match = content.match(markerRegex);
  const code = match && match[1] ? match[1].trim() : content.slice(0, 5000);
  const relativePath = path.relative(projectRoot, selectedFilePath);

  const ai = AiFactory.create();
  const result = await ai.summarize(code, selectedFilePath.endsWith('.swift') ? 'swift' : 'objc');
  if (result && result.error) {
  console.error('❌ AI 解析失败:', result.error);
  return;
  }
  const resolved = await headerResolution.resolveHeadersForText(projectRoot, relativePath, code);
  result.headers = Array.from(new Set([...(result.headers || []), ...resolved.headers]));
  result.headerPaths = resolved.headerPaths;
  result.moduleName = resolved.moduleName;

  const projectRootActual = path.dirname(path.dirname(specFile)); // 项目根 = spec 所在目录的父级
  const rootSpecPathResolved = (await findPath.getRootSpecFilePath(specFile)) || Paths.getProjectSpecPath(projectRootActual);
  await createFromExtracted(projectRootActual, rootSpecPathResolved, result);
}

exports.createCodeSnippets = createCodeSnippets;
exports.updateCodeSnippets = updateCodeSnippets;
exports.saveFromFile = saveFromFile;
exports.findFilesWithACode = findFilesWithACode;
exports.createCodeSnippetsFromText = createCodeSnippetsFromText;
exports.createFromExtracted = createFromExtracted;
exports.createFromFileWithAi = createFromFileWithAi;
