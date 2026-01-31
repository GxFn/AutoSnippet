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

async function postContextSearch(query, limit = 5, filter) {
	const url = new URL('/api/context/search', BASE_URL);
	const body = JSON.stringify({ query: String(query), limit: Number(limit), filter: filter || undefined });
	const client = url.protocol === 'https:' ? https : http;
	return new Promise((resolve, reject) => {
		const opts = {
			hostname: url.hostname,
			port: url.port || (url.protocol === 'https:' ? 443 : 80),
			path: url.pathname,
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
		};
		const req = client.request(opts, (res) => {
			let data = '';
			res.on('data', (ch) => { data += ch; });
			res.on('end', () => {
				try {
					const json = JSON.parse(data);
					resolve(json);
				} catch (e) {
					reject(new Error('Invalid JSON: ' + data.slice(0, 200)));
				}
			});
		});
		req.on('error', reject);
		req.write(body);
		req.end();
	});
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

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((err) => {
	process.stderr.write(`MCP Server Error: ${err.message}\n`);
	process.exit(1);
});
