import React from 'react';
import { Edit3, Trash2 } from 'lucide-react';
import { Snippet } from '../../types';
import { categoryConfigs } from '../../constants';

interface SnippetsViewProps {
	snippets: Snippet[];
	openSnippetEdit: (snippet: Snippet) => void;
	handleDeleteSnippet: (identifier: string, title: string) => void;
}

const SnippetsView: React.FC<SnippetsViewProps> = ({ snippets, openSnippetEdit, handleDeleteSnippet }) => {
	return (
		<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
			{snippets.map((snippet) => (
				<div key={snippet.identifier} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all group relative">
					<div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
						<button onClick={(e) => { e.stopPropagation(); openSnippetEdit(snippet); }} className="p-1.5 bg-slate-50 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"><Edit3 size={14} /></button>
						<button onClick={(e) => { e.stopPropagation(); handleDeleteSnippet(snippet.identifier, snippet.title); }} className="p-1.5 bg-slate-50 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"><Trash2 size={14} /></button>
					</div>
					<div onClick={() => openSnippetEdit(snippet)} className="cursor-pointer">
						<div className="flex justify-between items-start mb-4 pr-12">
							<h3 className="font-bold text-slate-900">{snippet.title}</h3>
									<div className="flex flex-col items-end gap-1">
								{snippet.completionKey && (
									<span className="text-[10px] bg-blue-50 text-blue-700 font-bold px-2 py-1 rounded uppercase tracking-wider">{snippet.completionKey}</span>
								)}
								{(() => {
									const finalCategory = snippet.category || 'Utility';
									const config = categoryConfigs[finalCategory] || categoryConfigs.Utility;
									const Icon = config.icon;
									return (
										<span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase flex items-center gap-1 border ${config.bg} ${config.color} ${config.border}`}>
											<Icon size={10} />
											{finalCategory}
										</span>
									);
								})()}
							</div>
						</div>
						<p className="text-sm text-slate-600 line-clamp-2 mb-4">{snippet.summary}</p>
						<div className="flex items-center gap-2">
							{snippet.language && (
								<span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-1 rounded">{snippet.language}</span>
							)}
						</div>
					</div>
				</div>
			))}
		</div>
	);
};

export default SnippetsView;
