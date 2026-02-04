#!/usr/bin/env node

/**
 * asd status - 环境自检命令
 * 检查项目根、AI配置、语义索引、Dashboard/Watch状态、Native UI等
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const Paths = require('../infrastructure/config/Paths');
const AiFactory = require('../ai/AiFactory');
const ProjectStructure = require('../infrastructure/paths/ProjectStructure');

/**
 * 检查 Dashboard 是否运行
 * @param {number} port 
 * @returns {Promise<{running: boolean, projectRoot?: string}>}
 */
function checkDashboard(port = 3000) {
	return new Promise((resolve) => {
		const req = http.get(`http://localhost:${port}/api/health`, { timeout: 1000 }, (res) => {
			let data = '';
			res.on('data', chunk => data += chunk);
			res.on('end', () => {
				try {
					const json = JSON.parse(data);
					resolve({ 
						running: json.service === 'AutoSnippet Dashboard',
						projectRoot: json.projectRoot 
					});
				} catch {
					resolve({ running: false });
				}
			});
		});
		req.on('error', () => resolve({ running: false }));
		req.on('timeout', () => {
			req.destroy();
			resolve({ running: false });
		});
	});
}

/**
 * 检查 Native UI
 * @returns {{available: boolean, path?: string}}
 */
function checkNativeUi() {
	const pkgRoot = path.join(__dirname, '../..');
	const nativeUiPath = path.join(pkgRoot, 'resources/native-ui/native-ui');
	
	if (fs.existsSync(nativeUiPath)) {
		try {
			fs.accessSync(nativeUiPath, fs.constants.X_OK);
			return { available: true, path: nativeUiPath };
		} catch {
			return { available: false, path: nativeUiPath, reason: '无执行权限' };
		}
	}
	
	return { available: false, reason: '文件不存在' };
}

/**
 * 检查语义索引
 * @param {string} projectRoot 
 * @returns {{built: boolean, count?: number, type?: string, path?: string}}
 */
function checkSemanticIndex(projectRoot) {
	const contextPath = path.join(projectRoot, 'AutoSnippet/.autosnippet/context');
	
	// 检查 vector_index.json (默认)
	const vectorIndexPath = path.join(contextPath, 'index/vector_index.json');
	if (fs.existsSync(vectorIndexPath)) {
		try {
			const data = JSON.parse(fs.readFileSync(vectorIndexPath, 'utf8'));
			const count = data.items?.length || 0;
			return { built: true, count, type: 'JSON', path: vectorIndexPath };
		} catch {
			return { built: false, reason: 'vector_index.json 格式异常' };
		}
	}
	
	// 检查 manifest.json
	const manifestPath = path.join(contextPath, 'manifest.json');
	if (fs.existsSync(manifestPath)) {
		try {
			const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
			if (manifest.updatedAt || manifest.lastFullRebuild) {
				return { built: true, type: 'Manifest', path: manifestPath };
			}
		} catch {}
	}
	
	return { built: false, reason: '未找到索引文件' };
}

/**
 * 检查 AI 配置
 * @param {string} projectRoot 
 * @returns {{configured: boolean, provider?: string, hasKey?: boolean}}
 */
function checkAiConfig(projectRoot) {
	try {
		const config = AiFactory.getConfigSync(projectRoot);
		if (!config) {
			return { configured: false, reason: '未配置 AI' };
		}
		
		return {
			configured: true,
			provider: config.provider || 'google',
			hasKey: config.hasKey || false,
		};
	} catch (err) {
		return { configured: false, reason: err.message };
	}
}

/**
 * 执行环境检查
 * @param {string} projectRoot 
 */
async function runStatus(projectRoot) {
	console.log('🔍 AutoSnippet 环境检查');
	console.log('========================================\n');
	
	const results = {
		projectRoot: false,
		ai: false,
		index: false,
		dashboard: false,
		nativeUi: false,
	};
	
	// 1. 检查项目根
	const boxspecPath = ProjectStructure.getBoxspecPath(projectRoot);
	if (boxspecPath && fs.existsSync(boxspecPath)) {
		console.log(`✅ 项目根: ${projectRoot}`);
		console.log(`   配置文件: ${path.basename(boxspecPath)}`);
		results.projectRoot = true;
	} else {
		console.log(`❌ 项目根: 未找到 AutoSnippet.boxspec.json`);
		console.log(`   当前目录: ${projectRoot}`);
		console.log(`   提示: 执行 asd setup 初始化项目`);
	}
	console.log('');
	
	// 2. 检查 AI 配置
	const aiStatus = checkAiConfig(projectRoot);
	if (aiStatus.configured && aiStatus.hasKey) {
		console.log(`✅ AI 配置: ${aiStatus.provider || 'google'} (配置完整)`);
		results.ai = true;
	} else if (aiStatus.configured && !aiStatus.hasKey) {
		console.log(`⚠️  AI 配置: ${aiStatus.provider || 'google'} (缺少 API Key)`);
		console.log(`   提示: 在 .env 中配置 ASD_GOOGLE_API_KEY 或其他 provider`);
	} else {
		console.log(`ℹ️  AI 配置: 未配置`);
		console.log(`   提示: 在 .env 中配置 AI provider 和 API Key`);
		console.log(`   参考: .env.example`);
	}
	console.log('');
	
	// 3. 检查语义索引
	const indexStatus = checkSemanticIndex(projectRoot);
	if (indexStatus.built) {
		const countStr = indexStatus.count ? ` (${indexStatus.count} 条记录)` : '';
		console.log(`✅ 语义索引: 已构建${countStr}`);
		console.log(`   类型: ${indexStatus.type}`);
		results.index = true;
	} else {
		console.log(`ℹ️  语义索引: 未构建`);
		console.log(`   提示: 执行 asd embed 构建索引`);
		console.log(`   说明: 索引用于语义搜索和 AI 上下文检索`);
	}
	console.log('');
	
	// 4. 检查 Dashboard
	const dashboardStatus = await checkDashboard(3000);
	if (dashboardStatus.running) {
		console.log(`✅ Dashboard: 运行中 (http://localhost:3000)`);
		if (dashboardStatus.projectRoot) {
			console.log(`   项目: ${dashboardStatus.projectRoot}`);
		}
		results.dashboard = true;
	} else {
		console.log(`ℹ️  Dashboard: 未运行`);
		console.log(`   提示: 执行 asd ui 启动 Dashboard`);
		console.log(`   说明: Dashboard 提供 Web 管理界面和文件监听`);
	}
	console.log('');
	
	// 5. 检查 Native UI
	const nativeUiStatus = checkNativeUi();
	if (nativeUiStatus.available) {
		console.log(`✅ Native UI: 可用`);
		results.nativeUi = true;
	} else {
		console.log(`⚠️  Native UI: 不可用 (${nativeUiStatus.reason || '未知原因'})`);
		console.log(`   提示: 执行 asd install:full 安装`);
		console.log(`   说明: Native UI 用于 Xcode 中的搜索结果展示`);
	}
	console.log('');
	
	// 6. Watch 状态提示
	if (!dashboardStatus.running) {
		console.log(`ℹ️  文件监听: 未运行`);
		console.log(`   提示: Dashboard (asd ui) 已包含文件监听功能`);
		console.log(`   说明: // as:create、// as:guard、// as:search 需要 Dashboard 运行`);
		console.log('');
	}
	
	// 生成建议
	console.log('========================================');
	console.log('📋 下一步建议：\n');
	
	const suggestions = [];
	
	if (!results.projectRoot) {
		suggestions.push('执行 asd setup 初始化项目');
	}
	
	if (!results.ai) {
		suggestions.push('配置 AI provider 和 API Key (.env 文件)');
	}
	
	if (!results.index) {
		suggestions.push('执行 asd embed 构建语义索引');
	}
	
	if (!results.dashboard) {
		suggestions.push('执行 asd ui 启动 Dashboard (包含文件监听)');
	} else {
		suggestions.push('在代码中使用 // as:search 检索知识库');
		suggestions.push('使用 // as:create 创建 Recipe');
	}
	
	if (!results.nativeUi) {
		suggestions.push('执行 asd install:full 安装 Native UI');
	}
	
	if (suggestions.length === 0) {
		console.log('  ✅ 环境配置完整，可以开始使用！');
	} else {
		suggestions.forEach((s, i) => {
			console.log(`  ${i + 1}. ${s}`);
		});
	}
	
	console.log('');
}

module.exports = { runStatus };
