import React, { useState } from 'react';
import { BookOpen, Rocket, Database, Zap, Search, Shield, Code, GitBranch, MessageSquare, Terminal, FileCode, List, ChevronDown, ChevronRight } from 'lucide-react';
import { ICON_SIZES } from '../../constants/icons';

const HelpView: React.FC = () => {
	const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['quick-start']));

	const toggleSection = (section: string) => {
		const newExpanded = new Set(expandedSections);
		if (newExpanded.has(section)) {
			newExpanded.delete(section);
		} else {
			newExpanded.add(section);
		}
		setExpandedSections(newExpanded);
	};

	const Section = ({ id, title, icon, children }: { id: string; title: string; icon: React.ReactNode; children: React.ReactNode }) => {
		const isExpanded = expandedSections.has(id);
		return (
			<section className="border border-slate-200 rounded-lg overflow-hidden">
				<button
					onClick={() => toggleSection(id)}
					className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition-colors"
				>
					<div className="flex items-center gap-3">
						{icon}
						<h2 className="text-lg font-bold text-slate-800">{title}</h2>
					</div>
					{isExpanded ? <ChevronDown size={ICON_SIZES.lg} /> : <ChevronRight size={ICON_SIZES.lg} />}
				</button>
				{isExpanded && <div className="p-4 bg-white">{children}</div>}
			</section>
		);
	};

	return (
		<div className="max-w-5xl mx-auto py-8 px-4">
			{/* 头部 */}
			<div className="mb-8 text-center">
				<h1 className="text-4xl font-bold text-slate-900 mb-4 flex items-center justify-center gap-3">
					<BookOpen size={ICON_SIZES.xxl} className="text-blue-600" />
					AutoSnippet 使用说明
				</h1>
				<p className="text-slate-600 text-lg max-w-3xl mx-auto">
					连接开发者、AI 与项目知识库：人工审核沉淀标准，知识库存储 Recipe + Snippet，AI 按规范生成代码
				</p>
				<div className="mt-6 flex gap-4 justify-center text-sm">
					<a href="https://github.com/GxFn/AutoSnippet" target="_blank" rel="noopener noreferrer" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
						查看 GitHub
					</a>
					<a href="/docs/USER_MANUAL.md" target="_blank" rel="noopener noreferrer" className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors">
						完整文档
					</a>
				</div>
			</div>

			<div className="space-y-4">
				{/* 快速开始 */}
				<Section id="quick-start" title="快速开始" icon={<Rocket size={ICON_SIZES.xl} className="text-blue-600" />}>
					<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
						<div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
							<div className="bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center mb-3 font-bold">1</div>
							<h3 className="font-semibold text-slate-800 mb-2">安装与初始化</h3>
							<pre className="bg-slate-100 px-3 py-2 rounded text-xs overflow-x-auto"><code>npm install -g autosnippet{'\n'}asd setup{'\n'}asd ui</code></pre>
							{/* <p className="text-slate-600 text-xs mt-2">setup 已自动安装 Cursor Skills + MCP</p> */}
						</div>
						<div className="bg-green-50 rounded-lg p-4 border border-green-200">
							<div className="bg-green-600 text-white rounded-full w-8 h-8 flex items-center justify-center mb-3 font-bold">2</div>
							<h3 className="font-semibold text-slate-800 mb-2">创建第一个 Recipe</h3>
							<p className="text-slate-600 text-sm mb-2">点击顶部 <strong>New Recipe</strong></p>
							<p className="text-slate-600 text-sm">选择 <strong>Use Copied Code</strong></p>
							<p className="text-slate-600 text-sm">复制代码 → AI 填充 → 保存</p>
						</div>
						<div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
							<div className="bg-purple-600 text-white rounded-full w-8 h-8 flex items-center justify-center mb-3 font-bold">3</div>
							<h3 className="font-semibold text-slate-800 mb-2">同步到 Xcode</h3>
							<pre className="bg-slate-100 px-3 py-2 rounded text-xs mb-2"><code>asd extract</code></pre>
							<p className="text-slate-600 text-sm">在 Xcode 输入 <code className="bg-slate-200 px-1 rounded">@trigger</code> 补全</p>
						</div>
					</div>
				</Section>

				{/* 核心概念 */}
				<Section id="concepts" title="核心概念" icon={<Database size={ICON_SIZES.xl} className="text-blue-600" />}>
					{/* 三大角色 */}
					<div className="mb-6">
						<h3 className="text-lg font-semibold text-slate-700 mb-3">三大角色</h3>
						<div className="overflow-x-auto">
							<table className="min-w-full border border-slate-200 rounded-lg text-sm">
								<thead>
									<tr className="bg-slate-50">
										<th className="px-4 py-3 border-b text-left font-semibold">角色</th>
										<th className="px-4 py-3 border-b text-left font-semibold">职责</th>
										<th className="px-4 py-3 border-b text-left font-semibold">能力</th>
									</tr>
								</thead>
								<tbody>
									<tr className="hover:bg-slate-50">
										<td className="px-4 py-3 border-b font-medium text-blue-700">开发者</td>
										<td className="px-4 py-3 border-b">审核与决策、维护项目标准</td>
										<td className="px-4 py-3 border-b text-xs">Dashboard 审核候选、保存 Recipe；Snippet 补全、<code className="bg-slate-100 px-1 rounded">// as:search</code>；运行 <code className="bg-slate-100 px-1 rounded">asd ui</code></td>
									</tr>
									<tr className="hover:bg-slate-50">
										<td className="px-4 py-3 border-b font-medium text-green-700">Cursor Agent</td>
										<td className="px-4 py-3 border-b">按规范生成代码、检索知识库</td>
										<td className="px-4 py-3 border-b text-xs">Skills 理解规范；MCP 工具按需检索、提交候选；不直接修改知识库</td>
									</tr>
									<tr className="hover:bg-slate-50">
										<td className="px-4 py-3 font-medium text-purple-700">项目内 AI</td>
										<td className="px-4 py-3">提取、摘要、扫描、审查</td>
										<td className="px-4 py-3 text-xs"><code className="bg-slate-100 px-1 rounded">asd ais</code> 批量扫描；分析剪贴板；Guard 审查；Dashboard RAG</td>
									</tr>
								</tbody>
							</table>
						</div>
					</div>

					{/* 四大组件 */}
					<div>
						<h3 className="text-lg font-semibold text-slate-700 mb-3">四大组件</h3>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
								<h4 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
									<FileCode size={ICON_SIZES.lg} />
									Recipe（配方）
								</h4>
								<p className="text-blue-800 text-sm mb-3">Markdown 格式的知识文档</p>
								<ul className="text-blue-700 text-xs space-y-1 list-disc list-inside">
									<li>位置：<code className="bg-blue-100 px-1 rounded">AutoSnippet/recipes/*.md</code></li>
									<li>优先级：<strong>最高</strong>，项目第一标准</li>
									<li>用途：为 Cursor、Guard、搜索提供上下文</li>
								</ul>
							</div>
							<div className="bg-green-50 rounded-lg p-4 border border-green-200">
								<h4 className="font-semibold text-green-900 mb-2 flex items-center gap-2">
									<Zap size={ICON_SIZES.lg} />
									Snippet（代码片段）
								</h4>
								<p className="text-green-800 text-sm mb-3">Xcode 代码补全片段</p>
								<ul className="text-green-700 text-xs space-y-1 list-disc list-inside">
									<li>位置：<code className="bg-green-100 px-1 rounded">AutoSnippet/snippets/*.json</code></li>
									<li>触发：在 Xcode 输入 trigger 自动补全</li>
									<li>关联：通常与 Recipe 一一对应</li>
								</ul>
							</div>
							<div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
								<h4 className="font-semibold text-purple-900 mb-2 flex items-center gap-2">
									<Search size={ICON_SIZES.lg} />
									向量索引（Context）
								</h4>
								<p className="text-purple-800 text-sm mb-3">语义搜索引擎</p>
								<ul className="text-purple-700 text-xs space-y-1 list-disc list-inside">
									<li>位置：<code className="bg-purple-100 px-1 rounded">.autosnippet/context/</code></li>
									<li>生成：<code className="bg-purple-100 px-1 rounded">asd embed</code> 或启动时自动</li>
									<li>用途：语义搜索、相似度匹配、个性化推荐</li>
								</ul>
							</div>
							<div className="bg-amber-50 rounded-lg p-4 border border-amber-200">
								<h4 className="font-semibold text-amber-900 mb-2 flex items-center gap-2">
									<List size={ICON_SIZES.lg} />
									Candidates（候选）
								</h4>
								<p className="text-amber-800 text-sm mb-3">待审核的 Recipe 草案</p>
								<ul className="text-amber-700 text-xs space-y-1 list-disc list-inside">
									<li>位置：<code className="bg-amber-100 px-1 rounded">candidates.json</code></li>
									<li>来源：AI 扫描、Cursor、剪贴板、Dashboard</li>
									<li>用途：人工审核后入库，确保质量</li>
								</ul>
							</div>
						</div>
					</div>

					{/* 闭环流程 */}
					<div className="mt-6 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-5 border border-slate-200">
						<h3 className="text-lg font-semibold text-slate-700 mb-4">知识库闭环</h3>
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div className="flex-1 min-w-[100px] text-center">
								<div className="bg-blue-500 text-white rounded-full w-10 h-10 flex items-center justify-center mx-auto mb-2 font-bold text-lg">1</div>
								<p className="text-slate-700 font-medium text-sm">扫描提取</p>
								<p className="text-slate-500 text-xs">AI/Cursor</p>
							</div>
							<div className="text-slate-400 text-2xl">→</div>
							<div className="flex-1 min-w-[100px] text-center">
								<div className="bg-green-500 text-white rounded-full w-10 h-10 flex items-center justify-center mx-auto mb-2 font-bold text-lg">2</div>
								<p className="text-slate-700 font-medium text-sm">人工审核</p>
								<p className="text-slate-500 text-xs">Dashboard</p>
							</div>
							<div className="text-slate-400 text-2xl">→</div>
							<div className="flex-1 min-w-[100px] text-center">
								<div className="bg-purple-500 text-white rounded-full w-10 h-10 flex items-center justify-center mx-auto mb-2 font-bold text-lg">3</div>
								<p className="text-slate-700 font-medium text-sm">知识沉淀</p>
								<p className="text-slate-500 text-xs">入库</p>
							</div>
							<div className="text-slate-400 text-2xl">→</div>
							<div className="flex-1 min-w-[100px] text-center">
								<div className="bg-amber-500 text-white rounded-full w-10 h-10 flex items-center justify-center mx-auto mb-2 font-bold text-lg">4</div>
								<p className="text-slate-700 font-medium text-sm">智能使用</p>
								<p className="text-slate-500 text-xs">Cursor/Xcode</p>
							</div>
							<div className="text-slate-400 text-2xl">→</div>
							<div className="flex-1 min-w-[100px] text-center">
								<div className="bg-rose-500 text-white rounded-full w-10 h-10 flex items-center justify-center mx-auto mb-2 font-bold text-lg">5</div>
								<p className="text-slate-700 font-medium text-sm">持续优化</p>
								<p className="text-slate-500 text-xs">评分排序</p>
							</div>
						</div>
					</div>
				</Section>

				{/* 核心功能 */}
				<Section id="features" title="核心功能" icon={<Zap size={ICON_SIZES.xl} className="text-blue-600" />}>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-5">
						<div className="border border-slate-200 rounded-lg p-5 hover:shadow-lg transition-shadow">
							<div className="flex items-center gap-2 mb-3">
									<Code size={ICON_SIZES.lg} className="text-blue-600" />
								<h3 className="font-semibold text-slate-800">知识库构建</h3>
							</div>
							<ul className="text-slate-600 text-sm space-y-2 list-disc list-inside">
								<li><strong>AI 扫描</strong>：<code className="bg-slate-100 px-1 rounded text-xs">asd ais [Target]</code> 批量提取</li>
								<li><strong>Cursor 扫描</strong>：对 Copilot 说 "扫描 Module"</li>
								<li><strong>手动创建</strong>：New Recipe → Use Copied Code</li>
							<li><strong>编辑器内</strong>：复制代码 → <code className="bg-slate-100 px-1 rounded text-xs">// as:create -c</code></li>
							</ul>
						</div>
						<div className="border border-slate-200 rounded-lg p-5 hover:shadow-lg transition-shadow">
							<div className="flex items-center gap-2 mb-3">
									<Search size={ICON_SIZES.lg} className="text-blue-600" />
								<h3 className="font-semibold text-slate-800">语义检索</h3>
							</div>
							<ul className="text-slate-600 text-sm space-y-2 list-disc list-inside">
								<li><strong>语义搜索</strong>：<code className="bg-slate-100 px-1 rounded text-xs">asd search -m "query"</code></li>
								<li><strong>编辑器内</strong>：<code className="bg-slate-100 px-1 rounded text-xs">// as:search keyword</code></li>
								<li><strong>Cursor MCP</strong>：自动检索知识库</li>
								<li><strong>Dashboard</strong>：搜索框支持语义 + 关键词</li>
							</ul>
						</div>
						<div className="border border-slate-200 rounded-lg p-5 hover:shadow-lg transition-shadow">
							<div className="flex items-center gap-2 mb-3">
									<Shield size={ICON_SIZES.lg} className="text-blue-600" />
								<h3 className="font-semibold text-slate-800">代码审查（Audit）</h3>
							</div>
							<ul className="text-slate-600 text-sm space-y-2 list-disc list-inside">
								<li><strong>文件审查</strong>：<code className="bg-slate-100 px-1 rounded text-xs">// as:audit</code></li>
								<li><strong>Target 审查</strong>：<code className="bg-slate-100 px-1 rounded text-xs">// as:audit target</code></li>
								<li><strong>项目审查</strong>：<code className="bg-slate-100 px-1 rounded text-xs">// as:audit project</code></li>
								<li><strong>Dashboard</strong>：Guard 页面可视化审查</li>
							</ul>
						</div>
						<div className="border border-slate-200 rounded-lg p-5 hover:shadow-lg transition-shadow">
							<div className="flex items-center gap-2 mb-3">
								<GitBranch size=
{20} className="text-blue-600" />
								<h3 className="font-semibold text-slate-800">依赖关系图</h3>
							</div>
							<ul className="text-slate-600 text-sm space-y-2 list-disc list-inside">
								<li><strong>刷新映射</strong>：<code className="bg-slate-100 px-1 rounded text-xs">asd spm-map</code></li>
								<li><strong>可视化</strong>：Dashboard → 依赖关系图</li>
								<li><strong>用途</strong>：理解 SPM 包依赖结构</li>
							</ul>
						</div>
					</div>
				</Section>

				{/* 编辑器指令 */}
				<Section id="editor-directives" title="编辑器指令" icon={<Terminal size={ICON_SIZES.xl} className="text-blue-600" />}>
					<p className="text-slate-600 text-sm mb-4">需先运行 <code className="bg-slate-100 px-1 rounded">asd watch</code> 或 <code className="bg-slate-100 px-1 rounded">asd ui</code></p>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
							<h4 className="font-semibold text-slate-800 mb-2"><code className="bg-slate-200 px-2 py-1 rounded">// as:create</code> / <code className="bg-slate-200 px-2 py-1 rounded">// as:c</code></h4>
							<p className="text-slate-600 text-sm mb-2">创建 Recipe/Snippet</p>
							<ul className="text-slate-600 text-xs space-y-1 list-disc list-inside">
								<li>无选项：打开 Dashboard</li>
								<li><code>-c</code>：从剪贴板静默创建</li>
								<li><code>-f</code>：扫描当前文件</li>
							</ul>
						</div>
						<div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
							<h4 className="font-semibold text-slate-800 mb-2"><code className="bg-slate-200 px-2 py-1 rounded">// as:search</code> / <code className="bg-slate-200 px-2 py-1 rounded">// as:s</code></h4>
							<p className="text-slate-600 text-sm mb-2">搜索并插入</p>
							<ul className="text-slate-600 text-xs space-y-1 list-disc list-inside">
								<li>从知识库检索 Recipe/Snippet</li>
								<li>选择后插入代码，替换该行</li>
								<li>记录一次人工使用</li>
							</ul>
						</div>
						<div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
							<h4 className="font-semibold text-slate-800 mb-2"><code className="bg-slate-200 px-2 py-1 rounded">// as:audit</code> / <code className="bg-slate-200 px-2 py-1 rounded">// as:a</code></h4>
							<p className="text-slate-600 text-sm mb-2">代码审查</p>
							<ul className="text-slate-600 text-xs space-y-1 list-disc list-inside">
								<li>无后缀：审查当前文件</li>
								<li><code>target</code>：审查当前 Target</li>
								<li><code>project</code>：审查整个项目</li>
							</ul>
						</div>
						<div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
							<h4 className="font-semibold text-slate-800 mb-2"><code className="bg-slate-200 px-2 py-1 rounded">// as:include</code> / <code className="bg-slate-200 px-2 py-1 rounded">// as:import</code></h4>
							<p className="text-slate-600 text-sm mb-2">自动注入头文件/模块</p>
							<ul className="text-slate-600 text-xs space-y-1 list-disc list-inside">
								<li>Snippet 中包含此标记</li>
								<li>补全后自动注入 import</li>
							</ul>
						</div>
					</div>
				</Section>

				{/* Cursor 集成 */}
				<Section id="cursor-integration" title="Cursor AI 集成" icon={<MessageSquare size={ICON_SIZES.xl} className="text-blue-600" />}>
					<div className="mb-5">
						<h3 className="font-semibold text-slate-800 mb-3">MCP 工具</h3>
						<div className="overflow-x-auto">
							<table className="min-w-full border border-slate-200 rounded-lg text-xs">
								<thead>
									<tr className="bg-slate-50">
										<th className="px-3 py-2 border-b text-left">工具</th>
										<th className="px-3 py-2 border-b text-left">用途</th>
									</tr>
								</thead>
								<tbody>
									<tr><td className="px-3 py-2 border-b"><code>context_search</code></td><td className="px-3 py-2 border-b">智能检索知识库</td></tr>
									<tr><td className="px-3 py-2 border-b"><code>open_create</code></td><td className="px-3 py-2 border-b">打开新建 Recipe 页</td></tr>
									<tr><td className="px-3 py-2 border-b"><code>get_targets</code></td><td className="px-3 py-2 border-b">获取所有 Target</td></tr>
									<tr><td className="px-3 py-2 border-b"><code>get_target_files</code></td><td className="px-3 py-2 border-b">获取 Target 源文件</td></tr>
									<tr><td className="px-3 py-2 border-b"><code>submit_candidates</code></td><td className="px-3 py-2 border-b">批量提交候选</td></tr>
									<tr><td className="px-3 py-2"><code>confirm_recipe_usage</code></td><td className="px-3 py-2">确认 Recipe 使用</td></tr>
								</tbody>
							</table>
						</div>
					</div>

					<div>
						<h3 className="font-semibold text-slate-800 mb-3">使用示例</h3>
						<div className="space-y-3">
							<div className="bg-blue-50 rounded p-3 border border-blue-200">
								<p className="font-medium text-blue-900 text-sm mb-1">检索知识库</p>
								<p className="text-blue-800 text-xs">对 Cursor 说："查找网络请求错误处理的代码"</p>
							</div>
							<div className="bg-green-50 rounded p-3 border border-green-200">
								<p className="font-medium text-green-900 text-sm mb-1">批量扫描</p>
								<p className="text-green-800 text-xs">对 Cursor 说："扫描 NetworkModule，生成 Recipes 到候选"</p>
							</div>
							<div className="bg-purple-50 rounded p-3 border border-purple-200">
								<p className="font-medium text-purple-900 text-sm mb-1">提交代码</p>
								<p className="text-purple-800 text-xs">对 Cursor 说："把这段代码保存为 Recipe"</p>
							</div>
						</div>
					</div>
				</Section>

				{/* 命令速查 */}
				<Section id="cli-reference" title="命令行速查" icon={<Terminal size={ICON_SIZES.xl} className="text-blue-600" />}>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<h3 className="font-semibold text-slate-800 mb-2">初始化与环境</h3>
							<div className="space-y-1 text-sm">
								<div className="flex justify-between bg-slate-50 px-3 py-2 rounded">
									<code>asd setup</code>
									<span className="text-slate-500 text-xs">初始化项目</span>
								</div>
								<div className="flex justify-between bg-slate-50 px-3 py-2 rounded">
									<code>asd status</code>
									<span className="text-slate-500 text-xs">环境自检</span>
								</div>
								<div className="flex justify-between bg-slate-50 px-3 py-2 rounded">
									<code>asd ui</code>
									<span className="text-slate-500 text-xs">启动 Dashboard</span>
								</div>
							</div>
						</div>
						<div>
							<h3 className="font-semibold text-slate-800 mb-2">Recipe/Snippet 管理</h3>
							<div className="space-y-1 text-sm">
								<div className="flex justify-between bg-slate-50 px-3 py-2 rounded">
									<code>// as:create -c</code>
									<span className="text-slate-500 text-xs">编辑器内从剪贴板创建</span>
								</div>
								<div className="flex justify-between bg-slate-50 px-3 py-2 rounded">
									<code>asd extract</code>
									<span className="text-slate-500 text-xs">同步到 Xcode</span>
								</div>
								<div className="flex justify-between bg-slate-50 px-3 py-2 rounded">
									<code>asd candidate</code>
									<span className="text-slate-500 text-xs">创建候选</span>
								</div>
							</div>
						</div>
						<div>
							<h3 className="font-semibold text-slate-800 mb-2">搜索与扫描</h3>
							<div className="space-y-1 text-sm">
								<div className="flex justify-between bg-slate-50 px-3 py-2 rounded">
									<code>asd search [keyword]</code>
									<span className="text-slate-500 text-xs">关键词搜索</span>
								</div>
								<div className="flex justify-between bg-slate-50 px-3 py-2 rounded">
									<code>asd search -m [query]</code>
									<span className="text-slate-500 text-xs">语义搜索</span>
								</div>
								<div className="flex justify-between bg-slate-50 px-3 py-2 rounded">
									<code>asd ais [Target]</code>
									<span className="text-slate-500 text-xs">AI 扫描</span>
								</div>
							</div>
						</div>
						<div>
							<h3 className="font-semibold text-slate-800 mb-2">高级功能</h3>
							<div className="space-y-1 text-sm">
								<div className="flex justify-between bg-slate-50 px-3 py-2 rounded">
									<code>asd embed</code>
									<span className="text-slate-500 text-xs">构建向量索引</span>
								</div>
								<div className="flex justify-between bg-slate-50 px-3 py-2 rounded">
									<code>asd spm-map</code>
									<span className="text-slate-500 text-xs">刷新依赖</span>
								</div>
								<div className="flex justify-between bg-slate-50 px-3 py-2 rounded">
									<code>asd install:full</code>
									<span className="text-slate-500 text-xs">完整安装</span>
								</div>
							</div>
						</div>
					</div>
				</Section>
			</div>

			{/* 底部提示 */}
			<div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg text-center">
				<p className="text-slate-700 text-sm">
					需要更详细的说明？查看 <a href="/docs/USER_MANUAL.md" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">完整使用说明书</a>
				</p>
			</div>
		</div>
	);
};

export default HelpView;
