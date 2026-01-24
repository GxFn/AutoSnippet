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

module.exports = {
	notify,
	alert,
};

