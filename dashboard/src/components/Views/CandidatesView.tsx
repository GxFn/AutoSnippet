import React, { useState } from 'react';
import { Zap, FileSearch, Box, Trash2, Edit3, Layers, Eye, EyeOff } from 'lucide-react';
import { ProjectData, ExtractedRecipe } from '../../types';
import { categoryConfigs } from '../../constants';
import CodeBlock from '../Shared/CodeBlock';
import MarkdownWithHighlight from '../Shared/MarkdownWithHighlight';

interface CandidatesViewProps {
	data: ProjectData | null;
	isShellTarget: (name: string) => boolean;
	handleDeleteCandidate: (targetName: string, candidateId: string) => void;
	onAuditCandidate: (cand: ExtractedRecipe) => void;
}

const CandidatesView: React.FC<CandidatesViewProps> = ({ data, isShellTarget, handleDeleteCandidate, onAuditCandidate }) => {
	const [expandedId, setExpandedId] = useState<string | null>(null);

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<div className="mb-6 flex justify-between items-center">
				<h2 className="text-xl font-bold flex items-center gap-2"><Zap className="text-amber-500" /> AI Scan Candidates</h2>
				<div className="text-xs text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
					这些内容由 AI 批量扫描生成，等待您的审核入库。
				</div>
			</div>
			
			<div className="flex-1 overflow-y-auto pr-2 space-y-8">
				{(!data?.candidates || Object.keys(data.candidates).length === 0) && (
					<div className="h-64 flex flex-col items-center justify-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
						<FileSearch size={48} className="mb-4 opacity-20" />
						<p>未发现候选内容。请在终端执行 `asd ais --all` 开始扫描。</p>
					</div>
				)}
				
				{data && Object.entries(data.candidates)
					.sort(([nameA], [nameB]) => {
						const aShell = isShellTarget(nameA);
						const bShell = isShellTarget(nameB);
						if (aShell && !bShell) return 1;
						if (!aShell && bShell) return -1;
						return nameA.localeCompare(nameB);
					})
					.map(([targetName, group]) => {
						const isShell = isShellTarget(targetName);
						return (
							<div key={targetName} className="space-y-4">
								<div className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-100 ${isShell ? 'bg-slate-50/50' : 'bg-white'}`}>
									{isShell ? <Box size={18} className="text-slate-400" /> : <Box size={18} className="text-blue-600" />}
									<span className={`text-lg font-bold ${isShell ? 'text-slate-400' : 'text-slate-800'}`}>{targetName}</span>
									{isShell && <span className="text-[10px] font-bold text-slate-300 border border-slate-200 px-1 rounded ml-2">SHELL MODULE</span>}
									<span className="text-xs text-slate-400 ml-auto">扫描于 {new Date(group.scanTime).toLocaleString()}</span>
								</div>
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									{group.items.map(cand => (
										<div key={cand.id} className={`bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow flex flex-col group ${isShell ? 'opacity-80' : ''}`}>
											<div className="flex justify-between items-start mb-2">
												<div className="flex flex-col">
													<span className={`text-[10px] font-bold uppercase mb-0.5 ${isShell ? 'text-slate-400' : 'text-blue-500'}`}>{targetName}</span>
													<h3 className="font-bold text-sm text-slate-800">{cand.title}</h3>
													{cand.category && (
														<span className={`w-fit mt-1 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase flex items-center gap-1 border ${categoryConfigs[cand.category]?.bg || 'bg-slate-50'} ${categoryConfigs[cand.category]?.color || 'text-slate-400'} ${categoryConfigs[cand.category]?.border || 'border-slate-100'}`}>
															{(() => {
																const Icon = categoryConfigs[cand.category]?.icon || Layers;
																return <Icon size={10} />;
															})()}
															{cand.category}
														</span>
													)}
												</div>
												<div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
													<button onClick={() => handleDeleteCandidate(targetName, cand.id)} title="忽略" className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded transition-colors"><Trash2 size={14} /></button>
												</div>
											</div>
											<p className="text-xs text-slate-500 line-clamp-2 mb-4 flex-1 h-8 leading-relaxed">{cand.summary}</p>
											
											{expandedId === cand.id && (
												<div className="mb-4 rounded-xl overflow-hidden border border-slate-100 bg-slate-50 max-h-60 overflow-y-auto">
													{cand.code ? (
														<CodeBlock code={cand.code} language={cand.language === 'objc' ? 'objectivec' : cand.language} />
													) : (
														<div className="p-4">
															<MarkdownWithHighlight content={cand.usageGuide || ''} />
														</div>
													)}
												</div>
											)}

											<div className="flex justify-between items-center mt-2">
												<div className="flex items-center gap-2">
													<button 
														onClick={() => setExpandedId(expandedId === cand.id ? null : cand.id)}
														className={`p-1.5 rounded-lg transition-colors ${expandedId === cand.id ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400 hover:text-blue-600'}`}
														title={expandedId === cand.id ? "隐藏预览" : "查看代码/指南预览"}
													>
														{expandedId === cand.id ? <EyeOff size={14} /> : <Eye size={14} />}
													</button>
													<span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${isShell ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-blue-600'}`}>{cand.trigger}</span>
													<span className="text-[10px] text-slate-400 uppercase font-bold">{cand.language}</span>
												</div>
												<button onClick={() => onAuditCandidate(cand)} className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-1">
													<Edit3 size={12} /> 审核并保存
												</button>
											</div>
										</div>
									))}
								</div>
							</div>
						);
					})
				}
			</div>
		</div>
	);
};

export default CandidatesView;
