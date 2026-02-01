#!/usr/bin/env node

/**
 * Native UI 辅助：调用 Swift Helper 或 AppleScript 弹窗
 * 供 watch 的 as:search 和 asd search --pick 使用
 */

const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const NATIVE_UI_BIN = path.join(ROOT, 'resources', 'native-ui', 'native-ui');

function isMacOS() {
	return process.platform === 'darwin';
}

function getNativeUiPath() {
	try {
		const fs = require('fs');
		if (fs.existsSync(NATIVE_UI_BIN)) return NATIVE_UI_BIN;
	} catch (_) {}
	return null;
}

/**
 * 优先使用 Swift Helper 高级弹窗；仅当显式设置 ASD_USE_APPLESCRIPT=1 时才用 AppleScript。
 * 若 Swift Helper 未构建，会自动回退到 AppleScript。
 */
function shouldUseAppleScript() {
	return process.env.ASD_USE_APPLESCRIPT === '1';
}

/**
 * 弹出列表选择，返回选中的索引（0-based），取消返回 -1
 */
async function pickFromList(items, title = 'AutoSnippet 搜索结果', prompt = '请选择:') {
	if (!items || items.length === 0) return -1;

	const nativePath = getNativeUiPath();
	if (nativePath && isMacOS() && !shouldUseAppleScript()) {
		try {
			const args = items.map(s => '"' + String(s).slice(0, 200).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(' ');
			const out = execSync(`"${nativePath}" list ${args}`, {
				encoding: 'utf8',
				stdio: ['inherit', 'pipe', 'pipe']
			});
			const idx = parseInt(out.trim(), 10);
			return Number.isNaN(idx) ? -1 : Math.max(0, Math.min(idx, items.length - 1));
		} catch (e) {
			if (e.status === 1) return -1;
			return fallbackAppleScriptList(items, title, prompt);
		}
	}
	if (isMacOS()) {
		if (!nativePath && process.stdout.isTTY) {
			try { process.stderr.write('ℹ️  提示: 执行 npm run build:native-ui 可启用高级弹窗\n'); } catch (_) {}
		}
		return fallbackAppleScriptList(items, title, prompt);
	}
	return fallbackInquirerList(items, prompt);
}

function fallbackAppleScriptList(items, title, prompt) {
	try {
		const listStr = '{' + items.map(s => `"${String(s).replace(/"/g, '\\"').slice(0, 150)}"`).join(', ') + '}';
		const script = `tell application "System Events" to activate
choose from list ${listStr} with title "${title}" with prompt "${prompt}"`;
		const out = execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, { encoding: 'utf8' });
		const sel = out.trim();
		if (sel === 'false') return -1;
		const idx = items.indexOf(sel);
		return idx >= 0 ? idx : 0;
	} catch (e) {
		return -1;
	}
}

async function fallbackInquirerList(items, prompt) {
	try {
		const inquirer = require('inquirer');
		const { answer } = await inquirer.prompt([
			{ type: 'list', name: 'answer', message: prompt || '请选择:', choices: items.map((s, i) => ({ name: s, value: i })) }
		]);
		return answer;
	} catch (e) {
		return -1;
	}
}

/**
 * 弹出预览确认框，返回 true 表示用户确认插入
 */
async function showPreview(title, code) {
	const nativePath = getNativeUiPath();
	if (nativePath && isMacOS() && !shouldUseAppleScript()) {
		try {
			const safeTitle = String(title).replace(/"/g, '\\"').slice(0, 100);
			const safeCode = String(code).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').slice(0, 3000);
			execSync(`"${nativePath}" preview "${safeTitle}" "${safeCode}"`, { stdio: 'inherit' });
			return true;
		} catch (e) {
			if (e.status === 1) return false;
			return fallbackAppleScriptPreview(title, code);
		}
	}
	if (isMacOS()) return fallbackAppleScriptPreview(title, code);
	return fallbackInquirerPreview(title, code);
}

function fallbackAppleScriptPreview(title, code) {
	try {
		const msg = String(code).slice(0, 500).replace(/"/g, '\\"').replace(/\n/g, '\\n');
		const t = String(title).slice(0, 50).replace(/"/g, '\\"');
		const script = `set r to button returned of (display alert "即将插入: ${t}" message "${msg}" buttons {"取消", "立即插入"} default button "立即插入")\nreturn r`;
		const out = execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, { encoding: 'utf8' });
		return out.trim().includes('立即插入');
	} catch (e) {
		return false;
	}
}

async function fallbackInquirerPreview(title, code) {
	try {
		const inquirer = require('inquirer');
		const { ok } = await inquirer.prompt([
			{ type: 'confirm', name: 'ok', message: `插入「${title}」?\n${String(code).slice(0, 200)}...`, default: true }
		]);
		return ok;
	} catch (e) {
		return false;
	}
}

/**
 * 写剪贴板（跨平台）
 */
function writeClipboard(text) {
	try {
		if (process.platform === 'darwin') {
			execSync('pbcopy', { input: text, encoding: 'utf8' });
			return true;
		}
		if (process.platform === 'linux') {
			execSync('xclip -selection clipboard', { input: text, encoding: 'utf8' });
			return true;
		}
		if (process.platform === 'win32') {
			execSync('powershell -Command Set-Clipboard', { input: text, encoding: 'utf8' });
			return true;
		}
	} catch (_) {}
	return false;
}

module.exports = {
	isMacOS,
	getNativeUiPath,
	pickFromList,
	showPreview,
	writeClipboard
};
