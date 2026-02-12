import React from 'react';
import { Bookmark, Copy, FolderOpen, Clock, GitBranch, Share2, Shield, MessageSquare, HelpCircle, Code, RefreshCw, Edit3, LogOut, User, ShieldCheck, Eye, Fingerprint } from 'lucide-react';
import { TabType } from '../../constants';
import { ICON_SIZES } from '../../constants/icons';

interface SidebarProps {
  activeTab: TabType;
  navigateToTab: (tab: TabType, options?: { preserveSearch?: boolean }) => void;
  handleRefreshProject: () => void;
  candidateCount: number;
  isDarkMode?: boolean;
  /** 当前登录用户名 */
  currentUser?: string;
  /** 当前角色 */
  currentRole?: string;
  /** 权限模式: token | probe */
  permissionMode?: string;
  /** 登出回调 */
  onLogout?: () => void;
}

const ROLE_LABELS: Record<string, { label: string, color: string, bg: string }> = {
  developer:       { label: '开发者', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
  external_agent:  { label: 'Agent', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
  chat_agent:      { label: 'ChatAgent', color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200' },
};

const MODE_ICONS: Record<string, typeof ShieldCheck> = {
  token: Fingerprint,
  probe: Eye,
};

const Sidebar: React.FC<SidebarProps> = ({ activeTab, navigateToTab, handleRefreshProject, candidateCount, isDarkMode = false, currentUser, currentRole, permissionMode, onLogout }) => {
  const roleInfo = ROLE_LABELS[currentRole || ''] || ROLE_LABELS.developer;
  const ModeIcon = MODE_ICONS[permissionMode || 'probe'] || Eye;

  return (
  <aside className={`w-64 ${isDarkMode ? 'bg-[#252526] border-r border-[#3e3e42]' : 'bg-white border-r border-slate-200'} flex flex-col shrink-0`}>
    <div className={`p-6 border-b ${isDarkMode ? 'border-[#3e3e42]' : 'border-slate-100'}  flex items-center gap-3`}>
    <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white"><Code size={ICON_SIZES.lg} /></div>
    <h1 className="font-bold text-lg">AutoSnippet</h1>
    </div>
    <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
    <button type="button" onClick={() => navigateToTab('recipes')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'recipes' ? (isDarkMode ? 'bg-blue-900/30 text-blue-400 font-medium' : 'bg-blue-50 text-blue-700 font-medium') : (isDarkMode ? 'text-slate-300 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-50')}`}><Bookmark size={ICON_SIZES.lg} /><span>Recipes</span></button>
    <button type="button" onClick={() => navigateToTab('spm')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'spm' ? (isDarkMode ? 'bg-blue-900/30 text-blue-400 font-medium' : 'bg-blue-50 text-blue-700 font-medium') : (isDarkMode ? 'text-slate-300 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-50')}`}><FolderOpen size={ICON_SIZES.lg} /><span>SPM Explorer</span></button>
    <button type="button" onClick={() => navigateToTab('candidates')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'candidates' ? (isDarkMode ? 'bg-blue-900/30 text-blue-400 font-medium' : 'bg-blue-50 text-blue-700 font-medium') : (isDarkMode ? 'text-slate-300 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-50')}`}><Clock size={ICON_SIZES.lg} /><span>Candidates ({candidateCount})</span></button>
    <button type="button" onClick={() => navigateToTab('depgraph')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'depgraph' ? (isDarkMode ? 'bg-blue-900/30 text-blue-400 font-medium' : 'bg-blue-50 text-blue-700 font-medium') : (isDarkMode ? 'text-slate-300 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-50')}`}><GitBranch size={ICON_SIZES.lg} /><span>依赖关系图</span></button>
    <button type="button" onClick={() => navigateToTab('knowledgegraph')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'knowledgegraph' ? (isDarkMode ? 'bg-blue-900/30 text-blue-400 font-medium' : 'bg-blue-50 text-blue-700 font-medium') : (isDarkMode ? 'text-slate-300 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-50')}`}><Share2 size={ICON_SIZES.lg} /><span>知识图谱</span></button>
    <button type="button" onClick={() => navigateToTab('guard')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'guard' ? (isDarkMode ? 'bg-blue-900/30 text-blue-400 font-medium' : 'bg-blue-50 text-blue-700 font-medium') : (isDarkMode ? 'text-slate-300 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-50')}`}><Shield size={ICON_SIZES.lg} /><span>Guard</span></button>
    <button type="button" onClick={() => navigateToTab('ai')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'ai' ? (isDarkMode ? 'bg-blue-900/30 text-blue-400 font-medium' : 'bg-blue-50 text-blue-700 font-medium') : (isDarkMode ? 'text-slate-300 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-50')}`}><MessageSquare size={ICON_SIZES.lg} /><span>AI Assistant</span></button>
    <button type="button" onClick={() => navigateToTab('editor')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'editor' ? (isDarkMode ? 'bg-blue-900/30 text-blue-400 font-medium' : 'bg-blue-50 text-blue-700 font-medium') : (isDarkMode ? 'text-slate-300 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-50')}`}><Edit3 size={ICON_SIZES.lg} /><span>编辑器（测试）</span></button>
    <button type="button" onClick={() => navigateToTab('help')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'help' ? (isDarkMode ? 'bg-blue-900/30 text-blue-400 font-medium' : 'bg-blue-50 text-blue-700 font-medium') : (isDarkMode ? 'text-slate-300 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-50')}`}><HelpCircle size={ICON_SIZES.lg} /><span>使用说明</span></button>
    </nav>
    <div className={`p-4 ${isDarkMode ? 'border-t border-[#3e3e42]' : 'border-t border-slate-100'}`}>
     {/* 角色徽章 */}
     <div className={`flex items-center gap-1.5 mb-3 px-2 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'bg-slate-700/30 border-slate-600 text-slate-400' : roleInfo.bg + ' ' + roleInfo.color}`}>
       <ModeIcon size={ICON_SIZES.xs} />
       <span>{permissionMode === 'token' ? '登录' : '探针'}</span>
       <span className="mx-0.5">&middot;</span>
       <ShieldCheck size={ICON_SIZES.xs} />
       <span>{roleInfo.label}</span>
     </div>
     {currentUser && (
      <div className={`flex items-center justify-between mb-3 px-2 py-1.5 rounded-lg ${isDarkMode ? 'bg-slate-700/30' : 'bg-slate-50'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <User size={ICON_SIZES.sm} className={isDarkMode ? 'text-slate-400' : 'text-slate-500'} />
          <span className={`text-xs font-medium truncate ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>{currentUser}</span>
        </div>
        {onLogout && (
          <button onClick={onLogout} title="登出" className={`shrink-0 p-1 rounded transition-colors ${isDarkMode ? 'text-slate-500 hover:text-red-400 hover:bg-slate-700/50' : 'text-slate-400 hover:text-red-500 hover:bg-red-50'}`}>
            <LogOut size={ICON_SIZES.sm} />
          </button>
        )}
      </div>
     )}
     <button onClick={handleRefreshProject} className={`w-full flex items-center justify-center gap-2 text-[10px] font-bold ${isDarkMode ? 'text-slate-400 hover:text-blue-400' : 'text-slate-400 hover:text-blue-600'} uppercase transition-colors`}>
      <RefreshCw size={ICON_SIZES.xs} /> Refresh Project
     </button>
    </div>
  </aside>
  );
};

export default Sidebar;
