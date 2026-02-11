import React, { useState } from 'react';
import { Search, X, Zap, FileText, Loader2, ChevronRight } from 'lucide-react';
import api from '../../api';
import { ICON_SIZES } from '../../constants/icons';
import CodeBlock from '../Shared/CodeBlock';

interface XcodeSearchResult {
  name: string;
  snippet: string;
  similarity: number;
  isContextRelevant: boolean;
  authority: number;
  usageCount: number;
  stats?: any;
  qualityScore?: number;
  recommendReason?: string;
}

interface XcodeSearchSimulatorProps {
  isOpen: boolean;
  onClose: () => void;
}

const XcodeSearchSimulator: React.FC<XcodeSearchSimulatorProps> = ({ isOpen, onClose }) => {
  const [searchInput, setSearchInput] = useState('// as:s network');
  const [filePath, setFilePath] = useState('Sources/BDNetwork/NetworkService.swift');
  const [results, setResults] = useState<XcodeSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [targetName, setTargetName] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedResult, setSelectedResult] = useState<XcodeSearchResult | null>(null);

  const handleSearch = async () => {
  if (!searchInput.trim()) return;

  setIsSearching(true);
  try {
    const response = await api.xcodeSimulateSearch({
    filePath,
    lineNumber: 1,
    keyword: searchInput,
    projectName: 'ByteDance'
    });

    if (response.results) {
    setResults(response.results || []);
    setTargetName(response.targetName);
    }
  } catch (error) {
    alert('搜索失败: ' + (error instanceof Error ? error.message : '未知错误'));
  } finally {
    setIsSearching(false);
  }
  };

  if (!isOpen) return null;

  return (
  <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4">
    <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
    {/* Header */}
    <div className="border-b border-slate-200 p-6 shrink-0">
      <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <FileText size={ICON_SIZES.lg} className="text-blue-600" />
        <h2 className="text-xl font-bold text-slate-900">Xcode 搜索模拟器</h2>
      </div>
      <button
        onClick={onClose}
        className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
      >
        <X size={ICON_SIZES.lg} className="text-slate-500" />
      </button>
      </div>

      <div className="space-y-3">
      {/* File Path Input */}
      <div>
        <label className="text-sm font-medium text-slate-700 block mb-1">
        文件路径
        </label>
        <input
        type="text"
        value={filePath}
        onChange={(e) => setFilePath(e.target.value)}
        placeholder="Sources/BDNetwork/NetworkService.swift"
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        <p className="text-xs text-slate-500 mt-1">
        💡 系统将从路径推断 Target 名称
        </p>
      </div>

      {/* Search Input */}
      <div>
        <label className="text-sm font-medium text-slate-700 block mb-1">
        搜索触发（如 Xcode 代码注释）
        </label>
        <div className="flex gap-2">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="// as:s keyword"
          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        <button
          onClick={handleSearch}
          disabled={isSearching || !searchInput.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition-colors flex items-center gap-2"
        >
          {isSearching ? (
          <Loader2 size={ICON_SIZES.md} className="animate-spin" />
          ) : (
          <Search size={ICON_SIZES.md} />
          )}
          {isSearching ? '搜索中...' : '搜索'}
        </button>
        </div>
      </div>
      </div>
    </div>

    {/* Content */}
    <div className="flex-1 overflow-auto p-6">
      {targetName && (
      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-900">
        <strong>推断 Target:</strong> {targetName}
        </p>
      </div>
      )}

      {results.length > 0 ? (
      <div className="space-y-3">
        <h3 className="font-semibold text-slate-900 text-sm mb-3">
        搜索结果 ({results.length})
        </h3>
        {results.map((result, idx) => (
        <div
          key={idx}
          className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-start justify-between mb-2">
          <div className="flex-1">
            <h4 className="font-semibold text-slate-900 text-sm">
            {result.name}
            </h4>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded text-xs text-slate-600">
              <Zap size={ICON_SIZES.xs} />
              {result.similarity}%
            </span>
            {result.isContextRelevant && (
              <span className="inline-flex items-center px-2 py-0.5 bg-green-100 rounded text-xs text-green-700 font-medium">
              ✓ 上下文相关
              </span>
            )}
            {result.qualityScore !== undefined && (
              <span className="inline-flex items-center px-2 py-0.5 bg-blue-100 rounded text-xs text-blue-700 font-medium">
              🤖 质量: {(result.qualityScore * 100).toFixed(0)}%
              </span>
            )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-600">
            权威: {result.authority}
            </p>
            <p className="text-xs text-slate-600">
            用: {result.usageCount}x
            </p>
          </div>
          </div>

          {result.recommendReason && (
          <div className="text-xs text-slate-500 bg-blue-50 p-2 rounded mt-2 border border-blue-100">
            <p className="font-medium text-blue-700 mb-0.5">推荐理由:</p>
            <p>{result.recommendReason}</p>
          </div>
          )}

          {result.snippet && (
          <div className="text-xs text-slate-600 bg-slate-50 p-2 rounded mt-2 max-h-[100px] overflow-hidden">
            <p className="line-clamp-3">{result.snippet}</p>
          </div>
          )}

          <button
          onClick={() => {
            setSelectedResult(result);
            setDetailsOpen(true);
          }}
          className="mt-3 w-full py-1.5 bg-blue-50 text-blue-600 rounded text-xs font-medium hover:bg-blue-100 transition-colors flex items-center justify-center gap-1"
          >
          <ChevronRight size={ICON_SIZES.sm} />
          查看完整内容
          </button>
        </div>
        ))}
      </div>
      ) : isSearching ? (
      <div className="flex items-center justify-center h-32">
        <div className="text-center">
        <Loader2 size={ICON_SIZES.xxl} className="animate-spin text-blue-600 mx-auto mb-2" />
        <p className="text-slate-600 text-sm">搜索中...</p>
        </div>
      </div>
      ) : (
      <div className="flex items-center justify-center h-32 text-slate-500">
        <p className="text-sm">输入搜索内容后点击"搜索"</p>
      </div>
      )}
    </div>

    {/* Footer */}
    <div className="border-t border-slate-200 p-4 bg-slate-50 text-xs text-slate-600 shrink-0">
      <p>
      💡 <strong>使用提示：</strong>
      在 Xcode 中输入 <code className="bg-slate-200 px-1 rounded">// as:s keyword</code> 可触发搜索
      </p>
    </div>

    {/* 详情模态框 */}
    {detailsOpen && selectedResult && (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b border-slate-200 p-6 flex items-start justify-between shrink-0">
        <div>
          <h3 className="text-lg font-bold text-slate-900">{selectedResult.name}</h3>
          <div className="flex items-center gap-4 mt-2 flex-wrap">
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
            相似度: {selectedResult.similarity}%
          </span>
          {selectedResult.isContextRelevant && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
            ✓ 上下文相关
            </span>
          )}
          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">
            权威: {selectedResult.authority}
          </span>
          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded">
            使用: {selectedResult.usageCount}x
          </span>
          </div>
        </div>
        <button
          onClick={() => setDetailsOpen(false)}
          className="p-1 hover:bg-slate-100 rounded transition-colors shrink-0"
        >
          <X size={ICON_SIZES.lg} className="text-slate-500" />
        </button>
        </div>

        {/* Content */}
        <div className="overflow-auto flex-1 p-6">
        <div className="prose prose-sm max-w-none">
          {selectedResult.snippet ? (
          <CodeBlock code={selectedResult.snippet} language="swift" />
          ) : (
          <p className="text-slate-500 text-sm">无内容</p>
          )}
        </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 p-4 bg-slate-50 flex justify-end gap-2 shrink-0">
        <button
          onClick={() => setDetailsOpen(false)}
          className="px-4 py-2 text-slate-700 hover:bg-slate-200 rounded transition-colors text-sm font-medium"
        >
          关闭
        </button>
        <button
          onClick={() => {
          // 复制到剪贴板
          if (navigator.clipboard && selectedResult.snippet) {
            navigator.clipboard.writeText(selectedResult.snippet).then(() => {
            alert('已复制到剪贴板');
            setDetailsOpen(false);
            });
          }
          }}
          className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded transition-colors text-sm font-medium flex items-center gap-2"
        >
          <ChevronRight size={ICON_SIZES.md} />
          复制代码
        </button>
        </div>
      </div>
      </div>
    )}
    </div>
  </div>
  );
};

export default XcodeSearchSimulator;
