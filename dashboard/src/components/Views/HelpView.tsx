import React from 'react';
import { BookOpen } from 'lucide-react';

const HelpView: React.FC = () => {
	return (
		<div className="max-w-3xl mx-auto py-8">
			<h1 className="text-2xl font-bold text-slate-900 mb-8 flex items-center gap-2"><BookOpen size={28} className="text-blue-600" /> 使用说明</h1>
			<div className="prose prose-slate max-w-none space-y-8 text-sm">
				<section>
					<h2 className="text-lg font-bold text-slate-800 mb-3">页面说明</h2>
					<ul className="list-disc pl-6 space-y-2 text-slate-600">
						<li><strong>Snippets</strong>：查看、编辑、删除代码片段；点击「Sync to Xcode」同步到 Xcode CodeSnippets。</li>
						<li><strong>Recipes</strong>：管理配方（Recipes）文档，与 Snippet 关联。</li>
						<li><strong>SPM Explorer</strong>：按 Target 扫描源码，AI 提取候选；或从路径/剪贴板创建 Recipe。</li>
						<li><strong>Candidates</strong>：审核由 CLI <code className="bg-slate-100 px-1 rounded">asd ais</code> 批量扫描产生的候选，通过入库或忽略。</li>
						<li><strong>AI Assistant</strong>：基于本地 Snippets/Recipes 的 RAG 问答。</li>
					</ul>
				</section>
				<section>
					<h2 className="text-lg font-bold text-slate-800 mb-3">新建 Recipe</h2>
					<p className="text-slate-600 mb-2">点击顶部「New Recipe」打开弹窗：</p>
					<ul className="list-disc pl-6 space-y-2 text-slate-600">
						<li><strong>按路径</strong>：输入相对路径（如 <code className="bg-slate-100 px-1 rounded">Sources/MyMod/Foo.m</code>），点击「Scan File」→ AI 提取标题/摘要/触发键/头文件，在 SPM Explorer 审核后保存。</li>
						<li><strong>按剪贴板</strong>：复制代码后点击「Use Copied Code」→ AI 分析并填充。若由 <code className="bg-slate-100 px-1 rounded">// as:create</code> 打开，会带当前文件路径自动解析头文件。</li>
					</ul>
				</section>
				<section>
					<h2 className="text-lg font-bold text-slate-800 mb-3">头文件与 watch</h2>
					<p className="text-slate-600 mb-2">保存时可勾选「引入头文件」，会写入 <code className="bg-slate-100 px-1 rounded text-xs">// as:include &lt;TargetName/Header.h&gt; path</code>。在项目目录运行 <code className="bg-slate-100 px-1 rounded">asd watch</code> 后，在 Xcode 中选中 Snippet 的 headerVersion 并保存，会自动在文件头部注入对应 <code className="bg-slate-100 px-1 rounded">#import</code>。</p>
				</section>
				<section>
					<h2 className="text-lg font-bold text-slate-800 mb-3">// as:create 流程</h2>
					<p className="text-slate-600 mb-2">在源码中写一行 <code className="bg-slate-100 px-1 rounded">// as:create</code>，把要提炼的代码复制到剪贴板并保存文件。watch 检测到后会打开本页并带当前文件路径；若剪贴板有内容会自动走「按剪贴板」创建，并按路径解析头文件。</p>
				</section>
				<section>
					<h2 className="text-lg font-bold text-slate-800 mb-3">命令行速查</h2>
					<ul className="list-disc pl-6 space-y-2 text-slate-600">
						<li><code className="bg-slate-100 px-1 rounded">asd ui</code>：启动本 Dashboard</li>
						<li><code className="bg-slate-100 px-1 rounded">asd create</code>：从含 <code className="bg-slate-100 px-1 rounded">// as:code</code> 的文件用 AI 创建 Snippet</li>
						<li><code className="bg-slate-100 px-1 rounded">asd create --clipboard [--path 相对路径]</code>：从剪贴板用 AI 创建</li>
						<li><code className="bg-slate-100 px-1 rounded">asd install</code>：同步 Snippets 到 Xcode</li>
						<li><code className="bg-slate-100 px-1 rounded">asd ais [Target]</code> / <code className="bg-slate-100 px-1 rounded">asd ais --all</code>：AI 扫描，结果在 Candidates 审核</li>
						<li><code className="bg-slate-100 px-1 rounded">asd watch</code>：监听头文件注入、ALink、// as:create</li>
					</ul>
				</section>
			</div>
		</div>
	);
};

export default HelpView;
