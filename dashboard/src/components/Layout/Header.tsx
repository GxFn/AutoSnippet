import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, RefreshCw, BrainCircuit, Loader2, Cpu, ChevronDown } from 'lucide-react';
import axios from 'axios';
import { ICON_SIZES } from '../../constants/icons';

interface AiProvider {
  id: string;
  label: string;
  defaultModel: string;
}

interface HeaderProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  setShowCreateModal: (show: boolean) => void;
  handleSyncToXcode: () => void;
  aiConfig?: { provider: string; model: string };
  onSemanticSearchResults?: (results: any[]) => void;
  onBeforeAiSwitch?: () => void;
  onAiConfigChange?: () => void;
}

const Header: React.FC<HeaderProps> = ({ searchQuery, setSearchQuery, setShowCreateModal, handleSyncToXcode, aiConfig, onSemanticSearchResults, onBeforeAiSwitch, onAiConfigChange }) => {
  const [isSemanticSearching, setIsSemanticSearching] = useState(false);
  const [aiDropdownOpen, setAiDropdownOpen] = useState(false);
  const [aiProviders, setAiProviders] = useState<AiProvider[]>([]);
  const [aiSwitching, setAiSwitching] = useState(false);
  const aiDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
  if (aiDropdownOpen && aiProviders.length === 0) {
    axios.get<AiProvider[]>('/api/ai/providers').then((res) => setAiProviders(res.data)).catch(() => {});
  }
  }, [aiDropdownOpen, aiProviders.length]);

  useEffect(() => {
  const close = (e: MouseEvent) => {
    if (aiDropdownRef.current && !aiDropdownRef.current.contains(e.target as Node)) setAiDropdownOpen(false);
  };
  document.addEventListener('click', close);
  return () => document.removeEventListener('click', close);
  }, []);

  const handleSemanticSearch = async () => {
  if (!searchQuery) return;
  setIsSemanticSearching(true);
  try {
    const res = await axios.post('/api/search/semantic', { keyword: searchQuery });
    if (onSemanticSearchResults) onSemanticSearchResults(res.data);
  } catch (e) {
    console.error('Semantic search failed', e);
    alert('语义搜索失败。请确保已运行 asd embed 构建索引。');
  } finally {
    setIsSemanticSearching(false);
  }
  };

  const handleSelectAi = async (provider: AiProvider) => {
  setAiSwitching(true);
  try {
    onBeforeAiSwitch?.();
    await axios.post('/api/ai/config', { provider: provider.id, model: provider.defaultModel });
    setAiDropdownOpen(false);
    if (onAiConfigChange) onAiConfigChange();
  } catch (e) {
    console.error('AI config update failed', e);
    alert('切换 AI 失败，请检查项目根目录是否可写。');
  } finally {
    setAiSwitching(false);
  }
  };

  return (
  <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0">
    <div className="flex items-center gap-4">
    <div className="relative w-96">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={ICON_SIZES.md} />
      <input 
      type="text" 
      placeholder="Search knowledge..." 
      className="w-full pl-10 pr-4 py-2 bg-slate-100 border-transparent rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" 
      value={searchQuery} 
      onChange={(e) => setSearchQuery(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && handleSemanticSearch()}
      />
    </div>
    <button 
      onClick={handleSemanticSearch}
      disabled={!searchQuery || isSemanticSearching}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all ${isSemanticSearching ? 'bg-blue-50 text-blue-400' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
      title="Semantic Search (Brain AI)"
    >
      {isSemanticSearching ? <Loader2 size={ICON_SIZES.sm} className="animate-spin" /> : <BrainCircuit size={ICON_SIZES.sm} />}
      Semantic
    </button>
    </div>
    <div className="flex items-center gap-4">
    {aiConfig && (
      <div className="relative" ref={aiDropdownRef}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setAiDropdownOpen((v) => !v); }}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-medium hover:bg-slate-200 transition-colors"
        title="点击切换 AI 提供商"
      >
        <Cpu size={ICON_SIZES.sm} />
        {aiConfig.provider} / {aiConfig.model}
        <ChevronDown size={ICON_SIZES.xs} className={aiDropdownOpen ? 'rotate-180' : ''} />
      </button>
      {aiDropdownOpen && (
        <div className="absolute top-full right-0 mt-1 py-1 rounded-lg border border-slate-200 bg-white shadow-lg z-50 min-w-[200px]">
        <div className="px-3 py-2 text-xs text-slate-500 border-b border-slate-100">切换 AI</div>
        <div className="px-3 py-1.5 text-[11px] text-slate-400 border-b border-slate-100">API Key 仍从 .env 读取</div>
        {aiProviders.length === 0 ? (
          <div className="px-3 py-2 text-xs text-slate-400">加载中...</div>
        ) : (
          aiProviders.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={aiSwitching}
            onClick={() => handleSelectAi(p)}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between ${aiConfig.provider === p.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700'}`}
          >
            <span>{p.label}</span>
            {aiConfig.provider === p.id && <span className="text-xs">✓</span>}
          </button>
          ))
        )}
        </div>
      )}
      </div>
    )}
    <button onClick={() => setShowCreateModal(true)} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors">
      <Plus size={ICON_SIZES.md} /> New Recipe
    </button>
    <button onClick={handleSyncToXcode} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm">
      <RefreshCw size={ICON_SIZES.md} /> Sync to Xcode
    </button>
    </div>
  </header>
  );
};

export default Header;
