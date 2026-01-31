#!/usr/bin/env node

/**
 * 打开浏览器，在 macOS 上优先复用已打开的 Dashboard 标签
 * 供 asd ui 与 watch (as:create、as:search) 共用
 */

const { execSync, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const open = require('open');

/**
 * 检测当前进程是否已有控制 Chromium 系浏览器的权限
 * @returns {boolean}
 */
function hasMacOSBrowserControlGranted() {
	if (process.platform !== 'darwin') return false;
	const chromiumBrowsers = [
		'Google Chrome Canary',
		'Google Chrome',
		'Microsoft Edge',
		'Brave Browser',
		'Vivaldi',
		'Chromium'
	];
	for (const browser of chromiumBrowsers) {
		try {
			execSync(`osascript -e 'tell application "${browser}" to get name'`, {
				stdio: 'ignore'
			});
			return true;
		} catch (_) {
			// 未安装或未授权，尝试下一个
		}
	}
	return false;
}

/**
 * 在 macOS 上尝试复用已打开的同 URL 标签，失败则用 open 新开
 * 支持按 base URL 查找后导航到目标 URL（as:create、as:search 复用已有 Dashboard）
 * 可通过环境变量 ASD_UI_NO_REUSE_TAB=1 跳过复用
 *
 * @param {string} url 要打开的地址（若仅此参数，则同时用于查找与打开）
 * @param {string} [baseUrlForLookup] 可选。用于查找已有标签的 base URL（如 http://localhost:3000），
 *   若提供则按 base 查找，找到后导航到 url；不提供则 url 同时用于查找与打开
 */
function openBrowserReuseTab(url, baseUrlForLookup) {
	const skipReuse = process.env.ASD_UI_NO_REUSE_TAB === '1' || process.env.ASD_UI_OPEN_REUSE === '0';
	if (skipReuse) {
		open(url);
		return;
	}
	if (process.platform === 'darwin') {
		const chromiumBrowsers = [
			'Google Chrome Canary',
			'Google Chrome',
			'Microsoft Edge',
			'Brave Browser',
			'Vivaldi',
			'Chromium'
		];
		const scriptPath = path.join(__dirname, '../../bin/openChrome.applescript');
		if (!fs.existsSync(scriptPath)) {
			open(url);
			return;
		}
		if (!hasMacOSBrowserControlGranted()) {
			console.log('💡 若已打开该页将复用标签；若系统弹出「辅助功能」权限请求，允许即可；未授权则自动新开标签。');
		}
		const lookupUrl = baseUrlForLookup || url;
		for (const browser of chromiumBrowsers) {
			try {
				// 若指定了 baseUrlForLookup，传三参：lookupBase, targetUrl, browser
				const args = lookupUrl !== url
					? [scriptPath, lookupUrl, url, browser]
					: [scriptPath, url, browser];
				execFileSync('osascript', args, {
					cwd: path.dirname(scriptPath),
					stdio: 'ignore'
				});
				return;
			} catch (_) {
				// 未授权、浏览器未安装或脚本失败，静默回退到 open(url)
			}
		}
	}
	open(url);
}

module.exports = {
	openBrowserReuseTab,
	hasMacOSBrowserControlGranted
};
