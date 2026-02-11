/**
 * Recipe 管理页面 - V2 完整生命周期：列表/创建/编辑/预览/发布/弃用/删除
 */

import React, { useState, useEffect } from 'react';
import { apiClient, Recipe, RecipeContent } from '../services/apiClient';
import toast from 'react-hot-toast';
import {
  Send,
  Loader,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Star,
  Download,
  Eye,
  X,
  Layers,
  Zap,
  BarChart3,
  Edit3,
  Trash2,
  Save,
  GitBranch,
  Sparkles,
} from 'lucide-react';
import { sortData, exportToCSV, SortConfig } from '../utils/tableUtils';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-yellow-500/20 text-yellow-400',
  active: 'bg-green-500/20 text-green-400',
  deprecated: 'bg-red-500/20 text-red-400',
};

const KNOWLEDGE_LABELS: Record<string, string> = {
  'code-pattern': '代码模式',
  'architecture': '架构',
  'best-practice': '最佳实践',
  'rule': '规则',
  'code-standard': '代码规范',
  'code-relation': '代码关联',
  'inheritance': '继承',
  'call-chain': '调用链',
  'data-flow': '数据流',
  'module-dependency': '模块依赖',
  'boundary-constraint': '边界约束',
  'code-style': '代码风格',
  'solution': '解决方案',
};

const COMPLEXITY_STYLES: Record<string, string> = {
  beginner: 'bg-green-500/15 text-green-400',
  intermediate: 'bg-blue-500/15 text-blue-400',
  advanced: 'bg-purple-500/15 text-purple-400',
};

const SCOPE_LABELS: Record<string, string> = {
  universal: '通用',
  'project-specific': '项目级',
  'target-specific': 'Target 级',
};

/* ── 空 RecipeContent ── */
const emptyContent = (): RecipeContent => ({
  pattern: '',
  rationale: '',
  steps: [],
  codeChanges: [],
  verification: null,
  markdown: '',
});

/* ── 表单状态 ── */
const RELATION_TYPES = [
  { key: 'inherits', label: '继承', icon: '↑' },
  { key: 'implements', label: '实现', icon: '◇' },
  { key: 'calls', label: '调用', icon: '→' },
  { key: 'dependsOn', label: '依赖', icon: '⊕' },
  { key: 'dataFlow', label: '数据流', icon: '⇢' },
  { key: 'conflicts', label: '冲突', icon: '✕' },
  { key: 'extends', label: '扩展', icon: '⊃' },
  { key: 'related', label: '关联', icon: '∼' },
] as const;

interface RecipeForm {
  title: string;
  trigger: string;
  language: string;
  category: string;
  description: string;
  knowledgeType: string;
  complexity: string;
  scope: string;
  content: RecipeContent;
  tags: string[];
  tagInput: string;
  headers: string[];
  headerInput: string;
  relations: Record<string, string[]>;
  relationType: string;
  relationInput: string;
}

const defaultForm = (): RecipeForm => ({
  title: '',
  trigger: '',
  language: 'swift',
  category: '',
  description: '',
  knowledgeType: 'code-pattern',
  complexity: 'intermediate',
  scope: 'universal',
  content: emptyContent(),
  tags: [],
  tagInput: '',
  headers: [],
  headerInput: '',
  relations: {},
  relationType: 'related',
  relationInput: '',
});

const RecipesPage: React.FC = () => {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [languageFilter, setLanguageFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [previewRecipe, setPreviewRecipe] = useState<Recipe | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);

  /* ── 编辑状态 ── */
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [editForm, setEditForm] = useState<RecipeForm>(defaultForm());
  const [isSaving, setIsSaving] = useState(false);

  /* ── 创建表单 ── */
  const [newRecipe, setNewRecipe] = useState<RecipeForm>(defaultForm());

  /* ── 数据加载 ── */
  const loadRecipes = async (page: number = 1) => {
    try {
      setIsLoading(true);
      const result = await apiClient.getRecipes(page, 12, categoryFilter || undefined, {
        status: statusFilter || undefined,
        language: languageFilter || undefined,
      });
      setRecipes(result.items);
      setTotalPages(Math.ceil((result as any).total / 12) || 1);
    } catch (error: any) {
      toast.error(`加载 Recipe 失败: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRecipes(currentPage);
  }, [categoryFilter, statusFilter, languageFilter, currentPage]);

  /* ── 搜索与排序 ── */
  const filteredRecipes = recipes.filter((r) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.title?.toLowerCase().includes(q) ||
      r.description?.toLowerCase().includes(q) ||
      r.category?.toLowerCase().includes(q) ||
      r.language?.toLowerCase().includes(q)
    );
  });

  const sortedRecipes = sortData(filteredRecipes, sortConfig);

  const handleSort = (key: string) => {
    setSortConfig((prev) => {
      if (prev?.key === key) {
        if (prev.order === 'asc') return { key, order: 'desc' };
        if (prev.order === 'desc') return null;
      }
      return { key, order: 'asc' };
    });
  };

  const handleExport = () => {
    exportToCSV(sortedRecipes, `recipes_${new Date().toISOString().split('T')[0]}`, [
      { key: 'id', label: 'ID' },
      { key: 'title', label: 'Title' },
      { key: 'language', label: 'Language' },
      { key: 'category', label: 'Category' },
      { key: 'knowledgeType', label: 'Knowledge Type' },
      { key: 'complexity', label: 'Complexity' },
      { key: 'status', label: 'Status' },
    ]);
    toast.success('导出成功');
  };

  /* ── 创建 ── */
  const handleCreateRecipe = async () => {
    if (!newRecipe.title || !newRecipe.language || !newRecipe.category) {
      toast.error('标题、语言和分类为必填项');
      return;
    }
    const c = newRecipe.content;
    if (!c.pattern && !c.rationale && !c.markdown && !(c.steps && c.steps.length > 0)) {
      toast.error('内容至少需要填写 代码模式、设计原理、步骤 或 Markdown 中的一项');
      return;
    }
    try {
      const { tagInput, headerInput, relationType, relationInput, ...rest } = newRecipe;
      await apiClient.createRecipe({ ...rest, relations: newRecipe.relations, dimensions: { headers: newRecipe.headers } } as any);
      toast.success('Recipe 已创建');
      setShowCreateModal(false);
      setNewRecipe(defaultForm());
      loadRecipes(1);
    } catch (error: any) {
      toast.error(`创建失败: ${error.message}`);
    }
  };

  /* ── 编辑 ── */
  const openEdit = (recipe: Recipe) => {
    setEditingRecipe(recipe);
    // 将 relations 中的对象数组转为 ID 字符串数组
    const flatRelations: Record<string, string[]> = {};
    if (recipe.relations) {
      for (const [key, arr] of Object.entries(recipe.relations)) {
        if (Array.isArray(arr) && arr.length > 0) {
          flatRelations[key] = arr.map((r: any) => typeof r === 'string' ? r : r.id || r.title || JSON.stringify(r));
        }
      }
    }
    setEditForm({
      title: recipe.title || '',
      trigger: recipe.trigger || '',
      language: recipe.language || 'swift',
      category: recipe.category || '',
      description: recipe.description || '',
      knowledgeType: recipe.knowledgeType || 'code-pattern',
      complexity: recipe.complexity || 'intermediate',
      scope: recipe.scope || 'universal',
      content: { ...emptyContent(), ...(recipe.content || {}) },
      tags: recipe.tags || [],
      tagInput: '',
      headers: (recipe.dimensions as any)?.headers || [],
      headerInput: '',
      relations: flatRelations,
      relationType: 'related',
      relationInput: '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editingRecipe) return;
    setIsSaving(true);
    try {
      const { tagInput, headerInput, relationType, relationInput, ...rest } = editForm;
      await apiClient.updateRecipe(editingRecipe.id, { ...rest, relations: editForm.relations, dimensions: { headers: editForm.headers } } as any);
      toast.success('Recipe 已更新');
      setEditingRecipe(null);
      loadRecipes(currentPage);
      // 如果预览面板正在看这个 recipe，也刷新
      if (previewRecipe?.id === editingRecipe.id) {
        const updated = await apiClient.getRecipe(editingRecipe.id);
        setPreviewRecipe(updated);
      }
    } catch (error: any) {
      toast.error(`更新失败: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  /* ── 发布/弃用/删除 ── */
  const handlePublish = async (id: string) => {
    try {
      await apiClient.publishRecipe(id);
      toast.success('Recipe 已发布');
      loadRecipes(currentPage);
    } catch (error: any) {
      toast.error(`发布失败: ${error.message}`);
    }
  };

  const handleDeprecate = async (id: string) => {
    const reason = prompt('请输入弃用原因：');
    if (!reason) return;
    try {
      await apiClient.deprecateRecipe(id, reason);
      toast.success('Recipe 已弃用');
      loadRecipes(currentPage);
    } catch (error: any) {
      toast.error(`弃用失败: ${error.message}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此 Recipe?')) return;
    try {
      await apiClient.deleteRecipe(id);
      toast.success('Recipe 已删除');
      if (previewRecipe?.id === id) setPreviewRecipe(null);
      loadRecipes(currentPage);
    } catch (error: any) {
      toast.error(`删除失败: ${error.message}`);
    }
  };

  const qualityPercent = (v: number | undefined) => v != null ? Math.round(v * 100) : 0;

  /* ── 发现关系 ── */
  const [isDiscovering, setIsDiscovering] = useState(false);

  const handleDiscoverRelations = async () => {
    setIsDiscovering(true);
    try {
      const result = await apiClient.discoverRelations();
      toast.success(`关系发现完成: ${result?.edgesCreated ?? 0} 条新关系`);
      loadRecipes(currentPage);
    } catch (error: any) {
      toast.error(`关系发现失败: ${error.message}`);
    } finally {
      setIsDiscovering(false);
    }
  };

  /* ════════════════════════ Render ════════════════════════ */

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-1 flex items-center gap-3">
              <BookOpen className="w-8 h-8 text-blue-400" />
              Recipes
            </h1>
            <p className="text-slate-400">管理知识食谱 — 代码模式、架构、最佳实践</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleDiscoverRelations}
              disabled={isDiscovering || recipes.length < 2}
              className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-lg flex items-center gap-2 transition disabled:opacity-50"
              title={recipes.length < 2 ? '至少需要 2 个 Recipe 才能发现关系' : 'AI 分析 Recipe 间的知识关系'}
            >
              {isDiscovering ? <Loader size={16} className="animate-spin" /> : <GitBranch size={16} />}
              发现关系
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg flex items-center gap-2 transition"
            >
              <Plus size={18} />
              新建 Recipe
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-6 flex gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-3 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="搜索 Recipe..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
            className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">全部状态</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="deprecated">Deprecated</option>
          </select>
          <select
            value={languageFilter}
            onChange={(e) => { setLanguageFilter(e.target.value); setCurrentPage(1); }}
            className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">全部语言</option>
            <option value="swift">Swift</option>
            <option value="objc">Objective-C</option>
            <option value="typescript">TypeScript</option>
            <option value="javascript">JavaScript</option>
            <option value="python">Python</option>
          </select>
          <input
            type="text"
            placeholder="分类筛选..."
            value={categoryFilter}
            onChange={(e) => { setCategoryFilter(e.target.value); setCurrentPage(1); }}
            className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 w-40"
          />
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">排序：</span>
            <select
              onChange={(e) => handleSort(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="">默认</option>
              <option value="title">标题</option>
              <option value="category">分类</option>
              <option value="status">状态</option>
              <option value="complexity">复杂度</option>
            </select>
          </div>
          <button onClick={handleExport} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition flex items-center gap-2">
            <Download size={16} />
            导出
          </button>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex justify-center items-center py-12">
            <Loader size={32} className="text-blue-500 animate-spin" />
          </div>
        )}

        {/* Recipe Grid + Preview */}
        {!isLoading && (
          <div className="flex gap-6">
            <div className={`flex-1 transition-all ${previewRecipe ? 'max-w-[60%]' : ''}`}>
              {sortedRecipes.length === 0 ? (
                <div className="text-center py-16">
                  {searchQuery || categoryFilter || statusFilter ? (
                    <p className="text-slate-500">无匹配结果</p>
                  ) : (
                    <div className="max-w-md mx-auto">
                      <Sparkles size={48} className="text-blue-400/50 mx-auto mb-4" />
                      <h3 className="text-xl font-semibold text-white mb-2">开始构建知识库</h3>
                      <p className="text-slate-400 mb-6">Recipe 是项目知识的核心单元。你可以手动创建，也可以用 AI 从源码中自动提取。</p>
                      <div className="flex flex-col gap-3">
                        <button
                          onClick={() => setShowCreateModal(true)}
                          className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center justify-center gap-2 transition"
                        >
                          <Plus size={18} /> 手动创建 Recipe
                        </button>
                        <div className="text-xs text-slate-500 space-y-1">
                          <p>💡 <strong>AI 扫描</strong>: 在终端运行 <code className="bg-slate-700 px-1.5 py-0.5 rounded">asd ais [Target]</code> 自动提取候选</p>
                          <p>💡 <strong>Cursor 集成</strong>: 运行 <code className="bg-slate-700 px-1.5 py-0.5 rounded">asd install:cursor-skill --mcp</code> 启用 AI 批量扫描</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
                  {sortedRecipes.map((recipe) => (
                    <div
                      key={recipe.id}
                      onClick={() => setPreviewRecipe(recipe)}
                      className={`bg-slate-800 border rounded-lg p-5 cursor-pointer transition group ${
                        previewRecipe?.id === recipe.id ? 'border-blue-500' : 'border-slate-700 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="text-base font-semibold text-white group-hover:text-blue-400 transition line-clamp-1 flex-1">
                          {recipe.title}
                        </h3>
                        {recipe.quality?.overall != null && (
                          <div className="flex items-center gap-1 ml-2 shrink-0">
                            <Star size={14} className="text-yellow-400 fill-yellow-400" />
                            <span className="text-xs text-yellow-400">{qualityPercent(recipe.quality.overall)}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-1.5 mb-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[recipe.status] || ''}`}>
                          {recipe.status}
                        </span>
                        <span className="text-xs px-2 py-0.5 bg-indigo-500/20 text-indigo-300 rounded">
                          {recipe.language}
                        </span>
                        <span className="text-xs px-2 py-0.5 bg-slate-700 text-slate-300 rounded">
                          {recipe.category}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded ${COMPLEXITY_STYLES[recipe.complexity] || ''}`}>
                          {recipe.complexity}
                        </span>
                      </div>

                      <p className="text-slate-400 text-xs mb-3 line-clamp-2">{recipe.description}</p>

                      {/* 代码片段预览 */}
                      {(recipe.content?.pattern || recipe.content?.markdown) && (
                        <pre className="text-[11px] text-slate-400 bg-slate-900/50 rounded p-2 mb-3 line-clamp-3 overflow-hidden font-mono whitespace-pre-wrap">
                          {recipe.content.pattern || recipe.content.markdown}
                        </pre>
                      )}

                      {recipe.tags && recipe.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {recipe.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="px-1.5 py-0.5 bg-slate-700/50 text-slate-400 rounded text-[10px]">{tag}</span>
                          ))}
                          {recipe.tags.length > 3 && <span className="text-[10px] text-slate-500">+{recipe.tags.length - 3}</span>}
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-3 border-t border-slate-700/50">
                        <div className="flex gap-3 text-[10px] text-slate-500">
                          <span>{KNOWLEDGE_LABELS[recipe.knowledgeType] || recipe.knowledgeType}</span>
                          {recipe.statistics && (
                            <>
                              <span>采纳 {recipe.statistics.adoptionCount || 0}</span>
                              <span>应用 {recipe.statistics.applicationCount || 0}</span>
                            </>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); openEdit(recipe); }}
                            className="p-1 text-slate-500 hover:text-blue-400 transition"
                            title="编辑"
                          >
                            <Edit3 size={14} />
                          </button>
                          {recipe.status === 'draft' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handlePublish(recipe.id); }}
                              className="text-xs px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded transition"
                            >
                              发布
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(recipe.id); }}
                            className="p-1 text-slate-500 hover:text-red-400 transition"
                            title="删除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex justify-between items-center mb-8">
                  <span className="text-slate-400 text-sm">第 {currentPage} / {totalPages} 页</span>
                  <div className="flex gap-2">
                    <button onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className="p-2 bg-slate-700 hover:bg-slate-600 text-white rounded disabled:opacity-50 transition">
                      <ChevronLeft size={20} />
                    </button>
                    <button onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages} className="p-2 bg-slate-700 hover:bg-slate-600 text-white rounded disabled:opacity-50 transition">
                      <ChevronRight size={20} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ══════ Preview Panel ══════ */}
            {previewRecipe && (
              <div className="w-[40%] min-w-[320px]">
                <div className="bg-slate-800 border border-slate-700 rounded-lg p-5 sticky top-6 max-h-[85vh] overflow-y-auto">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-white font-semibold flex items-center gap-2">
                      <Eye size={18} className="text-blue-400" />
                      Recipe 详情
                    </h3>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(previewRecipe)} className="p-1 text-slate-500 hover:text-blue-400" title="编辑">
                        <Edit3 size={16} />
                      </button>
                      <button onClick={() => setPreviewRecipe(null)} className="p-1 text-slate-500 hover:text-white">
                        <X size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4 text-sm">
                    <h4 className="text-lg font-bold text-white">{previewRecipe.title}</h4>

                    <div className="flex flex-wrap gap-1.5">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[previewRecipe.status]}`}>{previewRecipe.status}</span>
                      <span className="text-xs px-2 py-0.5 bg-indigo-500/20 text-indigo-300 rounded">{previewRecipe.language}</span>
                      <span className="text-xs px-2 py-0.5 bg-slate-700 text-slate-300 rounded">{previewRecipe.category}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${COMPLEXITY_STYLES[previewRecipe.complexity] || ''}`}>{previewRecipe.complexity}</span>
                      <span className="text-xs px-2 py-0.5 bg-cyan-500/15 text-cyan-400 rounded">{KNOWLEDGE_LABELS[previewRecipe.knowledgeType] || previewRecipe.knowledgeType}</span>
                      {previewRecipe.scope && (
                        <span className="text-xs px-2 py-0.5 bg-orange-500/15 text-orange-400 rounded">{SCOPE_LABELS[previewRecipe.scope] || previewRecipe.scope}</span>
                      )}
                      {previewRecipe.kind && (
                        <span className="text-xs px-2 py-0.5 bg-teal-500/15 text-teal-400 rounded">kind: {previewRecipe.kind}</span>
                      )}
                    </div>

                    {previewRecipe.description && (
                      <div>
                        <span className="text-slate-400 text-xs block mb-1">描述</span>
                        <p className="text-slate-300 text-xs leading-relaxed">{previewRecipe.description}</p>
                      </div>
                    )}

                    {/* Quality Metrics */}
                    {previewRecipe.quality && (
                      <div>
                        <span className="text-slate-400 text-xs block mb-2">质量指标</span>
                        <div className="space-y-2">
                          {[
                            { label: '代码完整度', value: previewRecipe.quality.codeCompleteness },
                            { label: '项目适配性', value: previewRecipe.quality.projectAdaptation },
                            { label: '文档清晰度', value: previewRecipe.quality.documentationClarity },
                            { label: '综合评分', value: previewRecipe.quality.overall },
                          ].map((m) => (
                            <div key={m.label} className="flex items-center gap-2">
                              <span className="text-xs text-slate-500 w-20 shrink-0">{m.label}</span>
                              <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${qualityPercent(m.value)}%` }} />
                              </div>
                              <span className="text-xs text-blue-400 w-8 text-right">{qualityPercent(m.value)}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Statistics */}
                    {previewRecipe.statistics && (
                      <div className="flex gap-4">
                        <div className="text-center">
                          <span className="block text-lg font-bold text-white">{previewRecipe.statistics.adoptionCount || 0}</span>
                          <span className="text-[10px] text-slate-500">采纳</span>
                        </div>
                        <div className="text-center">
                          <span className="block text-lg font-bold text-white">{previewRecipe.statistics.applicationCount || 0}</span>
                          <span className="text-[10px] text-slate-500">应用</span>
                        </div>
                        <div className="text-center">
                          <span className="block text-lg font-bold text-white">{previewRecipe.statistics.guardHitCount || 0}</span>
                          <span className="text-[10px] text-slate-500">Guard 命中</span>
                        </div>
                      </div>
                    )}

                    {/* Content: Pattern */}
                    {previewRecipe.content?.pattern && (
                      <div>
                        <span className="text-slate-400 text-xs block mb-2">代码模式</span>
                        <pre className="bg-slate-900 p-3 rounded text-xs text-green-300 overflow-x-auto max-h-64 overflow-y-auto font-mono leading-relaxed">
                          {previewRecipe.content.pattern}
                        </pre>
                      </div>
                    )}

                    {/* Content: Rationale */}
                    {previewRecipe.content?.rationale && (
                      <div>
                        <span className="text-slate-400 text-xs block mb-1">设计原理</span>
                        <p className="text-xs text-slate-300 leading-relaxed">{previewRecipe.content.rationale}</p>
                      </div>
                    )}

                    {/* Content: Steps */}
                    {previewRecipe.content?.steps && previewRecipe.content.steps.length > 0 && (
                      <div>
                        <span className="text-slate-400 text-xs block mb-2">实施步骤</span>
                        <ol className="text-xs text-slate-300 space-y-2 list-decimal list-inside">
                          {previewRecipe.content.steps.map((step, i) => (
                            <li key={i}>
                              {step.title && <span className="font-medium text-white">{step.title}: </span>}
                              {step.description}
                              {step.code && (
                                <pre className="mt-1 bg-slate-900 p-2 rounded text-[11px] text-green-300 font-mono">{step.code}</pre>
                              )}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {/* Content: Markdown */}
                    {previewRecipe.content?.markdown && !previewRecipe.content?.pattern && (
                      <div>
                        <span className="text-slate-400 text-xs block mb-2">Markdown 内容</span>
                        <pre className="bg-slate-900 p-3 rounded text-xs text-slate-300 overflow-x-auto max-h-48 overflow-y-auto font-mono leading-relaxed whitespace-pre-wrap">
                          {previewRecipe.content.markdown}
                        </pre>
                      </div>
                    )}

                    {/* Content: Verification */}
                    {previewRecipe.content?.verification && (
                      <div>
                        <span className="text-slate-400 text-xs block mb-1">验证方式</span>
                        <div className="text-xs text-slate-300 space-y-1">
                          {previewRecipe.content.verification.method && <p>方法: {previewRecipe.content.verification.method}</p>}
                          {previewRecipe.content.verification.expectedResult && <p>预期: {previewRecipe.content.verification.expectedResult}</p>}
                          {previewRecipe.content.verification.testCode && (
                            <pre className="mt-1 bg-slate-900 p-2 rounded text-[11px] text-green-300 font-mono">{previewRecipe.content.verification.testCode}</pre>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Constraints */}
                    {previewRecipe.constraints && (
                      <>
                        {previewRecipe.constraints.guards?.length > 0 && (
                          <div>
                            <span className="text-slate-400 text-xs block mb-1">Guard 规则</span>
                            <ul className="text-xs text-slate-300 space-y-1">
                              {previewRecipe.constraints.guards.map((g: any, i: number) => (
                                <li key={i} className="flex gap-1.5">
                                  <span className={g.severity === 'error' ? 'text-red-400' : 'text-yellow-400'}>●</span>
                                  <code className="font-mono text-[11px]">{g.pattern}</code>
                                  {g.message && <span className="text-slate-500">— {g.message}</span>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {previewRecipe.constraints.boundaries?.length > 0 && (
                          <div>
                            <span className="text-slate-400 text-xs block mb-1">边界约束</span>
                            <ul className="text-xs text-slate-300 space-y-1">
                              {previewRecipe.constraints.boundaries.map((b: string, i: number) => (
                                <li key={i} className="flex gap-1.5"><span className="text-orange-400">●</span>{b}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {previewRecipe.constraints.preconditions?.length > 0 && (
                          <div>
                            <span className="text-slate-400 text-xs block mb-1">前置条件</span>
                            <ul className="text-xs text-slate-300 space-y-1">
                              {previewRecipe.constraints.preconditions.map((p: string, i: number) => (
                                <li key={i} className="flex gap-1.5"><span className="text-blue-400">◆</span>{p}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {previewRecipe.constraints.sideEffects?.length > 0 && (
                          <div>
                            <span className="text-slate-400 text-xs block mb-1">副作用</span>
                            <ul className="text-xs text-slate-300 space-y-1">
                              {previewRecipe.constraints.sideEffects.map((s: string, i: number) => (
                                <li key={i} className="flex gap-1.5"><span className="text-pink-400">⚡</span>{s}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}

                    {/* Relations */}
                    {previewRecipe.relations && Object.entries(previewRecipe.relations).some(([, v]) => (v as any[])?.length > 0) && (
                      <div>
                        <span className="text-slate-400 text-xs block mb-2">关系图</span>
                        <div className="space-y-2">
                          {([
                            { key: 'inherits', label: '继承', color: 'text-green-400', icon: '↑' },
                            { key: 'implements', label: '实现', color: 'text-blue-400', icon: '◇' },
                            { key: 'calls', label: '调用', color: 'text-cyan-400', icon: '→' },
                            { key: 'dependsOn', label: '依赖', color: 'text-yellow-400', icon: '⊕' },
                            { key: 'dataFlow', label: '数据流', color: 'text-purple-400', icon: '⇢' },
                            { key: 'conflicts', label: '冲突', color: 'text-red-400', icon: '✕' },
                            { key: 'extends', label: '扩展', color: 'text-teal-400', icon: '⊃' },
                            { key: 'related', label: '关联', color: 'text-slate-300', icon: '∼' },
                          ] as const).map(({ key, label, color, icon }) => {
                            const items = (previewRecipe.relations as any)?.[key];
                            if (!items || items.length === 0) return null;
                            return (
                              <div key={key} className="flex items-start gap-2">
                                <span className={`text-xs font-mono ${color} w-14 shrink-0`}>{icon} {label}</span>
                                <div className="flex flex-wrap gap-1">
                                  {items.map((r: any, i: number) => (
                                    <span key={i} className="px-1.5 py-0.5 bg-slate-700/70 text-slate-300 rounded text-[10px] font-mono">
                                      {typeof r === 'string' ? r : r.id || r.title || JSON.stringify(r)}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Tags */}
                    {previewRecipe.tags && previewRecipe.tags.length > 0 && (
                      <div>
                        <span className="text-slate-400 text-xs block mb-1">标签</span>
                        <div className="flex flex-wrap gap-1">
                          {previewRecipe.tags.map((t) => (
                            <span key={t} className="px-2 py-0.5 bg-slate-700/50 text-slate-300 rounded text-xs">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-3 border-t border-slate-700">
                      <button onClick={() => openEdit(previewRecipe)} className="flex-1 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs transition flex items-center justify-center gap-1">
                        <Edit3 size={14} /> 编辑
                      </button>
                      {previewRecipe.status === 'draft' && (
                        <button onClick={() => handlePublish(previewRecipe.id)} className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition flex items-center justify-center gap-1">
                          <Send size={14} /> 发布
                        </button>
                      )}
                      {previewRecipe.status === 'active' && (
                        <button onClick={() => handleDeprecate(previewRecipe.id)} className="flex-1 px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded text-xs transition">
                          弃用
                        </button>
                      )}
                      <button onClick={() => handleDelete(previewRecipe.id)} className="px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded text-xs transition">
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className="text-xs text-slate-500 pt-2 border-t border-slate-700">
                      ID: {previewRecipe.id?.slice(0, 8)}... · 创建于 {new Date(previewRecipe.createdAt).toLocaleString('zh-CN')}
                      {previewRecipe.publishedAt && ` · 发布于 ${new Date(previewRecipe.publishedAt).toLocaleString('zh-CN')}`}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════ Create Modal ══════ */}
        {showCreateModal && (
          <RecipeFormModal
            title="新建 Recipe"
            form={newRecipe}
            setForm={setNewRecipe}
            onSubmit={handleCreateRecipe}
            onCancel={() => setShowCreateModal(false)}
            submitLabel="创建"
          />
        )}

        {/* ══════ Edit Modal ══════ */}
        {editingRecipe && (
          <RecipeFormModal
            title={`编辑 Recipe: ${editingRecipe.title}`}
            form={editForm}
            setForm={setEditForm}
            onSubmit={handleSaveEdit}
            onCancel={() => setEditingRecipe(null)}
            submitLabel={isSaving ? '保存中...' : '保存'}
            isSubmitting={isSaving}
          />
        )}
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════
 * RecipeFormModal — 创建/编辑共用表单
 * ════════════════════════════════════════════════════════ */
interface RecipeFormModalProps {
  title: string;
  form: RecipeForm;
  setForm: (f: RecipeForm) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  isSubmitting?: boolean;
}

const RecipeFormModal: React.FC<RecipeFormModalProps> = ({ title, form, setForm, onSubmit, onCancel, submitLabel, isSubmitting }) => {
  const updateContent = (key: keyof RecipeContent, value: any) => {
    setForm({ ...form, content: { ...form.content, [key]: value } });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold text-white mb-4">{title}</h2>
        <div className="space-y-4">
          {/* 标题 */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">标题 *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="如: Create UITableView with Diffable DataSource"
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Trigger */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Trigger（触发关键词）</label>
            <input
              type="text"
              value={form.trigger}
              onChange={(e) => setForm({ ...form, trigger: e.target.value })}
              placeholder="如: diffable-datasource（用于搜索和 .md 文件名）"
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* 语言 + 分类 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">语言 *</label>
              <select
                value={form.language}
                onChange={(e) => setForm({ ...form, language: e.target.value })}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              >
                <option value="swift">Swift</option>
                <option value="objc">Objective-C</option>
                <option value="typescript">TypeScript</option>
                <option value="javascript">JavaScript</option>
                <option value="python">Python</option>
                <option value="java">Java</option>
                <option value="kotlin">Kotlin</option>
                <option value="go">Go</option>
                <option value="rust">Rust</option>
                <option value="ruby">Ruby</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">分类 *</label>
              <input
                type="text"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="View, Service, Tool..."
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* 知识类型 + 复杂度 + 适用范围 */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">知识类型</label>
              <select
                value={form.knowledgeType}
                onChange={(e) => setForm({ ...form, knowledgeType: e.target.value })}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 text-sm"
              >
                <option value="code-pattern">代码模式</option>
                <option value="architecture">架构</option>
                <option value="best-practice">最佳实践</option>
                <option value="rule">规则</option>
                <option value="code-standard">代码规范</option>
                <option value="code-style">代码风格</option>
                <option value="solution">解决方案</option>
                <option value="boundary-constraint">边界约束</option>
                <option value="code-relation">代码关联</option>
                <option value="inheritance">继承与接口</option>
                <option value="call-chain">调用链路</option>
                <option value="data-flow">数据流向</option>
                <option value="module-dependency">模块依赖</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">复杂度</label>
              <select
                value={form.complexity}
                onChange={(e) => setForm({ ...form, complexity: e.target.value })}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              >
                <option value="beginner">初级</option>
                <option value="intermediate">中级</option>
                <option value="advanced">高级</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">适用范围</label>
              <select
                value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value })}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              >
                <option value="universal">通用</option>
                <option value="project-specific">项目级</option>
                <option value="target-specific">Target 级</option>
              </select>
            </div>
          </div>

          {/* 描述 */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">描述</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              placeholder="简要描述此 Recipe 的用途..."
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 text-sm"
            />
          </div>

          {/* ── Content 区域 ── */}
          <div className="border border-slate-600 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-bold text-slate-300">内容</h3>

            {/* 代码模式 */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">代码模式 (pattern)</label>
              <textarea
                value={form.content.pattern || ''}
                onChange={(e) => updateContent('pattern', e.target.value)}
                rows={6}
                placeholder="粘贴代码模式/示例代码..."
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 font-mono text-sm"
              />
            </div>

            {/* 设计原理 */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">设计原理 (rationale)</label>
              <textarea
                value={form.content.rationale || ''}
                onChange={(e) => updateContent('rationale', e.target.value)}
                rows={3}
                placeholder="解释为什么要这样做..."
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 text-sm"
              />
            </div>

            {/* Markdown 全文 */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Markdown 全文 (可选，用于 .md 文件同步)</label>
              <textarea
                value={form.content.markdown || ''}
                onChange={(e) => updateContent('markdown', e.target.value)}
                rows={4}
                placeholder="完整 Markdown 内容（可选）..."
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 font-mono text-sm"
              />
            </div>
          </div>

          {/* 标签 */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">标签</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.tagInput}
                onChange={(e) => setForm({ ...form, tagInput: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && form.tagInput.trim()) {
                    e.preventDefault();
                    setForm({ ...form, tags: [...form.tags, form.tagInput.trim()], tagInput: '' });
                  }
                }}
                placeholder="回车添加标签"
                className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            {form.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {form.tags.map((t, i) => (
                  <span key={i} className="px-2 py-0.5 bg-slate-700 text-slate-300 rounded text-xs flex items-center gap-1">
                    {t}
                    <button onClick={() => setForm({ ...form, tags: form.tags.filter((_, j) => j !== i) })} className="text-slate-500 hover:text-red-400">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Headers (import 语句) */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Headers (import 语句)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.headerInput}
                onChange={(e) => setForm({ ...form, headerInput: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && form.headerInput.trim()) {
                    e.preventDefault();
                    setForm({ ...form, headers: [...form.headers, form.headerInput.trim()], headerInput: '' });
                  }
                }}
                placeholder="如: import UIKit — 回车添加"
                className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
            {form.headers.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {form.headers.map((h, i) => (
                  <span key={i} className="px-2 py-0.5 bg-slate-700 text-slate-300 rounded text-xs font-mono flex items-center gap-1">
                    {h}
                    <button onClick={() => setForm({ ...form, headers: form.headers.filter((_, j) => j !== i) })} className="text-slate-500 hover:text-red-400">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ── 关系 ── */}
          <div className="border border-slate-600 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
              <GitBranch size={14} /> 知识关系
            </h3>
            <div className="flex gap-2">
              <select
                value={form.relationType}
                onChange={(e) => setForm({ ...form, relationType: e.target.value })}
                className="bg-slate-700 border border-slate-600 rounded px-2 py-2 text-white text-xs focus:outline-none focus:border-blue-500 w-24"
              >
                {RELATION_TYPES.map(({ key, label, icon }) => (
                  <option key={key} value={key}>{icon} {label}</option>
                ))}
              </select>
              <input
                type="text"
                value={form.relationInput}
                onChange={(e) => setForm({ ...form, relationInput: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && form.relationInput.trim()) {
                    e.preventDefault();
                    const type = form.relationType;
                    const current = form.relations[type] || [];
                    setForm({
                      ...form,
                      relations: { ...form.relations, [type]: [...current, form.relationInput.trim()] },
                      relationInput: '',
                    });
                  }
                }}
                placeholder="输入关联的 Recipe ID 或标题，回车添加"
                className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-xs focus:outline-none focus:border-blue-500"
              />
            </div>
            {/* 已添加的关系 */}
            {Object.entries(form.relations).some(([, v]) => v.length > 0) && (
              <div className="space-y-1.5">
                {RELATION_TYPES.map(({ key, label, icon }) => {
                  const items = form.relations[key];
                  if (!items || items.length === 0) return null;
                  return (
                    <div key={key} className="flex items-start gap-2">
                      <span className="text-xs text-slate-400 w-14 shrink-0">{icon} {label}</span>
                      <div className="flex flex-wrap gap-1">
                        {items.map((r, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-slate-700/70 text-slate-300 rounded text-[10px] font-mono flex items-center gap-1">
                            {r}
                            <button
                              onClick={() => {
                                const updated = items.filter((_, j) => j !== i);
                                const newRels = { ...form.relations };
                                if (updated.length === 0) delete newRels[key]; else newRels[key] = updated;
                                setForm({ ...form, relations: newRels });
                              }}
                              className="text-slate-500 hover:text-red-400"
                            >
                              <X size={8} />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-[10px] text-slate-500">关系也可通过「发现关系」按钮由 AI 自动分析生成</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 mt-6">
          <button onClick={onCancel} disabled={isSubmitting} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded transition disabled:opacity-50">
            取消
          </button>
          <button onClick={onSubmit} disabled={isSubmitting} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition flex items-center justify-center gap-2 disabled:opacity-50">
            {isSubmitting && <Loader size={16} className="animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RecipesPage;
