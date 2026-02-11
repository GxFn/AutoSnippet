import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Zap, Edit3, Cpu, CheckCircle, Pencil, Check, GitCompare, X, Copy, Loader2, Search, Inbox, Layers, Shield, AlertTriangle } from 'lucide-react';
import { SPMTarget, ExtractedRecipe, ScanResultItem, Recipe, GuardAuditResult } from '../../types';
import api from '../../api';
import { notify } from '../../utils/notification';
import { categories } from '../../constants';
import { ICON_SIZES } from '../../constants/icons';
import CodeBlock from '../Shared/CodeBlock';
import HighlightedCodeEditor from '../Shared/HighlightedCodeEditor';
import MarkdownWithHighlight, { stripFrontmatter } from '../Shared/MarkdownWithHighlight';
import ContextAwareSearchPanel from './ContextAwareSearchPanel';

interface SimilarRecipe { recipeName: string; similarity: number; }

interface SPMExplorerViewProps {
  targets: SPMTarget[];
  filteredTargets: SPMTarget[];
  selectedTargetName: string | null;
  isScanning: boolean;
  scanProgress: { current: number; total: number; status: string };
  scanFileList: { name: string; path: string }[];
  scanResults: ScanResultItem[];
  guardAudit?: GuardAuditResult | null;
  handleScanTarget: (target: SPMTarget) => void;
  handleScanProject?: () => void;
  handleUpdateScanResult: (index: number, updates: any) => void;
  handleSaveExtracted: (res: any) => void;
  handlePromoteToCandidate?: (res: ScanResultItem, index: number) => void;
  handleDeleteCandidate?: (targetName: string, candidateId: string) => void;
  onEditRecipe?: (recipe: Recipe) => void;
  isShellTarget: (name: string) => boolean;
  recipes?: Recipe[];
  isSavingRecipe?: boolean;
}

const SPMExplorerView: React.FC<SPMExplorerViewProps> = ({
  targets,
  filteredTargets,
  selectedTargetName,
  isScanning,
  scanProgress,
  scanFileList,
  scanResults,
  guardAudit,
  handleScanTarget,
  handleScanProject,
  handleUpdateScanResult,
  handleSaveExtracted,
  handlePromoteToCandidate,
  handleDeleteCandidate,
  onEditRecipe,
  isShellTarget,
  recipes = [],
  isSavingRecipe = false
}) => {
  const [editingCodeIndex, setEditingCodeIndex] = useState<number | null>(null);
  const [translatingIndex, setTranslatingIndex] = useState<number | null>(null);
  const [expandedEditIndex, setExpandedEditIndex] = useState<number | null>(null);
  const [similarityMap, setSimilarityMap] = useState<Record<string, SimilarRecipe[]>>({});
  const [similarityLoading, setSimilarityLoading] = useState<string | null>(null);
  const [compareModal, setCompareModal] = useState<{
  candidate: ScanResultItem;
  targetName: string;
  recipeName: string;
  recipeContent: string;
  similarList: SimilarRecipe[];
  recipeContents: Record<string, string>;
  } | null>(null);
  const [isContextSearchOpen, setIsContextSearchOpen] = useState(false);
  const [selectedContextFile, setSelectedContextFile] = useState<string | undefined>();
  const [selectedContextTarget, setSelectedContextTarget] = useState<string | undefined>();
  const fetchedSimilarRef = useRef<Set<string>>(new Set());
  const prevSimilarKeysRef = useRef<string[]>([]);
  const translateInFlightRef = useRef(false);

  const codeLang = (res: { language?: string }) => {
  const l = (res.language || '').toLowerCase();
  return (l === 'objectivec' || l === 'objc' || l === 'objective-c' || l === 'obj-c' ? 'objectivec' : (res.language || 'swift'));
  };

  const fetchSimilarity = useCallback(async (key: string, opts: { targetName?: string; candidateId?: string; candidate?: { title?: string; summary?: string; code?: string; usageGuide?: string } }) => {
  if (fetchedSimilarRef.current.has(key)) return;
  fetchedSimilarRef.current.add(key);
  setSimilarityLoading(key);
  try {
    const body = opts.candidateId && opts.targetName
    ? { targetName: opts.targetName, candidateId: opts.candidateId }
    : { candidate: opts.candidate || {} };
    const resp = await api.getCandidateSimilarityEx(body);
    setSimilarityMap(prev => ({ ...prev, [key]: resp.similar || [] }));
  } catch (_) {
    setSimilarityMap(prev => ({ ...prev, [key]: [] }));
  } finally {
    setSimilarityLoading(null);
  }
  }, []);

  const openCompare = useCallback(async (res: ScanResultItem, recipeName: string, similarList: SimilarRecipe[] = []) => {
  const targetName = res.candidateTargetName || '';
  // 移除 .md 后缀（如果有的话）
  const normalizedRecipeName = recipeName.replace(/\.md$/i, '');
  let recipeContent = '';
  const existing = recipes?.find(r => r.name === normalizedRecipeName || r.name.endsWith('/' + normalizedRecipeName));
  if (existing?.content) {
    recipeContent = existing.content;
  } else {
    try {
    const recipeData = await api.getRecipeContentByName(normalizedRecipeName);
    recipeContent = recipeData.content;
    } catch (err: any) {
    const status = err.response?.status;
    const message = err.response?.data?.message || err.message;
    if (status === 404) {
      notify(`Recipe 不存在: ${normalizedRecipeName}`, { type: 'error' });
    } else {
      notify(`加载 Recipe 失败: ${message}`, { type: 'error' });
    }
    return;
    }
  }
  const initialCache: Record<string, string> = { [normalizedRecipeName]: recipeContent };
  setCompareModal({ candidate: res, targetName, recipeName: normalizedRecipeName, recipeContent, similarList: similarList.slice(0, 3), recipeContents: initialCache });
  }, [recipes]);

  const handleContentLangChange = useCallback(async (i: number, newLang: 'cn' | 'en', currentRes: ScanResultItem) => {
  if (translateInFlightRef.current) return;
  if (newLang === 'cn') {
    handleUpdateScanResult(i, { lang: 'cn' });
    return;
  }
  
  // EN: 切换到英文版本（如果有则切换，没有则翻译生成）
  const res = currentRes;
  if (!res) return;
  
  const hasEnSummary = !!res.summary_en;
  const hasEnUsage = !!res.usageGuide_en;
  
  // 如果已有完整英文版本，直接切换显示
  if (hasEnSummary && hasEnUsage) {
    handleUpdateScanResult(i, { lang: 'en' });
    return;
  }
  
  // 没有完整英文版本，进行翻译
  const cnSummary = res.summary_cn ?? res.summary ?? '';
  const cnUsage = String(res.usageGuide_cn ?? res.usageGuide ?? '');
  const needSummary = !hasEnSummary && cnSummary.trim().length > 0;
  const needUsage = !hasEnUsage && cnUsage.trim().length > 0;
  
  if (!needSummary && !needUsage) {
    // 虽然没有需要翻译的，但至少有一个英文版本，切换显示
    handleUpdateScanResult(i, { lang: 'en' });
    return;
  }
  
  // 开始翻译
  translateInFlightRef.current = true;
  setTranslatingIndex(i);
  try {
    const resp = await api.translate(
    needSummary ? cnSummary : '',
    needUsage ? cnUsage : '',
    );
    
    if (resp?.warning) {
    // AI 翻译降级（provider 不可用、超时等），不切换语言
    notify(resp.warning, { type: 'error' });
    return;
    }
    
    const updates: any = { lang: 'en' };
    
    // 设置或保留翻译后的内容
    if (resp?.summary_en) {
    updates.summary_en = resp.summary_en;
    updates.summary = resp.summary_en;
    }
    if (resp?.usageGuide_en) {
    updates.usageGuide_en = resp.usageGuide_en;
    updates.usageGuide = resp.usageGuide_en;
    }
    
    handleUpdateScanResult(i, updates);
    notify('已翻译并切换到英文');
  } catch (err: any) {
    notify(err?.response?.data?.error || err?.message || '翻译失败，请检查网络或重试', { type: 'error' });
  } finally {
    translateInFlightRef.current = false;
    setTranslatingIndex(null);
  }
  }, [handleUpdateScanResult]);

  useEffect(() => {
  const keys = scanResults.map((r, i) => r.candidateId ?? `scan-${i}`);
  const prevKeys = prevSimilarKeysRef.current;
  const keysChanged = keys.length !== prevKeys.length || keys.some((k, i) => k !== prevKeys[i]);
  if (keysChanged) {
    fetchedSimilarRef.current.clear();
    prevSimilarKeysRef.current = keys;
  }
  scanResults.forEach((res, i) => {
    const key = res.candidateId ?? `scan-${i}`;
    if (res.candidateId && res.candidateTargetName) {
    fetchSimilarity(key, { targetName: res.candidateTargetName, candidateId: res.candidateId });
    } else {
    fetchSimilarity(key, { candidate: { title: res.title, summary: res.summary, code: res.code, usageGuide: res.usageGuide } });
    }
  });
  }, [scanResults, fetchSimilarity]);

  return (
  <div className="flex gap-8 h-full">
    <div className="w-80 bg-white rounded-xl border border-slate-200 flex flex-col overflow-hidden shrink-0">
    <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
      <span className="font-bold text-sm">项目 Target ({targets.length})</span>
      {handleScanProject && (
      <button
        onClick={handleScanProject}
        disabled={isScanning}
        className={`text-xs px-2 py-1 rounded transition-colors disabled:opacity-50 ${
        selectedTargetName === '__project__'
          ? 'bg-indigo-700 text-white ring-2 ring-indigo-300 shadow-sm'
          : 'bg-indigo-600 text-white hover:bg-indigo-700'
        }`}
        title="扫描整个项目：AI 提取 + Guard 审计"
      >
        <span className="flex items-center gap-1">
        <Layers size={12} />
        全项目扫描
        </span>
      </button>
      )}
    </div>
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
          <Zap size={ICON_SIZES.sm} className={`shrink-0 ${isSelected ? 'text-blue-500 opacity-100' : 'text-blue-500 opacity-0 group-hover:opacity-100'} transition-opacity`} />
        )}
        </button>
      );
      })}
    </div>
    </div>
    <div className="flex-1 bg-white rounded-xl border border-slate-200 flex flex-col overflow-hidden relative">
    <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-sm flex justify-between items-center">
      <div className="flex items-center gap-2">
      {selectedTargetName === '__project__' ? (
        <>
        <Layers size={ICON_SIZES.md} className="text-indigo-500" />
        <span>全项目扫描结果</span>
        {scanResults.length > 0 && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200">PROJECT</span>
        )}
        </>
      ) : selectedTargetName ? (
        <>
        <Zap size={ICON_SIZES.md} className="text-blue-500" />
        <span>Target: {selectedTargetName}</span>
        {scanResults.length > 0 && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">TARGET</span>
        )}
        </>
      ) : (
        <>
        <Edit3 size={ICON_SIZES.md} className="text-slate-400" />
        <span>审核提取结果</span>
        </>
      )}
      {scanResults.length > 0 && <span className="text-slate-400 font-normal text-xs ml-1">({scanResults.length} 条{scanResults[0]?.trigger ? ' Candidate' : ''})</span>}
      </div>
      <button
      onClick={() => {
        setSelectedContextTarget(selectedTargetName || undefined);
        setIsContextSearchOpen(true);
      }}
      className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 text-sm font-medium rounded-lg hover:bg-blue-100 transition-colors"
      title="智能搜索相关 Recipes"
      >
      <Search size={ICON_SIZES.sm} />
      智能搜索
      </button>
    </div>
    
    <div className="flex-1 overflow-y-auto p-6 space-y-8 relative">
      {isScanning && (
      <div className="absolute inset-0 bg-white/90 backdrop-blur-[2px] z-10 flex flex-col items-center justify-center text-blue-600 px-8 overflow-y-auto">
        <div className="relative mb-6">
        <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
        <Cpu size={ICON_SIZES.xxl} className="absolute inset-0 m-auto text-blue-600 animate-pulse" />
        </div>
        <p className="font-bold text-lg animate-pulse mb-1">
        {selectedTargetName === '__project__' ? '全项目扫描中' : `Target 扫描: ${selectedTargetName || '...'}`}
        </p>
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
        <Box size={ICON_SIZES.xxxl} className="mb-4 opacity-20" />
        <p className="font-medium text-slate-600">深度扫描与提取</p>
        <p className="text-xs mt-2 max-w-xs">
        从左侧选择一个 <span className="font-bold text-blue-600">Target</span> 进行单模块扫描，或点击 <span className="font-bold text-indigo-600">全项目扫描</span> 对所有模块进行 AI 提取 + Guard 审计。
        </p>
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

      {/* Guard 审计摘要 — 仅全项目扫描模式显示 */}
      {!isScanning && selectedTargetName === '__project__' && guardAudit?.summary && (
      <div className={`rounded-xl border p-4 ${guardAudit.summary.totalViolations > 0 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
        <div className="flex items-center gap-2 mb-2">
        <Shield size={ICON_SIZES.md} className={guardAudit.summary.totalViolations > 0 ? 'text-amber-600' : 'text-emerald-600'} />
        <span className="text-sm font-bold text-slate-700">Guard 审计摘要</span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200">PROJECT SCAN</span>
        </div>
        <div className="flex gap-6 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">已审计文件:</span>
          <span className="font-bold text-slate-700">{guardAudit.summary.totalFiles}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">违反总数:</span>
          <span className={`font-bold ${guardAudit.summary.totalViolations > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{guardAudit.summary.totalViolations}</span>
        </div>
        {guardAudit.summary.errors > 0 && (
          <div className="flex items-center gap-1.5">
          <AlertTriangle size={ICON_SIZES.sm} className="text-red-500" />
          <span className="font-bold text-red-700">{guardAudit.summary.errors} 错误</span>
          </div>
        )}
        {guardAudit.summary.warnings > 0 && (
          <div className="flex items-center gap-1.5">
          <AlertTriangle size={ICON_SIZES.sm} className="text-amber-500" />
          <span className="font-bold text-amber-700">{guardAudit.summary.warnings} 警告</span>
          </div>
        )}
        </div>
      </div>
      )}
      
      {scanResults.map((res, i) => {
      const isExpanded = expandedEditIndex === i;
      const headers = res.headers || [];
      return (
        <div key={i} className="bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="px-5 pt-4 pb-3 bg-gradient-to-b from-white to-slate-50/50 border-b border-slate-100">
        {/* 第一行：Title 突出 + 操作按钮 */}
        <div className="flex items-start justify-between gap-4 mb-3">
           <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5">Recipe Title</label>
              {res.scanMode === 'project' ? (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 border border-indigo-200 flex items-center gap-1">
                <Layers size={10} /> PROJECT
              </span>
              ) : res.scanMode === 'target' ? (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-200 flex items-center gap-1">
                <Zap size={10} /> {res.candidateTargetName || 'TARGET'}
              </span>
              ) : null}
            </div>
            <input className="font-semibold bg-transparent border-b-2 border-transparent hover:border-slate-200 focus:border-blue-500 outline-none px-0.5 text-lg w-full text-slate-800 placeholder:text-slate-300" value={res.title} onChange={e => handleUpdateScanResult(i, { title: e.target.value })} />
           </div>
           <div className="flex gap-2 shrink-0 pt-3">
            {handlePromoteToCandidate && (
            <button onClick={() => handlePromoteToCandidate(res, i)} className="text-xs px-4 py-2 rounded-lg font-bold transition-all shadow-sm flex items-center gap-1.5 active:scale-95 bg-white text-emerald-600 border border-emerald-200 hover:bg-emerald-50 whitespace-nowrap">
              <Inbox size={ICON_SIZES.md} />
              Candidate
            </button>
            )}
            <button onClick={() => handleSaveExtracted(res)} disabled={isSavingRecipe} className={`text-xs px-4 py-2 rounded-lg font-bold transition-all shadow-sm flex items-center gap-1.5 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap ${res.mode === 'full' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-amber-600 text-white hover:bg-amber-700'}`}>
              {isSavingRecipe ? <Loader2 size={ICON_SIZES.md} className="animate-spin" /> : <CheckCircle size={ICON_SIZES.md} />}
              {isSavingRecipe ? '保存中...' : '保存为 Recipe'}
            </button>
           </div>
        </div>
        {/* 第二行：所有控制项水平排列 */}
        <div className="flex items-end gap-4 flex-wrap">
           <div className="flex flex-col">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Trigger</label>
            <input className="font-mono font-bold text-blue-600 bg-blue-50/80 border border-blue-100 px-2.5 py-1 rounded-md outline-none text-xs focus:ring-2 focus:ring-blue-500/20 w-40" value={res.trigger} placeholder="@cmd" onChange={e => handleUpdateScanResult(i, { trigger: e.target.value })} />
           </div>
           <div className="flex flex-col">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Category</label>
            <select className="font-bold text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded-md outline-none text-[11px] focus:ring-2 focus:ring-blue-500/20" value={res.category} onChange={e => handleUpdateScanResult(i, { category: e.target.value })}>
              {categories.filter(c => c !== 'All').map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
           </div>
           <div className="w-px h-6 bg-slate-200 self-end mb-0.5" />
           <div className="flex flex-col">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Language</label>
            <div className="flex bg-slate-100 p-0.5 rounded-md">
              <button onClick={() => handleUpdateScanResult(i, { language: 'swift' })} className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all ${res.language === 'swift' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-500'}`}>Swift</button>
              <button onClick={() => handleUpdateScanResult(i, { language: 'objectivec' })} className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all ${res.language === 'objectivec' || res.language === 'objc' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-500'}`}>ObjC</button>
            </div>
           </div>
           <div className="flex flex-col">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Lang</label>
            <div className="flex bg-slate-100 p-0.5 rounded-md items-center">
              <button onClick={() => handleContentLangChange(i, 'cn', res)} disabled={translatingIndex !== null} className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all ${res.lang === 'cn' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-500'} disabled:opacity-50 disabled:cursor-not-allowed`}>CN</button>
              <button onClick={() => handleContentLangChange(i, 'en', res)} disabled={translatingIndex !== null} className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all flex items-center gap-0.5 ${res.lang === 'en' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-500'} disabled:opacity-50 disabled:cursor-not-allowed`}>
                {translatingIndex === i ? <Loader2 size={10} className="animate-spin" /> : null}
                EN
              </button>
            </div>
           </div>
           <div className="flex flex-col">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Mode</label>
            <div className="flex bg-slate-100 p-0.5 rounded-md">
              <button onClick={() => handleUpdateScanResult(i, { mode: 'full' })} className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all ${res.mode === 'full' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-500'}`}>Snippet+Recipe</button>
              <button onClick={() => handleUpdateScanResult(i, { mode: 'preview' })} className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all ${res.mode === 'preview' ? 'bg-white shadow-sm text-amber-600' : 'text-slate-400 hover:text-slate-500'}`}>Recipe Only</button>
            </div>
           </div>
           <div className="w-px h-6 bg-slate-200 self-end mb-0.5" />
           <div className="flex flex-col">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Difficulty</label>
            <select className="font-bold text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded-md outline-none text-[11px] focus:ring-2 focus:ring-purple-500/20" value={res.difficulty || 'intermediate'} onChange={e => handleUpdateScanResult(i, { difficulty: e.target.value as any })}>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
           </div>
           <div className="flex flex-col">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Authority</label>
            <select className="font-bold text-amber-600 bg-amber-50/60 border border-amber-100 px-2 py-1 rounded-md outline-none text-[11px] focus:ring-2 focus:ring-amber-500/20" value={res.authority || 3} onChange={e => handleUpdateScanResult(i, { authority: parseInt(e.target.value) })}>
              <option value="1">⭐ 1</option>
              <option value="2">⭐⭐ 2</option>
              <option value="3">⭐⭐⭐ 3</option>
              <option value="4">⭐⭐⭐⭐ 4</option>
              <option value="5">⭐⭐⭐⭐⭐ 5</option>
            </select>
           </div>
        </div>
        </div>
        <div className="px-6 pt-5 pb-0 space-y-3">
        {/* 属性行: Knowledge Type / Scope / Module / Headers */}
        <div className="flex flex-wrap gap-x-4 gap-y-2 items-end">
          <div className="flex flex-col">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Knowledge Type</label>
            <select className="font-bold text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded-md outline-none text-[11px] focus:ring-2 focus:ring-blue-500/20" value={res.knowledgeType || 'code-pattern'} onChange={e => handleUpdateScanResult(i, { knowledgeType: e.target.value as any })}>
              <option value="code-pattern">Code Pattern</option>
              <option value="architecture">Architecture</option>
              <option value="best-practice">Best Practice</option>
              <option value="rule">Rule</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Scope</label>
            <select className="font-bold text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded-md outline-none text-[11px] focus:ring-2 focus:ring-blue-500/20" value={res.scope || 'project-specific'} onChange={e => handleUpdateScanResult(i, { scope: e.target.value as any })}>
              <option value="universal">Universal</option>
              <option value="project-specific">Project Specific</option>
              <option value="target-specific">Target Specific</option>
            </select>
          </div>
          <div className="w-px h-6 bg-slate-200 self-end mb-0.5" />
          {res.moduleName && (
          <div className="flex flex-col">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Module</label>
            <span className="text-[11px] bg-purple-50 text-purple-700 border border-purple-100 px-2 py-1 rounded-md font-mono font-bold">{res.moduleName}</span>
          </div>
          )}
          {headers.length > 0 && (
          <div className="flex items-end gap-2">
            <div className="flex flex-col">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Headers</label>
            <button
              onClick={() => setExpandedEditIndex(expandedEditIndex === i ? null : i)}
              className={`text-[11px] font-bold px-2 py-1 rounded-md transition-colors border ${isExpanded ? 'text-blue-700 bg-blue-100 border-blue-300' : 'text-blue-600 bg-blue-50 border-blue-100 hover:bg-blue-100'}`}
            >
              {isExpanded ? '收起' : '编辑'} ({headers.length})
            </button>
            </div>
            <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[9px] text-slate-400">Snippet:</span>
            <button
              onClick={() => handleUpdateScanResult(i, { includeHeaders: !(res.includeHeaders !== false) })}
              className={`w-7 h-4 rounded-full relative transition-colors ${res.includeHeaders !== false ? 'bg-blue-600' : 'bg-slate-300'}`}
              title={res.includeHeaders !== false ? '开启：snippet 内写入 // as:include 标记' : '关闭：不写入头文件标记'}
            >
              <div className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full transition-all ${res.includeHeaders !== false ? 'right-0.5' : 'left-0.5'}`} />
            </button>
            <span className="text-[9px] font-bold text-slate-600">{res.includeHeaders !== false ? 'ON' : 'OFF'}</span>
            </div>
          </div>
          )}
          <div className="w-px h-6 bg-slate-200 self-end mb-0.5" />
          <div className="flex flex-col flex-1 min-w-[160px]">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Tags</label>
            <div className="flex flex-wrap gap-1 items-center bg-white border border-slate-200 rounded-md px-1.5 py-0.5 min-h-[28px] focus-within:ring-2 focus-within:ring-blue-500/20">
              {(res.tags || []).map((tag: string, ti: number) => (
              <span key={ti} className="flex items-center gap-0.5 text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0 rounded">
                {tag}
                <button onClick={() => { const newTags = [...(res.tags || [])]; newTags.splice(ti, 1); handleUpdateScanResult(i, { tags: newTags }); }} className="text-blue-400 hover:text-red-500 transition-colors leading-none text-[10px]" title="移除">&times;</button>
              </span>
              ))}
              <input
              className="flex-1 min-w-[80px] text-[11px] text-slate-600 outline-none bg-transparent py-0.5"
              placeholder={(res.tags || []).length === 0 ? '按 Enter/逗号添加...' : ''}
              onKeyDown={e => {
                const input = e.currentTarget;
                const val = input.value.trim();
                if ((e.key === 'Enter' || e.key === ',' || e.key === '，') && val) {
                e.preventDefault();
                const newTag = val.replace(/[,，]/g, '').trim();
                if (newTag && !(res.tags || []).includes(newTag)) {
                  handleUpdateScanResult(i, { tags: [...(res.tags || []), newTag] });
                }
                input.value = '';
                } else if (e.key === 'Backspace' && !input.value && (res.tags || []).length > 0) {
                const newTags = [...(res.tags || [])];
                newTags.pop();
                handleUpdateScanResult(i, { tags: newTags });
                }
              }}
              onBlur={e => {
                const val = e.currentTarget.value.trim().replace(/[,，]/g, '').trim();
                if (val && !(res.tags || []).includes(val)) {
                handleUpdateScanResult(i, { tags: [...(res.tags || []), val] });
                }
                e.currentTarget.value = '';
              }}
              />
            </div>
          </div>
        </div>

        {/* Headers 展开编辑 — 紧跟属性行 */}
        {isExpanded && headers.length > 0 && (
          <div className="space-y-2 bg-slate-50/80 rounded-lg p-3 border border-slate-200">
          <div className="flex items-center justify-between">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">导入头文件</label>
            <button
            onClick={() => {
              const newHeaders = [...headers, res.language === 'objectivec' ? '#import <Module/Header.h>' : 'import ModuleName'];
              handleUpdateScanResult(i, { headers: newHeaders });
            }}
            className="text-[9px] px-2 py-0.5 bg-green-500 text-white rounded hover:bg-green-600 font-bold"
            >
            + 添加
            </button>
          </div>
          <div className="space-y-1">
            {headers.map((h, hi) => (
            <div key={hi} className="flex items-center gap-2">
              <input
              className="flex-1 text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-400"
              value={h}
              onChange={e => {
                const newHeaders = [...headers];
                newHeaders[hi] = e.target.value;
                handleUpdateScanResult(i, { headers: newHeaders });
              }}
              placeholder={res.language === 'objectivec' ? '#import <Module/Header.h>' : 'import ModuleName'}
              />
              <button
              onClick={() => {
                const newHeaders = headers.filter((_, idx) => idx !== hi);
                handleUpdateScanResult(i, { headers: newHeaders });
              }}
              className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-[9px] font-bold"
              >
              删除
              </button>
            </div>
            ))}
          </div>
          </div>
        )}
        </div>

        {/* 文本内容区 */}
        <div className="px-6 pb-6 pt-3 space-y-3">
        {/* Summary 摘要 */}
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Summary (摘要) - {res.lang === 'cn' ? '中文' : 'EN'}</label>
          <textarea rows={1} className="w-full text-sm text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none resize-none leading-relaxed focus:ring-2 focus:ring-blue-500/10" value={res.summary} onChange={e => handleUpdateScanResult(i, { summary: e.target.value })} />
        </div>

        {/* Usage Guide 使用指南 */}
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Usage Guide (使用指南) - {res.lang === 'cn' ? '中文' : 'EN'}</label>
          <textarea rows={3} className="w-full text-sm text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none resize-y leading-relaxed focus:ring-2 focus:ring-blue-500/10" value={typeof res.usageGuide === 'object' ? JSON.stringify(res.usageGuide) : (res.usageGuide || '')} onChange={e => handleUpdateScanResult(i, { usageGuide: e.target.value })} placeholder="何时用 / 关键点 / 依赖..." />
        </div>
        
        {/* 相似度提示 */}
        {(() => {
          const simKey = res.candidateId ?? `scan-${i}`;
          const similar = similarityMap[simKey];
          const loading = similarityLoading === simKey;
          const hasSimilar = (similar?.length ?? 0) > 0;
          const highSimilar = (similar || []).filter(s => s.similarity >= 0.85);
          const hasHighSimilar = highSimilar.length > 0;
          return (hasSimilar || loading) ? (
          <div className="space-y-1.5">
            {/* 高相似度警告 */}
            {hasHighSimilar && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <span className="text-red-500 text-sm">⚠️</span>
              <span className="text-[11px] font-bold text-red-700">高重复风险：</span>
              {highSimilar.map(s => (
              <button
                key={s.recipeName}
                onClick={() => openCompare(res, s.recipeName, similar || [])}
                className="text-[11px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-800 border border-red-300 hover:bg-red-200 transition-colors"
              >
                {s.recipeName.replace(/\.md$/i, '')} {(s.similarity * 100).toFixed(0)}%
              </button>
              ))}
              <span className="text-[10px] text-red-500">建议先对比再保存</span>
            </div>
            )}
            {/* 一般相似度列表 */}
            <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[10px] text-slate-400 font-bold">相似 Recipe：</span>
            {loading ? (
              <span className="text-[10px] text-slate-400">加载中...</span>
            ) : (
              (similar || []).slice(0, 5).map(s => (
              <button
                key={s.recipeName}
                onClick={() => openCompare(res, s.recipeName, similar || [])}
                className={`text-[10px] font-bold px-2 py-1 rounded border transition-colors flex items-center gap-1 ${
                s.similarity >= 0.85
                  ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                  : s.similarity >= 0.6
                  ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
                title={`与 ${s.recipeName} 相似 ${(s.similarity * 100).toFixed(0)}%，点击对比`}
              >
                <GitCompare size={ICON_SIZES.xs} />
                {s.recipeName.replace(/\.md$/i, '')} {(s.similarity * 100).toFixed(0)}%
              </button>
              ))
            )}
            </div>
          </div>
          ) : null;
        })()}
        
        {/* 代码编辑 */}
        <div>
          <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase">Standardized Usage Example (标准使用示例)</label>
          {editingCodeIndex === i ? (
            <button type="button" onClick={() => setEditingCodeIndex(null)} className="flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:text-blue-700 px-2 py-1 rounded bg-blue-50">
            <Check size={ICON_SIZES.xs} /> 完成
            </button>
          ) : (
            <button type="button" onClick={() => setEditingCodeIndex(i)} className="flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-100" title="编辑代码">
            <Pencil size={ICON_SIZES.xs} /> 编辑
            </button>
          )}
          </div>
          {editingCodeIndex === i ? (
          <div className="rounded-xl overflow-hidden">
            <HighlightedCodeEditor
              value={res.code}
              onChange={(code) => handleUpdateScanResult(i, { code })}
              language={codeLang(res)}
              height={`${Math.min(12, res.code.split('\n').length) * 20 + 16}px`}
            />
          </div>
          ) : (
          <CodeBlock code={res.code} language={codeLang(res)} showLineNumbers />
          )}
        </div>
        </div>
      </div>
      );
      })}
    </div>
    </div>
    {/* 双栏对比弹窗：候选 vs Recipe */}
    {compareModal && (() => {
    const cand = compareModal.candidate;
    const candLang = codeLang(cand);
    const copyCandidate = () => {
      const parts = [];
      if (cand.code) parts.push('## Snippet / Code Reference\n\n```' + candLang + '\n' + cand.code + '\n```');
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
      const existing = recipes?.find(r => r.name === newName || r.name.endsWith('/' + newName));
      if (existing?.content) content = existing.content;
      else {
        try {
        const recipeData = await api.getRecipeContentByName(newName);
        content = recipeData.content;
        } catch (_) { return; }
      }
      setCompareModal(prev => prev ? { ...prev, recipeName: newName, recipeContent: content, recipeContents: { ...prev.recipeContents, [newName]: content } } : null);
      }
    };
    const handleDelete = async () => {
      if (!cand.candidateId || !compareModal.targetName || !handleDeleteCandidate) return;
      if (!window.confirm('确定删除该候选？')) return;
      try {
      await handleDeleteCandidate(compareModal.targetName, cand.candidateId);
      setCompareModal(null);
      } catch (_) {}
    };
    const handleAuditCandidate = () => {
      handleSaveExtracted(cand);
      setCompareModal(null);
    };
    const handleEditRecipe = () => {
      const recipe = recipes?.find(r => r.name === compareModal.recipeName || r.name.endsWith('/' + compareModal.recipeName))
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
          {cand.candidateId && compareModal.targetName && (
          <button onClick={handleDelete} className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded">删除候选</button>
          )}
          <button onClick={handleAuditCandidate} disabled={isSavingRecipe} className="text-xs text-blue-600 hover:bg-blue-50 px-2 py-1 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1">
          {isSavingRecipe ? <Loader2 size={ICON_SIZES.xs} className="animate-spin" /> : null}
          审核候选
          </button>
          <button onClick={handleEditRecipe} className="text-xs text-emerald-600 hover:bg-emerald-50 px-2 py-1 rounded">审核 Recipe</button>
        </div>
        <button onClick={() => setCompareModal(null)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors"><X size={ICON_SIZES.md} /></button>
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

    {/* 上下文感知搜索面板 */}
    <ContextAwareSearchPanel
    isOpen={isContextSearchOpen}
    onClose={() => setIsContextSearchOpen(false)}
    targetName={selectedContextTarget}
    currentFile={selectedContextFile}
    language="swift"
    onSelectRecipe={(recipeName) => {
      // 可选：跳转到该 Recipe 进行比较
      console.log('Selected recipe:', recipeName);
    }}
    />
  </div>
  );
};

export default SPMExplorerView;
