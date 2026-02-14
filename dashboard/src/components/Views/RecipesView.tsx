import React, { useState, useEffect, useRef } from 'react';
import { Edit3, Trash2, Tag, BookOpen, Shield, Lightbulb, FileText, FileCode, X, BookOpenCheck, ChevronLeft, ChevronRight, Eye, Save, Loader2, Link2, Plus, Search, ArrowUpDown, ArrowUp, ArrowDown, Maximize2, Minimize2 } from 'lucide-react';
import { useDrawerWide } from '../../hooks/useDrawerWide';
import { Recipe } from '../../types';
import { categoryConfigs } from '../../constants';
import Pagination from '../Shared/Pagination';
import MarkdownWithHighlight from '../Shared/MarkdownWithHighlight';
import HighlightedCodeEditor from '../Shared/HighlightedCodeEditor';
import api from '../../api';
import { notify } from '../../utils/notification';
import { ICON_SIZES } from '../../constants/icons';
import PageOverlay from '../Shared/PageOverlay';

const kindConfig: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ElementType }> = {
  rule: { label: 'Rule', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', icon: Shield },
  pattern: { label: 'Pattern', color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200', icon: Lightbulb },
  fact: { label: 'Fact', color: 'text-cyan-700', bg: 'bg-cyan-50', border: 'border-cyan-200', icon: BookOpen },
};

const statusConfig: Record<string, { color: string; bg: string; border: string }> = {
  active: { color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200' },
  published: { color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200' },
  draft: { color: 'text-slate-500', bg: 'bg-slate-50', border: 'border-slate-200' },
  archived: { color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
};

interface RecipesViewProps {
  recipes: Recipe[];
  openRecipeEdit: (recipe: Recipe) => void;
  handleDeleteRecipe: (name: string) => void;
  onRefresh?: () => void;
  currentPage?: number;
  onPageChange?: (page: number) => void;
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
}

/* ── Helpers ── */
function getDisplayName(recipe: Recipe) {
  return recipe.name || (recipe as any).title || 'Untitled';
}

function getContentStr(recipe: Recipe) {
  if (typeof recipe.content === 'string') return recipe.content;
  // API 偶尔返回对象格式的 content（V2 结构化数据）
  const obj = recipe.content as Record<string, string> | null;
  return obj?.pattern || obj?.markdown || JSON.stringify(recipe.content, null, 2);
}

function getPreviewText(recipe: Recipe) {
  const contentStr = getContentStr(recipe);
  return recipe.description
    || recipe.v2Content?.rationale
    || recipe.v2Content?.pattern
    || (typeof contentStr === 'string' ? contentStr : '');
}

/** 判断时间戳是否有效（非 0、非 null、不早于 2000 年） */
function isValidTimestamp(ts: string | number | null | undefined): boolean {
  if (ts == null) return false;
  const ms = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  // 946684800000 = 2000-01-01T00:00:00Z
  return !isNaN(ms) && ms > 946684800000;
}

function formatLastUsed(ts: string | number | null | undefined): string {
  if (!isValidTimestamp(ts)) return '从未使用';
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts as number);
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** 解析 YAML frontmatter + body */
function parseContent(content: string) {
  const lines = content.split('\n');
  const metadata: Record<string, string> = {};
  let bodyStartIndex = 0;
  let inYaml = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '---') {
      if (!inYaml && i === 0) { inYaml = true; continue; }
      else if (inYaml) { inYaml = false; bodyStartIndex = i + 1; break; }
    }
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)/);
    if (match) {
      metadata[match[1]] = match[2];
      if (!inYaml) bodyStartIndex = i + 1;
    } else if (!inYaml && line !== '') {
      bodyStartIndex = i; break;
    }
  }

  const body = lines.slice(bodyStartIndex).join('\n').trim();
  return { metadata, body };
}

const RecipesView: React.FC<RecipesViewProps> = ({
  recipes,
  // openRecipeEdit — editing is now handled inline in the drawer
  handleDeleteRecipe,
  onRefresh,
  currentPage: controlledPage,
  onPageChange: controlledOnPageChange,
  pageSize: controlledPageSize,
  onPageSizeChange: controlledOnPageSizeChange
}) => {
  /* ── Sorting ── */
  type SortKey = 'default' | 'name' | 'authorityScore' | 'authority' | 'totalUsage' | 'lastUsed' | 'category';
  type SortDir = 'asc' | 'desc';
  const [sortKey, setSortKey] = useState<SortKey>('default');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sortOptions: { key: SortKey; label: string; defaultDir: SortDir }[] = [
    { key: 'default', label: '默认', defaultDir: 'desc' },
    { key: 'authorityScore', label: '综合分', defaultDir: 'desc' },
    { key: 'authority', label: '权威分', defaultDir: 'desc' },
    { key: 'totalUsage', label: '使用次数', defaultDir: 'desc' },
    { key: 'lastUsed', label: '最近使用', defaultDir: 'desc' },
    { key: 'name', label: '名称', defaultDir: 'asc' },
    { key: 'category', label: '分类', defaultDir: 'asc' },
  ];

  const [internalPage, setInternalPage] = useState(1);
  const [internalPageSize, setInternalPageSize] = useState(12);
  const currentPage = controlledPage ?? internalPage;
  const pageSize = controlledPageSize ?? internalPageSize;
  const setCurrentPage = controlledOnPageChange ?? setInternalPage;
  const handlePageSizeChange = controlledOnPageSizeChange
    ? (size: number) => controlledOnPageSizeChange(size)
    : (size: number) => { setInternalPageSize(size); setInternalPage(1); };

  /* ── Detail Drawer ── */
  const { isWide: drawerWide, toggle: toggleDrawerWide } = useDrawerWide();
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [drawerMode, setDrawerMode] = useState<'view' | 'edit'>('view');
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const isMountedRef = useRef(true);

  /* ── Second-level (relation) Drawer ── */
  const [secondDrawerRecipe, setSecondDrawerRecipe] = useState<Recipe | null>(null);
  const [isAddingRelation, setIsAddingRelation] = useState(false);
  const [newRelationType, setNewRelationType] = useState('related');
  const [relationSearchQuery, setRelationSearchQuery] = useState('');

  useEffect(() => { return () => { isMountedRef.current = false; }; }, []);

  // Open drawer always in view mode; populate editContent
  const openDrawer = (recipe: Recipe) => {
    setSelectedRecipe(recipe);
    setDrawerMode('view');
    setEditContent(getContentStr(recipe));
    setSecondDrawerRecipe(null);
    setIsAddingRelation(false);
    setRelationSearchQuery('');
  };

  const closeDrawer = () => {
    setSelectedRecipe(null);
    setDrawerMode('view');
    setSecondDrawerRecipe(null);
    setIsAddingRelation(false);
    setRelationSearchQuery('');
  };

  const handleSaveInDrawer = async () => {
    if (!selectedRecipe || isSaving) return;
    setIsSaving(true);
    try {
      await api.saveRecipe(selectedRecipe.name, editContent);
      if (isMountedRef.current) {
        setDrawerMode('view');
        onRefresh?.();
      }
    } catch (err: any) {
      alert(err?.message || '保存 Recipe 失败');
    } finally {
      if (isMountedRef.current) setIsSaving(false);
    }
  };

  const handleSetAuthority = async (authority: number) => {
    if (!selectedRecipe) return;
    try {
      await api.setRecipeAuthority(selectedRecipe.name, authority);
      onRefresh?.();
    } catch (err: any) {
      notify(err?.message || '设置权威分失败', { type: 'error' });
    }
  };

  /* ── Relation management ── */
  const RELATION_TYPES = [
    { key: 'related', label: '关联', icon: '∼' },
    { key: 'dependsOn', label: '依赖', icon: '⊕' },
    { key: 'inherits', label: '继承', icon: '↑' },
    { key: 'implements', label: '实现', icon: '◇' },
    { key: 'calls', label: '调用', icon: '→' },
    { key: 'dataFlow', label: '数据流', icon: '⇢' },
    { key: 'conflicts', label: '冲突', icon: '✕' },
    { key: 'extends', label: '扩展', icon: '⊃' },
  ];

  const findRecipeByName = (name: string): Recipe | undefined => {
    const normalized = name.replace(/\.md$/i, '').toLowerCase();
    return recipes.find(r => {
      const rName = getDisplayName(r).replace(/\.md$/i, '').toLowerCase();
      return rName === normalized;
    });
  };

  const openSecondDrawer = (name: string) => {
    const found = findRecipeByName(name);
    if (found) setSecondDrawerRecipe(found);
  };

  const closeSecondDrawer = () => setSecondDrawerRecipe(null);

  const handleAddRelation = async (type: string, targetName: string) => {
    if (!selectedRecipe) return;
    const currentRelations: Record<string, any[]> = {};
    if (selectedRecipe.relations) {
      for (const [k, v] of Object.entries(selectedRecipe.relations)) {
        currentRelations[k] = [...v];
      }
    }
    const existing = currentRelations[type] || [];
    const targetId = targetName.replace(/\.md$/i, '');
    if (existing.some((r: any) => {
      const id = typeof r === 'string' ? r : r.id || r.title || '';
      return id.replace(/\.md$/i, '').toLowerCase() === targetId.toLowerCase();
    })) return;
    currentRelations[type] = [...existing, targetId];
    try {
      await api.updateRecipeRelations(selectedRecipe.name, currentRelations);
      setSelectedRecipe({ ...selectedRecipe, relations: currentRelations });
      setIsAddingRelation(false);
      setRelationSearchQuery('');
      onRefresh?.();
    } catch (err: any) {
      alert(err?.message || '添加关联失败');
    }
  };

  const handleRemoveRelation = async (type: string, targetName: string) => {
    if (!selectedRecipe) return;
    const currentRelations: Record<string, any[]> = {};
    if (selectedRecipe.relations) {
      for (const [k, v] of Object.entries(selectedRecipe.relations)) {
        currentRelations[k] = [...v];
      }
    }
    const existing = currentRelations[type] || [];
    currentRelations[type] = existing.filter((r: any) => {
      const id = typeof r === 'string' ? r : r.id || r.title || '';
      return id.replace(/\.md$/i, '').toLowerCase() !== targetName.replace(/\.md$/i, '').toLowerCase();
    });
    if (currentRelations[type].length === 0) delete currentRelations[type];
    try {
      await api.updateRecipeRelations(selectedRecipe.name, currentRelations);
      setSelectedRecipe({ ...selectedRecipe, relations: currentRelations });
      onRefresh?.();
    } catch (err: any) {
      alert(err?.message || '移除关联失败');
    }
  };

  // Close drawer if selected recipe is deleted
  useEffect(() => {
    if (selectedRecipe && !recipes.find(r => getDisplayName(r) === getDisplayName(selectedRecipe))) {
      closeDrawer();
    }
  }, [recipes, selectedRecipe]);

  // Reset page when recipes list changes
  useEffect(() => {
    if (controlledPage == null) setInternalPage(1);
  }, [recipes.length, controlledPage]);

  /* ── Sort recipes before pagination ── */
  const sortedRecipes = React.useMemo(() => {
    if (sortKey === 'default') return recipes;
    const arr = [...recipes];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let va: number | string = 0, vb: number | string = 0;
      switch (sortKey) {
        case 'name':
          va = getDisplayName(a).toLowerCase();
          vb = getDisplayName(b).toLowerCase();
          return dir * (va < vb ? -1 : va > vb ? 1 : 0);
        case 'authorityScore':
          va = a.stats?.authorityScore ?? -1;
          vb = b.stats?.authorityScore ?? -1;
          break;
        case 'authority':
          va = a.stats?.authority ?? -1;
          vb = b.stats?.authority ?? -1;
          break;
        case 'totalUsage':
          va = (a.stats?.guardUsageCount ?? 0) + (a.stats?.humanUsageCount ?? 0) + (a.stats?.aiUsageCount ?? 0);
          vb = (b.stats?.guardUsageCount ?? 0) + (b.stats?.humanUsageCount ?? 0) + (b.stats?.aiUsageCount ?? 0);
          break;
        case 'lastUsed': {
          const ta = a.stats?.lastUsedAt ? new Date(a.stats.lastUsedAt).getTime() : 0;
          const tb = b.stats?.lastUsedAt ? new Date(b.stats.lastUsedAt).getTime() : 0;
          va = isNaN(ta) ? 0 : ta;
          vb = isNaN(tb) ? 0 : tb;
          break;
        }
        case 'category':
          va = (a.category || '').toLowerCase();
          vb = (b.category || '').toLowerCase();
          return dir * (va < vb ? -1 : va > vb ? 1 : 0);
      }
      return dir * ((va as number) - (vb as number));
    });
    return arr;
  }, [recipes, sortKey, sortDir]);

  const totalPages = Math.ceil(sortedRecipes.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedRecipes = sortedRecipes.slice(startIndex, startIndex + pageSize);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /* ── Drawer navigation ── */
  const currentIndex = selectedRecipe ? sortedRecipes.findIndex(r => getDisplayName(r) === getDisplayName(selectedRecipe)) : -1;
  const goToPrev = () => {
    if (currentIndex > 0) setSelectedRecipe(sortedRecipes[currentIndex - 1]);
  };
  const goToNext = () => {
    if (currentIndex < sortedRecipes.length - 1) setSelectedRecipe(sortedRecipes[currentIndex + 1]);
  };

  return (
    <div className="relative">
      {/* ── Empty state ── */}
      {recipes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <BookOpenCheck size={48} className="text-slate-200 mb-4" />
          <p className="font-medium text-slate-600 mb-1">暂无 Recipe</p>
          <p className="text-sm text-slate-400">通过 SPM 扫描或手动创建来添加知识条目</p>
        </div>
      ) : (
        <>
        {/* ── Sort bar ── */}
        <div className="flex items-center gap-2 mb-4 text-xs">
          <ArrowUpDown size={14} className="text-slate-400 shrink-0" />
          {sortOptions.map(opt => {
            const active = sortKey === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => {
                  if (active) {
                    setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                  } else {
                    setSortKey(opt.key);
                    setSortDir(opt.defaultDir);
                  }
                  setCurrentPage(1);
                }}
                className={`px-2 py-1 rounded-md flex items-center gap-0.5 transition-colors ${
                  active
                    ? 'bg-blue-50 text-blue-700 font-medium border border-blue-200'
                    : 'text-slate-500 hover:bg-slate-100 border border-transparent'
                }`}
              >
                {opt.label}
                {active && sortKey !== 'default' && (
                  sortDir === 'asc'
                    ? <ArrowUp size={12} />
                    : <ArrowDown size={12} />
                )}
              </button>
            );
          })}
        </div>
        {/* ── Card grid ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {paginatedRecipes.map((recipe) => {
            const displayName = getDisplayName(recipe);
            const contentStr = getContentStr(recipe);
            const previewText = getPreviewText(recipe);
            const kc = recipe.kind ? kindConfig[recipe.kind] : null;
            const KindIcon = kc?.icon || FileText;
            const sc = statusConfig[recipe.status || ''] || null;
            const isSelected = selectedRecipe && getDisplayName(selectedRecipe) === displayName;
            return (
              <div
                key={displayName}
                onClick={() => openDrawer(recipe)}
                className={`bg-white p-6 rounded-xl border shadow-sm hover:shadow-md transition-all group relative cursor-pointer ${
                  isSelected ? 'border-blue-300 ring-1 ring-blue-200' : 'border-slate-200'
                }`}
              >
                {/* Hover actions */}
                <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <button onClick={(e) => { e.stopPropagation(); setSelectedRecipe(recipe); setDrawerMode('edit'); setEditContent(getContentStr(recipe)); }} className="p-1.5 bg-slate-50 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors" title="编辑"><Edit3 size={ICON_SIZES.sm} /></button>
                  <button onClick={(e) => { e.stopPropagation(); handleDeleteRecipe(recipe.name || (recipe as any).id); }} className="p-1.5 bg-slate-50 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors" title="删除"><Trash2 size={ICON_SIZES.sm} /></button>
                </div>

                {/* Title + badges */}
                <div className="flex justify-between items-start mb-2 pr-12 gap-2">
                  <h3 className="font-bold text-slate-900 break-words min-w-0">{displayName}</h3>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {kc && (
                      <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase flex items-center gap-1 border ${kc.bg} ${kc.color} ${kc.border}`}>
                        <KindIcon size={ICON_SIZES.xs} />{kc.label}
                      </span>
                    )}
                    {(() => {
                      const category = recipe.category || (typeof contentStr === 'string' ? contentStr.match(/category:\s*(.*)/)?.[1]?.trim() : null) || 'Utility';
                      const config = categoryConfigs[category] || categoryConfigs.Utility;
                      const Icon = config.icon;
                      return (
                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase flex items-center gap-1 border ${config.bg} ${config.color} ${config.border}`}>
                          <Icon size={ICON_SIZES.xs} />
                          {category}
                        </span>
                      );
                    })()}
                    {sc && recipe.status !== 'active' && recipe.status !== 'published' && (
                      <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase border ${sc.bg} ${sc.color} ${sc.border}`}>
                        {recipe.status}
                      </span>
                    )}
                    {typeof contentStr === 'string' && contentStr.includes('type: preview') && (
                      <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-bold uppercase">Preview Only</span>
                    )}
                  </div>
                </div>

                {/* Metadata row */}
                {(recipe.knowledgeType || recipe.language || (recipe.tags && recipe.tags.length > 0)) && (
                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    {recipe.knowledgeType && (
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100">
                        {recipe.knowledgeType}
                      </span>
                    )}
                    {recipe.language && (
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 uppercase">
                        {recipe.language}
                      </span>
                    )}
                    {recipe.tags && recipe.tags.length > 0 && recipe.tags.slice(0, 4).map((tag, i) => (
                      <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100 flex items-center gap-0.5">
                        <Tag size={8} />{tag}
                      </span>
                    ))}
                    {recipe.tags && recipe.tags.length > 4 && (
                      <span className="text-[9px] text-slate-400">+{recipe.tags.length - 4}</span>
                    )}
                  </div>
                )}

                {/* Stats row */}
                <div className="flex flex-wrap items-center gap-2 mb-2 text-[10px] text-slate-500">
                  <span>权威 {recipe.stats != null ? recipe.stats.authority : '—'}</span>
                  <span>·</span>
                  <span>
                    {recipe.stats != null
                      ? `g:${recipe.stats.guardUsageCount} h:${recipe.stats.humanUsageCount} a:${recipe.stats.aiUsageCount}`
                      : 'g:0 h:0 a:0'}
                  </span>
                  <span>·</span>
                  <span>综合分 {recipe.stats?.authorityScore != null ? recipe.stats.authorityScore.toFixed(2) : '—'}</span>
                  <span>·</span>
                  <span>最近 {formatLastUsed(recipe.stats?.lastUsedAt)}</span>
                </div>

                {/* Content preview */}
                <div className="text-xs text-slate-500 bg-slate-50 p-4 rounded-lg overflow-hidden line-clamp-4 font-mono whitespace-pre-wrap">{previewText}</div>

                {/* Relations / Constraints summary */}
                {(recipe.relations || recipe.constraints) && (
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {recipe.relations && Object.entries(recipe.relations).some(([, v]) => Array.isArray(v) && v.length > 0) && (
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 border border-purple-100">
                        关系 {Object.values(recipe.relations).flat().length}
                      </span>
                    )}
                    {recipe.constraints && (
                      (() => {
                        const count = (recipe.constraints.guards?.length || 0) + (recipe.constraints.boundaries?.length || 0) + (recipe.constraints.preconditions?.length || 0) + (recipe.constraints.sideEffects?.length || 0);
                        return count > 0 ? (
                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-100">
                            约束 {count}
                          </span>
                        ) : null;
                      })()
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </>
      )}

      {recipes.length > 0 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={sortedRecipes.length}
          pageSize={pageSize}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
        />
      )}

      {/* ── Detail Drawer ── */}
      {selectedRecipe && (() => {
        const recipe = selectedRecipe;
        const displayName = getDisplayName(recipe);
        const contentStr = getContentStr(recipe);
        const kc = recipe.kind ? kindConfig[recipe.kind] : null;
        const KindIcon = kc?.icon || FileText;
        const sc = statusConfig[recipe.status || ''] || null;
        const category = recipe.category || (typeof contentStr === 'string' ? contentStr.match(/category:\s*(.*)/)?.[1]?.trim() : null) || 'Utility';
        const catConfig = categoryConfigs[category] || categoryConfigs.Utility;
        const CatIcon = catConfig.icon;
        const { metadata, body } = parseContent(contentStr);

        return (
          <PageOverlay className="z-30 flex justify-end" onClick={() => { closeDrawer(); }}>
            <PageOverlay.Backdrop />

            {/* ── 关联 Recipe 侧抽屉（贴在详情抽屉左侧） ── */}
            {secondDrawerRecipe && (() => {
              const sr = secondDrawerRecipe;
              const srName = getDisplayName(sr);
              const srContent = getContentStr(sr);
              const srKc = sr.kind ? kindConfig[sr.kind] : null;
              const SrKindIcon = srKc?.icon || FileText;
              const srCategory = sr.category || (typeof srContent === 'string' ? srContent.match(/category:\s*(.*)/)?.[1]?.trim() : null) || 'Utility';
              const srCatConfig = categoryConfigs[srCategory] || categoryConfigs.Utility;
              const SrCatIcon = srCatConfig.icon;
              const { metadata: srMeta, body: srBody } = parseContent(srContent);

              return (
                <div
                  className={`relative h-full bg-white shadow-2xl flex flex-col border-r border-slate-200 ${drawerWide ? 'w-[720px] max-w-[50vw]' : 'w-[520px] max-w-[40vw]'}`}
                  style={{ animation: 'slideInRight 0.2s ease-out' }}
                  onClick={e => e.stopPropagation()}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-purple-50/50 shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <Link2 size={14} className="text-purple-400 shrink-0" />
                      <h3 className="font-bold text-slate-800 text-sm leading-snug break-words min-w-0">{srName.replace(/\.md$/i, '')}</h3>
                    </div>
                    <button onClick={closeSecondDrawer} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors shrink-0" title="关闭">
                      <X size={14} />
                    </button>
                  </div>

                  {/* Content */}
                  <div className="flex-1 overflow-y-auto">
                    {/* Badges */}
                    <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
                      {srKc && (
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase flex items-center gap-1 border ${srKc.bg} ${srKc.color} ${srKc.border}`}>
                          <SrKindIcon size={ICON_SIZES.xs} />{srKc.label}
                        </span>
                      )}
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase flex items-center gap-1 border ${srCatConfig.bg} ${srCatConfig.color} ${srCatConfig.border}`}>
                        <SrCatIcon size={ICON_SIZES.xs} />{srCategory}
                      </span>
                      {sr.language && (
                        <span className="text-[9px] font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-500 uppercase">{sr.language}</span>
                      )}
                      {sr.knowledgeType && (
                        <span className="text-[9px] font-medium px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100">{sr.knowledgeType}</span>
                      )}
                    </div>

                    {/* Tags */}
                    {sr.tags && sr.tags.length > 0 && (
                      <div className="px-5 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-1.5">
                        {sr.tags.map((tag, i) => (
                          <span key={i} className="text-[9px] px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100 flex items-center gap-0.5">
                            <Tag size={8} />{tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Stats row */}
                    <div className="px-5 py-3 border-b border-slate-100">
                      <div className="grid grid-cols-4 gap-2">
                        <div className="bg-slate-50 rounded-lg p-2 text-center">
                          <div className="text-sm font-bold text-slate-800">{sr.stats?.authority ?? '—'}</div>
                          <div className="text-[8px] text-slate-400 font-medium">权威</div>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2 text-center">
                          <div className="text-sm font-bold text-slate-800">{sr.stats?.authorityScore != null ? sr.stats.authorityScore.toFixed(1) : '—'}</div>
                          <div className="text-[8px] text-slate-400 font-medium">综合分</div>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2 text-center">
                          <div className="text-sm font-bold text-slate-800">
                            {sr.stats != null ? (sr.stats.guardUsageCount + sr.stats.humanUsageCount + sr.stats.aiUsageCount) : 0}
                          </div>
                          <div className="text-[8px] text-slate-400 font-medium">总使用</div>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2 text-center">
                          <div className="text-[10px] font-bold text-slate-800">{formatLastUsed(sr.stats?.lastUsedAt)}</div>
                          <div className="text-[8px] text-slate-400 font-medium">最近使用</div>
                        </div>
                      </div>
                    </div>

                    {/* Description */}
                    {sr.description && (
                      <div className="px-5 py-3 border-b border-slate-100">
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 block">描述</label>
                        <p className="text-xs text-slate-600 leading-relaxed">{sr.description}</p>
                      </div>
                    )}

                    {/* Metadata */}
                    {Object.keys(srMeta).length > 0 && (
                      <div className="px-5 py-3 border-b border-slate-100">
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">元数据</label>
                        <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                          {Object.entries(srMeta).filter(([k]) => !['tags', 'headers', 'summary_cn', 'summary_en', 'summary'].includes(k)).map(([key, value]) => {
                            let displayValue = value;
                            if (key === 'updatedAt' || key === 'createdAt') {
                              const ts = parseInt(value, 10);
                              if (!isNaN(ts) && ts > 946684800000) {
                                displayValue = new Date(ts).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                              }
                            }
                            return (
                              <div key={key} className="flex flex-col">
                                <span className="text-[9px] text-slate-400 font-bold uppercase">{key}</span>
                                <span className="text-[10px] text-slate-700 break-all font-medium">{displayValue}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Content body */}
                    <div className="px-5 py-4">
                      <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">内容</label>
                      {srBody ? (
                        <div className="markdown-body text-slate-700 text-xs">
                          <MarkdownWithHighlight content={srBody} showLineNumbers />
                        </div>
                      ) : (
                        <div className="text-xs text-slate-300 italic py-6 text-center">暂无正文内容</div>
                      )}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="px-4 py-2 border-t border-slate-200 flex items-center justify-between shrink-0 bg-slate-50">
                    <span className="text-[10px] text-slate-400">关联 Recipe 预览</span>
                    <button
                      onClick={() => { openDrawer(sr); }}
                      className="text-[10px] px-3 py-1 bg-blue-600 text-white rounded font-bold hover:bg-blue-700 flex items-center gap-1"
                    >
                      <Eye size={10} /> 打开完整视图
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Drawer */}
            <div
              className={`relative h-full bg-white shadow-2xl flex flex-col ${drawerWide ? 'w-[min(92vw,1100px)]' : 'w-[min(92vw,800px)]'}`}
              style={{ animation: 'slideInRight 0.25s ease-out' }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
                <div className="flex-1 min-w-0 mr-3">
                  <h3 className="font-bold text-slate-800 text-lg leading-snug break-words">{displayName}</h3>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {/* Prev / Next */}
                  <button onClick={goToPrev} disabled={currentIndex <= 0} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title="上一条"><ChevronLeft size={ICON_SIZES.md} /></button>
                  <span className="text-xs text-slate-400 tabular-nums">{currentIndex + 1}/{recipes.length}</span>
                  <button onClick={goToNext} disabled={currentIndex >= recipes.length - 1} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title="下一条"><ChevronRight size={ICON_SIZES.md} /></button>
                  <div className="w-px h-5 bg-slate-200 mx-1" />
                  {/* View/Edit toggle */}
                  <div className="flex bg-slate-100 p-0.5 rounded-lg mr-1">
                    <button
                      onClick={() => setDrawerMode('view')}
                      className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1 ${drawerMode === 'view' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      <Eye size={ICON_SIZES.sm} /> 预览
                    </button>
                    <button
                      onClick={() => { setDrawerMode('edit'); setEditContent(getContentStr(recipe)); }}
                      className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1 ${drawerMode === 'edit' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      <Edit3 size={ICON_SIZES.sm} /> 编辑
                    </button>
                  </div>
                  <button
                    onClick={toggleDrawerWide}
                    className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-400"
                    title={drawerWide ? '收窄面板' : '展开更宽'}
                  >
                    {drawerWide ? <Minimize2 size={ICON_SIZES.md} /> : <Maximize2 size={ICON_SIZES.md} />}
                  </button>
                  <button
                    onClick={() => { handleDeleteRecipe(recipe.name || (recipe as any).id); closeDrawer(); }}
                    className="p-1.5 hover:bg-red-50 rounded-lg text-red-500 transition-colors"
                    title="删除"
                  >
                    <Trash2 size={ICON_SIZES.md} />
                  </button>
                  <button onClick={closeDrawer} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
                    <X size={ICON_SIZES.md} />
                  </button>
                </div>
              </div>

              {drawerMode === 'edit' ? (
                /* ═══ Edit mode ═══ */
                <>
                  <div className="flex-1 flex flex-col min-h-0 p-4">
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Markdown 内容</label>
                    <div className="flex-1 min-h-0">
                      <HighlightedCodeEditor
                        value={editContent}
                        onChange={setEditContent}
                        language="markdown"
                        height="100%"
                        showLineNumbers
                      />
                    </div>
                  </div>
                  <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">权威分</span>
                      <select
                        className="font-bold text-amber-600 bg-amber-50 border border-amber-100 px-2 py-1 rounded-lg outline-none text-[10px] focus:ring-2 focus:ring-amber-500"
                        value={recipe.stats?.authority ?? 3}
                        onChange={e => handleSetAuthority(parseInt(e.target.value))}
                      >
                        <option value="1">⭐ 1</option>
                        <option value="2">⭐⭐ 2</option>
                        <option value="3">⭐⭐⭐ 3</option>
                        <option value="4">⭐⭐⭐⭐ 4</option>
                        <option value="5">⭐⭐⭐⭐⭐ 5</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setDrawerMode('view')} disabled={isSaving} className="px-4 py-1.5 text-sm text-slate-600 font-medium rounded-lg hover:bg-slate-50">取消</button>
                      <button onClick={handleSaveInDrawer} disabled={isSaving} className="px-5 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg flex items-center gap-1.5 hover:bg-blue-700 disabled:opacity-60">
                        {isSaving ? <Loader2 size={ICON_SIZES.sm} className="animate-spin" /> : <Save size={ICON_SIZES.sm} />}
                        {isSaving ? '保存中...' : '保存'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                /* ═══ View mode ═══ */
                <div className="flex-1 overflow-y-auto">
                  {/* Badge row */}
                  <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
                    {kc && (
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase flex items-center gap-1 border ${kc.bg} ${kc.color} ${kc.border}`}>
                        <KindIcon size={ICON_SIZES.xs} />{kc.label}
                      </span>
                    )}
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase flex items-center gap-1 border ${catConfig.bg} ${catConfig.color} ${catConfig.border}`}>
                      <CatIcon size={ICON_SIZES.xs} />
                      {category}
                    </span>
                    {sc && (
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase border ${sc.bg} ${sc.color} ${sc.border}`}>
                        {recipe.status}
                      </span>
                    )}
                    {recipe.knowledgeType && (
                      <span className="text-[9px] font-medium px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100">
                        {recipe.knowledgeType}
                      </span>
                    )}
                    {recipe.language && (
                      <span className="text-[9px] font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-500 uppercase">
                        {recipe.language}
                      </span>
                    )}
                    {recipe.trigger && (
                      <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">
                        {recipe.trigger}
                      </span>
                    )}
                  </div>

                  {/* Tags */}
                  {recipe.tags && recipe.tags.length > 0 && (
                    <div className="px-5 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-1.5">
                      {recipe.tags.map((tag, i) => (
                        <span key={i} className="text-[9px] px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100 flex items-center gap-0.5">
                          <Tag size={8} />{tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Stats */}
                  <div className="px-5 py-3 border-b border-slate-100">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="bg-slate-50 rounded-lg p-3 text-center">
                        <div className="text-lg font-bold text-slate-800">{recipe.stats?.authority ?? '—'}</div>
                        <div className="text-[10px] text-slate-400 font-medium">权威</div>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-3 text-center">
                        <div className="text-lg font-bold text-slate-800">{recipe.stats?.authorityScore != null ? recipe.stats.authorityScore.toFixed(1) : '—'}</div>
                        <div className="text-[10px] text-slate-400 font-medium">综合分</div>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-3 text-center">
                        <div className="text-lg font-bold text-slate-800">
                          {recipe.stats != null
                            ? (recipe.stats.guardUsageCount + recipe.stats.humanUsageCount + recipe.stats.aiUsageCount)
                            : 0}
                        </div>
                        <div className="text-[10px] text-slate-400 font-medium">总使用</div>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-3 text-center">
                        <div className="text-sm font-bold text-slate-800">{formatLastUsed(recipe.stats?.lastUsedAt)}</div>
                        <div className="text-[10px] text-slate-400 font-medium">最近使用</div>
                      </div>
                    </div>
                    {recipe.stats != null && (
                      <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-400">
                        <span>Guard: {recipe.stats.guardUsageCount}</span>
                        <span>Human: {recipe.stats.humanUsageCount}</span>
                        <span>AI: {recipe.stats.aiUsageCount}</span>
                      </div>
                    )}
                  </div>

                  {/* Parsed Metadata (from frontmatter) */}
                  {Object.keys(metadata).length > 0 && (
                    <div className="px-5 py-3 border-b border-slate-100">
                      <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">元数据</label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2.5 gap-x-6">
                        {Object.entries(metadata).filter(([k]) => !['tags', 'headers', 'summary_cn', 'summary_en', 'summary', 'usageGuide', 'usageGuide_cn', 'usageGuide_en'].includes(k)).map(([key, value]) => {
                          let displayValue = value;
                          if (key === 'updatedAt' || key === 'createdAt') {
                            const ts = parseInt(value, 10);
                            if (!isNaN(ts) && ts > 946684800000) {
                              displayValue = new Date(ts).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                            }
                          }
                          return (
                            <div key={key} className="flex flex-col">
                              <span className="text-[9px] text-slate-400 font-bold uppercase">{key}</span>
                              <span className="text-xs text-slate-700 break-all font-medium">{displayValue}</span>
                            </div>
                          );
                        })}
                      </div>
                      {/* Headers */}
                      {metadata.headers && (
                        <div className="mt-2.5">
                          <span className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Headers</span>
                          <div className="flex flex-wrap gap-1.5">
                            {(() => {
                              try {
                                const parsed = JSON.parse(metadata.headers);
                                return (Array.isArray(parsed) ? parsed : [metadata.headers]).map((h: string, i: number) => (
                                  <code key={i} className="px-2 py-0.5 bg-violet-50 text-violet-700 border border-violet-100 rounded text-[10px] font-mono">{h}</code>
                                ));
                              } catch {
                                return <code className="text-xs text-slate-700 font-mono">{metadata.headers}</code>;
                              }
                            })()}
                          </div>
                        </div>
                      )}
                      {/* Summary */}
                      {(metadata.summary_cn || metadata.summary) && (
                        <div className="mt-2.5">
                          <span className="text-[9px] text-slate-400 font-bold uppercase block mb-1">摘要</span>
                          <p className="text-xs text-slate-600 leading-relaxed">{metadata.summary_cn || metadata.summary}</p>
                        </div>
                      )}
                      {metadata.summary_en && (
                        <div className="mt-2">
                          <span className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Summary (EN)</span>
                          <p className="text-xs text-slate-600 leading-relaxed">{metadata.summary_en}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Relations (always shown for adding) ── */}
                  <div className="px-5 py-3 border-b border-slate-100">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <Link2 size={12} className="text-purple-400" />
                        <label className="text-[10px] font-bold text-slate-400 uppercase">关联 Recipes</label>
                        {(() => {
                          const total = recipe.relations ? Object.values(recipe.relations).flat().length : 0;
                          return total > 0 ? <span className="text-[9px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full font-bold">{total}</span> : null;
                        })()}
                      </div>
                      <button
                        onClick={() => { setIsAddingRelation(!isAddingRelation); setRelationSearchQuery(''); }}
                        className={`text-[9px] px-2 py-0.5 rounded font-bold flex items-center gap-1 transition-colors ${
                          isAddingRelation ? 'bg-slate-200 text-slate-600 hover:bg-slate-300' : 'bg-purple-500 text-white hover:bg-purple-600'
                        }`}
                      >
                        {isAddingRelation ? <><X size={10} /> 取消</> : <><Plus size={10} /> 添加关联</>}
                      </button>
                    </div>

                    {/* Add-relation panel */}
                    {isAddingRelation && (
                      <div className="mb-3 bg-purple-50/80 border border-purple-200 rounded-lg p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <select
                            value={newRelationType}
                            onChange={e => setNewRelationType(e.target.value)}
                            className="text-[10px] font-bold bg-white border border-purple-200 text-purple-700 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-purple-400"
                          >
                            {RELATION_TYPES.map(t => (
                              <option key={t.key} value={t.key}>{t.icon} {t.label}</option>
                            ))}
                          </select>
                          <div className="flex-1 relative">
                            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-300" />
                            <input
                              type="text"
                              placeholder="搜索 Recipe 名称..."
                              value={relationSearchQuery}
                              onChange={e => setRelationSearchQuery(e.target.value)}
                              className="w-full text-xs bg-white border border-purple-200 rounded pl-7 pr-2 py-1 outline-none focus:ring-1 focus:ring-purple-400"
                              autoFocus
                            />
                          </div>
                        </div>
                        {relationSearchQuery.length > 0 && (
                          <div className="max-h-36 overflow-y-auto rounded border border-purple-100 bg-white divide-y divide-slate-100">
                            {(() => {
                              const filtered = recipes.filter(r => {
                                if (getDisplayName(r) === displayName) return false;
                                const name = getDisplayName(r).toLowerCase();
                                return name.includes(relationSearchQuery.toLowerCase());
                              }).slice(0, 10);
                              if (filtered.length === 0) return (
                                <div className="text-xs text-slate-400 py-3 text-center">未找到匹配的 Recipe</div>
                              );
                              return filtered.map(r => {
                                const rName = getDisplayName(r);
                                const alreadyLinked = recipe.relations && Object.values(recipe.relations).flat().some((rel: any) => {
                                  const id = typeof rel === 'string' ? rel : rel.id || rel.title || '';
                                  return id.replace(/\.md$/i, '').toLowerCase() === rName.replace(/\.md$/i, '').toLowerCase();
                                });
                                return (
                                  <div
                                    key={rName}
                                    className={`flex items-center justify-between px-3 py-1.5 text-xs transition-colors ${
                                      alreadyLinked ? 'bg-slate-50 text-slate-400' : 'hover:bg-purple-50 cursor-pointer'
                                    }`}
                                    onClick={() => !alreadyLinked && handleAddRelation(newRelationType, rName)}
                                  >
                                    <span className="font-medium truncate mr-2">{rName.replace(/\.md$/i, '')}</span>
                                    {alreadyLinked
                                      ? <span className="text-[9px] text-slate-400 font-bold shrink-0">已关联</span>
                                      : <span className="text-[9px] text-purple-600 font-bold shrink-0">+ 添加</span>
                                    }
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Existing relations */}
                    {recipe.relations && Object.entries(recipe.relations).some(([, v]) => Array.isArray(v) && v.length > 0) ? (
                      <div className="space-y-1.5">
                        {RELATION_TYPES.map(({ key, label, icon }) => {
                          const items = recipe.relations?.[key];
                          if (!items || !Array.isArray(items) || items.length === 0) return null;
                          return (
                            <div key={key} className="flex items-start gap-2">
                              <span className="text-[10px] font-mono text-slate-500 w-14 shrink-0 pt-0.5">{icon} {label}</span>
                              <div className="flex flex-wrap gap-1">
                                {items.map((r: any, ri: number) => {
                                  const itemName = typeof r === 'string' ? r : r.id || r.title || JSON.stringify(r);
                                  const canNavigate = !!findRecipeByName(itemName);
                                  return (
                                    <span
                                      key={ri}
                                      className={`group/rel inline-flex items-center gap-1 px-1.5 py-0.5 border rounded text-[10px] font-mono transition-colors ${
                                        canNavigate
                                          ? 'bg-purple-50 border-purple-200 text-purple-700 cursor-pointer hover:bg-purple-100 hover:border-purple-300'
                                          : 'bg-white border-slate-200 text-slate-600'
                                      }`}
                                      onClick={() => canNavigate && openSecondDrawer(itemName)}
                                      title={canNavigate ? '点击查看详情' : itemName}
                                    >
                                      {itemName.replace(/\.md$/i, '')}
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleRemoveRelation(key, itemName); }}
                                        className="opacity-0 group-hover/rel:opacity-100 text-red-400 hover:text-red-600 transition-opacity ml-0.5"
                                        title="移除关联"
                                      >
                                        <X size={10} />
                                      </button>
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      !isAddingRelation && (
                        <div className="text-xs text-slate-300 py-2 text-center">暂无关联，点击上方按钮添加</div>
                      )
                    )}
                  </div>

                  {/* ── Constraints ── */}
                  {recipe.constraints && (() => {
                    const c = recipe.constraints;
                    const hasData = (c.guards?.length || 0) + (c.boundaries?.length || 0) + (c.preconditions?.length || 0) + (c.sideEffects?.length || 0) > 0;
                    if (!hasData) return null;
                    return (
                      <div className="px-5 py-3 border-b border-slate-100">
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 block">约束条件</label>
                        <div className="space-y-1.5 text-xs text-slate-600">
                          {c.guards?.map((g, i) => (
                            <div key={i} className="flex gap-1.5 items-start">
                              <span className={`text-xs mt-0.5 ${g.severity === 'error' ? 'text-red-500' : 'text-yellow-500'}`}>●</span>
                              <code className="font-mono text-[10px] bg-slate-100 px-1 py-0.5 rounded">{g.pattern}</code>
                              {g.message && <span className="text-[10px] text-slate-400">— {g.message}</span>}
                            </div>
                          ))}
                          {c.boundaries?.map((b, i) => <div key={i} className="flex gap-1.5"><span className="text-orange-400">●</span>{b}</div>)}
                          {c.preconditions?.map((p, i) => <div key={i} className="flex gap-1.5"><span className="text-blue-400">◆</span>{p}</div>)}
                          {c.sideEffects?.map((s, i) => <div key={i} className="flex gap-1.5"><span className="text-pink-400">⚡</span>{s}</div>)}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Description — 仅当与摘要不重复时显示 */}
                  {recipe.description && recipe.description !== (metadata.summary_cn || metadata.summary || '') && (
                    <div className="px-5 py-3 border-b border-slate-100">
                      <label className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 block">描述</label>
                      <p className="text-sm text-slate-600 leading-relaxed">{recipe.description}</p>
                    </div>
                  )}

                  {/* Usage Guide — 使用指南（优先 recipe 对象，降级 frontmatter） */}
                  {(recipe.usageGuide || recipe.usageGuide_cn || metadata.usageGuide || metadata.usageGuide_cn || metadata.usageGuide_en) && (
                    <div className="px-5 py-3 border-b border-slate-100">
                      <label className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 block flex items-center gap-1.5">
                        <BookOpen size={11} className="text-blue-400" /> 使用指南
                      </label>
                      <div className="markdown-body text-sm text-slate-600">
                        <MarkdownWithHighlight content={recipe.usageGuide || recipe.usageGuide_cn || metadata.usageGuide || metadata.usageGuide_cn || ''} />
                      </div>
                      {(recipe.usageGuide_en || metadata.usageGuide_en) && (
                        <div className="mt-2 pt-2 border-t border-slate-100">
                          <span className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Usage Guide (EN)</span>
                          <div className="markdown-body text-sm text-slate-500">
                            <MarkdownWithHighlight content={recipe.usageGuide_en || metadata.usageGuide_en || ''} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* V2 Structured Content — 结构化内容 */}
                  {recipe.v2Content && (() => {
                    const v2 = recipe.v2Content;
                    // 判断 v2.pattern 是否与 body 内容重复（跳过重复的 pattern 显示）
                    const patternRedundant = v2.pattern && body && body.includes(v2.pattern.trim());
                    const hasV2 = v2.rationale || (v2.pattern && !patternRedundant) || (v2.steps && v2.steps.length > 0) || (v2.codeChanges && v2.codeChanges.length > 0) || v2.verification;
                    if (!hasV2) return null;
                    return (
                      <div className="px-5 py-3 border-b border-slate-100 space-y-3">
                        {/* Rationale */}
                        {v2.rationale && (
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">设计原理</label>
                            <p className="text-sm text-slate-600 leading-relaxed">{v2.rationale}</p>
                          </div>
                        )}

                        {/* Pattern — 仅当与 body 不重复时显示 */}
                        {v2.pattern && !patternRedundant && (
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">模式</label>
                            <div className="markdown-body text-sm text-slate-600">
                              <MarkdownWithHighlight content={v2.pattern} showLineNumbers />
                            </div>
                          </div>
                        )}

                        {/* Steps */}
                        {v2.steps && v2.steps.length > 0 && (
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 block">实施步骤</label>
                            <div className="space-y-2">
                              {v2.steps.map((step: any, i: number) => {
                                // Handle both string and object step formats
                                if (typeof step === 'string') {
                                  return (
                                    <div key={i} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                                      <div className="flex items-start gap-2">
                                        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                                        <p className="text-xs text-slate-700">{step}</p>
                                      </div>
                                    </div>
                                  );
                                }
                                const title = typeof step.title === 'string' ? step.title : '';
                                const desc  = typeof step.description === 'string' ? step.description : '';
                                const code  = typeof step.code === 'string' ? step.code : '';
                                return (
                                  <div key={i} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-[10px] font-bold text-blue-600 bg-blue-50 rounded-full w-5 h-5 flex items-center justify-center shrink-0">{i + 1}</span>
                                      {title && <span className="text-xs font-bold text-slate-700">{title}</span>}
                                    </div>
                                    {desc && <p className="text-xs text-slate-600 ml-7">{desc}</p>}
                                    {code && (
                                      <pre className="text-[11px] font-mono bg-slate-800 text-green-300 p-2 rounded mt-1 ml-7 overflow-x-auto whitespace-pre-wrap">{code}</pre>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Code Changes */}
                        {v2.codeChanges && v2.codeChanges.length > 0 && (
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 block">代码变更</label>
                            <div className="space-y-2">
                              {v2.codeChanges.map((change, i) => (
                                <div key={i} className="border border-slate-200 rounded-lg overflow-hidden">
                                  <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                                    <FileCode size={11} className="text-blue-400" />
                                    <code className="text-[10px] font-mono text-slate-600">{change.file}</code>
                                  </div>
                                  {change.explanation && <p className="text-[11px] text-slate-500 px-3 py-1.5 border-b border-slate-100 bg-yellow-50/30">{change.explanation}</p>}
                                  <div className="p-2 bg-red-50/30 border-b border-slate-100">
                                    <div className="text-[9px] font-bold text-red-400 mb-0.5 uppercase">Before</div>
                                    <pre className="text-[11px] text-slate-600 whitespace-pre-wrap break-words font-mono">{change.before || '(空)'}</pre>
                                  </div>
                                  <div className="p-2 bg-emerald-50/30">
                                    <div className="text-[9px] font-bold text-emerald-500 mb-0.5 uppercase">After</div>
                                    <pre className="text-[11px] text-slate-700 whitespace-pre-wrap break-words font-mono">{change.after}</pre>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Verification */}
                        {v2.verification && (
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">验证方法</label>
                            <div className="bg-teal-50/50 border border-teal-100 rounded-lg p-3 space-y-1.5">
                              {v2.verification.method && <p className="text-xs text-slate-600"><span className="font-bold text-teal-600">方法:</span> {v2.verification.method}</p>}
                              {v2.verification.expectedResult && <p className="text-xs text-slate-600"><span className="font-bold text-teal-600">预期结果:</span> {v2.verification.expectedResult}</p>}
                              {v2.verification.testCode && (
                                <pre className="text-[11px] font-mono bg-slate-800 text-green-300 p-2 rounded overflow-x-auto whitespace-pre-wrap mt-1">{v2.verification.testCode}</pre>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Full content body (markdown) - rendered from parsed body, not raw content */}
                  <div className="px-5 py-4">
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">内容</label>
                    {body ? (
                      <div className="markdown-body text-slate-700">
                        <MarkdownWithHighlight content={body} showLineNumbers />
                      </div>
                    ) : (
                      <div className="text-sm text-slate-300 italic py-8 text-center">暂无正文内容</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </PageOverlay>
        );
      })()}
    </div>
  );
};

export default RecipesView;