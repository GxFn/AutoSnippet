const path = require('path');
const fs = require('fs');
const findPath = require('../../bin/findPath.js');

function parseImportLine(headerStr) {
  const s = String(headerStr || '').trim();
  const angle = s.match(/#import\s+<([^>]+)>/);
  if (angle) {
    const part = angle[1].trim();
    const slash = part.indexOf('/');
    if (slash !== -1) {
      return { moduleName: part.slice(0, slash), headerName: path.basename(part, '.h') };
    }
    return { moduleName: null, headerName: path.basename(part, '.h') };
  }
  const quote = s.match(/#import\s+"([^"]+)"/);
  if (quote) {
    return { moduleName: null, headerName: path.basename(quote[1], '.h') };
  }
  if (/^import\s+/.test(s)) return null;
  return null;
}

async function resolveHeaderRelativePath(headerStr, targetRootDir) {
  if (!targetRootDir) return undefined;
  const parsed = parseImportLine(headerStr);
  if (!parsed) return undefined;
  const { moduleName, headerName } = parsed;
  const headerPath = await findPath.findSubHeaderPath(targetRootDir, headerName, moduleName);
  if (!headerPath) return undefined;
  return path.relative(targetRootDir, headerPath);
}

function determineModuleNameFromPath(filePath, packageInfo) {
  const packagePath = packageInfo.path;
  const relativePath = path.relative(packagePath, filePath);
  const segments = relativePath.split(path.sep);
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (packageInfo.targets && packageInfo.targets.includes(segment)) return segment;
  }
  const first = packageInfo.targets && packageInfo.targets[0];
  if (first && first !== packageInfo.name) return first;
  return packageInfo.name || null;
}

/**
 * 按路径 + 文本解析头文件（与 web /api/extract/text 一致）
 * @param {string} projectRoot
 * @param {string} relativePath - 相对 projectRoot 的路径（如 Sources/Mod/Foo.m）
 * @param {string} text - 代码文本（可含 #import，无则从 .m 推断同名 .h）
 * @returns {Promise<{ headers: string[], headerPaths: string[], moduleName: string|null }>}
 */
async function resolveHeadersForText(projectRoot, relativePath, text) {
  const fullPath = path.resolve(projectRoot, (relativePath || '').trim());
  if (!relativePath || !fs.existsSync(fullPath)) {
    return { headers: [], headerPaths: [], moduleName: null };
  }

  const targetRootDir = await findPath.findTargetRootDir(fullPath);
  let moduleName = targetRootDir ? path.basename(targetRootDir) : null;
  const importRegex = /^(?:#import|import)\s+.*$/gm;
  let headers = (text.match(importRegex) || []).filter(Boolean);
  let headerPaths = targetRootDir
    ? await Promise.all(headers.map(h => resolveHeaderRelativePath(h, targetRootDir)))
    : [];

  const ext = path.extname(fullPath).toLowerCase();
  if (targetRootDir && headers.length === 0 && (ext === '.m' || ext === '.mm')) {
    const headerNameWithoutExt = path.basename(fullPath, ext);
    const packagePath = await findPath.findPackageSwiftPath(fullPath);
    const packageInfo = packagePath ? await findPath.parsePackageSwift(packagePath) : null;
    if (packageInfo) moduleName = determineModuleNameFromPath(fullPath, packageInfo);
    const headerPath = await findPath.findSubHeaderPath(targetRootDir, headerNameWithoutExt, moduleName);
    if (headerPath) {
      headers = [`#import <${moduleName || path.basename(targetRootDir)}/${headerNameWithoutExt}.h>`];
      headerPaths = [path.relative(targetRootDir, headerPath)];
    }
  }

  return { headers, headerPaths, moduleName };
}

module.exports = {
  resolveHeadersForText,
  parseImportLine,
  resolveHeaderRelativePath,
  determineModuleNameFromPath
};
