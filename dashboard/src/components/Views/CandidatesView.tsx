import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { Zap, FileSearch, Box, Trash2, Edit3, Layers, Eye, EyeOff, GitCompare, X, Copy } from 'lucide-react';
import { ProjectData, ExtractedRecipe } from '../../types';
import { notify } from '../../utils/notification';
import { categoryConfigs } from '../../constants';
import CodeBlock from '../Shared/CodeBlock';
import MarkdownWithHighlight, { stripFrontmatter } from '../Shared/MarkdownWithHighlight';
import Pagination from '../Shared/Pagination';
import { ICON_SIZES } from '../../constants/icons';

interface SimilarRecipe { recipeName: string; similarity: number; }

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
	onEditRecipe?: (recipe: { name: string; content: string; stats?: any }) => void;
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

const CandidatesView: React.FC<CandidatesViewProps> = ({ data, isShellTarget, isSilentTarget = () => false, isPendingTarget = () => false, handleDeleteCandidate, handleDeleteAllInTarget, onAuditCandidate, onAuditAllInTarget, onEditRecipe }) => {
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [targetPages, setTargetPages] = useState<Record<string, { page: number; pageSize: number }>>({});
	const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
	const [similarityMap, setSimilarityMap] = useState<Record<string, SimilarRecipe[]>>({});
	const [similarityLoading, setSimilarityLoading] = useState<string | null>(null);
	const [filters, setFilters] = useState({
		priority: 'all' as 'all' | 'high' | 'medium' | 'low',
		sort: 'default' as 'default' | 'score-desc' | 'score-asc',
		onlySimilar: false
	});
	const [compareModal, setCompareModal] = useState<{
		candidate: ExtractedRecipe & { id: string };
		targetName: string;
		recipeName: string;
		recipeContent: string;
		similarList: SimilarRecipe[];
		recipeContents: Record<string, string>;
	} | null>(null);

	const fetchedSimilarRef = useRef<Set<string>>(new Set());
	const fetchSimilarity = useCallback(async (targetName: string, candidateId: string) => {
		if (fetchedSimilarRef.current.has(candidateId)) return;
		fetchedSimilarRef.current.add(candidateId);
		setSimilarityLoading(candidateId);
		try {
			const res = await axios.post<{ similar: SimilarRecipe[] }>('/api/candidates/similarity', { targetName, candidateId });
			setSimilarityMap(prev => ({ ...prev, [candidateId]: res.data.similar || [] }));
		} catch (_) {
			setSimilarityMap(prev => ({ ...prev, [candidateId]: [] }));
		} finally {
			setSimilarityLoading(null);
		}
	}, []);

	const openCompare = useCallback(async (cand: ExtractedRecipe & { id: string }, targetName: string, recipeName: string, similarList: SimilarRecipe[] = []) => {
		// 移除 .md 后缀（如果有的话）
		const normalizedRecipeName = recipeName.replace(/\.md$/i, '');
		let recipeContent = '';
		const existing = data?.recipes?.find(r => r.name === normalizedRecipeName || r.name.endsWith('/' + normalizedRecipeName));
		if (existing?.content) {
			recipeContent = existing.content;
		} else {
			try {
				const res = await axios.get<{ content: string }>(`/api/recipes/get?name=${encodeURIComponent(normalizedRecipeName)}`);
				recipeContent = res.data.content;
			} catch (_) {
				return;
			}
		}
		const initialCache: Record<string, string> = { [normalizedRecipeName]: recipeContent };
		setCompareModal({ candidate: cand, targetName, recipeName: normalizedRecipeName, recipeContent, similarList: similarList.slice(0, 3), recipeContents: initialCache });
	}, [data?.recipes]);

	const candidateEntries = data?.candidates ? Object.entries(data.candidates) : [];
	const sortedEntries = sortTargetNames(candidateEntries, isShellTarget, isSilentTarget, isPendingTarget);
	const targetNames = sortedEntries.map(([name]) => name);
	const effectiveTarget = selectedTarget && targetNames.includes(selectedTarget) ? selectedTarget : (targetNames[0] ?? null);

	useEffect(() => {
		if (targetNames.length > 0 && (!selectedTarget || !targetNames.includes(selectedTarget))) {
			setSelectedTarget(targetNames[0]);
		}
	}, [targetNames.join(','), selectedTarget]);

	// 展开时获取相似度
	useEffect(() => {
		if (expandedId && effectiveTarget) {
			fetchSimilarity(effectiveTarget, expandedId);
		}
	}, [expandedId, effectiveTarget, fetchSimilarity]);

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<div className="mb-4 flex justify-between items-center shrink-0">
				<h2 className="text-xl font-bold flex items-center gap-2"><Zap className="text-amber-500" size={ICON_SIZES.lg} /> AI Scan Candidates</h2>
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
									{isShell ? <Box size={ICON_SIZES.sm} className={isSelected ? 'text-blue-500' : 'text-slate-400'} /> : <Box size={ICON_SIZES.sm} className={isSelected ? 'text-blue-600' : 'text-slate-500'} />}
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
						<FileSearch size={ICON_SIZES.xxxl} className="mb-4 opacity-20" />
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
						
						const filteredItems = group.items
							.filter((cand) => {
								if (filters.priority !== 'all') {
									const priority = (cand as any).reviewNotes?.priority;
									if (priority !== filters.priority) return false;
								}
								if (filters.onlySimilar) {
									const related = (cand as any).relatedRecipes;
									if (!Array.isArray(related) || related.length === 0) return false;
								}
								return true;
							})
							.sort((a, b) => {
								if (filters.sort === 'default') return 0;
								const qa = (a as any).quality?.overallScore ?? 0;
								const qb = (b as any).quality?.overallScore ?? 0;
								return filters.sort === 'score-desc' ? qb - qa : qa - qb;
							});

						// 分页计算
						const totalItems = filteredItems.length;
						const totalPages = Math.ceil(totalItems / pageSize);
						const startIndex = (currentPage - 1) * pageSize;
						const paginatedItems = filteredItems.slice(startIndex, startIndex + pageSize);
						
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
									{isShell ? <Box size={ICON_SIZES.md} className="text-slate-400" /> : <Box size={ICON_SIZES.md} className="text-blue-600" />}
									<span className={`text-lg font-bold ${isShell ? 'text-slate-400' : 'text-slate-800'}`}>{targetName}</span>
									{isSilent && <span className="text-[10px] font-bold text-amber-600 border border-amber-200 px-1 rounded ml-2">{silentLabel}</span>}
									{isShell && !isSilent && <span className="text-[10px] font-bold text-slate-300 border border-slate-200 px-1 rounded ml-2">SHELL MODULE</span>}
									<span className="text-xs text-slate-400">扫描于 {new Date(group.scanTime).toLocaleString()}</span>
									<div className="flex items-center gap-2 ml-auto">
										<select
											className="text-[10px] font-bold px-2 py-1 rounded border border-slate-200 text-slate-600 bg-white"
											value={filters.priority}
											onChange={e => setFilters(prev => ({ ...prev, priority: e.target.value as any }))}
											title="按优先级过滤"
										>
											<option value="all">优先级：全部</option>
											<option value="high">优先级：高</option>
											<option value="medium">优先级：中</option>
											<option value="low">优先级：低</option>
										</select>
										<select
											className="text-[10px] font-bold px-2 py-1 rounded border border-slate-200 text-slate-600 bg-white"
											value={filters.sort}
											onChange={e => setFilters(prev => ({ ...prev, sort: e.target.value as any }))}
											title="按综合分排序"
										>
											<option value="default">综合分：默认</option>
											<option value="score-desc">综合分：高→低</option>
											<option value="score-asc">综合分：低→高</option>
										</select>
										<label className="text-[10px] font-bold text-slate-600 flex items-center gap-1">
											<input
												type="checkbox"
												checked={filters.onlySimilar}
												onChange={e => setFilters(prev => ({ ...prev, onlySimilar: e.target.checked }))}
											/>
											只看相似
										</label>
										{(filters.priority !== 'all' || filters.sort !== 'default' || filters.onlySimilar) && (
											<>
												<span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
													已筛选
												</span>
												<button
													onClick={() => setFilters({ priority: 'all', sort: 'default', onlySimilar: false })}
													className="text-[10px] font-bold text-slate-600 hover:text-slate-800 px-2 py-1 rounded border border-slate-200 bg-white"
													title="重置筛选"
												>
													重置
												</button>
											</>
										)}
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
																return <Icon size={ICON_SIZES.xs} />;
															})()}
															{cand.category}
														</span>
													)}
												</div>
												<div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
													<button onClick={() => handleDeleteCandidate(targetName, cand.id)} title="忽略" className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded transition-colors"><Trash2 size={ICON_SIZES.sm} /></button>
												</div>
											</div>
													<p className="text-xs text-slate-500 line-clamp-2 mb-3 flex-1 h-8 leading-relaxed">{cand.summary}</p>
													{(() => {
														const quality = (cand as any).quality;
														const overall = typeof quality?.overallScore === 'number' ? quality.overallScore : null;
														const priority = (cand as any).reviewNotes?.priority;
														const related = (cand as any).relatedRecipes?.[0];
														const similarList = similarityMap[cand.id] || [];
														return (overall != null || priority || related) ? (
															<div className="flex flex-wrap items-center gap-2 mb-3">
																{overall != null && (
																	<span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
																		综合分 {(overall * 100).toFixed(0)}%
																	</span>
																)}
																{priority && (
																	<span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${priority === 'high' ? 'bg-red-50 text-red-700 border-red-200' : priority === 'medium' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
																		优先级 {priority}
																	</span>
																)}
																{related && (
																	<button
																		onClick={() => {
																			const name = String(related.id || related.title || '').trim();
																			if (name) openCompare(cand, targetName, name, similarList);
																		}}
																		className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
																		title="点击对比相似 Recipe"
																	>
																		相似 {String(related.title || related.id || '').replace(/\.md$/i, '')} {(related.similarity * 100).toFixed(0)}%
																	</button>
																)}
															</div>
														) : null;
													})()}
											
											{expandedId === cand.id && (
												<div className="mb-4 space-y-3">
													{(() => {
														const similar = similarityMap[cand.id];
														const loading = similarityLoading === cand.id;
														const hasSimilar = (similar?.length ?? 0) > 0;
														return (hasSimilar || loading) ? (
															<div className="flex flex-wrap gap-1.5 items-center">
																<span className="text-[10px] text-slate-400 font-bold">相似 Recipe：</span>
																{loading ? (
																	<span className="text-[10px] text-slate-400">加载中...</span>
																) : (
																	(similar || []).slice(0, 3).map(s => (
																		<button
																			key={s.recipeName}
																			onClick={() => openCompare(cand, targetName, s.recipeName, similar || [])}
																			className="text-[10px] font-bold px-2 py-1 rounded bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors flex items-center gap-1"
																			title={`与 ${s.recipeName} 相似 ${(s.similarity * 100).toFixed(0)}%，点击对比`}
																		>
																			<GitCompare size={ICON_SIZES.xs} />
																			{s.recipeName.replace(/\.md$/i, '')} {(s.similarity * 100).toFixed(0)}%
																		</button>
																	))
																)}
															</div>
														) : null;
													})()}
													<div className="rounded-xl overflow-hidden border border-slate-100 bg-slate-50 max-h-60 overflow-y-auto">
														{cand.code ? (
															<CodeBlock code={cand.code} language={cand.language === 'objc' ? 'objectivec' : cand.language} />
														) : (
															<div className="p-4">
																<MarkdownWithHighlight content={cand.usageGuide || ''} />
															</div>
														)}
													</div>
												</div>
											)}

											<div className="flex justify-between items-center mt-2">
												<div className="flex items-center gap-2">
													<button 
														onClick={() => setExpandedId(expandedId === cand.id ? null : cand.id)}
														className={`p-1.5 rounded-lg transition-colors ${expandedId === cand.id ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400 hover:text-blue-600'}`}
														title={expandedId === cand.id ? "隐藏预览" : "查看代码/指南预览"}
													>
														{expandedId === cand.id ? <EyeOff size={ICON_SIZES.sm} /> : <Eye size={ICON_SIZES.sm} />}
													</button>
													<span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${isShell ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-blue-600'}`}>{cand.trigger}</span>
													<span className="text-[10px] text-slate-400 uppercase font-bold">{cand.language}</span>
												</div>
												<button onClick={() => onAuditCandidate(cand, targetName)} className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-1">
													<Edit3 size={ICON_SIZES.xs} /> 审核并保存
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

			{/* 双栏对比弹窗：候选 vs Recipe */}
			{compareModal && (() => {
				const cand = compareModal.candidate;
				const candLang = cand.language === 'objc' || cand.language === 'objective-c' ? 'objectivec' : (cand.language || 'text');
				const copyCandidate = () => {
					const parts = [];
					if (cand.code) parts.push('## Snippet / Code Reference\n\n```' + (candLang || '') + '\n' + cand.code + '\n```');
					if (cand.usageGuide) parts.push('\n## AI Context / Usage Guide\n\n' + cand.usageGuide);
					navigator.clipboard.writeText(parts.join('\n') || '').then(() => notify('已复制候选内容'));
				};
				const copyRecipe = () => {
					const text = stripFrontmatter(compareModal.recipeContent);
					navigator.clipboard.writeText(text).then(() => notify('已复制 Recipe 内容'));
				};
				const switchToRecipe = async (newName: string) => {
					if (newName === compareModal.recipeName) return;
					const cached = compareModal.recipeContents[newName];
					if (cached) {
						setCompareModal(prev => prev ? { ...prev, recipeName: newName, recipeContent: cached } : null);
					} else {
						let content = '';
						const existing = data?.recipes?.find(r => r.name === newName || r.name.endsWith('/' + newName));
						if (existing?.content) content = existing.content;
						else {
							try {
								const res = await axios.get<{ content: string }>(`/api/recipes/get?name=${encodeURIComponent(newName)}`);
								content = res.data.content;
							} catch (_) { return; }
						}
						setCompareModal(prev => prev ? { ...prev, recipeName: newName, recipeContent: content, recipeContents: { ...prev.recipeContents, [newName]: content } } : null);
					}
				};
				const handleDelete = async () => {
					if (!window.confirm('确定删除该候选？')) return;
					try {
						await handleDeleteCandidate(compareModal.targetName, cand.id);
						setCompareModal(null);
					} catch (_) {}
				};
				const handleAuditCandidate = () => {
					onAuditCandidate(cand, compareModal.targetName);
					setCompareModal(null);
				};
				const handleEditRecipe = () => {
					const recipe = data?.recipes?.find(r => r.name === compareModal.recipeName || r.name.endsWith('/' + compareModal.recipeName))
						|| { name: compareModal.recipeName, content: compareModal.recipeContent };
					onEditRecipe?.(recipe);
					setCompareModal(null);
				};
				return (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2" onClick={() => setCompareModal(null)}>
						<div className="bg-white rounded-2xl shadow-2xl w-[min(95vw,1600px)] max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
							<div className="flex justify-between items-center px-4 py-3 border-b border-slate-200 shrink-0">
								<div className="flex items-center gap-3">
									<h3 className="font-bold text-slate-800">候选 vs Recipe 对比</h3>
									<button onClick={handleDelete} className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded">删除候选</button>
									<button onClick={handleAuditCandidate} className="text-xs text-blue-600 hover:bg-blue-50 px-2 py-1 rounded">审核候选</button>
									<button onClick={handleEditRecipe} className="text-xs text-emerald-600 hover:bg-emerald-50 px-2 py-1 rounded">审核 Recipe</button>
								</div>
								<button onClick={() => setCompareModal(null)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors"><X size={ICON_SIZES.lg} /></button>
							</div>
							<div className="flex-1 grid grid-cols-2 overflow-hidden min-h-0" style={{ gridTemplateRows: 'auto 1fr' }}>
								<div className="px-4 py-3 bg-blue-50 border-b border-r border-slate-100 flex flex-col justify-center min-h-0">
									<div className="flex items-center justify-between gap-2">
										<span className="text-sm font-bold text-blue-700 truncate flex-1 min-w-0" title={cand.title}>候选：{cand.title}</span>
										<button onClick={copyCandidate} className="p-1.5 hover:bg-blue-100 rounded-lg text-blue-600 shrink-0" title="复制"> <Copy size={ICON_SIZES.sm} /> </button>
									</div>
									<div className="min-h-[28px] mt-2 shrink-0" />
								</div>
								<div className="px-4 py-3 bg-emerald-50 border-b border-slate-100 flex flex-col justify-center min-h-0">
									<div className="flex items-center justify-between gap-2">
										<span className="text-sm font-bold text-emerald-700 truncate flex-1 min-w-0" title={compareModal.recipeName}>Recipe：{compareModal.recipeName.replace(/\.md$/i, '')}</span>
										<button onClick={copyRecipe} className="p-1.5 hover:bg-emerald-100 rounded-lg text-emerald-600 shrink-0" title="复制"> <Copy size={ICON_SIZES.sm} /> </button>
									</div>
									{compareModal.similarList.length > 1 ? (
										<div className="flex flex-wrap gap-1 mt-2 shrink-0">
											{compareModal.similarList.map(s => (
												<button
													key={s.recipeName}
													onClick={() => switchToRecipe(s.recipeName)}
													className={`text-[10px] font-bold px-2 py-1 rounded transition-colors ${compareModal.recipeName === s.recipeName ? 'bg-emerald-200 text-emerald-800' : 'bg-white/80 text-emerald-600 hover:bg-emerald-100'}`}
												>
													{s.recipeName.replace(/\.md$/i, '')} {(s.similarity * 100).toFixed(0)}%
												</button>
											))}
										</div>
									) : (
										<div className="min-h-[28px] mt-2 shrink-0" />
									)}
								</div>
								<div className="flex-1 overflow-auto p-4 min-h-0 border-r border-slate-200 markdown-body text-slate-700">
									<h2 className="text-lg font-bold mb-2 mt-4">Snippet / Code Reference</h2>
									{cand.code ? (
										<CodeBlock code={cand.code} language={candLang} className="!overflow-visible" />
									) : (
										<p className="text-slate-400 italic mb-3">（无代码）</p>
									)}
									<h2 className="text-lg font-bold mb-2 mt-4">AI Context / Usage Guide</h2>
									{cand.usageGuide ? (
										<MarkdownWithHighlight content={cand.usageGuide} />
									) : (
										<p className="text-slate-400 italic">（无使用指南）</p>
									)}
								</div>
								<div className="flex-1 overflow-auto p-4 min-h-0">
									<MarkdownWithHighlight content={compareModal.recipeContent} stripFrontmatter />
								</div>
							</div>
						</div>
					</div>
				);
			})()}
		</div>
	);
};

export default CandidatesView;
