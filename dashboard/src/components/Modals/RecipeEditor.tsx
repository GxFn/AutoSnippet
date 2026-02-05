import React, { useState } from 'react';
import axios from 'axios';
import { X, Save, Eye, Edit3, Loader2 } from 'lucide-react';
import { Recipe } from '../../types';
import MarkdownWithHighlight from '../Shared/MarkdownWithHighlight';
import { ICON_SIZES } from '../../constants/icons';

interface RecipeEditorProps {
	editingRecipe: Recipe;
	setEditingRecipe: (recipe: Recipe | null) => void;
	handleSaveRecipe: () => void;
	closeRecipeEdit: () => void;
	isSavingRecipe?: boolean;
}

const defaultStats = {
	authority: 0,
	guardUsageCount: 0,
	humanUsageCount: 0,
	aiUsageCount: 0,
	lastUsedAt: null as string | null,
	authorityScore: 0
};

const RecipeEditor: React.FC<RecipeEditorProps> = ({ editingRecipe, setEditingRecipe, handleSaveRecipe, closeRecipeEdit, isSavingRecipe = false }) => {
	const [viewMode, setViewMode] = useState<'edit' | 'preview'>('preview');
	const REQUIRED_CATEGORIES = ['View', 'Service', 'Tool', 'Model', 'Network', 'Storage', 'UI', 'Utility'];

	const handleSetAuthority = async (authority: number) => {
		try {
			await axios.post('/api/recipes/set-authority', { name: editingRecipe.name, authority });
			const stats = editingRecipe.stats ? { ...editingRecipe.stats, authority } : { ...defaultStats, authority };
			setEditingRecipe({ ...editingRecipe, stats });
		} catch (_) {}
	};

	// 解析元数据和正文
	const parseContent = (content: string) => {
		const lines = content.split('\n');
		const metadata: Record<string, string> = {};
		let bodyStartIndex = 0;
		let inYaml = false;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			
			// 处理 --- 包裹的 YAML
			if (line === '---') {
				if (!inYaml && i === 0) {
					inYaml = true;
					continue;
				} else if (inYaml) {
					inYaml = false;
					bodyStartIndex = i + 1;
					break;
				}
			}

			// 处理普通的 key: value
			const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)/);
			if (match) {
				metadata[match[1]] = match[2];
				if (!inYaml) bodyStartIndex = i + 1;
			} else if (!inYaml && line !== '') {
				// 遇到非空且不是 key: value 的行，说明正文开始了
				bodyStartIndex = i;
				break;
			}
		}

		const body = lines.slice(bodyStartIndex).join('\n').trim();
		return { metadata, body };
	};

	const { metadata, body } = parseContent(editingRecipe.content || '');

	const validateMetadata = (meta: Record<string, string>) => {
		const errors: string[] = [];
		const warnings: string[] = [];
		const get = (key: string) => (meta[key] || '').trim();
		const title = get('title');
		const trigger = get('trigger');
		const category = get('category');
		const language = get('language').toLowerCase();
		const summaryCn = get('summary_cn') || get('summary');
		const summaryEn = get('summary_en');
		const headers = get('headers');

		if (!title) errors.push('缺少 title');
		if (!trigger || !trigger.startsWith('@')) errors.push('trigger 必须以 @ 开头');
		if (!category || !REQUIRED_CATEGORIES.includes(category)) errors.push(`category 必须为以下之一：${REQUIRED_CATEGORIES.join(', ')}`);
		if (!language || (language !== 'swift' && language !== 'objectivec' && language !== 'markdown')) errors.push('language 必须为 swift 或 objectivec');
		if (!summaryCn) errors.push('缺少 summary/summary_cn');
		if (!summaryEn) warnings.push('缺少 summary_en');

		if (!headers) {
			warnings.push('缺少 headers（建议填写完整 import 语句）');
		} else {
			const list = headers.startsWith('[')
				? headers.slice(1, -1).split(',').map(h => h.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
				: [headers.replace(/^["']|["']$/g, '')];
			const invalid = list.filter(h => !(h.startsWith('import ') || h.startsWith('#import ')));
			if (invalid.length > 0) warnings.push('headers 建议为完整 import 语句（Swift: import X / ObjC: #import <X/Y.h>）');
		}

		return { errors, warnings };
	};

	const { errors, warnings } = validateMetadata(metadata);

	// 格式化时间戳
	const formatTimestamp = (ts: number | undefined) => {
		if (!ts) return '';
		return new Date(ts).toLocaleString('zh-CN', { 
			year: 'numeric', 
			month: '2-digit', 
			day: '2-digit', 
			hour: '2-digit', 
			minute: '2-digit' 
		});
	};

	return (
		<div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
			<div className="bg-white w-full max-w-6xl rounded-2xl shadow-2xl flex flex-col h-[85vh]">
				<div className="p-6 border-b border-slate-100 flex justify-between items-center flex-wrap gap-4">
					<h2 className="text-xl font-bold">Edit Recipe</h2>
					<div className="flex items-center gap-4">
						<div className="flex items-center gap-2">
							<span className="text-xs font-medium text-slate-500">权威分</span>
							{viewMode === 'preview' ? (
								<span className="text-sm text-slate-700">{(editingRecipe.stats?.authority ?? 3)}</span>
							) : (
								<select 
									className="font-bold text-amber-600 bg-amber-50 border border-amber-100 px-2 py-1 rounded-lg outline-none text-[10px] focus:ring-2 focus:ring-amber-500"
									value={editingRecipe.stats?.authority ?? 3}
									onChange={e => handleSetAuthority(parseInt(e.target.value))}
								>
									<option value="1">⭐ 1 - Basic</option>
									<option value="2">⭐⭐ 2 - Good</option>
									<option value="3">⭐⭐⭐ 3 - Solid</option>
									<option value="4">⭐⭐⭐⭐ 4 - Great</option>
									<option value="5">⭐⭐⭐⭐⭐ 5 - Excellent</option>
								</select>
							)}
						</div>
						<div className="flex bg-slate-100 p-1 rounded-lg mr-4">
							<button 
								onClick={() => setViewMode('preview')} 
								className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${viewMode === 'preview' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}
							>
								<Eye size={ICON_SIZES.sm} /> Preview
							</button>
							<button 
								onClick={() => setViewMode('edit')} 
								className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${viewMode === 'edit' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}
							>
								<Edit3 size={ICON_SIZES.sm} /> Edit
							</button>
						</div>
						<button onClick={closeRecipeEdit} className="p-2 hover:bg-slate-100 rounded-full"><X size={ICON_SIZES.lg} /></button>
					</div>
				</div>
				<div className="p-6 space-y-4 flex-1 flex flex-col overflow-hidden">
					{viewMode === 'edit' && (
						<div>
							<label className="block text-xs font-bold text-slate-400 uppercase mb-1">Path</label>
							<input className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm" value={editingRecipe.name} onChange={e => setEditingRecipe({ ...editingRecipe, name: e.target.value })} />
						</div>
					)}

					{(errors.length > 0 || warnings.length > 0) && (
						<div className="rounded-xl border p-4 text-xs space-y-2 bg-amber-50 border-amber-200 text-amber-800">
							<div className="font-bold">Frontmatter 校验提示</div>
							{errors.length > 0 && (
								<div>
									<div className="font-semibold">错误</div>
									<ul className="list-disc pl-5">
										{errors.map((e, i) => <li key={i}>{e}</li>)}
									</ul>
								</div>
							)}
							{warnings.length > 0 && (
								<div>
									<div className="font-semibold">建议</div>
									<ul className="list-disc pl-5">
										{warnings.map((w, i) => <li key={i}>{w}</li>)}
									</ul>
								</div>
							)}
						</div>
					)}
					
					<div className="flex-1 flex flex-col min-h-0">
						{viewMode === 'edit' ? (
							<>
								<label className="block text-xs font-bold text-slate-400 uppercase mb-1">Markdown Content</label>
								<textarea
									className="w-full flex-1 p-4 bg-slate-900 text-slate-100 font-mono text-xs rounded-xl outline-none leading-relaxed"
									value={editingRecipe.content || ''}
									onChange={e => setEditingRecipe({ ...editingRecipe, content: e.target.value })}
								/>
							</>
						) : (
							<div className="flex-1 overflow-y-auto space-y-6">
								{/* 优化的元数据展示区 */}
								{Object.keys(metadata).length > 0 && (
									<div className="bg-slate-50 border border-slate-200 rounded-2xl p-6">
										<h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Recipe Metadata</h3>
										<div className="space-y-4">
											{/* 元数据网格（排除 summary、summary_cn、summary_en） */}
											{Object.keys(metadata).filter(k => !['summary', 'summary_cn', 'summary_en'].includes(k)).length > 0 && (
												<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-4 gap-x-8">
													{Object.entries(metadata).filter(([k]) => !['summary', 'summary_cn', 'summary_en'].includes(k)).map(([key, value]) => (
														<div key={key} className="flex flex-col">
															<span className="text-[10px] text-slate-400 font-bold uppercase mb-1">{key}</span>
															<span className="text-sm text-slate-700 break-all font-medium">
																{key === 'updatedAt' ? (
																	formatTimestamp(parseInt(value))
																) : value.startsWith('[') && value.endsWith(']') ? (
																	<div className="flex flex-wrap gap-1 mt-1">
																		{value.slice(1, -1).split(',').map((v, i) => (
																			<span key={i} className="px-2 py-0.5 bg-white border border-slate-200 rounded text-[10px] font-mono">{v.trim()}</span>
																		))}
																	</div>
																) : (
																	value
																)}
															</span>
														</div>
													))}
												</div>
											)}
											
											{/* summary_cn - 在 Metadata 层级最底部独立一行 */}
											{metadata.summary_cn && (
												<div className="mt-4 pt-4 border-t border-slate-200">
													<span className="text-[10px] text-slate-400 font-bold uppercase mb-2 block">Summary (Chinese)</span>
													<p className="text-sm text-slate-700 leading-relaxed">{metadata.summary_cn}</p>
												</div>
											)}

											{/* summary_en - 在 Metadata 层级最底部独立一行 */}
											{metadata.summary_en && (
												<div className="mt-3 pt-3 border-t border-slate-200">
													<span className="text-[10px] text-slate-400 font-bold uppercase mb-2 block">Summary (English)</span>
													<p className="text-sm text-slate-700 leading-relaxed">{metadata.summary_en}</p>
												</div>
											)}
										</div>
									</div>
								)}
								
								{/* 正文预览区 */}
								<div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm min-h-[400px]">
									{body ? (
										<MarkdownWithHighlight content={body} showLineNumbers />
									) : (
										<div className="flex items-center justify-center h-full text-slate-300 italic">No content body</div>
									)}
								</div>
							</div>
						)}
					</div>
				</div>
				<div className="p-6 border-t border-slate-100 flex justify-end gap-3">
					<button onClick={closeRecipeEdit} disabled={isSavingRecipe} className="px-4 py-2 text-slate-600 font-medium disabled:opacity-50">Cancel</button>
					<button onClick={handleSaveRecipe} disabled={isSavingRecipe} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium flex items-center gap-2 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed">
						{isSavingRecipe ? <Loader2 size={ICON_SIZES.lg} className="animate-spin" /> : <Save size={ICON_SIZES.lg} />}
						{isSavingRecipe ? '保存中...' : 'Save Changes'}
					</button>
				</div>
			</div>
		</div>
	);
};

export default RecipeEditor;
