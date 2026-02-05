const fs = require('fs');
const path = require('path');
const compat = require('../../../context/ContextServiceCompat');
const defaults = require('../../config/Defaults');

/**
 * 扫描项目中的所有 SPM Target 及其源代码文件
 */
class TargetScanner {
  /**
   * 查找项目根目录下的所有 Package.swift 并解析出 Targets
   * @param {string} projectRoot 
   */
  async listAllTargets(projectRoot) {
  const targets = [];
  const parser = compat.getPackageParserInstance(projectRoot);
  const scanDir = async (dir) => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'Build' || entry.name === '.build') continue;
      await scanDir(path.join(dir, entry.name));
    } else if (entry.name === 'Package.swift') {
      const pkgPath = path.join(dir, entry.name);
      const pkgInfo = await parser.parsePackageSwift(pkgPath);
      if (pkgInfo) {
      // Package 所在的目录（不是 Package.swift 文件本身）
      const pkgDir = path.dirname(pkgPath);
      
      // 兼容两种格式：targets（数组）或 targetsInfo（对象）
      const targetsList = pkgInfo.targets || [];
      if (Array.isArray(targetsList)) {
        // 新格式：targets 是数组
        for (const targetInfo of targetsList) {
        if (targetInfo && targetInfo.name) {
          targets.push({
          name: targetInfo.name,
          packageName: pkgInfo.name,
          packagePath: pkgPath,
          targetDir: pkgDir,  // 使用 Package 所在目录，而不是 pkgInfo.path
          info: targetInfo
          });
        }
        }
      } else if (pkgInfo.targetsInfo && typeof pkgInfo.targetsInfo === 'object') {
        // 旧格式：targetsInfo 是对象
        for (const targetName in pkgInfo.targetsInfo) {
        targets.push({
          name: targetName,
          packageName: pkgInfo.name,
          packagePath: pkgPath,
          targetDir: pkgDir,
          info: pkgInfo.targetsInfo[targetName]
        });
        }
      }
      }
    }
    }
  };

  await scanDir(projectRoot);
  return targets;
  }

  /**
   * 获取某个 Target 的所有源代码文件内容
   * @param {Object} target 
   * @param {Object} options 
   */
  /**
   * 获取 Target 的源码根目录（用于判断某文件是否属于该 target）
   * @param {Object} target
   * @returns {string|null} 绝对路径，不存在则 null
   */
  getTargetSearchDir(target) {
  const { targetDir, name, info } = target;
  let searchDir = path.join(targetDir, 'Sources', name);
  if (info && info.path) searchDir = path.join(targetDir, info.path);
  if (fs.existsSync(searchDir)) return path.resolve(searchDir);
  searchDir = path.join(targetDir, name);
  return fs.existsSync(searchDir) ? path.resolve(searchDir) : null;
  }

  /**
   * 查找包含指定文件的 Target（按 searchDir 包含关系）
   * @param {string} projectRoot
   * @param {string} absoluteFilePath 文件绝对路径
   * @returns {Promise<Object|null>} target 或 null
   */
  async findTargetContainingFile(projectRoot, absoluteFilePath) {
  const targets = await this.listAllTargets(projectRoot);
  const normalized = path.resolve(absoluteFilePath);
  for (const t of targets) {
    const dir = this.getTargetSearchDir(t);
    if (dir && (normalized === dir || normalized.startsWith(dir + path.sep))) return t;
  }
  return null;
  }

  /**
   * 获取 Target 下所有 .m/.h/.swift 的绝对路径（供 Guard 等按 target 维度审查用）
   * @param {Object} target
   * @returns {Promise<string[]>}
   */
  async getTargetSourcePaths(target) {
  const searchDir = this.getTargetSearchDir(target);
  if (!searchDir) return [];
  const paths = [];
  const scan = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) scan(full);
    else if (e.isFile() && /\.(m|h|swift)$/i.test(e.name)) paths.push(full);
    }
  };
  scan(searchDir);
  return paths;
  }

  async getTargetFilesContent(target, options = { maxFiles: 10, maxChars: 10000 }) {
  const { targetDir, name, info } = target;
  let baseDir = null;
  
  // 1. 如果 target 定义中有 path 参数，优先使用
  if (info && info.path) {
    baseDir = path.join(targetDir, info.path);
  }
  
  // 2. 尝试标准路径：Sources/TargetName
  if (!baseDir || !fs.existsSync(baseDir)) {
    const standardPath = path.join(targetDir, 'Sources', name);
    if (fs.existsSync(standardPath)) {
    baseDir = standardPath;
    }
  }
  
  // 3. 兼容非标准路径：TargetName
  if (!baseDir || !fs.existsSync(baseDir)) {
    const altPath = path.join(targetDir, name);
    if (fs.existsSync(altPath)) {
    baseDir = altPath;
    }
  }
  
  // 如果仍然找不到，返回空数组
  if (!baseDir || !fs.existsSync(baseDir)) {
    return [];
  }

  // 确定要扫描的目录列表
  let scanDirs = [baseDir];
  if (info && info.sources && Array.isArray(info.sources)) {
    // 如果指定了 sources 参数，扫描这些子目录
    scanDirs = info.sources.map(sourceDir => path.join(baseDir, sourceDir));
  }

  const files = [];
  
  // 1. 优先寻找 README（通常包含最高价值的使用说明）
  for (const readmeName of defaults.README_NAMES) {
    // 检查 base 目录
    const targetReadme = path.join(baseDir, readmeName);
    if (fs.existsSync(targetReadme)) {
    const content = await fs.promises.readFile(targetReadme, 'utf8');
    files.push({ name: readmeName, path: targetReadme, content: content.slice(0, 5000), priority: 1 });
    break;
    }
    // 检查 package 目录
    const packageReadme = path.join(targetDir, readmeName);
    if (fs.existsSync(packageReadme)) {
    const content = await fs.promises.readFile(packageReadme, 'utf8');
    files.push({ name: readmeName, path: packageReadme, content: content.slice(0, 5000), priority: 1 });
    break;
    }
  }

  const readFiles = async (dir) => {
    if (!fs.existsSync(dir)) return;
    
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
    if (entry.isDirectory()) {
      await readFiles(path.join(dir, entry.name));
    } else {
      const isHeader = entry.name.endsWith('.h');
      const isSource = entry.name.endsWith('.swift') || entry.name.endsWith('.m');
      if (isHeader || isSource) {
      const content = await fs.promises.readFile(path.join(dir, entry.name), 'utf8');
      files.push({
        name: entry.name,
        path: path.join(dir, entry.name),
        content: content.slice(0, 2500),
        priority: isHeader ? 2 : 3 // Header 优先级高于实现文件
      });
      }
    }
    }
  };

  // 扫描所有目录
  for (const scanDir of scanDirs) {
    await readFiles(scanDir);
  }

  // 根据优先级排序并截取前 N 个文件
  return files
    .sort((a, b) => (a.priority || 99) - (b.priority || 99))
    .slice(0, options.maxFiles);
  }
}

module.exports = new TargetScanner();
