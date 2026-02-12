import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Zap, FileSearch, Box, Trash2, Edit3, Layers, Eye, EyeOff, GitCompare, X, Copy, Brain, BookOpen, Target, ChevronDown, ChevronUp, Sparkles, Shield, Clock, Code2, Tag, AlertTriangle, CheckCircle2, BarChart3, Filter, ArrowUpDown, Rocket, Wand2, Loader2 } from 'lucide-react';
import { ProjectData, ExtractedRecipe, CandidateItem } from '../../types';
import api from '../../api';
import { notify } from '../../utils/notification';
import { categoryConfigs } from '../../constants';
import CodeBlock from '../Shared/CodeBlock';
import MarkdownWithHighlight, { stripFrontmatter } from '../Shared/MarkdownWithHighlight';
import Pagination from '../Shared/Pagination';
import { ICON_SIZES } from '../../constants/icons';
import RefineChatPanel from './RefineChatPanel';

interface SimilarRecipe { recipeName: string; similarity: number; }

const SILENT_LABELS: Record<string, string> = { _watch: 'as:create', _draft: '草稿', _cli: 'CLI', _pending: '待审核(24h)', _recipe: 'New Recipe' };

interface CandidatesViewProps {
  data: ProjectData | null;
  isShellTarget: (name: string) => boolean;
  isSilentTarget?: (name: string) => boolean;
  isPendingTarget?: (name: string) => boolean;
  handleDeleteCandidate: (targetName: string, candidateId: string) => void;
  handleDeleteAllInTarget: (targetName: string) => void;
  onAuditCandidate: (cand: CandidateItem, targetName: string) => void;
  onAuditAllInTarget: (items: CandidateItem[], targetName: string) => void;
  onEditRecipe?: (recipe: { name: string; content: string; stats?: any }) => void;
  onColdStart?: () => void;
  isScanning?: boolean;
  onRefresh?: () => void;
}

/* ── 工具函数 ── */

function sortTargetNames(
  entries: [string, { targetName: string; scanTime: number; items: CandidateItem[] }][],
  isShellTarget: (name: string) => boolean,
  isSilentTarget: (name: string) => boolean,
  isPendingTarget: (name: string) => boolean
): [string, { targetName: string; scanTime: number; items: CandidateItem[] }][] {
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

/** 安全格式化日期 — 避免 1970 问题 */
function formatDate(raw: string | number | undefined): string {
  if (!raw) return '';
  const ts = typeof raw === 'number' ? raw : Number(raw);
  // 如果是秒级时间戳（< 1e12）转为毫秒
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const d = new Date(ms);
  if (isNaN(d.getTime()) || d.getFullYear() < 2000) return '';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return d.toLocaleDateString('zh-CN');
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return d.toLocaleDateString('zh-CN');
}

/** 代码预览：取前 N 行 */
function codePreview(code: string | undefined, maxLines = 4): string {
  if (!code) return '';
  return code.split('\n').slice(0, maxLines).join('\n');
}

/** 置信度颜色系统 */
function confidenceColor(c: number | null | undefined): { ring: string; text: string; bg: string; label: string } {
  if (c == null) return { ring: 'stroke-slate-200', text: 'text-slate-400', bg: 'bg-slate-50', label: '—' };
  if (c >= 0.8) return { ring: 'stroke-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', label: '高' };
  if (c >= 0.6) return { ring: 'stroke-blue-500', text: 'text-blue-700', bg: 'bg-blue-50', label: '中' };
  if (c >= 0.4) return { ring: 'stroke-amber-500', text: 'text-amber-700', bg: 'bg-amber-50', label: '中低' };
  return { ring: 'stroke-red-500', text: 'text-red-700', bg: 'bg-red-50', label: '低' };
}

/** 优先级配色 */
function priorityStyle(p: string | undefined) {
  if (p === 'high') return { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: '🔴' };
  if (p === 'medium') return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: '🟡' };
  if (p === 'low') return { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', icon: '⚪' };
  return null;
}

/** 来源 label */
const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  'bootstrap-scan': { label: 'AI 全量扫描', color: 'text-violet-600 bg-violet-50 border-violet-200' },
  'mcp': { label: 'MCP 提交', color: 'text-blue-600 bg-blue-50 border-blue-200' },
  'manual': { label: '手动创建', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  'file-watcher': { label: '文件监听', color: 'text-orange-600 bg-orange-50 border-orange-200' },
  'clipboard': { label: '剪贴板', color: 'text-pink-600 bg-pink-50 border-pink-200' },
  'cli': { label: 'CLI', color: 'text-slate-600 bg-slate-50 border-slate-200' },
};

/** 小型 SVG 环形置信度 */
const ConfidenceRing: React.FC<{ value: number | null | undefined; size?: number }> = ({ value, size = 36 }) => {
  const r = (size - 6) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = value != null ? Math.max(0, Math.min(1, value)) : 0;
  const offset = circumference * (1 - pct);
  const { ring, text } = confidenceColor(value);
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={3} className="text-slate-100" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} strokeLinecap="round"
          className={ring} strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
      </svg>
      <span className={`absolute text-[9px] font-bold ${text}`}>
        {value != null ? `${Math.round(value * 100)}` : '—'}
      </span>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════ */

const CandidatesView: React.FC<CandidatesViewProps> = ({
  data, isShellTarget, isSilentTarget = () => false, isPendingTarget = () => false,
  handleDeleteCandidate, handleDeleteAllInTarget,
  onAuditCandidate, onAuditAllInTarget, onEditRecipe, onColdStart, isScanning, onRefresh,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
  const [refiningIds, setRefiningIds] = useState<Set<string>>(new Set());
  const [enrichingAll, setEnrichingAll] = useState(false);
  const [refining, setRefining] = useState(false);
  const [refinePanel, setRefinePanel] = useState<{ candidateIds: string[] } | null>(null);
  const [targetPages, setTargetPages] = useState<Record<string, { page: number; pageSize: number }>>({});
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [similarityMap, setSimilarityMap] = useState<Record<string, SimilarRecipe[]>>({});
  const [similarityLoading, setSimilarityLoading] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    priority: 'all' as 'all' | 'high' | 'medium' | 'low',
    sort: 'default' as 'default' | 'score-desc' | 'score-asc' | 'confidence-desc' | 'date-desc',
    onlySimilar: false,
  });
  const [compareModal, setCompareModal] = useState<{
    candidate: CandidateItem;
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
      const result = await api.getCandidateSimilarityEx({ targetName, candidateId });
      setSimilarityMap(prev => ({ ...prev, [candidateId]: result.similar || [] }));
    } catch (_) {
      setSimilarityMap(prev => ({ ...prev, [candidateId]: [] }));
    } finally {
      setSimilarityLoading(null);
    }
  }, []);

  const openCompare = useCallback(async (cand: CandidateItem, targetName: string, recipeName: string, similarList: SimilarRecipe[] = []) => {
    const normalizedRecipeName = recipeName.replace(/\.md$/i, '');
    let recipeContent = '';
    const existing = data?.recipes?.find(r => r.name === normalizedRecipeName || r.name.endsWith('/' + normalizedRecipeName));
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

  // 统计数据
  const stats = useMemo(() => {
    if (!effectiveTarget || !data?.candidates?.[effectiveTarget]) return null;
    const items = data.candidates[effectiveTarget].items;
    const total = items.length;
    const high = items.filter(c => c.reviewNotes?.priority === 'high').length;
    const medium = items.filter(c => c.reviewNotes?.priority === 'medium').length;
    const low = items.filter(c => c.reviewNotes?.priority === 'low').length;
    const avgConfidence = items.reduce((sum, c) => sum + (c.reasoning?.confidence ?? 0), 0) / (total || 1);
    const withCode = items.filter(c => c.code && c.code.trim().length > 0).length;
    const sources = new Map<string, number>();
    items.forEach(c => {
      const s = c.source || 'unknown';
      sources.set(s, (sources.get(s) || 0) + 1);
    });
    return { total, high, medium, low, avgConfidence, withCode, sources };
  }, [effectiveTarget, data?.candidates]);

  /** AI 补齐单个候选语义字段 */
  const handleEnrichCandidate = useCallback(async (candidateId: string) => {
    if (enrichingIds.has(candidateId)) return;
    setEnrichingIds(prev => new Set(prev).add(candidateId));
    try {
      const result = await api.enrichCandidates([candidateId]);
      if (result.enriched > 0) {
        notify(`已补齐 ${result.results?.[0]?.filledFields?.length || 0} 个结构字段`);
      } else {
        notify('所有结构字段已完整，无需补齐');
      }
      onRefresh?.();
    } catch (err: any) {
      notify(`AI 补齐失败: ${err.response?.data?.error || err.message}`, { type: 'error' });
    } finally {
      setEnrichingIds(prev => { const next = new Set(prev); next.delete(candidateId); return next; });
    }
  }, [enrichingIds, onRefresh]);

  /** 批量 AI 补齐当前 Target 下所有候选 */
  const handleEnrichAll = useCallback(async () => {
    if (enrichingAll || !effectiveTarget || !data?.candidates?.[effectiveTarget]) return;
    const items = data.candidates[effectiveTarget].items;
    if (items.length === 0) return;
    setEnrichingAll(true);
    try {
      let total = 0;
      for (let i = 0; i < items.length; i += 20) {
        const batch = items.slice(i, i + 20).map(c => c.id);
        const result = await api.enrichCandidates(batch);
        total += result.enriched;
      }
      notify(`① 结构补齐完成: ${total}/${items.length} 条候选已更新`);
      onRefresh?.();
    } catch (err: any) {
      notify(`① 结构补齐失败: ${err.response?.data?.error || err.message}`, { type: 'error' });
    } finally {
      setEnrichingAll(false);
    }
  }, [enrichingAll, effectiveTarget, data?.candidates, onRefresh]);

  /** Phase 6: AI 润色所有 Bootstrap 候选 — 打开对话式润色面板 */
  const handleRefineBootstrap = useCallback(() => {
    if (!effectiveTarget || !data?.candidates?.[effectiveTarget]) return;
    const ids = data.candidates[effectiveTarget].items.map(c => c.id);
    setRefinePanel({ candidateIds: ids });
  }, [effectiveTarget, data?.candidates]);

  /** 单条候选润色 — 打开对话式润色面板 */
  const handleRefineSingle = useCallback((candidateId: string) => {
    setRefinePanel({ candidateIds: [candidateId] });
  }, []);

  /** 润色面板中某条候选已更新 — 局部刷新数据（不整页刷新） */
  const handleCandidateUpdated = useCallback((candidateId: string) => {
    // 触发最小化数据刷新
    onRefresh?.();
  }, [onRefresh]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ── 页面头部 ── */}
      <div className="mb-4 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center">
            <Sparkles className="text-blue-600" size={20} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">AI Scan Candidates</h2>
            <p className="text-xs text-slate-400 mt-0.5">AI 批量扫描后生成的候选内容，等待审核入库</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 冷启动按钮 */}
          {onColdStart && (
            <button
              onClick={onColdStart}
              disabled={isScanning}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
                isScanning
                  ? 'text-slate-400 bg-slate-100 cursor-not-allowed'
                  : 'text-white bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 shadow-sm hover:shadow'
              }`}
              title="冷启动：结构收集 + 9 维度 Candidate 创建（与 MCP 一致）"
            >
              {isScanning ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
              {isScanning ? '初始化中...' : '冷启动'}
            </button>
          )}
          {/* ① 结构补齐：填充缺失的语义元数据 */}
          {stats && stats.total > 0 && (
            <button
              onClick={handleEnrichAll}
              disabled={enrichingAll || refining}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                enrichingAll || refining
                  ? 'text-slate-400 bg-slate-100 cursor-not-allowed'
                  : 'text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100'
              }`}
              title="① 结构补齐：填充缺失的 rationale / knowledgeType / complexity / scope / steps / constraints（只填空不覆盖，建议先于润色执行）"
            >
              {enrichingAll ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              {enrichingAll ? '补齐中...' : '① 结构补齐'}
            </button>
          )}
          {/* ② 内容润色：改善描述质量 + 推断关联 */}
          {stats && stats.total > 0 && (
            <button
              onClick={handleRefineBootstrap}
              disabled={refining || enrichingAll}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                refining || enrichingAll
                  ? 'text-slate-400 bg-slate-100 cursor-not-allowed'
                  : 'text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100'
              }`}
              title="② 内容润色：改善 summary 描述、补充架构洞察、推断 relations 关联、调整 confidence 评分（逐条 AI 精炼，建议在结构补齐之后执行）"
            >
              {refining ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {refining ? '润色中...' : '② 内容润色'}
            </button>
          )}
          {stats && (
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
                <BarChart3 size={14} className="text-slate-400" />
                <span className="text-slate-500">共 <strong className="text-slate-700">{stats.total}</strong> 条</span>
                {stats.withCode < stats.total && (
                  <span className="text-slate-400 ml-1">（含代码 {stats.withCode}）</span>
                )}
              </div>
              {stats.high > 0 && (
                <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-50 border border-red-100">
                  <span className="text-red-600 font-bold">{stats.high}</span>
                  <span className="text-red-500">高优先</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-100">
                <span className="text-emerald-500">平均置信度</span>
                <strong className="text-emerald-700">{Math.round(stats.avgConfidence * 100)}%</strong>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Target 切换标签栏 ── */}
      {candidateEntries.length > 0 && (
        <div className="shrink-0 bg-white border border-slate-100 rounded-xl px-3 py-2 mb-4 shadow-sm">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {targetNames.map((targetName) => {
              const isShell = isShellTarget(targetName);
              const isSilent = isSilentTarget(targetName);
              const silentLabel = SILENT_LABELS[targetName];
              const group = data!.candidates[targetName];
              const count = group?.items?.length ?? 0;
              const isSelected = effectiveTarget === targetName;
              const catCfg = categoryConfigs[targetName] || categoryConfigs['All'];
              return (
                <button
                  key={targetName}
                  onClick={() => setSelectedTarget(targetName)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all border
                    ${isSelected
                      ? `${catCfg?.bg || 'bg-blue-50'} ${catCfg?.color || 'text-blue-700'} ${catCfg?.border || 'border-blue-200'} shadow-sm ring-1 ring-inset ${catCfg?.border || 'ring-blue-200'}`
                      : 'bg-slate-50/80 text-slate-600 border-slate-100 hover:border-slate-200 hover:bg-slate-100'}`}
                >
                  {(() => {
                    const Icon = catCfg?.icon || Box;
                    return <Icon size={ICON_SIZES.sm} className={isSelected ? '' : 'text-slate-400'} />;
                  })()}
                  <span>{targetName}</span>
                  {isSilent && silentLabel && <span className="text-[9px] text-amber-600 border border-amber-200 px-1 rounded">{silentLabel}</span>}
                  <span className={`text-[10px] font-normal rounded-full px-1.5 ${isSelected ? 'bg-white/60' : 'bg-slate-200/60 text-slate-400'}`}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 内容区域 ── */}
      <div className="flex-1 overflow-y-auto pr-1">
        {(!data?.candidates || Object.keys(data.candidates).length === 0) && (
          <div className="h-72 flex flex-col items-center justify-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
            <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center mb-4">
              <FileSearch size={32} className="text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-500">未发现候选内容</p>
            <p className="mt-2 text-xs max-w-sm text-center leading-relaxed text-slate-400">
              点击下方按钮冷启动知识库，或使用 CLI 命令手动创建
            </p>
            {onColdStart && (
              <button
                onClick={onColdStart}
                disabled={isScanning}
                className={`mt-4 flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                  isScanning
                    ? 'text-slate-400 bg-slate-100 cursor-not-allowed'
                    : 'text-white bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 shadow-md hover:shadow-lg'
                }`}
              >
                {isScanning ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />}
                {isScanning ? '正在初始化...' : '冷启动：初始化知识库'}
              </button>
            )}
            <p className="mt-3 text-[11px] text-slate-400">
              或 <code className="text-blue-600 bg-blue-50 px-1 rounded">asd ais --all</code> 全量扫描 ·
              <code className="text-blue-600 bg-blue-50 px-1 rounded ml-1">asd candidate</code> 从剪贴板创建
            </p>
          </div>
        )}

        {data && effectiveTarget && sortedEntries
          .filter(([name]) => name === effectiveTarget)
          .map(([targetName, group]) => {
            const isShell = isShellTarget(targetName);
            const isSilent = isSilentTarget(targetName);
            const silentLabel = SILENT_LABELS[targetName] || '静默';

            const pageState = targetPages[targetName] || { page: 1, pageSize: 12 };
            const currentPage = pageState.page;
            const pageSize = pageState.pageSize;

            const filteredItems = group.items
              .filter((cand) => {
                if (filters.priority !== 'all') {
                  const priority = cand.reviewNotes?.priority;
                  if (priority !== filters.priority) return false;
                }
                if (filters.onlySimilar) {
                  const related = cand.relatedRecipes;
                  if (!Array.isArray(related) || related.length === 0) return false;
                }
                return true;
              })
              .sort((a, b) => {
                if (filters.sort === 'default') return 0;
                if (filters.sort === 'score-desc') return (b.quality?.overallScore ?? 0) - (a.quality?.overallScore ?? 0);
                if (filters.sort === 'score-asc') return (a.quality?.overallScore ?? 0) - (b.quality?.overallScore ?? 0);
                if (filters.sort === 'confidence-desc') return (b.reasoning?.confidence ?? 0) - (a.reasoning?.confidence ?? 0);
                if (filters.sort === 'date-desc') {
                  const ta = typeof a.createdAt === 'number' ? a.createdAt : Number(a.createdAt) || 0;
                  const tb = typeof b.createdAt === 'number' ? b.createdAt : Number(b.createdAt) || 0;
                  return tb - ta;
                }
                return 0;
              });

            const totalItems = filteredItems.length;
            const totalPages = Math.ceil(totalItems / pageSize);
            const startIndex = (currentPage - 1) * pageSize;
            const paginatedItems = filteredItems.slice(startIndex, startIndex + pageSize);

            const handlePageChange = (page: number) => {
              setTargetPages(prev => ({ ...prev, [targetName]: { ...pageState, page } }));
            };
            const handlePageSizeChange = (size: number) => {
              setTargetPages(prev => ({ ...prev, [targetName]: { page: 1, pageSize: size } }));
            };

            const catCfg = categoryConfigs[targetName] || categoryConfigs['All'];

            return (
              <div key={targetName} className="space-y-3">
                {/* ── 工具栏 ── */}
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white border border-slate-100 shadow-sm">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {(() => {
                      const Icon = catCfg?.icon || Box;
                      return <Icon size={18} className={catCfg?.color || 'text-blue-600'} />;
                    })()}
                    <span className="text-base font-bold text-slate-800 truncate">{targetName}</span>
                    {isSilent && <span className="text-[10px] font-bold text-amber-600 border border-amber-200 bg-amber-50 px-1.5 py-0.5 rounded">{silentLabel}</span>}
                    {isShell && !isSilent && <span className="text-[10px] font-bold text-slate-400 border border-slate-200 bg-slate-50 px-1.5 py-0.5 rounded">SHELL</span>}
                    <span className="text-[11px] text-slate-400 flex items-center gap-1">
                      <Clock size={11} />
                      扫描于 {formatDate(group.scanTime) || new Date(group.scanTime).toLocaleString()}
                    </span>
                  </div>

                  {/* 筛选控件 */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 border border-slate-100">
                      <Filter size={12} className="text-slate-400" />
                      <select
                        className="text-[11px] font-medium bg-transparent border-none outline-none text-slate-600 pr-1 cursor-pointer"
                        value={filters.priority}
                        onChange={e => setFilters(prev => ({ ...prev, priority: e.target.value as any }))}
                      >
                        <option value="all">全部优先级</option>
                        <option value="high">🔴 高优先</option>
                        <option value="medium">🟡 中优先</option>
                        <option value="low">⚪ 低优先</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 border border-slate-100">
                      <ArrowUpDown size={12} className="text-slate-400" />
                      <select
                        className="text-[11px] font-medium bg-transparent border-none outline-none text-slate-600 pr-1 cursor-pointer"
                        value={filters.sort}
                        onChange={e => setFilters(prev => ({ ...prev, sort: e.target.value as any }))}
                      >
                        <option value="default">默认排序</option>
                        <option value="score-desc">综合分 高→低</option>
                        <option value="score-asc">综合分 低→高</option>
                        <option value="confidence-desc">置信度 高→低</option>
                        <option value="date-desc">最新优先</option>
                      </select>
                    </div>
                    <label className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-50 border border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors select-none">
                      <input
                        type="checkbox"
                        checked={filters.onlySimilar}
                        onChange={e => setFilters(prev => ({ ...prev, onlySimilar: e.target.checked }))}
                        className="rounded text-blue-600 w-3 h-3"
                      />
                      只看相似
                    </label>
                    {(filters.priority !== 'all' || filters.sort !== 'default' || filters.onlySimilar) && (
                      <button
                        onClick={() => setFilters({ priority: 'all', sort: 'default', onlySimilar: false })}
                        className="text-[11px] font-medium text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                      >
                        重置
                      </button>
                    )}
                  </div>

                  <div className="h-5 w-px bg-slate-200" />

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400 font-medium">{totalItems} 条</span>
                    <button
                      onClick={() => onAuditAllInTarget(paginatedItems, targetName)}
                      className="text-[11px] font-bold text-blue-600 hover:text-blue-700 px-2.5 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                    >
                      当前页进入审核
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`确定移除当前页的 ${paginatedItems.length} 条候选？`)) {
                          paginatedItems.forEach(item => handleDeleteCandidate(targetName, item.id));
                        }
                      }}
                      className="text-[11px] font-bold text-orange-500 hover:text-orange-600 px-2.5 py-1.5 rounded-lg hover:bg-orange-50 transition-colors"
                    >
                      移除当前页
                    </button>
                    <button
                      onClick={() => handleDeleteAllInTarget(targetName)}
                      className="text-[11px] font-bold text-red-500 hover:text-red-600 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors border border-red-200"
                    >
                      全部删除
                    </button>
                  </div>
                </div>

                {/* ── 候选卡片网格 ── */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {paginatedItems.map((cand) => {
                    const isExpanded = expandedId === cand.id;
                    const confidence = cand.reasoning?.confidence ?? null;
                    const overall = cand.quality?.overallScore ?? null;
                    const priority = cand.reviewNotes?.priority;
                    const pStyle = priorityStyle(priority);
                    const related = cand.relatedRecipes?.[0];
                    const similarList = similarityMap[cand.id] || [];

                    const srcInfo = SOURCE_LABELS[cand.source || ''] || { label: cand.source || '', color: 'text-slate-500 bg-slate-50 border-slate-200' };
                    const candCatCfg = categoryConfigs[cand.category || ''] || categoryConfigs['All'] || {};

                    // 类别颜色用于左侧色条
                    const strongAccent = (candCatCfg?.color || 'text-blue-600').replace('text-', 'border-l-');

                    return (
                      <div
                        key={cand.id}
                        className={`bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-lg transition-all duration-200 flex flex-col group
                          ${isShell ? 'opacity-75' : ''}
                          ${isExpanded ? 'ring-2 ring-blue-200 shadow-lg' : 'hover:border-slate-300'}`}
                      >
                        {/* ── 卡片头部：类别色条 + 标题 + 置信度 ── */}
                        <div className={`border-l-[4px] ${strongAccent} px-4 pt-3.5 pb-2`}>
                          <div className="flex items-start justify-between gap-3">
                            {/* 左：标题 & 标签 */}
                            <div className="flex-1 min-w-0">
                              {/* 第一行：类别 + 来源 + 知识类型 */}
                              <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase flex items-center gap-1 border ${candCatCfg?.bg || 'bg-slate-50'} ${candCatCfg?.color || 'text-slate-400'} ${candCatCfg?.border || 'border-slate-100'}`}>
                                  {(() => {
                                    const Icon = candCatCfg?.icon || Layers;
                                    return <Icon size={10} />;
                                  })()}
                                  {cand.category || 'general'}
                                </span>
                                {cand.knowledgeType && (
                                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100">
                                    {cand.knowledgeType}
                                  </span>
                                )}
                                {cand.source && cand.source !== 'unknown' && (
                                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${srcInfo.color}`}>
                                    {srcInfo.label}
                                  </span>
                                )}
                                {cand.complexity && (
                                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border
                                    ${cand.complexity === 'advanced' ? 'bg-red-50 text-red-600 border-red-100' :
                                      cand.complexity === 'intermediate' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                                        'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
                                    {cand.complexity === 'advanced' ? '高级' : cand.complexity === 'intermediate' ? '中级' : '初级'}
                                  </span>
                                )}
                              </div>

                              {/* 标题 */}
                              <h3 className="font-bold text-sm text-slate-800 leading-snug mb-1 line-clamp-1">{cand.title}</h3>

                              {/* 摘要 */}
                              <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{cand.summary || cand.summary_cn || ''}</p>
                            </div>

                            {/* 右：置信度环 + 操作 */}
                            <div className="flex flex-col items-center gap-1 shrink-0">
                              <ConfidenceRing value={confidence} />
                              <span className="text-[9px] text-slate-400 font-medium">置信度</span>
                            </div>
                          </div>
                        </div>

                        {/* ── AI 推理摘要（始终可见） ── */}
                        {cand.reasoning?.whyStandard && (
                          <div className="px-4 py-2 bg-gradient-to-r from-indigo-50/50 to-transparent border-t border-indigo-50">
                            <div className="flex items-start gap-1.5">
                              <Brain size={12} className="text-indigo-400 mt-0.5 shrink-0" />
                              <p className="text-[11px] text-indigo-600/80 line-clamp-1 leading-relaxed">
                                {cand.reasoning.whyStandard}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* ── 指标行：综合分 + 优先级 + 相似 ── */}
                        {(overall != null || pStyle || related) && (
                          <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-t border-slate-50">
                            {overall != null && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                                <CheckCircle2 size={10} />
                                综合 {(overall * 100).toFixed(0)}%
                              </span>
                            )}
                            {pStyle && (
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${pStyle.bg} ${pStyle.text} ${pStyle.border}`}>
                                {pStyle.icon} {priority === 'high' ? '高优先' : priority === 'medium' ? '中优先' : '低优先'}
                              </span>
                            )}
                            {related && (
                              <button
                                onClick={() => {
                                  const name = String(related.id || related.title || '').trim();
                                  if (name) openCompare(cand, targetName, name, similarList);
                                }}
                                className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors flex items-center gap-1"
                                title="点击对比相似 Recipe"
                              >
                                <GitCompare size={10} />
                                相似 {String(related.title || related.id || '').replace(/\.md$/i, '')} {(related.similarity * 100).toFixed(0)}%
                              </button>
                            )}
                          </div>
                        )}

                        {/* ── 代码预览（始终显示前 3 行） ── */}
                        {cand.code && (
                          <div className="mx-3 mb-2 rounded-xl overflow-hidden border border-slate-200/60 shadow-sm">
                            <div className="flex items-center justify-between px-3 py-1.5" style={{ background: '#282c34' }}>
                              <div className="flex items-center gap-2">
                                <Code2 size={11} className="text-slate-500" />
                                <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wide">{cand.language || 'code'}</span>
                              </div>
                              <span className="text-[10px] text-slate-500 font-mono tabular-nums">{cand.code.split('\n').length} 行</span>
                            </div>
                            <div className="relative max-h-[80px] overflow-hidden">
                              <CodeBlock
                                code={codePreview(cand.code, 3)}
                                language={cand.language === 'objc' ? 'objectivec' : cand.language}
                                className="!rounded-none"
                              />
                              {cand.code.split('\n').length > 3 && (
                                <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-[#282c34] to-transparent pointer-events-none" />
                              )}
                            </div>
                          </div>
                        )}

                        {/* ── 展开详情 ── */}
                        {isExpanded && (
                          <div className="px-4 pb-3 space-y-3 border-t border-slate-100 pt-3 animate-in fade-in slide-in-from-top-1 duration-200">
                            {/* Reasoning 完整面板 */}
                            {(() => {
                              const r = cand.reasoning;
                              const hasReasoning = r && (r.whyStandard || (r.sources && r.sources.length > 0) || r.confidence != null);
                              if (!hasReasoning && !cand.quality) return null;
                              return (
                                <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 text-xs space-y-2.5">
                                  <div className="flex items-center gap-1.5 text-indigo-700 font-bold text-[11px]">
                                    <Brain size={14} />
                                    AI 推理过程
                                  </div>
                                  {hasReasoning ? (
                                    <>
                                      {r!.whyStandard && (
                                        <div>
                                          <span className="text-indigo-600 font-bold flex items-center gap-1 mb-0.5"><Target size={10} /> 为什么是标准用法</span>
                                          <p className="text-slate-600 leading-relaxed pl-3">{r!.whyStandard}</p>
                                        </div>
                                      )}
                                      {r!.sources && r!.sources.length > 0 && (
                                        <div>
                                          <span className="text-indigo-600 font-bold flex items-center gap-1 mb-0.5"><BookOpen size={10} /> 来源</span>
                                          <ul className="pl-3 text-slate-600 space-y-0.5">
                                            {r!.sources.map((s: string, i: number) => <li key={i} className="flex items-start gap-1"><span className="text-indigo-400 mt-0.5">•</span>{s}</li>)}
                                          </ul>
                                        </div>
                                      )}
                                      {r!.confidence != null && (
                                        <div className="flex items-center gap-2">
                                          <span className="text-indigo-600 font-bold">置信度</span>
                                          <div className="flex-1 max-w-[200px] bg-indigo-100 rounded-full h-2 overflow-hidden">
                                            <div
                                              className={`h-full rounded-full transition-all ${r!.confidence >= 0.7 ? 'bg-emerald-500' : r!.confidence >= 0.4 ? 'bg-amber-500' : 'bg-red-500'}`}
                                              style={{ width: `${Math.round((r!.confidence ?? 0) * 100)}%` }}
                                            />
                                          </div>
                                          <span className={`font-bold ${r!.confidence >= 0.7 ? 'text-emerald-600' : r!.confidence >= 0.4 ? 'text-amber-600' : 'text-red-600'}`}>
                                            {Math.round((r!.confidence ?? 0) * 100)}%
                                          </span>
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <p className="text-slate-400 italic pl-3">暂无推理信息</p>
                                  )}
                                </div>
                              );
                            })()}

                            {/* 相似 Recipe 列表 */}
                            {(() => {
                              const similar = similarityMap[cand.id];
                              const loading = similarityLoading === cand.id;
                              const hasSimilar = (similar?.length ?? 0) > 0;
                              return (hasSimilar || loading) ? (
                                <div className="flex flex-wrap gap-1.5 items-center">
                                  <span className="text-[10px] text-slate-400 font-bold">相似 Recipe：</span>
                                  {loading ? (
                                    <span className="text-[10px] text-slate-400 animate-pulse">加载中...</span>
                                  ) : (
                                    (similar || []).slice(0, 3).map(s => (
                                      <button
                                        key={s.recipeName}
                                        onClick={() => openCompare(cand, targetName, s.recipeName, similar || [])}
                                        className="text-[10px] font-bold px-2 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors flex items-center gap-1"
                                        title={`与 ${s.recipeName} 相似 ${(s.similarity * 100).toFixed(0)}%`}
                                      >
                                        <GitCompare size={10} />
                                        {s.recipeName.replace(/\.md$/i, '')} {(s.similarity * 100).toFixed(0)}%
                                      </button>
                                    ))
                                  )}
                                </div>
                              ) : null;
                            })()}

                            {/* 完整代码 / 使用指南 */}
                            <div className="rounded-xl overflow-hidden border border-slate-100 bg-slate-50 max-h-72 overflow-y-auto">
                              {cand.code ? (
                                <CodeBlock code={cand.code} language={cand.language === 'objc' ? 'objectivec' : cand.language} showLineNumbers />
                              ) : (
                                <div className="p-4">
                                  <MarkdownWithHighlight content={cand.usageGuide || ''} />
                                </div>
                              )}
                            </div>

                            {/* usageGuide（如果同时有 code 和 usageGuide） */}
                            {cand.code && cand.usageGuide && (
                              <div className="rounded-xl overflow-hidden border border-slate-100 bg-white p-3 max-h-48 overflow-y-auto">
                                <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 mb-2">
                                  <BookOpen size={12} /> 使用指南
                                </div>
                                <MarkdownWithHighlight content={cand.usageGuide} />
                              </div>
                            )}

                            {/* 附加信息区 */}
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400">
                              {cand.scope && <span>范围: <strong className="text-slate-600">{cand.scope === 'universal' ? '通用' : cand.scope === 'project-specific' ? '项目级' : '模块级'}</strong></span>}
                              {cand.headers && cand.headers.length > 0 && <span>头文件: <strong className="text-slate-600">{cand.headers.join(', ')}</strong></span>}
                              {cand.steps && cand.steps.length > 0 && <span>实施步骤: <strong className="text-slate-600">{cand.steps.length} 步</strong></span>}
                              {cand.rationale && <span title={cand.rationale}>设计原理: <strong className="text-slate-600 line-clamp-1">{cand.rationale.substring(0, 60)}{cand.rationale.length > 60 ? '...' : ''}</strong></span>}
                            </div>
                          </div>
                        )}

                        {/* ── 卡片底栏：元信息 + 操作 ── */}
                        <div className="flex justify-between items-center px-4 py-2.5 border-t border-slate-100 bg-slate-50/50 mt-auto">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            {/* 展开/折叠 */}
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : cand.id)}
                              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors
                                ${isExpanded ? 'bg-blue-100 text-blue-700' : 'bg-white text-slate-500 hover:text-blue-600 hover:bg-blue-50 border border-slate-200'}`}
                              title={isExpanded ? '收起详情' : '展开详情'}
                            >
                              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              {isExpanded ? '收起' : '详情'}
                            </button>

                            {/* trigger */}
                            {cand.trigger && (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600 font-bold">{cand.trigger}</span>
                            )}

                            {/* 语言 */}
                            <span className="text-[10px] uppercase font-bold text-slate-400 bg-white border border-slate-200 px-1.5 py-0.5 rounded-md">{cand.language}</span>

                            {/* tags */}
                            {cand.tags && cand.tags.length > 0 && cand.tags.slice(0, 3).map((tag, i) => (
                              <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-100 font-medium">
                                {typeof tag === 'string' ? tag : String(tag)}
                              </span>
                            ))}
                            {cand.tags && cand.tags.length > 3 && (
                              <span className="text-[9px] text-slate-400">+{cand.tags.length - 3}</span>
                            )}

                            {/* 日期 */}
                            {cand.createdAt && formatDate(cand.createdAt) && (
                              <span className="text-[9px] text-slate-400 flex items-center gap-0.5">
                                <Clock size={9} />
                                {formatDate(cand.createdAt)}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => handleEnrichCandidate(cand.id)}
                              disabled={enrichingIds.has(cand.id)}
                              title="① 结构补齐：填充缺失的语义字段（rationale / knowledgeType / complexity 等）"
                              className={`p-1.5 rounded-lg transition-colors flex items-center gap-1 text-[11px] font-medium ${
                                enrichingIds.has(cand.id)
                                  ? 'text-slate-300 cursor-not-allowed'
                                  : 'text-amber-500 hover:text-amber-600 hover:bg-amber-50'
                              }`}
                            >
                              {enrichingIds.has(cand.id) ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                            </button>
                            <button
                              onClick={() => handleRefineSingle(cand.id)}
                              disabled={refiningIds.has(cand.id)}
                              title="② 内容润色：改善描述、补充洞察、推断关联（支持自定义提示词）"
                              className={`p-1.5 rounded-lg transition-colors flex items-center gap-1 text-[11px] font-medium ${
                                refiningIds.has(cand.id)
                                  ? 'text-slate-300 cursor-not-allowed'
                                  : 'text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50'
                              }`}
                            >
                              {refiningIds.has(cand.id) ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                            </button>
                            <button
                              onClick={() => handleDeleteCandidate(targetName, cand.id)}
                              title="忽略"
                              className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-lg transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                            <button
                              onClick={() => onAuditCandidate(cand, targetName)}
                              className="text-[11px] font-bold text-blue-600 hover:text-blue-700 px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors flex items-center gap-1"
                            >
                              <Edit3 size={12} /> 审核并保存
                            </button>
                            {cand.status === 'approved' && (
                              <button
                                onClick={async () => {
                                  try {
                                    await api.promoteCandidateToRecipe(cand.id);
                                    notify('已提升为 Recipe');
                                    onRefresh?.();
                                  } catch (err: any) {
                                    notify(`提升失败: ${err.message}`, { type: 'error' });
                                  }
                                }}
                                className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 transition-colors flex items-center gap-1"
                                title="一键提升为 Recipe"
                              >
                                <Rocket size={12} /> 提升为 Recipe
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 分页 */}
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

      {/* ═══ 双栏对比弹窗 ═══ */}
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
                const recipeData = await api.getRecipeContentByName(newName);
                content = recipeData.content;
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setCompareModal(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-[min(95vw,1600px)] max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center px-5 py-3.5 border-b border-slate-200 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                    <GitCompare size={16} className="text-white" />
                  </div>
                  <h3 className="font-bold text-slate-800">候选 vs Recipe 对比</h3>
                  <div className="flex items-center gap-1.5 ml-2">
                    <button onClick={handleDelete} className="text-xs font-medium text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-colors">删除候选</button>
                    <button onClick={handleAuditCandidate} className="text-xs font-medium text-blue-600 hover:bg-blue-50 px-2.5 py-1.5 rounded-lg transition-colors">审核候选</button>
                    <button onClick={handleEditRecipe} className="text-xs font-medium text-emerald-600 hover:bg-emerald-50 px-2.5 py-1.5 rounded-lg transition-colors">审核 Recipe</button>
                  </div>
                </div>
                <button onClick={() => setCompareModal(null)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors"><X size={20} /></button>
              </div>
              <div className="flex-1 grid grid-cols-2 overflow-hidden min-h-0" style={{ gridTemplateRows: 'auto 1fr' }}>
                <div className="px-5 py-3 bg-blue-50 border-b border-r border-slate-100 flex flex-col justify-center min-h-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-blue-700 truncate flex-1 min-w-0" title={cand.title}>候选：{cand.title}</span>
                    <button onClick={copyCandidate} className="p-1.5 hover:bg-blue-100 rounded-lg text-blue-600 shrink-0" title="复制"><Copy size={14} /></button>
                  </div>
                  <div className="min-h-[28px] mt-2 shrink-0" />
                </div>
                <div className="px-5 py-3 bg-emerald-50 border-b border-slate-100 flex flex-col justify-center min-h-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-emerald-700 truncate flex-1 min-w-0" title={compareModal.recipeName}>Recipe：{compareModal.recipeName.replace(/\.md$/i, '')}</span>
                    <button onClick={copyRecipe} className="p-1.5 hover:bg-emerald-100 rounded-lg text-emerald-600 shrink-0" title="复制"><Copy size={14} /></button>
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
                <div className="flex-1 overflow-auto p-5 min-h-0 border-r border-slate-200 markdown-body text-slate-700">
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
                <div className="flex-1 overflow-auto p-5 min-h-0">
                  <MarkdownWithHighlight content={compareModal.recipeContent} stripFrontmatter />
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 对话式润色面板 ── */}
      {refinePanel && effectiveTarget && data?.candidates?.[effectiveTarget] && (
        <RefineChatPanel
          candidateIds={refinePanel.candidateIds}
          candidates={data.candidates[effectiveTarget].items}
          onClose={() => setRefinePanel(null)}
          onCandidateUpdated={handleCandidateUpdated}
        />
      )}
    </div>
  );
};

export default CandidatesView;
