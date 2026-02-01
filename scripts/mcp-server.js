#!/usr/bin/env node

/**
 * AutoSnippet MCP Server
 *
 * 将知识库 API 包装为语义化工具，供 Cursor 等 MCP 客户端调用。
 * Skills 只描述语义能力（如「知识库检索」），硬连接（URL、HTTP）集中在此。
 *
 * 配置：ASD_UI_URL（默认 http://localhost:3000），需先运行 asd ui。
 * Cursor 配置：.cursor/mcp.json 或 ~/.cursor/mcp.json
 */

const http = require('http');
const https = require('https');
const defaults = require('../lib/infra/defaults');
const path = require('path');
const sdkServer = path.join(__dirname, '../node_modules/@modelcontextprotocol/sdk/dist/cjs/server');
const { McpServer } = require(path.join(sdkServer, 'mcp.js'));
const { StdioServerTransport } = require(path.join(sdkServer, 'stdio.js'));
const { z } = require('zod');

const BASE_URL = process.env.ASD_UI_URL || defaults.DEFAULT_ASD_UI_URL;

function openCreatePage(path) {
	const url = new URL('/', BASE_URL);
	url.searchParams.set('action', 'create');
	url.searchParams.set('source', 'clipboard');
	if (path && typeof path === 'string' && path.trim()) {
		url.searchParams.set('path', path.trim());
	}
	const openBrowser = require('../lib/infra/openBrowser');
	openBrowser.openBrowserReuseTab(url.toString(), BASE_URL);
}

function request(method, pathname, body) {
	const url = new URL(pathname, BASE_URL);
	const client = url.protocol === 'https:' ? https : http;
	const opts = {
		hostname: url.hostname,
		port: url.port || (url.protocol === 'https:' ? 443 : 80),
		path: url.pathname,
		method
	};
	let postBody = null;
	if (body !== undefined && method === 'POST') {
		postBody = JSON.stringify(body);
		opts.headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postBody) };
	}
	return new Promise((resolve, reject) => {
		const req = client.request(opts, (res) => {
			let data = '';
			res.on('data', (ch) => { data += ch; });
			res.on('end', () => {
				try {
					const json = data ? JSON.parse(data) : {};
					resolve(json);
				} catch (e) {
					reject(new Error('Invalid JSON: ' + data.slice(0, 200)));
				}
			});
		});
		req.on('error', reject);
		if (postBody) req.write(postBody);
		req.end();
	});
}

async function postContextSearch(query, limit = 5, filter) {
	return request('POST', '/api/context/search', { query: String(query), limit: Number(limit), filter: filter || undefined });
}

const server = new McpServer({ name: 'autosnippet', version: '1.0.0' });

server.registerTool(
	'autosnippet_open_create',
	{
		description: '打开浏览器并导航到 Dashboard 新建 Recipe 页（Use Copied Code 流程）。等价于 Xcode 中 // as:create 复制后保存触发的跳转。用户需先将要提交的代码复制到剪贴板，调用后页面会读取剪贴板并填充。可选 path 用于头文件解析（如 Sources/MyMod/Foo.m）。Dashboard 需已运行于 localhost:3000（若未运行，先在终端 asd ui）。',
		inputSchema: {
			path: z.string().optional().describe('相对路径，用于头文件解析，如 Sources/MyMod/Foo.m')
		}
	},
	async ({ path }) => {
		try {
			openCreatePage(path);
			return {
				content: [{
					type: 'text',
					text: '已打开 Dashboard 新建 Recipe 页。请确保要提交的代码已在剪贴板中，页面将自动读取并填充。若尚未复制，请复制后刷新页面或点击 Use Copied Code。'
				}]
			};
		} catch (e) {
			return {
				content: [{ type: 'text', text: `打开失败: ${e.message}。请确认 Dashboard 已运行（终端执行 asd ui），或手动打开 http://localhost:3000。` }]
			};
		}
	}
);

server.registerTool(
	'autosnippet_context_search',
	{
		description: '按需检索项目知识库：根据自然语言查询返回相关 Recipe、文档。需先运行 asd ui。',
		inputSchema: {
			query: z.string().describe('自然语言查询，如：网络请求、WebView 加载、URLRequest'),
			limit: z.number().optional().default(5).describe('返回条数，默认 5')
		}
	},
	async ({ query, limit }) => {
		try {
			const res = await postContextSearch(query, limit ?? 5);
			const items = res?.items || [];
			if (items.length === 0) {
				return { content: [{ type: 'text', text: '未找到相关上下文。请确认 asd ui 已启动且 asd embed 已执行。' }] };
			}
			const lines = items.map((it, i) => {
				const meta = it.metadata || {};
				const src = meta.sourcePath || meta.source || it.id || '';
				return `[${i + 1}] ${src}\n${(it.content || '').slice(0, 2000)}${(it.content || '').length > 2000 ? '\n...(截断)' : ''}`;
			});
			return { content: [{ type: 'text', text: lines.join('\n\n---\n\n') }] };
		} catch (e) {
			return {
				content: [{
					type: 'text',
					text: `检索失败: ${e.message}。请确认 asd ui 已启动并已执行 asd embed。`
				}]
			};
		}
	}
);

server.registerTool(
	'autosnippet_get_targets',
	{
		description: '获取项目所有 SPM Target 列表，供 Cursor 批量扫描时选择要扫描的 target。需先运行 asd ui。',
		inputSchema: {}
	},
	async () => {
		try {
			const list = await request('GET', '/api/spm/targets');
			if (!Array.isArray(list)) {
				return { content: [{ type: 'text', text: '未获取到 Target 列表。请确认 asd ui 已启动且项目根含 Package.swift。' }] };
			}
			const lines = list.map((t, i) => `${i + 1}. ${t.name} (package: ${t.packageName}, path: ${t.targetDir})`);
			return { content: [{ type: 'text', text: lines.length ? lines.join('\n') : '当前项目无 SPM Target。' }] };
		} catch (e) {
			return { content: [{ type: 'text', text: `请求失败: ${e.message}。请确认 asd ui 已启动。` }] };
		}
	}
);

server.registerTool(
	'autosnippet_get_target_files',
	{
		description: '获取指定 SPM Target 的源码文件列表（name + path），供 Cursor 批量扫描时按文件读取内容并提取候选。传入 targetName（如 MyModule）即可。需先运行 asd ui。',
		inputSchema: {
			targetName: z.string().describe('Target 名称，与 autosnippet_get_targets 列表中的 name 一致')
		}
	},
	async ({ targetName }) => {
		try {
			if (!targetName || typeof targetName !== 'string') {
				return { content: [{ type: 'text', text: '请传入 targetName（Target 名称）。' }] };
			}
			const res = await request('POST', '/api/spm/target-files', { targetName: targetName.trim() });
			const files = res?.files || [];
			const lines = files.map((f, i) => `${i + 1}. ${f.path} (${f.name})`);
			return { content: [{ type: 'text', text: lines.length ? lines.join('\n') : '该 Target 无源码文件。' }] };
		} catch (e) {
			return { content: [{ type: 'text', text: `请求失败: ${e.message}。请确认 asd ui 已启动且 targetName 正确。` }] };
		}
	}
);

server.registerTool(
	'autosnippet_submit_candidates',
	{
		description: '将 Cursor 提取的候选批量提交到 Dashboard Candidates，供人工审核。用于「用 Cursor 做批量扫描」：先 get_targets → get_target_files → 对每个文件用 Cursor AI 提取 Recipe 结构 → 调用本工具提交。每条 item 需含 title、summary、trigger、language、code、usageGuide；可选 summary_cn、usageGuide_cn、category、headers 等。需先运行 asd ui。',
		inputSchema: {
			targetName: z.string().describe('候选归属的 target 名，如 MyModule 或 _cursor'),
			items: z.array(z.record(z.string(), z.unknown())).describe('候选数组，每条至少含 title, summary, trigger, language, code, usageGuide'),
			source: z.string().optional().describe('来源标记，默认 cursor-scan'),
			expiresInHours: z.number().optional().describe('保留小时数，默认 24')
		}
	},
	async ({ targetName, items, source, expiresInHours }) => {
		try {
			if (!targetName || !Array.isArray(items) || items.length === 0) {
				return { content: [{ type: 'text', text: '需要 targetName 与 items（数组，至少一条）。' }] };
			}
			const res = await request('POST', '/api/candidates/append', {
				targetName: String(targetName),
				items,
				source: source || 'cursor-scan',
				expiresInHours: typeof expiresInHours === 'number' ? expiresInHours : 24
			});
			return {
				content: [{
					type: 'text',
					text: `已提交 ${res?.count ?? items.length} 条候选到 ${res?.targetName ?? targetName}。请在 Dashboard Candidates 页审核。`
				}]
			};
		} catch (e) {
			return { content: [{ type: 'text', text: `提交失败: ${e.message}。请确认 asd ui 已启动且 items 格式符合 ExtractedRecipe（含 title, summary, trigger, language, code, usageGuide）。` }] };
		}
	}
);

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((err) => {
	process.stderr.write(`MCP Server Error: ${err.message}\n`);
	process.exit(1);
});
