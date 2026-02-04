/**
 * ProjectStructure - 统一项目结构路径管理
 * 
 * 项目结构约定：
 * ProjectRoot/                      ← 项目根目录（如 BiliDemo）
 *   ├── AutoSnippet/               ← AutoSnippet 目录（固定名称）
 *   │   ├── AutoSnippet.boxspec.json  ← 配置文件
 *   │   ├── recipes/               ← Recipes 目录（固定路径）
 *   │   └── .autosnippet/          ← 缓存和索引
 *   └── [项目文件]
 */

const fs = require('fs');
const path = require('path');

const AUTOSNIPPET_DIR = 'AutoSnippet';
const BOXSPEC_FILE = 'AutoSnippet.boxspec.json';
const RECIPES_DIR = 'recipes';
const CACHE_DIR = '.autosnippet';

class ProjectStructure {
	/**
	 * 从任意路径查找项目根目录
	 * @param {string} startPath - 起始路径（文件或目录）
	 * @returns {string|null} 项目根目录路径，未找到返回 null
	 */
	static findProjectRoot(startPath) {
		let currentPath = path.resolve(startPath);
		
		// 如果是文件，从其目录开始
		try {
			const stats = fs.statSync(currentPath);
			if (stats.isFile()) {
				currentPath = path.dirname(currentPath);
			}
		} catch (err) {
			// 文件不存在，假设是目录路径
		}

		const maxLevels = 20;
		let levels = 0;

		while (levels < maxLevels) {
			// 检查是否存在 AutoSnippet/AutoSnippet.boxspec.json
			const autosnippetDir = path.join(currentPath, AUTOSNIPPET_DIR);
			const boxspecPath = path.join(autosnippetDir, BOXSPEC_FILE);
			
			if (fs.existsSync(boxspecPath)) {
				return currentPath; // 找到项目根目录
			}

			// 向上一级
			const parentPath = path.dirname(currentPath);
			if (parentPath === currentPath) {
				break; // 已到达文件系统根目录
			}
			currentPath = parentPath;
			levels++;
		}

		return null;
	}

	/**
	 * 异步查找项目根目录
	 * @param {string} startPath - 起始路径
	 * @returns {Promise<string|null>}
	 */
	static async findProjectRootAsync(startPath) {
		let currentPath = path.resolve(startPath);
		
		try {
			const stats = await fs.promises.stat(currentPath);
			if (stats.isFile()) {
				currentPath = path.dirname(currentPath);
			}
		} catch (err) {
			// 忽略错误
		}

		const maxLevels = 20;
		let levels = 0;

		while (levels < maxLevels) {
			const autosnippetDir = path.join(currentPath, AUTOSNIPPET_DIR);
			const boxspecPath = path.join(autosnippetDir, BOXSPEC_FILE);
			
			try {
				await fs.promises.access(boxspecPath, fs.constants.F_OK);
				return currentPath;
			} catch (err) {
				// 继续向上查找
			}

			const parentPath = path.dirname(currentPath);
			if (parentPath === currentPath) {
				break;
			}
			currentPath = parentPath;
			levels++;
		}

		return null;
	}

	/**
	 * 获取 AutoSnippet 目录路径
	 * @param {string} projectRoot - 项目根目录
	 * @returns {string}
	 */
	static getAutoSnippetDir(projectRoot) {
		return path.join(projectRoot, AUTOSNIPPET_DIR);
	}

	/**
	 * 获取 boxspec.json 文件路径
	 * @param {string} projectRoot - 项目根目录
	 * @returns {string}
	 */
	static getBoxspecPath(projectRoot) {
		return path.join(projectRoot, AUTOSNIPPET_DIR, BOXSPEC_FILE);
	}

	/**
	 * 获取 recipes 目录路径
	 * @param {string} projectRoot - 项目根目录
	 * @returns {string}
	 */
	static getRecipesDir(projectRoot) {
		return path.join(projectRoot, AUTOSNIPPET_DIR, RECIPES_DIR);
	}

	/**
	 * 获取缓存目录路径
	 * @param {string} projectRoot - 项目根目录
	 * @returns {string}
	 */
	static getCacheDir(projectRoot) {
		return path.join(projectRoot, AUTOSNIPPET_DIR, CACHE_DIR);
	}

	/**
	 * 验证项目结构是否有效
	 * @param {string} projectRoot - 项目根目录
	 * @returns {boolean}
	 */
	static isValidProject(projectRoot) {
		const boxspecPath = this.getBoxspecPath(projectRoot);
		return fs.existsSync(boxspecPath);
	}

	/**
	 * 从 boxspec 路径反推项目根目录
	 * @param {string} boxspecPath - boxspec.json 文件路径
	 * @returns {string}
	 */
	static getProjectRootFromBoxspec(boxspecPath) {
		// boxspecPath: /path/to/BiliDemo/AutoSnippet/AutoSnippet.boxspec.json
		// 返回: /path/to/BiliDemo
		const autosnippetDir = path.dirname(boxspecPath);
		return path.dirname(autosnippetDir);
	}

	/**
	 * 从任意 AutoSnippet 内部路径反推项目根目录
	 * @param {string} internalPath - AutoSnippet 内部的任意路径
	 * @returns {string|null}
	 */
	static getProjectRootFromInternal(internalPath) {
		const resolved = path.resolve(internalPath);
		const parts = resolved.split(path.sep);
		
		// 查找 AutoSnippet 目录在路径中的位置
		const autosnippetIndex = parts.lastIndexOf(AUTOSNIPPET_DIR);
		if (autosnippetIndex === -1) {
			return null;
		}
		
		// 项目根 = AutoSnippet 目录的父级
		const projectRootParts = parts.slice(0, autosnippetIndex);
		return projectRootParts.join(path.sep);
	}

	/**
	 * 初始化项目结构（创建必要的目录）
	 * @param {string} projectRoot - 项目根目录
	 */
	static initProjectStructure(projectRoot) {
		const autosnippetDir = this.getAutoSnippetDir(projectRoot);
		const recipesDir = this.getRecipesDir(projectRoot);
		const cacheDir = this.getCacheDir(projectRoot);

		// 创建目录
		if (!fs.existsSync(autosnippetDir)) {
			fs.mkdirSync(autosnippetDir, { recursive: true });
		}
		if (!fs.existsSync(recipesDir)) {
			fs.mkdirSync(recipesDir, { recursive: true });
		}
		if (!fs.existsSync(cacheDir)) {
			fs.mkdirSync(cacheDir, { recursive: true });
		}
	}

	/**
	 * 获取项目结构信息（用于调试）
	 * @param {string} projectRoot - 项目根目录
	 * @returns {object}
	 */
	static getProjectInfo(projectRoot) {
		return {
			projectRoot,
			autosnippetDir: this.getAutoSnippetDir(projectRoot),
			boxspecPath: this.getBoxspecPath(projectRoot),
			recipesDir: this.getRecipesDir(projectRoot),
			cacheDir: this.getCacheDir(projectRoot),
			isValid: this.isValidProject(projectRoot),
		};
	}
}

module.exports = ProjectStructure;
