#!/usr/bin/env node

/**
 * Knowledge Base 目录迁移工具
 * 用于将旧的 Knowledge/ 目录迁移到新的 AutoSnippet/ 目录（或自定义目录）
 */

const fs = require('fs');
const path = require('path');
const { getKnowledgeBaseDirName } = require('../infrastructure/config/Paths');

/**
 * 检查是否需要迁移
 * @param {string} projectRoot - 项目根目录
 * @returns {{needMigration: boolean, oldPath: string, newPath: string, reason: string}}
 */
function checkMigrationStatus(projectRoot) {
	const newDirName = getKnowledgeBaseDirName(projectRoot);
	const oldPath = path.join(projectRoot, 'Knowledge');
	const newPath = path.join(projectRoot, newDirName);

	// 如果配置的就是 Knowledge，无需迁移
	if (newDirName === 'Knowledge') {
		return {
			needMigration: false,
			oldPath,
			newPath,
			reason: 'knowledgeBase.dir 配置为 Knowledge，无需迁移'
		};
	}

	// 如果新目录已存在，无需迁移
	if (fs.existsSync(newPath)) {
		return {
			needMigration: false,
			oldPath,
			newPath,
			reason: `${newDirName}/ 目录已存在`
		};
	}

	// 如果旧目录不存在，无需迁移
	if (!fs.existsSync(oldPath)) {
		return {
			needMigration: false,
			oldPath,
			newPath,
			reason: 'Knowledge/ 目录不存在'
		};
	}

	// 需要迁移
	return {
		needMigration: true,
		oldPath,
		newPath,
		reason: `检测到旧的 Knowledge/ 目录，需迁移到 ${newDirName}/`
	};
}

/**
 * 执行迁移
 * @param {string} projectRoot - 项目根目录
 * @param {object} options - 选项
 * @param {boolean} options.dryRun - 仅检查不执行
 * @param {boolean} options.force - 强制迁移（即使新目录存在）
 * @returns {{success: boolean, message: string, details: object}}
 */
function migrateKnowledgeBase(projectRoot, options = {}) {
	const { dryRun = false, force = false } = options;
	const status = checkMigrationStatus(projectRoot);

	if (!status.needMigration && !force) {
		return {
			success: true,
			message: status.reason,
			details: status
		};
	}

	const { oldPath, newPath } = status;

	// Dry run 模式
	if (dryRun) {
		return {
			success: true,
			message: `[Dry Run] 将执行迁移: ${oldPath} → ${newPath}`,
			details: {
				...status,
				files: countFiles(oldPath)
			}
		};
	}

	try {
		// 检查新目录是否存在
		if (fs.existsSync(newPath) && !force) {
			throw new Error(`目标目录 ${newPath} 已存在，使用 --force 覆盖`);
		}

		// 执行迁移（重命名）
		console.log(`正在迁移: ${oldPath} → ${newPath}`);
		fs.renameSync(oldPath, newPath);

		return {
			success: true,
			message: `迁移成功: Knowledge/ → ${path.basename(newPath)}/`,
			details: {
				oldPath,
				newPath,
				files: countFiles(newPath)
			}
		};
	} catch (error) {
		return {
			success: false,
			message: `迁移失败: ${error.message}`,
			details: {
				oldPath,
				newPath,
				error: error.message
			}
		};
	}
}

/**
 * 统计目录下的文件数量
 * @param {string} dir - 目录路径
 * @returns {{total: number, recipes: number, snippets: number}}
 */
function countFiles(dir) {
	if (!fs.existsSync(dir)) {
		return { total: 0, recipes: 0, snippets: 0 };
	}

	let total = 0;
	let recipes = 0;
	let snippets = 0;

	function walk(currentPath) {
		const entries = fs.readdirSync(currentPath, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(currentPath, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath);
			} else {
				total++;
				if (fullPath.includes('/recipes/') && entry.name.endsWith('.md')) {
					recipes++;
				} else if (fullPath.includes('/snippets/') && entry.name.endsWith('.json')) {
					snippets++;
				}
			}
		}
	}

	try {
		walk(dir);
	} catch (error) {
		// 忽略统计错误
	}

	return { total, recipes, snippets };
}

/**
 * 生成迁移报告
 * @param {string} projectRoot - 项目根目录
 * @returns {string} 报告文本
 */
function generateMigrationReport(projectRoot) {
	const status = checkMigrationStatus(projectRoot);
	const newDirName = getKnowledgeBaseDirName(projectRoot);

	let report = '=== Knowledge Base 迁移状态 ===\n\n';
	report += `当前配置: knowledgeBase.dir = "${newDirName}"\n`;
	report += `旧目录: ${status.oldPath}\n`;
	report += `新目录: ${status.newPath}\n\n`;

	if (status.needMigration) {
		const fileCount = countFiles(status.oldPath);
		report += `状态: ⚠️  需要迁移\n`;
		report += `原因: ${status.reason}\n\n`;
		report += `文件统计:\n`;
		report += `  - 总文件数: ${fileCount.total}\n`;
		report += `  - Recipes: ${fileCount.recipes}\n`;
		report += `  - Snippets: ${fileCount.snippets}\n\n`;
		report += `执行迁移: asd migrate:knowledge\n`;
		report += `查看预览: asd migrate:knowledge --dry-run\n`;
	} else {
		report += `状态: ✅ ${status.reason}\n`;
	}

	return report;
}

module.exports = {
	checkMigrationStatus,
	migrateKnowledgeBase,
	generateMigrationReport,
	countFiles
};
