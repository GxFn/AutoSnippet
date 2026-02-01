import React, { useState } from 'react';
import { Box, Zap, Edit3, Cpu, CheckCircle, Pencil, Check } from 'lucide-react';
import { SPMTarget, ExtractedRecipe, ScanResultItem } from '../../types';
import { categories } from '../../constants';
import CodeBlock from '../Shared/CodeBlock';

interface SPMExplorerViewProps {
	targets: SPMTarget[];
	filteredTargets: SPMTarget[];
	selectedTargetName: string | null;
	isScanning: boolean;
	scanProgress: { current: number; total: number; status: string };
	scanFileList: { name: string; path: string }[];
	scanResults: ScanResultItem[];
	handleScanTarget: (target: SPMTarget) => void;
	handleUpdateScanResult: (index: number, updates: any) => void;
	handleSaveExtracted: (res: any) => void;
	isShellTarget: (name: string) => boolean;
}

const SPMExplorerView: React.FC<SPMExplorerViewProps> = ({
	targets,
	filteredTargets,
	selectedTargetName,
	isScanning,
	scanProgress,
	scanFileList,
	scanResults,
	handleScanTarget,
	handleUpdateScanResult,
	handleSaveExtracted,
	isShellTarget
}) => {
	const [editingCodeIndex, setEditingCodeIndex] = useState<number | null>(null);
	const codeLang = (res: { language?: string }) => (res.language === 'objectivec' || res.language === 'objc' ? 'objectivec' : (res.language || 'swift'));

	return (
		<div className="flex gap-8 h-full">
			<div className="w-80 bg-white rounded-xl border border-slate-200 flex flex-col overflow-hidden shrink-0">
				<div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-sm">项目 Target ({targets.length})</div>
				<div className="flex-1 overflow-y-auto p-2 space-y-1">
					{filteredTargets.map(t => {
						const isShell = isShellTarget(t.name);
						const isSelected = selectedTargetName === t.name;
						return (
							<button 
								key={t.name} 
								onClick={() => handleScanTarget(t)} 
								disabled={isScanning}
								className={`w-full text-left p-3 rounded-lg flex items-center justify-between group transition-all border ${
									isScanning ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'
								} ${isSelected ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-200' : 'bg-white border-transparent'} ${isShell ? 'opacity-90' : ''}`}
							>
								<div className={`flex flex-col max-w-[85%] ${isShell ? 'opacity-60' : ''}`}>
									<div className="flex items-center gap-2">
										{!isShell && <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSelected ? 'bg-blue-600' : 'bg-blue-600'}`} />}
										<span className={`text-sm truncate ${!isShell ? 'font-bold' : 'font-medium'} ${isSelected ? 'text-blue-700' : ''}`}>{t.name}</span>
									</div>
									<span className="text-[10px] text-slate-400 truncate pl-3">{t.packageName}</span>
								</div>
								{isShell ? (
									<span className="text-[9px] font-bold text-slate-300 border border-slate-100 px-1 rounded">SHELL</span>
								) : (
									<Zap size={14} className={`shrink-0 ${isSelected ? 'text-blue-500 opacity-100' : 'text-blue-500 opacity-0 group-hover:opacity-100'} transition-opacity`} />
								)}
							</button>
						);
					})}
				</div>
			</div>
			<div className="flex-1 bg-white rounded-xl border border-slate-200 flex flex-col overflow-hidden relative">
				<div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-sm flex justify-between items-center">
					<div className="flex items-center gap-2">
						<Edit3 size={16} className="text-slate-400" />
						<span>审核提取结果 {scanResults.length > 0 && <span className="text-blue-600 ml-1">[{scanResults[0].trigger ? 'Candidate' : 'New'}]</span>}</span>
					</div>
				</div>
				
				<div className="flex-1 overflow-y-auto p-6 space-y-8 relative">
					{isScanning && (
						<div className="absolute inset-0 bg-white/90 backdrop-blur-[2px] z-10 flex flex-col items-center justify-center text-blue-600 px-8 overflow-y-auto">
							<div className="relative mb-6">
								<div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
								<Cpu size={32} className="absolute inset-0 m-auto text-blue-600 animate-pulse" />
							</div>
							<p className="font-bold text-lg animate-pulse mb-1">文件扫描与识别</p>
							<p className="text-sm text-slate-500 mb-4">{scanProgress.status}</p>
							{scanFileList.length > 0 && (
								<div className="w-full max-w-lg mb-4 text-left">
									<p className="text-[10px] font-bold text-slate-400 uppercase mb-2">本次扫描的文件 ({scanFileList.length})</p>
									<div className="max-h-32 overflow-y-auto space-y-1 rounded-lg bg-slate-50 border border-slate-200 p-2">
										{scanFileList.map((f, i) => (
											<div key={i} className="text-xs font-mono text-slate-600 truncate" title={f.path}>{f.name}</div>
										))}
									</div>
								</div>
							)}
							<div className="w-full max-w-md bg-slate-100 rounded-full h-2.5 overflow-hidden">
								<div
									className="h-full bg-blue-600 rounded-full transition-all duration-500 ease-out"
									style={{ width: `${Math.min(scanProgress.total ? (scanProgress.current / scanProgress.total) * 100 : 0, 98)}%` }}
								/>
							</div>
							<p className="text-xs text-slate-400 mt-3">
								{scanProgress.total ? `${Math.round((scanProgress.current / scanProgress.total) * 100)}%` : '0%'}
							</p>
						</div>
					)}

					{!isScanning && scanResults.length === 0 && (
						<div className="h-full flex flex-col items-center justify-center text-slate-400 text-center">
							<Box size={48} className="mb-4 opacity-20" />
							<p className="font-medium text-slate-600">深度扫描与提取</p>
							<p className="text-xs mt-2">从左侧选择一个模块，让 AI 识别可复用的代码片段和最佳实践。</p>
						</div>
					)}

					{!isScanning && scanFileList.length > 0 && (
						<div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
							<p className="text-[10px] font-bold text-slate-400 uppercase mb-2">本次扫描的文件 ({scanFileList.length})</p>
							<div className="flex flex-wrap gap-2">
								{scanFileList.map((f, i) => (
									<span key={i} className="text-xs font-mono bg-white border border-slate-200 text-slate-600 px-2 py-1 rounded" title={f.path}>{f.name}</span>
								))}
							</div>
						</div>
					)}
					
					{scanResults.map((res, i) => (
						<div key={i} className="bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
							<div className="p-4 bg-white border-b border-slate-100 flex justify-between items-center">
								<div className="flex items-center gap-4 flex-1">
									 <div className="flex flex-col w-[512px]">
											<label className="text-[9px] font-bold text-slate-400 uppercase ml-1 mb-0.5">Recipe Title</label>
											<input className="font-bold bg-transparent border-b border-transparent hover:border-slate-200 focus:border-blue-500 outline-none px-1 text-base w-full" value={res.title} onChange={e => handleUpdateScanResult(i, { title: e.target.value })} />
									 </div>
									 <div className="flex flex-col w-64">
											<label className="text-[9px] font-bold text-slate-400 uppercase ml-1 mb-0.5">Triggers</label>
											<input className="font-mono font-bold text-blue-600 bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-lg outline-none text-xs focus:ring-2 focus:ring-blue-500 w-full" value={res.trigger} placeholder="@cmd" onChange={e => handleUpdateScanResult(i, { trigger: e.target.value })} />
									 </div>
									 <div className="flex flex-col">
											<label className="text-[9px] font-bold text-slate-400 uppercase ml-1 mb-0.5">Category</label>
											<select 
												className="font-bold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-1.5 rounded-lg outline-none text-[10px] focus:ring-2 focus:ring-blue-500"
												value={res.category}
												onChange={e => handleUpdateScanResult(i, { category: e.target.value })}
											>
												{categories.filter(c => c !== 'All').map(cat => (
													<option key={cat} value={cat}>{cat}</option>
												))}
											</select>
									 </div>
									 <div className="flex flex-col">
											<label className="text-[9px] font-bold text-slate-400 uppercase ml-1 mb-0.5">Language</label>
											<div className="flex bg-slate-100 p-1 rounded-lg">
												<button onClick={() => handleUpdateScanResult(i, { language: 'swift' })} className={`px-2 py-1 rounded-md text-[9px] font-bold transition-all ${res.language === 'swift' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}>Swift</button>
												<button onClick={() => handleUpdateScanResult(i, { language: 'objectivec' })} className={`px-2 py-1 rounded-md text-[9px] font-bold transition-all ${res.language === 'objectivec' || res.language === 'objc' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}>ObjC</button>
											</div>
									 </div>
									 <div className="flex flex-col">
											<label className="text-[9px] font-bold text-slate-400 uppercase ml-1 mb-0.5">Content Lang</label>
											<div className="flex bg-slate-100 p-1 rounded-lg">
												<button onClick={() => handleUpdateScanResult(i, { lang: 'cn' })} className={`px-2 py-1 rounded-md text-[9px] font-bold transition-all ${res.lang === 'cn' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}>CN</button>
												<button onClick={() => handleUpdateScanResult(i, { lang: 'en' })} className={`px-2 py-1 rounded-md text-[9px] font-bold transition-all ${res.lang === 'en' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}>EN</button>
											</div>
									 </div>
									 <div className="flex flex-col">
											<label className="text-[9px] font-bold text-slate-400 uppercase ml-1 mb-0.5">Mode</label>
											<div className="flex bg-slate-100 p-1 rounded-lg">
												<button onClick={() => handleUpdateScanResult(i, { mode: 'full' })} className={`px-4 py-1 rounded-md text-[9px] font-bold transition-all ${res.mode === 'full' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}>SNIPPET + RECIPE</button>
												<button onClick={() => handleUpdateScanResult(i, { mode: 'preview' })} className={`px-4 py-1 rounded-md text-[9px] font-bold transition-all ${res.mode === 'preview' ? 'bg-white shadow-sm text-amber-600' : 'text-slate-400'}`}>RECIPE ONLY</button>
											</div>
									 </div>
									 <div className="flex flex-col">
											<label className="text-[9px] font-bold text-slate-400 uppercase ml-1 mb-0.5">引入头文件</label>
											<div className="flex items-center gap-2">
												<button
													onClick={() => handleUpdateScanResult(i, { includeHeaders: !(res.includeHeaders !== false) })}
													className={`w-8 h-4 rounded-full relative transition-colors ${res.includeHeaders !== false ? 'bg-blue-600' : 'bg-slate-300'}`}
													title={res.includeHeaders !== false ? '开启：snippet 内写入 // as:include 标记，watch 按标记注入' : '关闭：不写入头文件标记'}
												>
													<div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${res.includeHeaders !== false ? 'right-0.5' : 'left-0.5'}`} />
												</button>
												<span className="text-[9px] text-slate-500">{res.includeHeaders !== false ? '按标记注入' : '不引入'}</span>
											</div>
									 </div>
								</div>
								<div className="ml-4">
									 <button onClick={() => handleSaveExtracted(res)} className={`text-xs px-5 py-2.5 rounded-xl font-bold transition-all shadow-sm flex items-center gap-2 active:scale-95 ${res.mode === 'full' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-amber-600 text-white hover:bg-amber-700'}`}><CheckCircle size={18} />保存为 Recipe</button>
								</div>
							</div>
							<div className="p-6 space-y-4">
								<div className="flex gap-4">
										<div className="flex-1">
											<label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Summary (摘要) - {res.lang === 'cn' ? '中文' : 'EN'}</label>
											<textarea rows={2} className="w-full text-sm text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none resize-none leading-relaxed focus:ring-2 focus:ring-blue-500/10" value={res.summary} onChange={e => handleUpdateScanResult(i, { summary: e.target.value })} />
										</div>
								</div>
								<div className="space-y-1">
									<label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">头文件 Headers {res.moduleName && <span className="text-slate-400 font-normal">· {res.moduleName}</span>}</label>
									{res.headers && res.headers.length > 0 ? (
										<div className="flex flex-wrap gap-2">
											{res.headers.map((h, hi) => (
												<span key={hi} className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded font-mono" title={res.headerPaths?.[hi] ? `相对路径: ${res.headerPaths[hi]}` : undefined}>{h}</span>
											))}
										</div>
									) : (
										<p className="text-[10px] text-slate-400">未解析到头文件（剪贴板需含 #import，且路径在 target 下）</p>
									)}
								</div>
								<div>
									<div className="flex items-center justify-between mb-1">
										<label className="text-[10px] font-bold text-slate-400 uppercase">Standardized Usage Example (标准使用示例)</label>
										{editingCodeIndex === i ? (
											<button type="button" onClick={() => setEditingCodeIndex(null)} className="flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:text-blue-700 px-2 py-1 rounded bg-blue-50">
												<Check size={12} /> 完成
											</button>
										) : (
											<button type="button" onClick={() => setEditingCodeIndex(i)} className="flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-100" title="编辑代码">
												<Pencil size={12} /> 编辑
											</button>
										)}
									</div>
									{editingCodeIndex === i ? (
										<div className="bg-slate-900 rounded-xl p-4 overflow-x-auto">
											<textarea
												className="w-full bg-transparent text-xs text-slate-100 font-mono leading-relaxed outline-none resize-none"
												rows={Math.min(12, res.code.split('\n').length)}
												value={res.code}
												onChange={e => handleUpdateScanResult(i, { code: e.target.value })}
											/>
										</div>
									) : (
										<CodeBlock code={res.code} language={codeLang(res)} showLineNumbers />
									)}
								</div>
								<div>
									<label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Usage Guide (使用指南) - {res.lang === 'cn' ? '中文' : 'EN'}</label>
									<textarea className="w-full text-xs text-slate-500 bg-blue-50 p-4 rounded-xl border border-blue-100 outline-none min-h-[100px] leading-relaxed" value={res.usageGuide} onChange={e => handleUpdateScanResult(i, { usageGuide: e.target.value })} />
								</div>
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
};

export default SPMExplorerView;
