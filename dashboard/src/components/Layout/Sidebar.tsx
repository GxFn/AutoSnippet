import React from 'react';
import { Bookmark, Copy, FolderOpen, Clock, GitBranch, Shield, MessageSquare, HelpCircle, Code, RefreshCw } from 'lucide-react';
import { TabType } from '../../constants';
import { ProjectData } from '../../types';

interface SidebarProps {
	activeTab: TabType;
	navigateToTab: (tab: TabType, options?: { preserveSearch?: boolean }) => void;
	handleRefreshProject: () => void;
	candidateCount: number;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, navigateToTab, handleRefreshProject, candidateCount }) => {
	return (
		<aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0">
			<div className="p-6 border-b border-slate-100 flex items-center gap-3">
				<div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white"><Code size={20} /></div>
				<h1 className="font-bold text-lg">AutoSnippet</h1>
			</div>
			<nav className="flex-1 p-4 space-y-2 overflow-y-auto">
				<button type="button" onClick={() => navigateToTab('recipes')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'recipes' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}><Bookmark size={20} /><span>Recipes</span></button>
				<button type="button" onClick={() => navigateToTab('snippets')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'snippets' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}><Copy size={20} /><span>Snippets</span></button>
				<button type="button" onClick={() => navigateToTab('spm')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'spm' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}><FolderOpen size={20} /><span>SPM Explorer</span></button>
				<button type="button" onClick={() => navigateToTab('candidates')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'candidates' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}><Clock size={20} /><span>Candidates ({candidateCount})</span></button>
				<button type="button" onClick={() => navigateToTab('depgraph')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'depgraph' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}><GitBranch size={20} /><span>依赖关系图</span></button>
				<button type="button" onClick={() => navigateToTab('guard')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'guard' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}><Shield size={20} /><span>Guard</span></button>
				<button type="button" onClick={() => navigateToTab('ai')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'ai' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}><MessageSquare size={20} /><span>AI Assistant</span></button>
				<button type="button" onClick={() => navigateToTab('help')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'help' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}><HelpCircle size={20} /><span>使用说明</span></button>
			</nav>
			<div className="p-4 border-t border-slate-100">
				 <button onClick={handleRefreshProject} className="w-full flex items-center justify-center gap-2 text-[10px] font-bold text-slate-400 uppercase hover:text-blue-600 transition-colors">
						<RefreshCw size={12} /> Refresh Project
				 </button>
			</div>
		</aside>
	);
};

export default Sidebar;
