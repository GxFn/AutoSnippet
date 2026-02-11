import React, { useState, useEffect } from 'react';
import { Edit3, Trash2, Tag, BookOpen, Shield, Lightbulb, FileText } from 'lucide-react';
import { Recipe } from '../../types';
import { categoryConfigs } from '../../constants';
import Pagination from '../Shared/Pagination';
import { ICON_SIZES } from '../../constants/icons';

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
  /** 分页由父组件控制，刷新数据后保持当前页 */
  currentPage?: number;
  onPageChange?: (page: number) => void;
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
}

const RecipesView: React.FC<RecipesViewProps> = ({
  recipes,
  openRecipeEdit,
  handleDeleteRecipe,
  currentPage: controlledPage,
  onPageChange: controlledOnPageChange,
  pageSize: controlledPageSize,
  onPageSizeChange: controlledOnPageSizeChange
}) => {
  const [internalPage, setInternalPage] = useState(1);
  const [internalPageSize, setInternalPageSize] = useState(12);
  const currentPage = controlledPage ?? internalPage;
  const pageSize = controlledPageSize ?? internalPageSize;
  const setCurrentPage = controlledOnPageChange ?? setInternalPage;
  const handlePageSizeChange = controlledOnPageSizeChange
  ? (size: number) => controlledOnPageSizeChange(size)
  : (size: number) => { setInternalPageSize(size); setInternalPage(1); };

  // 仅在使用内部状态时：列表长度变化（如搜索/过滤）重置到第一页
  useEffect(() => {
  if (controlledPage == null) setInternalPage(1);
  }, [recipes.length, controlledPage]);

  const totalPages = Math.ceil(recipes.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedRecipes = recipes.slice(startIndex, startIndex + pageSize);

  const handlePageChange = (page: number) => {
  setCurrentPage(page);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
  <div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
    {paginatedRecipes.map((recipe) => {
    const displayName = recipe.name || (recipe as any).title || 'Untitled';
    const contentStr = typeof recipe.content === 'string' ? recipe.content : (recipe.content as any)?.pattern || (recipe.content as any)?.markdown || JSON.stringify(recipe.content, null, 2);
    // V2 智能预览：优先显示结构化描述，回退到 content 原文
    const previewText = recipe.description
      || recipe.v2Content?.rationale
      || recipe.v2Content?.pattern
      || (typeof contentStr === 'string' ? contentStr : '');
    const kc = recipe.kind ? kindConfig[recipe.kind] : null;
    const KindIcon = kc?.icon || FileText;
    const sc = statusConfig[recipe.status || ''] || null;
    return (
    <div key={displayName} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all group relative">
      <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
      <button onClick={(e) => { e.stopPropagation(); openRecipeEdit(recipe); }} className="p-1.5 bg-slate-50 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"><Edit3 size={ICON_SIZES.sm} /></button>
      <button onClick={(e) => { e.stopPropagation(); handleDeleteRecipe(recipe.name || (recipe as any).id); }} className="p-1.5 bg-slate-50 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"><Trash2 size={ICON_SIZES.sm} /></button>
      </div>
      <div onClick={() => openRecipeEdit(recipe)} className="cursor-pointer">
      {/* 标题行 + 类型标签 */}
      <div className="flex justify-between items-center mb-2 pr-12">
        <h3 className="font-bold text-slate-900 truncate">{displayName}</h3>
        <div className="flex items-center gap-1.5 shrink-0">
        {/* Kind badge */}
        {kc && (
          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase flex items-center gap-1 border ${kc.bg} ${kc.color} ${kc.border}`}>
          <KindIcon size={ICON_SIZES.xs} />{kc.label}
          </span>
        )}
        {/* Category badge */}
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
        {/* Status badge */}
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

      {/* V2 额外元数据行：knowledgeType + language + tags */}
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

      {/* 统计行 */}
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
        {recipe.stats?.lastUsedAt && (
        <>
          <span>·</span>
          <span>最近 {new Date(recipe.stats.lastUsedAt).toLocaleDateString()}</span>
        </>
        )}
      </div>

      {/* 内容预览：优先用 description/rationale，回退到原始 content */}
      <div className="text-xs text-slate-500 bg-slate-50 p-4 rounded-lg overflow-hidden line-clamp-6 font-mono whitespace-pre-wrap">{previewText}</div>

      {/* V2 关系/约束摘要（如有） */}
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
    </div>
    );
    })}
    </div>

    <Pagination
    currentPage={currentPage}
    totalPages={totalPages}
    totalItems={recipes.length}
    pageSize={pageSize}
    onPageChange={handlePageChange}
    onPageSizeChange={handlePageSizeChange}
    />
  </div>
  );
};

export default RecipesView;
