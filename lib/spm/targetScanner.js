const fs = require('fs');
const path = require('path');
const packageParser = require('./packageParser');
const defaults = require('../infra/defaults');

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
		const scanDir = async (dir) => {
			const entries = await fs.promises.readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.isDirectory()) {
					if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'Build' || entry.name === '.build') continue;
					await scanDir(path.join(dir, entry.name));
				} else if (entry.name === 'Package.swift') {
					const pkgPath = path.join(dir, entry.name);
					const pkgInfo = await packageParser.parsePackageSwift(pkgPath);
					if (pkgInfo && pkgInfo.targetsInfo) {
						for (const targetName in pkgInfo.targetsInfo) {
							targets.push({
								name: targetName,
								packageName: pkgInfo.name,
								packagePath: pkgPath,
								targetDir: pkgInfo.path,
								info: pkgInfo.targetsInfo[targetName]
							});
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
		// 默认路径约定：Sources/TargetName
		let searchDir = path.join(targetDir, 'Sources', name);
		if (info.path) {
				searchDir = path.join(targetDir, info.path);
		}

		if (!fs.existsSync(searchDir)) {
			// 兼容一些非标准路径
			searchDir = path.join(targetDir, name);
			if (!fs.existsSync(searchDir)) return [];
		}

		const files = [];
		
		// 1. 优先寻找 README（通常包含最高价值的使用说明）
		for (const readmeName of defaults.README_NAMES) {
			// 检查 target 目录
			const targetReadme = path.join(searchDir, readmeName);
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

		await readFiles(searchDir);

		// 根据优先级排序并截取前 N 个文件
		return files
			.sort((a, b) => (a.priority || 99) - (b.priority || 99))
			.slice(0, options.maxFiles);
	}
}

module.exports = new TargetScanner();
