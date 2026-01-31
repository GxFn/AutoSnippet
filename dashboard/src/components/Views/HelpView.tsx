import React from 'react';
import { BookOpen } from 'lucide-react';

const HelpView: React.FC = () => {
	return (
		<div className="max-w-3xl mx-auto py-8">
			<h1 className="text-2xl font-bold text-slate-900 mb-8 flex items-center gap-2"><BookOpen size={28} className="text-blue-600" /> 使用说明</h1>
			<div className="prose prose-slate max-w-none space-y-8 text-sm">
				<section>
					<h2 className="text-lg font-bold text-slate-800 mb-3">开发者、AI 与知识库</h2>
					<div className="overflow-x-auto mb-2">
						<table className="min-w-full border border-slate-200 rounded-lg text-left text-sm">
							<thead><tr className="bg-slate-50"><th className="px-3 py-2 border-b">角色</th><th className="px-3 py-2 border-b">职责</th><th className="px-3 py-2 border-b">能力</th></tr></thead>
							<tbody>
								<tr><td className="px-3 py-2 border-b font-medium">开发者</td><td className="px-3 py-2 border-b">审核与决策；维护项目标准</td><td className="px-3 py-2 border-b">Dashboard 审核 Candidate、保存 Recipe；Snippet 补全、<code className="bg-slate-100 px-1 rounded">// as:search</code>；<code className="bg-slate-100 px-1 rounded">asd embed</code>、<code className="bg-slate-100 px-1 rounded">asd ui</code></td></tr>
								<tr><td className="px-3 py-2 border-b font-medium">Cursor Agent</td><td className="px-3 py-2 border-b">按规范生成代码；检索知识库</td><td className="px-3 py-2 border-b">Skills 理解规范；MCP 按需检索、打开新建 Recipe 页；起草供人工审核，不直接改 Knowledge</td></tr>
								<tr><td className="px-3 py-2 border-b font-medium">项目内 AI</td><td className="px-3 py-2 border-b">提取、摘要、扫描、审查</td><td className="px-3 py-2 border-b"><code className="bg-slate-100 px-1 rounded">asd ais</code>；Use Copied Code 分析；Guard 审查；Dashboard RAG。由 <code className="bg-slate-100 px-1 rounded">.env</code> 配置</td></tr>
								<tr><td className="px-3 py-2 font-medium">知识库</td><td className="px-3 py-2">存储与提供项目标准</td><td className="px-3 py-2">Recipes、Snippets、语义向量；Guard、搜索、两种 AI 均依赖</td></tr>
							</tbody>
						</table>
					</div>
					<p className="text-slate-600"><strong>闭环</strong>：扫描 → 审核 → 沉淀 → Cursor/AI 使用 → 再沉淀。用 Cursor 基于知识库写代码；写完通过 <code className="bg-slate-100 px-1 rounded">// as:create</code>、<code className="bg-slate-100 px-1 rounded">asd create --clipboard</code> 或 Dashboard 提交入库；用 <code className="bg-slate-100 px-1 rounded">// as:guard</code> 合规审查；用 Snippet 或 <code className="bg-slate-100 px-1 rounded">// as:search</code> 插入标准代码。知识库随人工审核持续更新。</p>
				</section>
				<section>
					<h2 className="text-lg font-bold text-slate-800 mb-3">页面说明</h2>
					<ul className="list-disc pl-6 space-y-2 text-slate-600">
						<li><strong>Snippets</strong>：查看、编辑、删除代码片段；点击「Sync to Xcode」同步到 Xcode CodeSnippets。</li>
						<li><strong>Recipes</strong>：管理配方（Recipes）文档，与 Snippet 关联。</li>
						<li><strong>SPM Explorer</strong>：按 Target 扫描源码，AI 提取候选；或从路径/剪贴板创建 Recipe。</li>
						<li><strong>Candidates</strong>：审核由 CLI <code className="bg-slate-100 px-1 rounded">asd ais</code> 批量扫描产生的候选，通过入库或忽略。</li>
						<li><strong>依赖关系图</strong>：展示 SPM 包依赖；<code className="bg-slate-100 px-1 rounded">asd spm-map</code> 更新。</li>
						<li><strong>AI Assistant</strong>：基于本地 Snippets/Recipes 的 RAG 问答；支持语义搜索。</li>
					</ul>
				</section>
				<section>
					<h2 className="text-lg font-bold text-slate-800 mb-3">新建 Recipe</h2>
					<p className="text-slate-600 mb-2">点击顶部「New Recipe」打开弹窗：</p>
					<ul className="list-disc pl-6 space-y-2 text-slate-600">
						<li><strong>按路径</strong>：输入相对路径（如 <code className="bg-slate-100 px-1 rounded">Sources/MyMod/Foo.m</code>），点击「Scan File」→ AI 提取标题/摘要/触发键/头文件，在 SPM Explorer 审核后保存。</li>
						<li><strong>按剪贴板</strong>：复制代码后点击「Use Copied Code」。<strong>完整 Recipe MD</strong>（含 <code className="bg-slate-100 px-1 rounded">---</code> frontmatter、<code className="bg-slate-100 px-1 rounded">## Snippet / Code Reference</code>、<code className="bg-slate-100 px-1 rounded">## AI Context / Usage Guide</code>）会直接解析，不调用 AI 重写。纯代码则由 AI 分析填充。若由 <code className="bg-slate-100 px-1 rounded">// as:create</code> 打开，会带当前文件路径自动解析头文件。</li>
					</ul>
				</section>
				<section>
					<h2 className="text-lg font-bold text-slate-800 mb-3">编辑器内指令</h2>
					<p className="text-slate-600 mb-2">需先运行 <code className="bg-slate-100 px-1 rounded">asd watch</code> 或 <code className="bg-slate-100 px-1 rounded">asd ui</code>。在源码中写入以下指令并保存：</p>
					<ul className="list-disc pl-6 space-y-2 text-slate-600">
						<li><code className="bg-slate-100 px-1 rounded">// as:create</code>：剪贴板 + 当前路径创建 Recipe，打开本页。复制代码后保存即可。</li>
						<li><code className="bg-slate-100 px-1 rounded">// as:guard</code> [关键词]：按知识库 AI 审查当前文件，结果输出终端。需 <code className="bg-slate-100 px-1 rounded">asd embed</code> 后优先用语义检索。</li>
						<li><code className="bg-slate-100 px-1 rounded">// as:search</code> [关键词]：从知识库检索 Recipe/Snippet，选一条插入替换该行。</li>
					</ul>
				</section>
				<section>
					<h2 className="text-lg font-bold text-slate-800 mb-3">语义能力</h2>
					<ul className="list-disc pl-6 space-y-2 text-slate-600">
						<li><code className="bg-slate-100 px-1 rounded">asd embed</code>：构建语义向量索引。本 Dashboard 启动时自动检测并执行，亦可手动运行。可设 <code className="bg-slate-100 px-1 rounded">ASD_AUTO_EMBED=0</code> 关闭自动 embed。</li>
						<li><code className="bg-slate-100 px-1 rounded">asd search -m [query]</code>：语义搜索知识库（自然语言）。</li>
						<li><code className="bg-slate-100 px-1 rounded">asd install:cursor-skill --mcp</code>：安装 Skills 并配置 MCP；Cursor Agent 可调用 <code className="bg-slate-100 px-1 rounded">autosnippet_context_search</code> 按需检索、<code className="bg-slate-100 px-1 rounded">autosnippet_open_create</code> 打开新建 Recipe 页。需本 Dashboard 运行。</li>
					</ul>
				</section>
				<section>
					<h2 className="text-lg font-bold text-slate-800 mb-3">头文件与 watch</h2>
					<p className="text-slate-600 mb-2">保存时可勾选「引入头文件」，会写入 <code className="bg-slate-100 px-1 rounded text-xs">// as:include &lt;TargetName/Header.h&gt; path</code>。在项目目录运行 <code className="bg-slate-100 px-1 rounded">asd watch</code>（或 <code className="bg-slate-100 px-1 rounded">asd ui</code>）后，在 Xcode 中选中 Snippet 的 headerVersion 并保存，会自动在文件头部注入对应 <code className="bg-slate-100 px-1 rounded">#import</code>。</p>
				</section>
				<section>
					<h2 className="text-lg font-bold text-slate-800 mb-3">全量安装与可选依赖</h2>
					<p className="text-slate-600 mb-2">任意目录执行：</p>
					<ul className="list-disc pl-6 space-y-2 text-slate-600">
						<li><code className="bg-slate-100 px-1 rounded">asd install:full</code>：核心 + 可选依赖 + Dashboard（前端不存在时构建）</li>
						<li><code className="bg-slate-100 px-1 rounded">asd install:full --parser</code>：上述 + Swift 解析器（ParsePackage，SPM 解析更准确；默认回退 dump-package，需本机已装 Swift）</li>
						<li><code className="bg-slate-100 px-1 rounded">asd install:full --lancedb</code>：仅安装 LanceDB（向量检索更快；再在 boxspec <code className="bg-slate-100 px-1 rounded">context.storage.adapter</code> 配 <code className="bg-slate-100 px-1 rounded">{'"lance"'}</code>）</li>
					</ul>
				</section>
				<section>
					<h2 className="text-lg font-bold text-slate-800 mb-3">AI 配置</h2>
					<p className="text-slate-600 mb-2">项目根 <code className="bg-slate-100 px-1 rounded">.env</code> 设置 API Key（如 <code className="bg-slate-100 px-1 rounded">ASD_GOOGLE_API_KEY</code>）。可选 <code className="bg-slate-100 px-1 rounded">ASD_AI_PROVIDER</code>、<code className="bg-slate-100 px-1 rounded">ASD_AI_MODEL</code>、代理（<code className="bg-slate-100 px-1 rounded">https_proxy</code>）等。支持：Gemini、OpenAI、DeepSeek、Claude、Ollama（本地）。见 <code className="bg-slate-100 px-1 rounded">.env.example</code>。</p>
				</section>
				<section>
					<h2 className="text-lg font-bold text-slate-800 mb-3">Cursor Skills 一览</h2>
					<ul className="list-disc pl-6 space-y-2 text-slate-600">
						<li><strong>autosnippet-when</strong>：路由，根据用户意图推荐对应能力</li>
						<li><strong>autosnippet-concepts</strong>：知识库、Recipe、Context 存储、Recipe 优先级</li>
						<li><strong>autosnippet-recipes</strong>：项目 Recipe 上下文、检索方式</li>
						<li><strong>autosnippet-create</strong>：提交代码到 Dashboard、禁止直接写 Knowledge</li>
						<li><strong>autosnippet-search</strong>：查找/插入推荐</li>
						<li><strong>autosnippet-guard</strong>：审查推荐</li>
						<li><strong>autosnippet-dep-graph</strong>：SPM 依赖结构</li>
					</ul>
					<p className="text-slate-600 mt-2">MCP 工具：<code className="bg-slate-100 px-1 rounded">autosnippet_context_search</code> 按需检索；<code className="bg-slate-100 px-1 rounded">autosnippet_open_create</code> 打开新建 Recipe 页。</p>
				</section>
				<section>
					<h2 className="text-lg font-bold text-slate-800 mb-3">命令行速查</h2>
					<ul className="list-disc pl-6 space-y-2 text-slate-600">
						<li><code className="bg-slate-100 px-1 rounded">asd ui</code>：启动本 Dashboard（并后台 watch）</li>
						<li><code className="bg-slate-100 px-1 rounded">asd create --clipboard [--path 相对路径]</code>：从剪贴板用 AI 创建 Recipe/Snippet</li>
						<li><code className="bg-slate-100 px-1 rounded">asd create</code>：从含 <code className="bg-slate-100 px-1 rounded">// as:code</code> 的文件用 AI 创建 Snippet</li>
						<li><code className="bg-slate-100 px-1 rounded">asd install</code>：同步 Snippets 到 Xcode</li>
						<li><code className="bg-slate-100 px-1 rounded">asd ais [Target]</code> / <code className="bg-slate-100 px-1 rounded">asd ais --all</code>：AI 扫描，结果在 Candidates 审核</li>
						<li><code className="bg-slate-100 px-1 rounded">asd search [keyword]</code>：关键词搜索；加 <code className="bg-slate-100 px-1 rounded">-m</code> 为语义搜索</li>
						<li><code className="bg-slate-100 px-1 rounded">asd watch</code>：仅监听，不打开浏览器</li>
					</ul>
				</section>
				<section>
					<h2 className="text-lg font-bold text-slate-800 mb-3">术语</h2>
					<ul className="list-disc pl-6 space-y-1 text-slate-600">
						<li><strong>Recipe</strong>：<code className="bg-slate-100 px-1 rounded">Knowledge/recipes/</code> 下的 Markdown 知识</li>
						<li><strong>Snippet</strong>：Xcode 代码片段，trigger 补全（默认 <code className="bg-slate-100 px-1 rounded">@</code>）</li>
						<li><strong>项目根</strong>：含 <code className="bg-slate-100 px-1 rounded">AutoSnippetRoot.boxspec.json</code> 的目录</li>
					</ul>
				</section>
			</div>
		</div>
	);
};

export default HelpView;
