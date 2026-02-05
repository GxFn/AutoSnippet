/**
 * iOS Guard 多维度审计
 */

const fs = require('fs');
const path = require('path');
const { runStaticCheck } = require('./staticCheck');

/**
 * 审查维度：同文件 / 同 target / 同项目
 */
const AUDIT_DIMENSIONS = ['file', 'target', 'project'];

/** OC 有名 Category 声明正则：@interface ClassName (CategoryName) */
const OBJC_CATEGORY_REGEX = /@interface\s+(\w+)\s*\(\s*(\w+)\s*\)/g;

/** 从代码中收集 (ClassName, CategoryName) */
function collectCategoriesFromCode(code) {
  const byKey = {};
  const lines = (code || '').split(/\r?\n/);
  lines.forEach((line, i) => {
  const oneLine = line.trim();
  OBJC_CATEGORY_REGEX.lastIndex = 0;
  const m = OBJC_CATEGORY_REGEX.exec(oneLine);
  if (!m) return;
  const key = `${m[1]}(${m[2]})`;
  if (!byKey[key]) byKey[key] = [];
  byKey[key].push({ line: i + 1, snippet: oneLine.slice(0, 120) });
  });
  return byKey;
}

function runObjcCategoryDuplicateInFile(code) {
  const violations = [];
  const byKey = collectCategoriesFromCode(code);
  for (const [key, occurrences] of Object.entries(byKey)) {
  if (occurrences.length <= 1) continue;
  occurrences.forEach((occ, idx) => {
    if (idx === 0) return;
    violations.push({
    ruleId: 'objc-duplicate-category',
    message: `同文件内 Category 重名：${key}，首次在第 ${occurrences[0].line} 行`,
    severity: 'warning',
    line: occ.line,
    snippet: occ.snippet,
    dimension: 'file'
    });
  });
  }
  return violations;
}

function collectSourceFiles(projectRoot, dir, baseDir, out) {
  const fullDir = baseDir ? path.join(baseDir, dir) : dir;
  const absDir = path.isAbsolute(fullDir) ? fullDir : path.join(projectRoot, fullDir);
  if (!fs.existsSync(absDir)) return;
  const skipDirs = new Set(['node_modules', 'Pods', '.git', 'build', 'DerivedData', '.build', 'Carthage', '.xcodeproj', '.xcworkspace']);
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  for (const e of entries) {
  const rel = path.join(fullDir, e.name).replace(/\\/g, '/');
  if (e.isDirectory()) {
    if (!skipDirs.has(e.name)) collectSourceFiles(projectRoot, e.name, fullDir, out);
  } else if (e.isFile() && /\.(m|h|swift)$/i.test(e.name)) {
    out.push(rel.replace(/\\/g, '/').replace(/^\.\//, ''));
  }
  }
}

async function runStaticCheckForScope(projectRoot, fileScope, currentFilePathAbsolute, ruleScope) {
  const violations = [];
  const langFromExt = (rel) => (/\.swift$/i.test(rel) ? 'swift' : 'objc');

  if (fileScope === 'target') {
  try {
    const targetScanner = require('../../spm/targetScanner');
    const target = await targetScanner.findTargetContainingFile(projectRoot, currentFilePathAbsolute);
    if (!target) return [];
    const paths = await targetScanner.getTargetSourcePaths(target);
    for (const abs of paths) {
    const rel = path.relative(projectRoot, abs).replace(/\\/g, '/').replace(/^\.\//, '');
    let code;
    try {
      code = fs.readFileSync(abs, 'utf8');
    } catch (_) {
      continue;
    }
    const language = langFromExt(rel);
    const fileViolations = runStaticCheck(projectRoot, code, language, ruleScope);
    fileViolations.forEach(v => violations.push({ ...v, filePath: rel }));
    }
  } catch (_) {
    return [];
  }
  return violations;
  }

  if (fileScope === 'project') {
  const files = [];
  collectSourceFiles(projectRoot, '.', '', files);
  for (const rel of files) {
    const abs = path.join(projectRoot, rel);
    let code;
    try {
    code = fs.readFileSync(abs, 'utf8');
    } catch (_) {
    continue;
    }
    const language = langFromExt(rel);
    const fileViolations = runStaticCheck(projectRoot, code, language, ruleScope);
    fileViolations.forEach(v => violations.push({ ...v, filePath: rel }));
  }
  return violations;
  }

  return [];
}

function collectObjcFiles(projectRoot, dir, baseDir, out) {
  const fullDir = baseDir ? path.join(baseDir, dir) : dir;
  const absDir = path.isAbsolute(fullDir) ? fullDir : path.join(projectRoot, fullDir);
  if (!fs.existsSync(absDir)) return;
  const skipDirs = new Set(['node_modules', 'Pods', '.git', 'build', 'DerivedData', '.build', 'Carthage', '.xcodeproj', '.xcworkspace']);
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  for (const e of entries) {
  const rel = path.join(fullDir, e.name).replace(/\\/g, '/');
  if (e.isDirectory()) {
    if (!skipDirs.has(e.name)) collectObjcFiles(projectRoot, e.name, fullDir, out);
  } else if (e.isFile() && /\.(m|h)$/i.test(e.name)) {
    out.push(rel.replace(/\\/g, '/').replace(/^\.\//, ''));
  }
  }
}

function runObjcCategoryDuplicateInTarget(projectRoot, _currentFilePath, targetFilePaths) {
  const violations = [];
  const byKey = {};
  for (const abs of targetFilePaths) {
  let code;
  try {
    code = fs.readFileSync(abs, 'utf8');
  } catch (_) {
    continue;
  }
  const rel = path.relative(projectRoot, abs).replace(/\\/g, '/').replace(/^\.\//, '');
  const lines = (code || '').split(/\r?\n/);
  lines.forEach((line, i) => {
    const oneLine = line.trim();
    OBJC_CATEGORY_REGEX.lastIndex = 0;
    const m = OBJC_CATEGORY_REGEX.exec(oneLine);
    if (!m) return;
    const key = `${m[1]}(${m[2]})`;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push({ filePath: rel, line: i + 1, snippet: oneLine.slice(0, 120) });
  });
  }
  for (const [key, occurrences] of Object.entries(byKey)) {
  if (occurrences.length <= 1) continue;
  occurrences.forEach(occ => {
    const otherDesc = occurrences.filter(o => o.filePath !== occ.filePath || o.line !== occ.line).map(o => `${o.filePath}:${o.line}`).join(', ');
    violations.push({
    ruleId: 'objc-duplicate-category',
    message: `同 target 内 Category 重名：${key}，另见 ${otherDesc}`,
    severity: 'warning',
    line: occ.line,
    snippet: occ.snippet,
    dimension: 'target',
    filePath: occ.filePath
    });
  });
  }
  return violations;
}

function runObjcCategoryDuplicateCheckProject(projectRoot, _currentFilePath) {
  const violations = [];
  const files = [];
  collectObjcFiles(projectRoot, '.', '', files);
  const byKey = {};
  for (const rel of files) {
  const abs = path.join(projectRoot, rel);
  let code;
  try {
    code = fs.readFileSync(abs, 'utf8');
  } catch (_) {
    continue;
  }
  const lines = (code || '').split(/\r?\n/);
  lines.forEach((line, i) => {
    const oneLine = line.trim();
    OBJC_CATEGORY_REGEX.lastIndex = 0;
    const m = OBJC_CATEGORY_REGEX.exec(oneLine);
    if (!m) return;
    const key = `${m[1]}(${m[2]})`;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push({ filePath: rel, line: i + 1, snippet: oneLine.slice(0, 120) });
  });
  }
  for (const [key, occurrences] of Object.entries(byKey)) {
  if (occurrences.length <= 1) continue;
  occurrences.forEach(occ => {
    const otherDesc = occurrences.filter(o => o.filePath !== occ.filePath || o.line !== occ.line).map(o => `${o.filePath}:${o.line}`).join(', ');
    violations.push({
    ruleId: 'objc-duplicate-category',
    message: `项目内 Category 重名：${key}，另见 ${otherDesc}`,
    severity: 'warning',
    line: occ.line,
    snippet: occ.snippet,
    dimension: 'project',
    filePath: occ.filePath
    });
  });
  }
  return violations;
}

const AUDIT_BY_LANGUAGE = {
  objc: {
  file: (code) => runObjcCategoryDuplicateInFile(code),
  target: async (projectRoot, currentFilePathRelative, currentFilePathAbsolute) => {
    try {
    const targetScanner = require('../../spm/targetScanner');
    const target = await targetScanner.findTargetContainingFile(projectRoot, currentFilePathAbsolute || path.join(projectRoot, currentFilePathRelative));
    if (!target) return [];
    const targetPaths = await targetScanner.getTargetSourcePaths(target);
    return runObjcCategoryDuplicateInTarget(projectRoot, currentFilePathRelative, targetPaths);
    } catch (_) {
    return [];
    }
  },
  project: (projectRoot, currentFilePathRelative) => runObjcCategoryDuplicateCheckProject(projectRoot, currentFilePathRelative)
  },
  swift: {
  file: () => [],
  target: async () => [],
  project: () => []
  }
};

function getSupportedAuditLanguages() {
  return Object.keys(AUDIT_BY_LANGUAGE);
}

async function runFileAudit(projectRoot, code, language, currentFilePathRelative, currentFilePathAbsolute, scope) {
  const audits = AUDIT_BY_LANGUAGE[language];
  if (!audits || !currentFilePathRelative) return [];

  const doFile = !scope || scope === 'file';
  const doTarget = !scope || scope === 'target';
  const doProject = !scope || scope === 'project';

  const vFile = (doFile && audits.file) ? audits.file(code) : [];
  const vTarget = (doTarget && audits.target) ? await audits.target(projectRoot, currentFilePathRelative, currentFilePathAbsolute) : [];
  const vProject = (doProject && audits.project) ? audits.project(projectRoot, currentFilePathRelative) : [];
  return [...vFile, ...vTarget, ...vProject];
}

module.exports = {
  AUDIT_DIMENSIONS,
  AUDIT_BY_LANGUAGE,
  getSupportedAuditLanguages,
  runFileAudit,
  runStaticCheckForScope,
  runObjcCategoryDuplicateInFile,
  runObjcCategoryDuplicateInTarget,
  runObjcCategoryDuplicateCheckProject
};
