import React from 'react';
import { Zap, CheckCircle, Pencil, Check, GitCompare, Inbox, Layers, Loader2 } from 'lucide-react';
import { ScanResultItem, SimilarRecipe } from '../../types';
import { categories } from '../../constants';
import { ICON_SIZES } from '../../constants/icons';
import CodeBlock from '../Shared/CodeBlock';
import HighlightedCodeEditor from '../Shared/HighlightedCodeEditor';

interface ScanResultCardProps {
  res: ScanResultItem;
  index: number;
  /* code editing */
  editingCodeIndex: number | null;
  setEditingCodeIndex: (i: number | null) => void;
  /* translation */
  translatingIndex: number | null;
  /* header expansion */
  expandedEditIndex: number | null;
  setExpandedEditIndex: (i: number | null) => void;
  /* similarity */
  similarityMap: Record<string, SimilarRecipe[]>;
  /* callbacks */
  handleUpdateScanResult: (index: number, updates: any) => void;
  handleSaveExtracted: (res: any) => void;
  handlePromoteToCandidate?: (res: ScanResultItem, index: number) => void;
  handleContentLangChange: (i: number, lang: 'cn' | 'en', res: ScanResultItem) => void;
  openCompare: (res: ScanResultItem, recipeName: string, similarList: SimilarRecipe[]) => void;
  isSavingRecipe?: boolean;
}

/* ── helpers ── */
const codeLang = (res: { language?: string }) => {
  const l = (res.language || '').toLowerCase();
  return l === 'objectivec' || l === 'objc' || l === 'objective-c' || l === 'obj-c'
    ? 'objectivec'
    : (res.language || 'swift');
};

/**
 * 从 header 字符串中提取核心模块/文件名，用于在代码中搜索引用
 * e.g. '#import "BDVideoPlayerView.h"' → ['BDVideoPlayerView']
 *      '#import <SDWebImage/SDWebImage.h>' → ['SDWebImage']
 *      'import BDUIKit' → ['BDUIKit']
 */
function extractHeaderSymbols(header: string): string[] {
  const symbols: string[] = [];
  // ObjC: #import "Foo.h" or #import <Module/Foo.h>
  const objcQuote = header.match(/#import\s+"([^"]+)"/);
  if (objcQuote) {
    const fname = objcQuote[1].replace(/\.h$/, '');
    symbols.push(fname);
  }
  const objcAngle = header.match(/#import\s+<([^>]+)>/);
  if (objcAngle) {
    const parts = objcAngle[1].replace(/\.h$/, '').split('/');
    symbols.push(...parts);  // e.g. ['SDWebImage', 'SDWebImage'] → both module and header
  }
  // Swift: import ModuleName
  const swiftImport = header.match(/^import\s+(\w+)/);
  if (swiftImport) {
    symbols.push(swiftImport[1]);
  }
  // @import Module;
  const atImport = header.match(/@import\s+(\w+)/);
  if (atImport) {
    symbols.push(atImport[1]);
  }
  return [...new Set(symbols.filter(Boolean))];
}

/** 判断 header 是否在代码中被引用（通过检测类名/模块名出现） */
function isHeaderUsedInCode(header: string, code: string): 'used' | 'unused' | 'unknown' {
  if (!code || !code.trim()) return 'unknown';
  const symbols = extractHeaderSymbols(header);
  if (symbols.length === 0) return 'unknown';
  return symbols.some(sym => code.includes(sym)) ? 'used' : 'unused';
}

/** 归一化 ObjC header 格式：统一 #import 风格 */
function normalizeObjCHeader(header: string): string {
  // 已经是标准格式则保留
  if (header.startsWith('#import ') || header.startsWith('import ') || header.startsWith('@import ')) {
    return header.trim();
  }
  // 可能是裸的 <Module/Header.h> 或 "Header.h"
  if (header.startsWith('<') || header.startsWith('"')) {
    return `#import ${header.trim()}`;
  }
  return header.trim();
}

const ScanResultCard: React.FC<ScanResultCardProps> = ({
  res,
  index: i,
  editingCodeIndex,
  setEditingCodeIndex,
  translatingIndex,
  expandedEditIndex,
  setExpandedEditIndex,
  similarityMap,
  handleUpdateScanResult,
  handleSaveExtracted,
  handlePromoteToCandidate,
  handleContentLangChange,
  openCompare,
  isSavingRecipe = false,
}) => {
  const isExpanded = expandedEditIndex === i;
  const headers = res.headers || [];

  return (
    <div className="bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
      {/* ── Header: Title + Actions ── */}
      <div className="px-5 pt-4 pb-3 bg-gradient-to-b from-white to-slate-50/50 border-b border-slate-100">
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
            <input
              className="font-semibold bg-transparent border-b-2 border-transparent hover:border-slate-200 focus:border-blue-500 outline-none px-0.5 text-lg w-full text-slate-800 placeholder:text-slate-300"
              value={res.title}
              onChange={e => handleUpdateScanResult(i, { title: e.target.value })}
            />
          </div>
          <div className="flex gap-2 shrink-0 pt-3">
            {handlePromoteToCandidate && (
              <button
                onClick={() => handlePromoteToCandidate(res, i)}
                className="text-xs px-4 py-2 rounded-lg font-bold transition-all shadow-sm flex items-center gap-1.5 active:scale-95 bg-white text-emerald-600 border border-emerald-200 hover:bg-emerald-50 whitespace-nowrap"
              >
                <Inbox size={ICON_SIZES.md} />
                Candidate
              </button>
            )}
            <button
              onClick={() => handleSaveExtracted(res)}
              disabled={isSavingRecipe}
              className={`text-xs px-4 py-2 rounded-lg font-bold transition-all shadow-sm flex items-center gap-1.5 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap ${
                res.mode === 'full'
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-amber-600 text-white hover:bg-amber-700'
              }`}
            >
              {isSavingRecipe ? <Loader2 size={ICON_SIZES.md} className="animate-spin" /> : <CheckCircle size={ICON_SIZES.md} />}
              {isSavingRecipe ? '保存中...' : '保存为 Recipe'}
            </button>
          </div>
        </div>

        {/* ── Controls row ── */}
        <div className="flex items-end gap-4 flex-wrap">
          <div className="flex flex-col">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Trigger</label>
            <input
              className="font-mono font-bold text-blue-600 bg-blue-50/80 border border-blue-100 px-2.5 py-1 rounded-md outline-none text-xs focus:ring-2 focus:ring-blue-500/20 w-40"
              value={res.trigger}
              placeholder="@cmd"
              onChange={e => handleUpdateScanResult(i, { trigger: e.target.value })}
            />
          </div>
          <div className="flex flex-col">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Category</label>
            <select
              className="font-bold text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded-md outline-none text-[11px] focus:ring-2 focus:ring-blue-500/20"
              value={res.category}
              onChange={e => handleUpdateScanResult(i, { category: e.target.value })}
            >
              {categories.filter(c => c !== 'All').map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div className="w-px h-6 bg-slate-200 self-end mb-0.5" />
          <div className="flex flex-col">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Language</label>
            <div className="flex bg-slate-100 p-0.5 rounded-md">
              <button
                onClick={() => handleUpdateScanResult(i, { language: 'swift' })}
                className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all ${res.language === 'swift' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-500'}`}
              >
                Swift
              </button>
              <button
                onClick={() => handleUpdateScanResult(i, { language: 'objectivec' })}
                className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all ${res.language === 'objectivec' || res.language === 'objc' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-500'}`}
              >
                ObjC
              </button>
            </div>
          </div>
          <div className="flex flex-col">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Lang</label>
            <div className="flex bg-slate-100 p-0.5 rounded-md items-center">
              <button
                onClick={() => handleContentLangChange(i, 'cn', res)}
                disabled={translatingIndex !== null}
                className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all ${res.lang === 'cn' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-500'} disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                CN
              </button>
              <button
                onClick={() => handleContentLangChange(i, 'en', res)}
                disabled={translatingIndex !== null}
                className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all flex items-center gap-0.5 ${res.lang === 'en' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-500'} disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {translatingIndex === i ? <Loader2 size={10} className="animate-spin" /> : null}
                EN
              </button>
            </div>
          </div>
          <div className="flex flex-col">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Mode</label>
            <div className="flex bg-slate-100 p-0.5 rounded-md">
              <button
                onClick={() => handleUpdateScanResult(i, { mode: 'full' })}
                className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all ${res.mode === 'full' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-500'}`}
              >
                Snippet+Recipe
              </button>
              <button
                onClick={() => handleUpdateScanResult(i, { mode: 'preview' })}
                className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all ${res.mode === 'preview' ? 'bg-white shadow-sm text-amber-600' : 'text-slate-400 hover:text-slate-500'}`}
              >
                Recipe Only
              </button>
            </div>
          </div>
          <div className="w-px h-6 bg-slate-200 self-end mb-0.5" />
          <div className="flex flex-col">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Difficulty</label>
            <select
              className="font-bold text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded-md outline-none text-[11px] focus:ring-2 focus:ring-purple-500/20"
              value={res.difficulty || 'intermediate'}
              onChange={e => handleUpdateScanResult(i, { difficulty: e.target.value as any })}
            >
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Authority</label>
            <select
              className="font-bold text-amber-600 bg-amber-50/60 border border-amber-100 px-2 py-1 rounded-md outline-none text-[11px] focus:ring-2 focus:ring-amber-500/20"
              value={res.authority || 3}
              onChange={e => handleUpdateScanResult(i, { authority: parseInt(e.target.value) })}
            >
              <option value="1">⭐ 1</option>
              <option value="2">⭐⭐ 2</option>
              <option value="3">⭐⭐⭐ 3</option>
              <option value="4">⭐⭐⭐⭐ 4</option>
              <option value="5">⭐⭐⭐⭐⭐ 5</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Metadata row: Knowledge Type / Scope / Module / Headers / Tags ── */}
      <div className="px-6 pt-5 pb-0 space-y-3">
        <div className="flex flex-wrap gap-x-4 gap-y-2 items-end">
          <div className="flex flex-col">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Knowledge Type</label>
            <select
              className="font-bold text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded-md outline-none text-[11px] focus:ring-2 focus:ring-blue-500/20"
              value={res.knowledgeType || 'code-pattern'}
              onChange={e => handleUpdateScanResult(i, { knowledgeType: e.target.value as any })}
            >
              <option value="code-pattern">Code Pattern</option>
              <option value="architecture">Architecture</option>
              <option value="best-practice">Best Practice</option>
              <option value="rule">Rule</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-0.5 mb-1">Scope</label>
            <select
              className="font-bold text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded-md outline-none text-[11px] focus:ring-2 focus:ring-blue-500/20"
              value={res.scope || 'project-specific'}
              onChange={e => handleUpdateScanResult(i, { scope: e.target.value as any })}
            >
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
                  <button
                    onClick={() => { const newTags = [...(res.tags || [])]; newTags.splice(ti, 1); handleUpdateScanResult(i, { tags: newTags }); }}
                    className="text-blue-400 hover:text-red-500 transition-colors leading-none text-[10px]"
                    title="移除"
                  >
                    &times;
                  </button>
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

        {/* Headers expanded editing */}
        {isExpanded && headers.length > 0 && (
          <div className="space-y-2 bg-slate-50/80 rounded-lg p-3 border border-slate-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">导入头文件</label>
                {/* Usage summary */}
                {(() => {
                  const usedCount = headers.filter(h => isHeaderUsedInCode(h, res.code) === 'used').length;
                  const unusedCount = headers.filter(h => isHeaderUsedInCode(h, res.code) === 'unused').length;
                  return (
                    <span className="text-[9px] text-slate-400">
                      {usedCount > 0 && <span className="text-green-600 font-bold">{usedCount} 引用</span>}
                      {usedCount > 0 && unusedCount > 0 && ' · '}
                      {unusedCount > 0 && <span className="text-amber-600 font-bold">{unusedCount} 未引用</span>}
                    </span>
                  );
                })()}
              </div>
              <div className="flex items-center gap-1.5">
                {/* Normalize format */}
                <button
                  onClick={() => {
                    const normalized = headers.map(h => normalizeObjCHeader(h));
                    handleUpdateScanResult(i, { headers: normalized });
                  }}
                  className="text-[9px] px-2 py-0.5 bg-slate-200 text-slate-600 rounded hover:bg-slate-300 font-bold"
                  title="统一 #import 格式"
                >
                  格式化
                </button>
                {/* Remove unused */}
                {headers.some(h => isHeaderUsedInCode(h, res.code) === 'unused') && (
                  <button
                    onClick={() => {
                      const kept = headers.filter(h => isHeaderUsedInCode(h, res.code) !== 'unused');
                      handleUpdateScanResult(i, { headers: kept });
                    }}
                    className="text-[9px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded hover:bg-amber-200 font-bold"
                    title="移除代码中未引用的头文件"
                  >
                    清理未引用
                  </button>
                )}
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
            </div>
            <div className="space-y-1">
              {headers.map((h, hi) => {
                const usage = isHeaderUsedInCode(h, res.code);
                return (
                  <div key={hi} className="flex items-center gap-2">
                    {/* Usage indicator */}
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        usage === 'used' ? 'bg-green-500' : usage === 'unused' ? 'bg-amber-400' : 'bg-slate-300'
                      }`}
                      title={usage === 'used' ? '代码中有引用' : usage === 'unused' ? '代码中未找到引用' : '无法判断'}
                    />
                    <input
                      className={`flex-1 text-xs font-mono bg-white border rounded px-2 py-1 outline-none focus:border-blue-400 ${
                        usage === 'unused' ? 'border-amber-300 text-amber-700' : 'border-slate-200'
                      }`}
                      value={h}
                      onChange={e => {
                        const newHeaders = [...headers];
                        newHeaders[hi] = e.target.value;
                        handleUpdateScanResult(i, { headers: newHeaders });
                      }}
                      placeholder={res.language === 'objectivec' ? '#import <Module/Header.h>' : 'import ModuleName'}
                    />
                    {usage === 'unused' && (
                      <span className="text-[8px] text-amber-500 font-bold shrink-0">未引用</span>
                    )}
                    <button
                      onClick={() => {
                        const newHeaders = headers.filter((_, idx) => idx !== hi);
                        handleUpdateScanResult(i, { headers: newHeaders });
                      }}
                      className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-[9px] font-bold shrink-0"
                    >
                      删除
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Content area: Summary, UsageGuide, Similarity, Code ── */}
      <div className="px-6 pb-6 pt-3 space-y-3">
        {/* Summary */}
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Summary (摘要) - {res.lang === 'cn' ? '中文' : 'EN'}</label>
          <textarea
            rows={1}
            className="w-full text-sm text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none resize-none leading-relaxed focus:ring-2 focus:ring-blue-500/10"
            value={res.summary}
            onChange={e => handleUpdateScanResult(i, { summary: e.target.value })}
          />
        </div>

        {/* Usage Guide */}
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Usage Guide (使用指南) - {res.lang === 'cn' ? '中文' : 'EN'}</label>
          <textarea
            rows={3}
            className="w-full text-sm text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none resize-y leading-relaxed focus:ring-2 focus:ring-blue-500/10"
            value={typeof res.usageGuide === 'object' ? JSON.stringify(res.usageGuide) : (res.usageGuide || '')}
            onChange={e => handleUpdateScanResult(i, { usageGuide: e.target.value })}
            placeholder="何时用 / 关键点 / 依赖..."
          />
        </div>

        {/* Similarity warnings — 仅在有 ≥60% 相似结果时才显示，不产生布局变化 */}
        {(() => {
          const simKey = res.candidateId ?? `scan-${i}`;
          const similar = similarityMap[simKey];
          // 只过滤出有意义的相似结果（≥60%），低于此阈值不显示
          const meaningfulSimilar = (similar || []).filter(s => s.similarity >= 0.6);
          if (meaningfulSimilar.length === 0) return null;
          const highSimilar = meaningfulSimilar.filter(s => s.similarity >= 0.85);
          const hasHighSimilar = highSimilar.length > 0;
          return (
            <div className="space-y-1.5">
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
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-[10px] text-slate-400 font-bold">相似 Recipe：</span>
                {meaningfulSimilar.slice(0, 5).map(s => (
                  <button
                    key={s.recipeName}
                    onClick={() => openCompare(res, s.recipeName, similar || [])}
                    className={`text-[10px] font-bold px-2 py-1 rounded border transition-colors flex items-center gap-1 ${
                      s.similarity >= 0.85
                        ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                        : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                    }`}
                    title={`与 ${s.recipeName} 相似 ${(s.similarity * 100).toFixed(0)}%，点击对比`}
                  >
                    <GitCompare size={ICON_SIZES.xs} />
                    {s.recipeName.replace(/\.md$/i, '')} {(s.similarity * 100).toFixed(0)}%
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Code editing */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase">Standardized Usage Example (标准使用示例)</label>
            {editingCodeIndex === i ? (
              <button
                type="button"
                onClick={() => setEditingCodeIndex(null)}
                className="flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:text-blue-700 px-2 py-1 rounded bg-blue-50"
              >
                <Check size={ICON_SIZES.xs} /> 完成
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setEditingCodeIndex(i)}
                className="flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-100"
                title="编辑代码"
              >
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
};

export default ScanResultCard;
