#!/usr/bin/env node

/**
 * 职责：
 * - 统一 macOS 通知能力（osascript）
 * - 处理换行/引号等转义，避免脚本语法错误
 *
 * 说明：
 * - 仅在 darwin 下生效；其他平台静默忽略
 * - 使用 execFile 避免 shell quoting 问题
 */

const { execFile } = require('child_process');

function escapeAppleScriptString(s) {
	return String(s ?? '')
		.replace(/\\/g, '\\\\')
		.replace(/\r/g, '')
		.replace(/\n/g, '\\n')
		.replace(/"/g, '\\"');
}

function notify(message, options = {}) {
	try {
		if (process.platform !== 'darwin') return;
		if (!message) return;

		const title = escapeAppleScriptString(options.title || '');
		const subtitle = escapeAppleScriptString(options.subtitle || '');
		const msg = escapeAppleScriptString(message);

		const script = `display notification "${msg}" with title "${title}" subtitle "${subtitle}"`;
		execFile('osascript', ['-e', script], () => {});
	} catch {
		// ignore
	}
}

function alert(message, options = {}) {
	try {
		if (process.platform !== 'darwin') return;
		if (!message) return;

		const title = escapeAppleScriptString(options.title || 'AutoSnippet');
		const msg = escapeAppleScriptString(message);
		const giveUp = typeof options.givingUpAfterSeconds === 'number' ? options.givingUpAfterSeconds : 10;

		const script = giveUp > 0
			? `display dialog "${msg}" with title "${title}" buttons {"OK"} default button 1 giving up after ${giveUp}`
			: `display dialog "${msg}" with title "${title}" buttons {"OK"} default button 1`;

		// 异步执行，避免阻塞 watcher
		execFile('osascript', ['-e', script], () => {});
	} catch {
		// ignore
	}
}

/**
 * 显示多按钮弹窗并返回用户选择（同步等待）
 * @param {string} message - 消息内容
 * @param {Object} options - 选项
 * @param {string} options.title - 弹窗标题
 * @param {Array<string>} options.buttons - 按钮数组，如 ['直接插入', '建议补丁', '自动修复', '取消']
 * @param {number} options.defaultButton - 默认按钮索引（1-based）
 * @returns {Promise<string>} 用户点击的按钮文本
 */
function promptWithButtons(message, options = {}) {
	return new Promise((resolve) => {
		try {
			if (process.platform !== 'darwin') {
				// 非 macOS 环境：直接返回第一个按钮（取消或默认）
				resolve(options.buttons?.[options.buttons.length - 1] || '取消');
				return;
			}

			if (!message || !options.buttons || options.buttons.length === 0) {
				resolve('取消');
				return;
			}

			const title = escapeAppleScriptString(options.title || 'AutoSnippet');
			const msg = escapeAppleScriptString(message);
			const buttons = options.buttons.map(b => `"${escapeAppleScriptString(b)}"`).join(', ');
			const defaultButton = options.defaultButton || 1;

			const script = `display dialog "${msg}" with title "${title}" buttons {${buttons}} default button ${defaultButton}`;

			// 同步执行，获取用户选择
			const { execSync } = require('child_process');
			const result = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
				encoding: 'utf8',
				timeout: 30000
			});

			// 解析返回值：button returned:<button_name>
			const match = result.match(/button returned:(.+?)$/m);
			if (match && match[1]) {
				resolve(match[1].trim());
			} else {
				resolve(options.buttons[0] || '取消');
			}
		} catch (err) {
			// 用户取消或超时：返回最后一个按钮（通常是"取消"）
			resolve(options.buttons?.[options.buttons.length - 1] || '取消');
		}
	});
}

module.exports = {
	notify,
	alert,
	promptWithButtons,
};

