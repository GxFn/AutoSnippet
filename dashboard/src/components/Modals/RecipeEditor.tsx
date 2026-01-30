import React, { useState } from 'react';
import { X, Save, Eye, Edit3 } from 'lucide-react';
import { Recipe } from '../../types';
import MarkdownWithHighlight from '../Shared/MarkdownWithHighlight';

interface RecipeEditorProps {
	editingRecipe: Recipe;
	setEditingRecipe: (recipe: Recipe | null) => void;
	handleSaveRecipe: () => void;
	closeRecipeEdit: () => void;
}

const RecipeEditor: React.FC<RecipeEditorProps> = ({ editingRecipe, setEditingRecipe, handleSaveRecipe, closeRecipeEdit }) => {
	const [viewMode, setViewMode] = useState<'edit' | 'preview'>('preview');

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

	return (
		<div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
			<div className="bg-white w-full max-w-6xl rounded-2xl shadow-2xl flex flex-col h-[85vh]">
				<div className="p-6 border-b border-slate-100 flex justify-between items-center">
					<h2 className="text-xl font-bold">Edit Recipe</h2>
					<div className="flex items-center gap-2">
						<div className="flex bg-slate-100 p-1 rounded-lg mr-4">
							<button 
								onClick={() => setViewMode('preview')} 
								className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${viewMode === 'preview' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}
							>
								<Eye size={14} /> Preview
							</button>
							<button 
								onClick={() => setViewMode('edit')} 
								className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${viewMode === 'edit' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}
							>
								<Edit3 size={14} /> Edit
							</button>
						</div>
						<button onClick={closeRecipeEdit} className="p-2 hover:bg-slate-100 rounded-full"><X size={20} /></button>
					</div>
				</div>
				<div className="p-6 space-y-4 flex-1 flex flex-col overflow-hidden">
					{viewMode === 'edit' && (
						<div>
							<label className="block text-xs font-bold text-slate-400 uppercase mb-1">Path</label>
							<input className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm" value={editingRecipe.name} onChange={e => setEditingRecipe({ ...editingRecipe, name: e.target.value })} />
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
										<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-4 gap-x-8">
											{Object.entries(metadata).map(([key, value]) => (
												<div key={key} className="flex flex-col">
													<span className="text-[10px] text-slate-400 font-bold uppercase mb-1">{key}</span>
													<span className="text-sm text-slate-700 break-all font-medium">
														{value.startsWith('[') && value.endsWith(']') ? (
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
					<button onClick={closeRecipeEdit} className="px-4 py-2 text-slate-600 font-medium">Cancel</button>
					<button onClick={handleSaveRecipe} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium flex items-center gap-2 hover:bg-blue-700"><Save size={18} />Save Changes</button>
				</div>
			</div>
		</div>
	);
};

export default RecipeEditor;
