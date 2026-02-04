#!/usr/bin/env node

/**
 * asd candidate - 从剪贴板创建候选
 * 读取剪贴板内容，创建候选项到 Dashboard 审核
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Paths = require('../infrastructure/config/Paths');

/**
 * 读取剪贴板
 * @returns {string}
 */
function readClipboard() {
	try {
		if (process.platform === 'darwin') {
			return execSync('pbpaste', { encoding: 'utf8' });
		}
		if (process.platform === 'linux') {
			return execSync('xclip -selection clipboard -o', { encoding: 'utf8' });
		}
		if (process.platform === 'win32') {
			return execSync('powershell -Command Get-Clipboard', { encoding: 'utf8' });
		}
		return '';
	} catch {
		return '';
	}
}

/**
 * 生成候选 ID
 * @returns {string}
 */
function generateId() {
	return `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 保存候选到 candidates.json
 * @param {string} projectRoot 
 * @param {object} candidate 
 */
function saveCandidate(projectRoot, candidate) {
	const candidatesPath = path.join(projectRoot, 'AutoSnippet/.autosnippet/candidates.json');
	const candidatesDir = path.dirname(candidatesPath);
	
	// 确保目录存在
	if (!fs.existsSync(candidatesDir)) {
		fs.mkdirSync(candidatesDir, { recursive: true });
	}
	
	// 读取现有候选
	let candidates = {};
	if (fs.existsSync(candidatesPath)) {
		try {
			candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
		} catch {
			candidates = {};
		}
	}
	
	// 添加新候选（使用 clipboard 作为 target）
	if (!candidates.clipboard) {
		candidates.clipboard = {
			targetName: 'clipboard',
			scanTime: Date.now(),
			items: []
		};
	}
	
	candidates.clipboard.items.push(candidate);
	candidates.clipboard.scanTime = Date.now();
	
	// 保存
	fs.writeFileSync(candidatesPath, JSON.stringify(candidates, null, 2), 'utf8');
}

/**
 * 执行 candidate
 * @param {string} projectRoot 
 * @param {object} options 
 */
async function runCandidate(projectRoot, options = {}) {
	// 1. 读取剪贴板
	const code = readClipboard();
	if (!code || code.trim() === '') {
		console.error('❌ 剪贴板为空');
		console.error('   提示: 先复制代码，然后执行 asd candidate');
		return;
	}
	
	console.log('📋 已读取剪贴板内容\n');
	console.log(`代码片段 (${code.split('\n').length} 行):`);
	console.log('----------------------------------------');
	console.log(code.split('\n').slice(0, 10).join('\n'));
	if (code.split('\n').length > 10) {
		console.log('...(已省略)');
	}
	console.log('----------------------------------------\n');
	
	// 2. 提取语言（简单检测）
	let language = 'objc'; // 默认
	if (code.includes('func ') || code.includes('class ') && code.includes(':')) {
		language = 'swift';
	}
	
	// 3. 创建候选
	const candidate = {
		id: generateId(),
		title: options.title || `Clipboard ${new Date().toLocaleString()}`,
		code: code,
		language: language,
		source: 'clipboard',
		status: 'pending',
		createdAt: Date.now(),
	};
	
	if (options.category) {
		candidate.category = options.category;
	}
	
	// 4. 保存
	try {
		saveCandidate(projectRoot, candidate);
		console.log('✅ 候选已创建\n');
		console.log(`   ID: ${candidate.id}`);
		console.log(`   语言: ${language}`);
		console.log('');
		console.log('📋 下一步：');
		console.log('  1. 执行 asd ui 打开 Dashboard');
		console.log('  2. 进入 Candidates 页面');
		console.log('  3. 审核并保存为 Recipe/Snippet');
	} catch (err) {
		console.error('❌ 保存失败:', err.message);
		process.exit(1);
	}
}

module.exports = { runCandidate };
