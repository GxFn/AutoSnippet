import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X, Search, CheckCircle } from 'lucide-react';
import { ICON_SIZES } from '../../constants/icons';

interface SearchResult {
  name: string;
  path: string;
  content: string;
  qualityScore?: number;
  recommendReason?: string;
}

interface SearchModalProps {
  searchQ: string;
  insertPath: string;
  onClose: () => void;
}

function extractFirstCodeBlock(content: string): string {
  const stripped = content.replace(/^---[\s\S]*?---\s*\n?/, '').trim();
  const match = stripped.match(/```[\w]*\n([\s\S]*?)```/);
  if (match && match[1]) return match[1].trim();
  return stripped.slice(0, 8000);
}

const SearchModal: React.FC<SearchModalProps> = ({ searchQ, insertPath, onClose }) => {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [inserting, setInserting] = useState<string | null>(null);

  useEffect(() => {
  const q = searchQ ? encodeURIComponent(searchQ) : '';
  axios.get<{ results: SearchResult[]; total: number }>(`/api/recipes/search?q=${q}`)
    .then(res => setResults(res.data.results || []))
    .catch(() => setResults([]))
    .finally(() => setLoading(false));
  }, [searchQ]);

  const handleInsert = async (result: SearchResult) => {
  setInserting(result.name);
  try {
    const content = extractFirstCodeBlock(result.content);
    await axios.post('/api/insert-at-search-mark', { path: insertPath, content });
    alert('✅ 已插入到 ' + insertPath);
    onClose();
  } catch (err) {
    alert('❌ 插入失败');
  } finally {
    setInserting(null);
  }
  };

  return (
  <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
    <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
      <h2 className="text-xl font-bold flex items-center gap-2 text-slate-800">
      <Search size={ICON_SIZES.xl} className="text-blue-600" /> as:search — 选择并插入
      </h2>
      <button onClick={onClose} className="p-2 hover:bg-white rounded-full transition-colors"><X size={ICON_SIZES.lg} /></button>
    </div>
    <div className="p-4 text-sm text-slate-500 border-b border-slate-100">
      关键词: {searchQ || '(全部)'} · 插入到: {insertPath}
    </div>
    <div className="flex-1 overflow-y-auto p-4">
      {loading ? (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
      ) : results.length === 0 ? (
      <div className="text-slate-500 text-center py-8">未找到匹配的 Recipe</div>
      ) : (
      <ul className="space-y-2">
        {results.map((r) => (
        <li key={r.name}>
          <button
          type="button"
          onClick={() => handleInsert(r)}
          disabled={inserting !== null}
          className="w-full flex items-center justify-between gap-3 p-4 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all text-left disabled:opacity-50"
          >
          <div className="flex-1 flex flex-col gap-1">
            <span className="font-medium text-slate-800 truncate">{r.name}</span>
            {(r.qualityScore !== undefined || r.recommendReason) && (
            <div className="flex items-center gap-2 flex-wrap">
              {r.qualityScore !== undefined && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 rounded text-xs text-blue-700 font-medium">
                🤖 质量: {(r.qualityScore * 100).toFixed(0)}%
              </span>
              )}
              {r.recommendReason && (
              <span className="text-xs text-slate-600 italic truncate max-w-xs">
                {r.recommendReason}
              </span>
              )}
            </div>
            )}
          </div>
          {inserting === r.name ? (
            <span className="text-blue-600 text-sm flex items-center gap-1"><span className="animate-spin">⏳</span> 插入中...</span>
          ) : (
            <span className="text-blue-600 text-sm flex items-center gap-1"><CheckCircle size={ICON_SIZES.md} /> 插入</span>
          )}
          </button>
        </li>
        ))}
      </ul>
      )}
    </div>
    </div>
  </div>
  );
};

export default SearchModal;
