import React from 'react';
import { Bookmark, Copy, FolderOpen, Clock, GitBranch, Shield, MessageSquare, HelpCircle, Code, RefreshCw, Edit3 } from 'lucide-react';
import { TabType } from '../../constants';
import { ICON_SIZES } from '../../constants/icons';
import { ProjectData } from '../../types';

interface SidebarProps {
  activeTab: TabType;
  navigateToTab: (tab: TabType, options?: { preserveSearch?: boolean }) => void;
  handleRefreshProject: () => void;
  candidateCount: number;
  isDarkMode?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, navigateToTab, handleRefreshProject, candidateCount, isDarkMode = false }) => {
  return (
  <aside className={`w-64 ${isDarkMode ? 'bg-[#252526] border-r border-[#3e3e42]' : 'bg-white border-r border-slate-200'} flex flex-col shrink-0`}>
    <div className={`p-6 border-b ${isDarkMode ? 'border-[#3e3e42]' : 'border-slate-100'}  flex items-center gap-3`}>
    <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white"><Code size={ICON_SIZES.lg} /></div>
    <h1 className="font-bold text-lg">AutoSnippet</h1>
    </div>
    <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
    <button type="button" onClick={() => navigateToTab('recipes')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'recipes' ? (isDarkMode ? 'bg-blue-900/30 text-blue-400 font-medium' : 'bg-blue-50 text-blue-700 font-medium') : (isDarkMode ? 'text-slate-300 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-50')}`}><Bookmark size={ICON_SIZES.lg} /><span>Recipes</span></button>
    <button type="button" onClick={() => navigateToTab('snippets')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'snippets' ? (isDarkMode ? 'bg-blue-900/30 text-blue-400 font-medium' : 'bg-blue-50 text-blue-700 font-medium') : (isDarkMode ? 'text-slate-300 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-50')}`}><Copy size={ICON_SIZES.lg} /><span>Snippets</span></button>
    <button type="button" onClick={() => navigateToTab('spm')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'spm' ? (isDarkMode ? 'bg-blue-900/30 text-blue-400 font-medium' : 'bg-blue-50 text-blue-700 font-medium') : (isDarkMode ? 'text-slate-300 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-50')}`}><FolderOpen size={ICON_SIZES.lg} /><span>SPM Explorer</span></button>
    <button type="button" onClick={() => navigateToTab('candidates')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'candidates' ? (isDarkMode ? 'bg-blue-900/30 text-blue-400 font-medium' : 'bg-blue-50 text-blue-700 font-medium') : (isDarkMode ? 'text-slate-300 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-50')}`}><Clock size={ICON_SIZES.lg} /><span>Candidates ({candidateCount})</span></button>
    <button type="button" onClick={() => navigateToTab('depgraph')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'depgraph' ? (isDarkMode ? 'bg-blue-900/30 text-blue-400 font-medium' : 'bg-blue-50 text-blue-700 font-medium') : (isDarkMode ? 'text-slate-300 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-50')}`}><GitBranch size={ICON_SIZES.lg} /><span>依赖关系图</span></button>
    <button type="button" onClick={() => navigateToTab('guard')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'guard' ? (isDarkMode ? 'bg-blue-900/30 text-blue-400 font-medium' : 'bg-blue-50 text-blue-700 font-medium') : (isDarkMode ? 'text-slate-300 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-50')}`}><Shield size={ICON_SIZES.lg} /><span>Guard</span></button>
    <button type="button" onClick={() => navigateToTab('ai')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'ai' ? (isDarkMode ? 'bg-blue-900/30 text-blue-400 font-medium' : 'bg-blue-50 text-blue-700 font-medium') : (isDarkMode ? 'text-slate-300 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-50')}`}><MessageSquare size={ICON_SIZES.lg} /><span>AI Assistant</span></button>
    <button type="button" onClick={() => navigateToTab('editor')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'editor' ? (isDarkMode ? 'bg-blue-900/30 text-blue-400 font-medium' : 'bg-blue-50 text-blue-700 font-medium') : (isDarkMode ? 'text-slate-300 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-50')}`}><Edit3 size={ICON_SIZES.lg} /><span>Xcode 编辑器</span></button>
    <button type="button" onClick={() => navigateToTab('help')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'help' ? (isDarkMode ? 'bg-blue-900/30 text-blue-400 font-medium' : 'bg-blue-50 text-blue-700 font-medium') : (isDarkMode ? 'text-slate-300 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-50')}`}><HelpCircle size={ICON_SIZES.lg} /><span>使用说明</span></button>
    </nav>
    <div className={`p-4 ${isDarkMode ? 'border-t border-[#3e3e42]' : 'border-t border-slate-100'}`}>
     <button onClick={handleRefreshProject} className={`w-full flex items-center justify-center gap-2 text-[10px] font-bold ${isDarkMode ? 'text-slate-400 hover:text-blue-400' : 'text-slate-400 hover:text-blue-600'} uppercase transition-colors`}>
      <RefreshCw size={ICON_SIZES.xs} /> Refresh Project
     </button>
    </div>
  </aside>
  );
};

export default Sidebar;
