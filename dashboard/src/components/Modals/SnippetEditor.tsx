import React, { useState } from 'react';
import { X, Save, FileCode, Eye, Edit3 } from 'lucide-react';
import axios from 'axios';
import { Snippet } from '../../types';
import { categories } from '../../constants';
import CodeBlock from '../Shared/CodeBlock';

interface SnippetEditorProps {
	editingSnippet: Snippet;
	setEditingSnippet: (snippet: Snippet | null) => void;
	handleSaveSnippet: () => void;
	closeSnippetEdit: () => void;
}

const SnippetEditor: React.FC<SnippetEditorProps> = ({ editingSnippet, setEditingSnippet, handleSaveSnippet, closeSnippetEdit }) => {
	const [codeView, setCodeView] = useState<'edit' | 'preview'>('preview');
	const codeText = (editingSnippet.content || editingSnippet.body || []).join('\n');
	const codeLang = editingSnippet.language === 'objc' ? 'objectivec' : (editingSnippet.language || 'text');

	const handleAiRewrite = async () => {
		try {
			const res = await axios.post('/api/ai/summarize', { 
				code: (editingSnippet.content || editingSnippet.body || []).join('\n'), 
				language: editingSnippet.language 
			}); 
			if (res.data.title_cn || res.data.title) { 
				setEditingSnippet({
					...editingSnippet, 
					title: res.data.title_cn || res.data.title, 
					summary: res.data.summary_cn || res.data.summary, 
					completionKey: res.data.trigger,
					content: res.data.code ? res.data.code.split('\n') : (editingSnippet.content || editingSnippet.body || [])
				}); 
			} 
		} catch (err) {
			alert('AI rewrite failed');
		}
	};

	return (
		<div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
			<div className="bg-white w-full max-w-6xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
				<div className="p-6 border-b border-slate-100 flex justify-between items-center">
					<h2 className="text-xl font-bold">Edit Snippet</h2>
					<div className="flex items-center gap-2">
						<div className="flex bg-slate-100 p-1 rounded-lg mr-4">
							<button 
								onClick={() => setCodeView('preview')} 
								className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${codeView === 'preview' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}
							>
								<Eye size={14} /> Preview
							</button>
							<button 
								onClick={() => setCodeView('edit')} 
								className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${codeView === 'edit' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}
							>
								<Edit3 size={14} /> Edit
							</button>
						</div>
						<button onClick={closeSnippetEdit} className="p-2 hover:bg-slate-100 rounded-full"><X size={20} /></button>
					</div>
				</div>
				<div className="p-6 space-y-4 overflow-y-auto">
					<div className="grid grid-cols-4 gap-4">
						<div><label className="block text-xs font-bold text-slate-400 uppercase mb-1">Title</label><input className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm" value={editingSnippet.title} onChange={e => setEditingSnippet({...editingSnippet, title: e.target.value})} /></div>
						<div><label className="block text-xs font-bold text-slate-400 uppercase mb-1">Trigger</label><input className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm" value={editingSnippet.completionKey} onChange={e => setEditingSnippet({...editingSnippet, completionKey: e.target.value})} /></div>
						<div>
							<label className="block text-xs font-bold text-slate-400 uppercase mb-1">Category</label>
							<select 
								className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none"
								value={editingSnippet.category || 'Utility'}
								onChange={e => setEditingSnippet({...editingSnippet, category: e.target.value})}
							>
								{categories.filter(c => c !== 'All').map(cat => (
									<option key={cat} value={cat}>{cat}</option>
								))}
							</select>
						</div>
						<div>
							<label className="block text-xs font-bold text-slate-400 uppercase mb-1">Language</label>
							<div className="flex bg-slate-100 p-1 rounded-lg">
								<button onClick={() => setEditingSnippet({...editingSnippet, language: 'swift'})} className={`flex-1 px-2 py-1 rounded-md text-[10px] font-bold transition-all ${editingSnippet.language === 'swift' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}>Swift</button>
								<button onClick={() => setEditingSnippet({...editingSnippet, language: 'objectivec'})} className={`flex-1 px-2 py-1 rounded-md text-[10px] font-bold transition-all ${editingSnippet.language === 'objectivec' || editingSnippet.language === 'objc' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}>ObjC</button>
							</div>
						</div>
					</div>
					<div><label className="block text-xs font-bold text-slate-400 uppercase mb-1">Summary</label><textarea rows={2} className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none resize-none" value={editingSnippet.summary} onChange={e => setEditingSnippet({...editingSnippet, summary: e.target.value})} /></div>
					
					{codeView === 'edit' ? (
						<>
							<div className="bg-slate-50 p-4 rounded-xl space-y-3">
								<div className="flex items-center justify-between">
									<label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase"><FileCode size={14} /> Headers / Imports</label>
									<div className="flex items-center gap-2">
										<span className="text-[10px] font-bold text-slate-400 uppercase">Auto-include in Snippet</span>
										<button 
											onClick={() => setEditingSnippet({...editingSnippet, includeHeaders: !editingSnippet.includeHeaders})}
											className={`w-8 h-4 rounded-full relative transition-colors ${editingSnippet.includeHeaders ? 'bg-blue-600' : 'bg-slate-300'}`}
										>
											<div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${editingSnippet.includeHeaders ? 'right-0.5' : 'left-0.5'}`} />
										</button>
									</div>
								</div>
								<textarea 
									rows={2} 
									className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-mono outline-none" 
									placeholder="e.g. #import <UIKit/UIKit.h> or import Foundation"
									value={(editingSnippet.headers || []).join('\n')} 
									onChange={e => setEditingSnippet({...editingSnippet, headers: e.target.value.split('\n')})} 
								/>
							</div>

							<div>
								<div className="flex justify-between items-center mb-1">
									<label className="block text-xs font-bold text-slate-400 uppercase">Code</label>
									<button onClick={handleAiRewrite} className="text-[10px] text-blue-600 font-bold hover:underline">
										AI Rewrite
									</button>
								</div>
								<textarea className="w-full h-64 p-4 bg-slate-900 text-slate-100 font-mono text-xs rounded-xl outline-none" value={codeText} onChange={e => setEditingSnippet({...editingSnippet, content: (e.target.value || '').split('\n')})} />
							</div>
						</>
					) : (
						<div className="space-y-6">
							<div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm min-h-[400px]">
								<div className="flex justify-between items-center mb-4">
									<label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Code Preview</label>
									<button onClick={handleAiRewrite} className="text-[10px] text-blue-600 font-bold hover:underline">
										AI Rewrite
									</button>
								</div>
								<CodeBlock code={codeText} language={codeLang} showLineNumbers />
							</div>
						</div>
					)}
				</div>
				<div className="p-6 border-t border-slate-100 flex justify-end gap-3">
					<button onClick={closeSnippetEdit} className="px-4 py-2 text-slate-600 font-medium">Cancel</button>
					<button onClick={handleSaveSnippet} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium flex items-center gap-2 hover:bg-blue-700"><Save size={18} />Save Changes</button>
				</div>
			</div>
		</div>
	);
};

export default SnippetEditor;
