import React, { useState, useEffect } from 'react';
import { Zap, FileSearch, Box, Trash2, Edit3, Layers, Eye, EyeOff } from 'lucide-react';
import { ProjectData, ExtractedRecipe } from '../../types';
import { categoryConfigs } from '../../constants';
import CodeBlock from '../Shared/CodeBlock';
import MarkdownWithHighlight from '../Shared/MarkdownWithHighlight';
import Pagination from '../Shared/Pagination';

const SILENT_LABELS: Record<string, string> = { _watch: 'as:create', _draft: '草稿', _cli: 'CLI', _pending: '待审核(24h)', _recipe: 'New Recipe' };

interface CandidatesViewProps {
	data: ProjectData | null;
	isShellTarget: (name: string) => boolean;
	isSilentTarget?: (name: string) => boolean;
	isPendingTarget?: (name: string) => boolean;
	handleDeleteCandidate: (targetName: string, candidateId: string) => void;
	handleDeleteAllInTarget: (targetName: string) => void;
	onAuditCandidate: (cand: ExtractedRecipe & { id: string }, targetName: string) => void;
	onAuditAllInTarget: (items: (ExtractedRecipe & { id: string })[], targetName: string) => void;
}

function sortTargetNames(
	entries: [string, { targetName: string; scanTime: number; items: (ExtractedRecipe & { id: string })[] }][],
	isShellTarget: (name: string) => boolean,
	isSilentTarget: (name: string) => boolean,
	isPendingTarget: (name: string) => boolean
): [string, { targetName: string; scanTime: number; items: (ExtractedRecipe & { id: string })[] }][] {
	return [...entries].sort(([nameA], [nameB]) => {
		const aPending = isPendingTarget(nameA);
		const bPending = isPendingTarget(nameB);
		if (aPending && !bPending) return 1;
		if (!aPending && bPending) return -1;
		const aSilent = isSilentTarget(nameA);
		const bSilent = isSilentTarget(nameB);
		if (aSilent && !bSilent) return -1;
		if (!aSilent && bSilent) return 1;
		const aShell = isShellTarget(nameA);
		const bShell = isShellTarget(nameB);
		if (aShell && !bShell) return 1;
		if (!aShell && bShell) return -1;
		return nameA.localeCompare(nameB);
	});
}

const CandidatesView: React.FC<CandidatesViewProps> = ({ data, isShellTarget, isSilentTarget = () => false, isPendingTarget = () => false, handleDeleteCandidate, handleDeleteAllInTarget, onAuditCandidate, onAuditAllInTarget }) => {
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [targetPages, setTargetPages] = useState<Record<string, { page: number; pageSize: number }>>({});
	// 当前选中的 target（类别），只显示该 target 下的候选
	const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

	const candidateEntries = data?.candidates ? Object.entries(data.candidates) : [];
	const sortedEntries = sortTargetNames(candidateEntries, isShellTarget, isSilentTarget, isPendingTarget);
	const targetNames = sortedEntries.map(([name]) => name);
	const effectiveTarget = selectedTarget && targetNames.includes(selectedTarget) ? selectedTarget : (targetNames[0] ?? null);

	// 当当前选中的 target 不在列表里（如被删空）时，切到第一个
	useEffect(() => {
		if (targetNames.length > 0 && (!selectedTarget || !targetNames.includes(selectedTarget))) {
			setSelectedTarget(targetNames[0]);
		}
	}, [targetNames.join(','), selectedTarget]);

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<div className="mb-4 flex justify-between items-center shrink-0">
				<h2 className="text-xl font-bold flex items-center gap-2"><Zap className="text-amber-500" /> AI Scan Candidates</h2>
				<div className="text-xs text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
					这些内容由 AI 批量扫描生成，等待您的审核入库。
				</div>
			</div>

			{/* 类别（target）切换标签栏：多个类别不放在一页 */}
			{candidateEntries.length > 0 && (
				<div className="shrink-0 bg-white border border-slate-100 rounded-xl px-3 py-2 mb-4">
					<div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
						{targetNames.map((targetName) => {
							const isShell = isShellTarget(targetName);
							const isSilent = isSilentTarget(targetName);
							const silentLabel = SILENT_LABELS[targetName];
							const group = data!.candidates[targetName];
							const count = group?.items?.length ?? 0;
							const isSelected = effectiveTarget === targetName;
							return (
								<button
									key={targetName}
									onClick={() => setSelectedTarget(targetName)}
									className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all border
										${isSelected
											? 'bg-blue-50 text-blue-700 border-blue-200 shadow-sm'
											: 'bg-slate-50/80 text-slate-600 border-slate-100 hover:border-slate-200 hover:bg-slate-100'}`}
								>
									{isShell ? <Box size={14} className={isSelected ? 'text-blue-500' : 'text-slate-400'} /> : <Box size={14} className={isSelected ? 'text-blue-600' : 'text-slate-500'} />}
									<span>{targetName}</span>
									{isSilent && silentLabel && <span className="text-[9px] text-amber-600 border border-amber-200 px-1 rounded">{silentLabel}</span>}
									<span className="text-[10px] font-normal text-slate-400">({count})</span>
								</button>
							);
						})}
					</div>
				</div>
			)}
			
			<div className="flex-1 overflow-y-auto pr-2">
				{(!data?.candidates || Object.keys(data.candidates).length === 0) && (
					<div className="h-64 flex flex-col items-center justify-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
						<FileSearch size={48} className="mb-4 opacity-20" />
						<p>未发现候选内容。</p>
						<p className="mt-2 text-xs">可执行 <code>asd ais --all</code> 扫描，或 <code>asd candidate</code> 从剪贴板创建，或在代码中写 <code>// as:create</code> 后保存。</p>
					</div>
				)}
				
				{data && effectiveTarget && sortedEntries
					.filter(([name]) => name === effectiveTarget)
					.map(([targetName, group]) => {
						const isShell = isShellTarget(targetName);
						const isSilent = isSilentTarget(targetName);
						const silentLabel = SILENT_LABELS[targetName] || '静默';
						
						// 获取或初始化该 target 的分页状态
						const pageState = targetPages[targetName] || { page: 1, pageSize: 12 };
						const currentPage = pageState.page;
						const pageSize = pageState.pageSize;
						
						// 分页计算
						const totalItems = group.items.length;
						const totalPages = Math.ceil(totalItems / pageSize);
						const startIndex = (currentPage - 1) * pageSize;
						const paginatedItems = group.items.slice(startIndex, startIndex + pageSize);
						
						// 分页处理函数
						const handlePageChange = (page: number) => {
							setTargetPages(prev => ({
								...prev,
								[targetName]: { ...pageState, page }
							}));
						};
						
						const handlePageSizeChange = (size: number) => {
							setTargetPages(prev => ({
								...prev,
								[targetName]: { page: 1, pageSize: size }
							}));
						};
						
						return (
							<div key={targetName} className="space-y-4">
								<div className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-100 ${isShell ? 'bg-slate-50/50' : 'bg-white'}`}>
									{isShell ? <Box size={18} className="text-slate-400" /> : <Box size={18} className="text-blue-600" />}
									<span className={`text-lg font-bold ${isShell ? 'text-slate-400' : 'text-slate-800'}`}>{targetName}</span>
									{isSilent && <span className="text-[10px] font-bold text-amber-600 border border-amber-200 px-1 rounded ml-2">{silentLabel}</span>}
									{isShell && !isSilent && <span className="text-[10px] font-bold text-slate-300 border border-slate-200 px-1 rounded ml-2">SHELL MODULE</span>}
									<span className="text-xs text-slate-400">扫描于 {new Date(group.scanTime).toLocaleString()}</span>
									<div className="flex items-center gap-2 ml-auto">
										<span className="text-xs text-slate-400">共 {group.items.length} 条</span>
										{totalItems > pageSize && (
											<span className="text-xs text-slate-500">（当前页 {paginatedItems.length} 条）</span>
										)}
										<button 
											onClick={() => onAuditAllInTarget(paginatedItems, targetName)} 
											className="text-[10px] font-bold text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
											title="将当前页所有候选进入审核"
										>
											当前页进入审核
										</button>
										<button 
											onClick={() => {
												if (window.confirm(`确定移除当前页的 ${paginatedItems.length} 条候选？`)) {
													paginatedItems.forEach(item => handleDeleteCandidate(targetName, item.id));
												}
											}} 
											className="text-[10px] font-bold text-orange-500 hover:text-orange-600 px-2 py-1 rounded hover:bg-orange-50 transition-colors"
											title="移除当前页所有候选"
										>
											移除当前页
										</button>
										<button 
											onClick={() => handleDeleteAllInTarget(targetName)} 
											className="text-[10px] font-bold text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors border border-red-200"
											title="移除该 target 下的全部候选"
										>
											全部删除
										</button>
									</div>
								</div>
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									{paginatedItems.map(cand => (
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
												<button onClick={() => onAuditCandidate(cand, targetName)} className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-1">
													<Edit3 size={12} /> 审核并保存
												</button>
											</div>
										</div>
									))}
								</div>
								
								{/* 分页控件 */}
								{totalItems > 12 && (
									<Pagination
										currentPage={currentPage}
										totalPages={totalPages}
										totalItems={totalItems}
										pageSize={pageSize}
										onPageChange={handlePageChange}
										onPageSizeChange={handlePageSizeChange}
									/>
								)}
							</div>
						);
					})
				}
			</div>
		</div>
	);
};

export default CandidatesView;
