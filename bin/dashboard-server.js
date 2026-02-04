const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const AiFactory = require('../lib/ai/AiFactory');
const SpecRepositoryV2 = require('../lib/snippet/SpecRepositoryV2');
const snippetInstaller = require('../lib/snippet/snippetInstaller');
const spmDepMapUpdater = require('../lib/spm/spmDepMapUpdater');
const watch = require('../lib/watch/fileWatcher');
const findPath = require('../lib/infrastructure/paths/PathFinder');
const Paths = require('../lib/infrastructure/config/Paths');
const targetScanner = require('../lib/spm/targetScanner');
const candidateService = require('../lib/ai/candidateService');
const headerResolution = require('../lib/ai/headerResolution');
const MarkerLineV2 = require('../lib/snippet/MarkerLineV2');
const triggerSymbol = require('../lib/infrastructure/config/TriggerSymbol');
const writeGuard = require('../lib/writeGuard');
const rateLimit = require('../lib/rateLimit');
const openBrowser = require('../lib/infrastructure/external/OpenBrowser');
const openBrowserReuseTab = openBrowser.openBrowserReuseTab;
const autoEmbed = require('../lib/context/autoEmbed');
const { registerDashboardRoutes } = require('./dashboard/routes');
const { unescapeSnippetLine } = require('./dashboard/helpers');

/**
 * 检测端口是否可用
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortAvailable(port) {
	return new Promise((resolve) => {
		const server = http.createServer();
		server.once('error', (err) => {
			if (err.code === 'EADDRINUSE') {
				resolve(false);
			} else {
				resolve(false);
			}
		});
		server.once('listening', () => {
			server.close();
			resolve(true);
		});
		// 绑定所有接口（与 Express 默认行为一致）
		server.listen(port);
	});
}

/**
 * 检测指定端口是否运行着 Dashboard 服务
 * @param {number} port
 * @param {string} [expectedProjectRoot] 可选：期望的项目根路径，若提供则检查是否匹配
 * @returns {Promise<{isDashboard: boolean, isSameProject: boolean}>}
 */
async function isDashboardRunning(port, expectedProjectRoot) {
	return new Promise((resolve) => {
		const req = http.get(`http://localhost:${port}/api/health`, (res) => {
			let data = '';
			res.on('data', chunk => data += chunk);
			res.on('end', () => {
				try {
					const json = JSON.parse(data);
					const isDashboard = json.service === 'AutoSnippet Dashboard';
					const isSameProject = expectedProjectRoot 
						? json.projectRoot === expectedProjectRoot
						: true;
					resolve({ isDashboard, isSameProject, projectRoot: json.projectRoot });
				} catch {
					resolve({ isDashboard: false, isSameProject: false });
				}
			});
		});
		req.on('error', () => resolve({ isDashboard: false, isSameProject: false }));
		req.setTimeout(1000, () => {
			req.destroy();
			resolve({ isDashboard: false, isSameProject: false });
		});
	});
}


/**
 * 启动 Dashboard Server
 * @param {string} projectRoot 
 * @param {number} port 
 * @param {{ forceBuild?: boolean, openBrowser?: boolean }} options 
 */
async function launch(projectRoot, port = 3000, options = {}) {
	port = parseInt(port);
	const url = `http://localhost:${port}`;
	const shouldOpenBrowser = options.openBrowser !== false;

	// 检查端口是否已有服务运行
	const portAvail = await isPortAvailable(port);
	if (!portAvail) {
		// 端口被占用，检查是否是 Dashboard
		const result = await isDashboardRunning(port, projectRoot);
		if (result.isDashboard) {
			if (result.isSameProject) {
				// 是同一个项目的 Dashboard，直接复用
				console.log(`✅ Dashboard 已在 ${url} 运行（项目: ${path.basename(projectRoot)}）`);
				if (shouldOpenBrowser) {
					console.log(`🌐 正在打开浏览器...`);
					try {
						openBrowserReuseTab(url);
					} catch (err) {
						console.error(`⚠️ 自动打开浏览器失败: ${err.message}`);
						console.log(`💡 请手动访问: ${url}`);
					}
				} else {
					console.log(`💡 使用浏览器访问: ${url}`);
				}
				return;
			} else {
				// 是其他项目的 Dashboard，提示用户
				console.error(`❌ 端口 ${port} 已被其他项目的 Dashboard 占用`);
				console.log(`   当前项目: ${projectRoot}`);
				console.log(`   运行中的: ${result.projectRoot || '未知'}`);
				console.log(`💡 请尝试使用其他端口: asd ui --port 3001`);
				console.log(`   或停止其他 Dashboard 后重试`);
				return;
			}
		} else {
			console.error(`❌ 端口 ${port} 已被其他服务占用`);
			console.log(`💡 请尝试使用其他端口: asd ui --port 3001`);
			return;
		}
	}

	const specRepository = new SpecRepositoryV2(projectRoot);
	const forceBuild = options.forceBuild === true || process.env.ASD_UI_BUILD === '1' || process.env.ASD_UI_REBUILD === '1';
	
	// 1. 在后台启动 Watcher（支持调试模式）
	const isDebugMode = process.env.ASD_DEBUG_WATCH === '1' || process.env.ASD_DEBUG_SEARCH === '1';
	if (isDebugMode) {
		console.log(`[Dashboard] 正在启动项目监听器（调试模式）...`);
	} else {
		console.log(`[Dashboard] 正在后台启动项目监听器...`);
	}
	
	const rootSpecPath = Paths.getProjectSpecPath(projectRoot);
	try {
		// 调试模式下不启用 quiet，以便看到详细日志
		watch.watchFileChange(rootSpecPath, projectRoot, { quiet: !isDebugMode });
		if (isDebugMode) {
			console.log(`[Dashboard] ✅ 监听器已就绪（调试模式已启用）`);
			console.log(`[Dashboard] 💡 在 Xcode 中使用 // as:s 将触发搜索`);
		} else {
			console.log(`[Dashboard] ✅ 监听器已就绪`);
		}
	} catch (err) {
		console.error(`[Dashboard] ❌ 监听器启动失败: ${err.message}`);
	}

	const app = express();
	app.use(cors());
	app.use(express.json());

	// Catch JSON parse errors (e.g. truncated or malformed body) and return 400 instead of crashing
	app.use((err, req, res, next) => {
		const isJsonParseError = err.status === 400 && (
			err.type === 'entity.parse.failed' ||
			err instanceof SyntaxError ||
			(err.message && /JSON|Unexpected token/i.test(err.message))
		);
		if (isJsonParseError) {
			res.status(400).json({ error: 'Invalid JSON body', message: err.message || 'Malformed or truncated JSON' });
			return;
		}
		next(err);
	});

	const markerLine = new MarkerLineV2(projectRoot);

	const ctx = {
		projectRoot,
		path,
		fs,
		Paths,
		AiFactory,
		specRepository,
		snippetInstaller,
		spmDepMapUpdater,
		findPath,
		targetScanner,
		candidateService,
		headerResolution,
		markerLine,
		triggerSymbol,
		writeGuard,
		rateLimit,
		unescapeSnippetLine,
	};

	registerDashboardRoutes(app, ctx);

	// 静态资源（前端编译后的代码）；若未构建则自动在包目录执行 install + build（-g 安装也适用）
	const pkgRoot = path.resolve(__dirname, '..');
	const dashboardDir = path.join(pkgRoot, 'dashboard');
	let distPath = path.join(dashboardDir, 'dist');
	const needBuild = !fs.existsSync(distPath) || forceBuild;
	if (needBuild) {
		if (forceBuild) {
			console.log('🔄 启动前重新构建 Dashboard...');
		} else {
			console.log('⚠️	未检测到 dashboard/dist，正在自动构建（首次约需 1–2 分钟）...');
		}
		const { execSync } = require('child_process');
		try {
			if (!fs.existsSync(path.join(dashboardDir, 'node_modules'))) {
				console.log('		安装 dashboard 依赖...');
				execSync('npm install', { cwd: dashboardDir, stdio: 'inherit' });
			}
			execSync('npm run build:dashboard', { cwd: pkgRoot, stdio: 'inherit' });
		} catch (err) {
			console.error('❌ 自动构建失败:', err.message);
		}
	}
	distPath = path.join(dashboardDir, 'dist');
	if (fs.existsSync(distPath)) {
		app.use('/', express.static(distPath));
		app.get(/^((?!\/api).)*$/, (req, res) => {
			res.sendFile(path.join(distPath, 'index.html'));
		});
	} else {
		app.get('/', (req, res) => {
			res.status(200).send(
				'<h1>AutoSnippet Dashboard Server</h1>' +
				'<p>前端构建失败。请检查：</p>' +
				'<ul><li>在 AutoSnippet 安装目录执行 <code>npm run build:dashboard</code></li>' +
				'<li>或到 <a href="https://github.com/GxFn/AutoSnippet">GitHub</a> 查看说明</li></ul>'
			);
		});
		console.warn('⚠️	 构建后仍无 dashboard/dist，请手动在包目录执行: npm run build:dashboard');
	}

	app.listen(port, () => {
		const url = `http://localhost:${port}`;
		console.log(`🚀 AutoSnippet Dashboard 运行在: ${url}`);
		
		if (shouldOpenBrowser) {
			console.log(`🌐 正在打开浏览器...`);
			try {
				openBrowserReuseTab(url);
			} catch (err) {
				console.error(`⚠️ 自动打开浏览器失败: ${err.message}`);
				console.log(`💡 请手动访问: ${url}`);
			}
		} else {
			console.log(`💡 使用浏览器访问: ${url}`);
		}

		// 恰当时机自动执行 embed（可 ASD_AUTO_EMBED=0 关闭）
		autoEmbed.scheduleAutoEmbed(projectRoot, 5000);
	});
}

module.exports = { launch };
