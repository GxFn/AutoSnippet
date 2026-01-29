import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Terminal, Cpu, MessageSquare, Search, Code, Plus, Save, X, Trash2, Box, Zap, CheckCircle, Edit3, RefreshCw, Clipboard, FileSearch, Globe, Layers, Layout, HardDrive, Wifi, Database, FileCode, BookOpen } from 'lucide-react';
import { Snippet, Skill, ProjectData, SPMTarget, ExtractedSkill } from './types';

const categoryConfigs: Record<string, { icon: any, color: string, bg: string, border: string }> = {
  All: { icon: Globe, color: 'text-slate-600', bg: 'bg-slate-100', border: 'border-slate-200' },
  View: { icon: Layout, color: 'text-pink-600', bg: 'bg-pink-50', border: 'border-pink-100' },
  Service: { icon: Cpu, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-100' },
  Tool: { icon: Zap, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100' },
  Model: { icon: Database, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' },
  Network: { icon: Wifi, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100' },
  Storage: { icon: HardDrive, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-100' },
  UI: { icon: Box, color: 'text-cyan-600', bg: 'bg-cyan-50', border: 'border-cyan-100' },
  Utility: { icon: Layers, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-100' },
};

const App: React.FC = () => {
  const validTabs = ['snippets', 'skills', 'ai', 'spm', 'candidates', 'help'] as const;
  const getTabFromPath = (): typeof validTabs[number] => {
    const path = window.location.pathname.replace(/^\//, '').split('/')[0] || '';
    return (validTabs.includes(path as any) ? path : 'snippets') as any;
  };

  const [data, setData] = useState<ProjectData | null>(null);
  const [activeTab, setActiveTab] = useState<typeof validTabs[number]>(getTabFromPath());

  const navigateToTab = (tab: typeof validTabs[number], options?: { preserveSearch?: boolean }) => {
    setActiveTab(tab);
    const search = options?.preserveSearch && window.location.search ? window.location.search : '';
    window.history.pushState({}, document.title, `/${tab}${search}`);
  };

  const openSnippetEdit = (snippet: Snippet) => {
    const cleanTitle = snippet.title.replace(/^\[.*?\]\s*/, '');
    setEditingSnippet({ ...snippet, title: cleanTitle });
    setActiveTab('snippets');
    const q = new URLSearchParams(window.location.search);
    q.set('edit', snippet.identifier);
    window.history.pushState({}, document.title, `/snippets?${q.toString()}`);
  };

  const closeSnippetEdit = () => {
    setEditingSnippet(null);
    window.history.replaceState({}, document.title, '/snippets');
  };

  const openSkillEdit = (skill: Skill) => {
    setEditingSkill(skill);
    setActiveTab('skills');
    const q = new URLSearchParams(window.location.search);
    q.set('edit', encodeURIComponent(skill.name));
    window.history.pushState({}, document.title, `/skills?${q.toString()}`);
  };

  const closeSkillEdit = () => {
    setEditingSkill(null);
    window.history.replaceState({}, document.title, '/skills');
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  
  const [targets, setTargets] = useState<SPMTarget[]>([]);
  const [selectedTargetName, setSelectedTargetName] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState<(ExtractedSkill & { mode: 'full' | 'preview', lang: 'cn' | 'en' })[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [categories, setCategories] = useState<string[]>(['All', 'View', 'Service', 'Tool', 'Model', 'Network', 'Storage', 'UI', 'Utility']);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createPath, setCreatePath] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [chatHistory, setChatHistory] = useState<{role: 'user'|'model', text: string}[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isAiThinking, setIsAiThinking] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setActiveTab(getTabFromPath());
  }, []);

  useEffect(() => {
    if (!data) return;
    const pathname = window.location.pathname.replace(/^\//, '').split('/')[0];
    const params = new URLSearchParams(window.location.search);
    const editId = params.get('edit');
    if (pathname === 'snippets' && editId && data.rootSpec?.list) {
      const snippet = data.rootSpec.list.find((s: Snippet) => s.identifier === editId);
      if (snippet && !editingSnippet) {
        setActiveTab('snippets');
        openSnippetEdit(snippet);
      }
    }
    if (pathname === 'skills' && editId && data.skills) {
      try {
        const name = decodeURIComponent(editId);
        const skill = data.skills.find((s: Skill) => s.name === name);
        if (skill && !editingSkill) {
          setActiveTab('skills');
          openSkillEdit(skill);
        }
      } catch (_) {}
    }
  }, [data]);

  useEffect(() => {
    fetchData();
    fetchTargets();

    const handlePopState = () => {
      setActiveTab(getTabFromPath());
    };
    window.addEventListener('popstate', handlePopState);

    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    const path = params.get('path');
    const source = params.get('source');

    if (action === 'create' && path) {
      setCreatePath(path);
      setShowCreateModal(true);
      // 不在这里清除 URL 参数，便于在 /spm 页仍能看到 action、path
      setTimeout(async () => {
        if (source === 'clipboard') {
          try {
            const text = await navigator.clipboard.readText();
            if (text && text.trim()) {
              handleCreateFromClipboard(path);
              return;
            }
          } catch (_) {}
        }
        handleCreateFromPathWithSpecifiedPath(path);
      }, 500);
    }
  }, []);

  const handleCreateFromPathWithSpecifiedPath = async (specifiedPath: string) => {
    setIsExtracting(true);
    try {
      const res = await axios.post<{ result: ExtractedSkill[], isMarked: boolean }>('/api/extract/path', { relativePath: specifiedPath });
      setScanResults(res.data.result.map(item => ({ 
        ...item, 
        mode: 'full',
        lang: 'cn',
        includeHeaders: true,
        category: item.category || 'Utility',
        summary: item.summary_cn || item.summary || '',
        usageGuide: item.usageGuide_cn || item.usageGuide || ''
      })));
      navigateToTab('spm', { preserveSearch: true });
      setShowCreateModal(false);
    } catch (err) {
      alert('Extraction failed.');
    } finally {
      setIsExtracting(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await axios.get<ProjectData>('/api/data');
      setData(res.data);
    } catch (_) {
    } finally {
      setLoading(false);
    }
  };

  const fetchTargets = async () => {
    try {
      const res = await axios.get<SPMTarget[]>('/api/spm/targets');
      setTargets(res.data);
    } catch (_) {
    }
  };

  const handleSyncToXcode = async () => {
    try {
      await axios.post('/api/commands/install');
      alert('✅ Successfully synced to Xcode CodeSnippets!');
    } catch (err) {
      alert('❌ Sync failed');
    }
  };

  const handleRefreshProject = async () => {
    try {
      await axios.post('/api/commands/spm-map');
      fetchTargets();
      alert('✅ Project structure refreshed!');
    } catch (err) {
      alert('❌ Refresh failed');
    }
  };

  const handleCreateFromPath = async () => {
    if (!createPath) return;
    setIsExtracting(true);
    try {
      const res = await axios.post<{ result: ExtractedSkill[], isMarked: boolean }>('/api/extract/path', { relativePath: createPath });
      setScanResults(res.data.result.map(item => ({ 
        ...item, 
        mode: 'full', 
        lang: 'cn',
        includeHeaders: true,
        category: item.category || 'Utility',
        summary: item.summary_cn || item.summary || '',
        usageGuide: item.usageGuide_cn || item.usageGuide || ''
      })));
      navigateToTab('spm');
      setShowCreateModal(false);
      if (res.data.isMarked) {
        alert('🎯 Precision Lock: Successfully extracted code between // as:code markers.');
      } else {
        alert('ℹ️ No markers found. AI is analyzing the full file.');
      }
    } catch (err) {
      alert('Extraction failed. Check path.');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleCreateFromClipboard = async (contextPath?: string) => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return alert('Clipboard is empty');
      
      setIsExtracting(true);
      // 由 // as:create 打开时传入 contextPath，后端按路径解析头文件（headers/headerPaths/moduleName）
      const relativePath = contextPath || createPath;
      const res = await axios.post<ExtractedSkill>('/api/extract/text', {
        text,
        ...(relativePath ? { relativePath } : {})
      });
      const item = res.data;
      setScanResults([{ 
        ...item, 
        mode: 'full', 
        lang: 'cn',
        includeHeaders: true,
        category: item.category || 'Utility',
        summary: item.summary_cn || item.summary || '',
        usageGuide: item.usageGuide_cn || item.usageGuide || ''
      }]);
      navigateToTab('spm', { preserveSearch: true });
      setShowCreateModal(false);
    } catch (err) {
      alert('Failed to read clipboard or AI error');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleScanTarget = async (target: SPMTarget) => {
    if (isScanning) return;
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setSelectedTargetName(target.name);
    setIsScanning(true);
    setScanResults([]);
    try {
      const res = await axios.post<ExtractedSkill[]>('/api/spm/scan', { target }, {
        signal: controller.signal
      });
      if (Array.isArray(res.data)) {
        setScanResults(res.data.map(item => ({ 
          ...item, 
          mode: 'full',
          lang: 'cn',
          includeHeaders: item.includeHeaders !== false,
          category: item.category || 'Utility',
          summary: item.summary_cn || item.summary || '',
          usageGuide: item.usageGuide_cn || item.usageGuide || ''
        })));
      } else {
        alert((res.data as { message?: string })?.message || 'Scan failed: Unexpected response format');
      }
    } catch (err: any) {
      if (axios.isCancel(err)) return;
      alert(`Scan failed: ${err.response?.data?.error || err.message}`);
    } finally {
      if (abortControllerRef.current === controller) {
        setIsScanning(false);
        abortControllerRef.current = null;
      }
    }
  };

  const handleUpdateScanResult = (index: number, updates: Partial<ExtractedSkill & { mode: 'full' | 'preview', lang: 'cn' | 'en'; includeHeaders?: boolean }>) => {
    const newResults = [...scanResults];
    const current = { ...newResults[index], ...updates };
    
    if (updates.lang !== undefined) {
      current.summary = updates.lang === 'cn' ? (current.summary_cn || current.summary) : (current.summary_en || current.summary);
      current.usageGuide = updates.lang === 'cn' ? (current.usageGuide_cn || current.usageGuide) : (current.usageGuide_en || current.usageGuide);
    } else {
      if (updates.summary !== undefined) {
        if (current.lang === 'cn') current.summary_cn = updates.summary;
        else current.summary_en = updates.summary;
      }
      if (updates.usageGuide !== undefined) {
        if (current.lang === 'cn') current.usageGuide_cn = updates.usageGuide;
        else current.usageGuide_en = updates.usageGuide;
      }
    }

    newResults[index] = current;
    setScanResults(newResults);
  };

  const handleSaveExtracted = async (extracted: ExtractedSkill & { mode: 'full' | 'preview' }) => {
    try {
      const triggers = extracted.trigger.split(/[,，\s]+/).map(t => t.trim()).filter(Boolean);
      const primarySnippetId = crypto.randomUUID().toUpperCase();
      
      if (extracted.mode === 'full') {
        for (let i = 0; i < triggers.length; i++) {
          const t = triggers[i];
          const includeHeaders = extracted.includeHeaders !== false;
          const snippet: Snippet = {
            identifier: i === 0 ? primarySnippetId : crypto.randomUUID().toUpperCase(),
            title: triggers.length > 1 ? `${extracted.title} (${t})` : extracted.title,
            completionKey: t,
            category: extracted.category,
            summary: extracted.summary,
            language: extracted.language,
            content: extracted.code.split('\n'),
            headers: includeHeaders ? (extracted.headers || []) : [],
            headerPaths: includeHeaders ? (extracted.headerPaths || []) : undefined,
            moduleName: extracted.moduleName,
            includeHeaders
          };
          await axios.post('/api/snippets/save', { snippet });
        }
      }

      const skillName = `${extracted.title.replace(/\s+/g, '-')}.md`;
      const skillContent = `---
id: ${extracted.mode === 'full' ? primarySnippetId : 'preview-only'}
title: ${extracted.title}
language: ${extracted.language}
trigger: ${triggers.join(', ')}
category: ${extracted.category || 'Utility'}
summary: ${extracted.summary}
type: ${extracted.mode}
headers: ${JSON.stringify(extracted.headers || [])}
---

## Snippet / Code Reference

\`\`\`${extracted.language}
${extracted.code}
\`\`\`

## AI Context / Usage Guide

${extracted.usageGuide}
`;
      await axios.post('/api/skills/save', { name: skillName, content: skillContent });
      
      alert(extracted.mode === 'full' ? '✅ Saved as Snippet & Skill!' : '✅ Saved to KB!');
      fetchData();
      setScanResults(prev => prev.filter(item => item.title !== extracted.title));
    } catch (err) {
      alert('❌ Failed to save');
    }
  };

  const handleSaveSkill = async () => {
    if (!editingSkill) return;
    try {
      await axios.post('/api/skills/save', { name: editingSkill.name, content: editingSkill.content });
      closeSkillEdit();
      fetchData();
    } catch (err) {
      alert('Failed to save skill');
    }
  };

  const handleDeleteSkill = async (name: string) => {
    if (!window.confirm(`Are you sure?`)) return;
    try {
      await axios.post('/api/skills/delete', { name });
      fetchData();
    } catch (err) {
      alert('Failed to delete');
    }
  };

  const handleDeleteCandidate = async (targetName: string, candidateId: string) => {
    try {
      await axios.post('/api/candidates/delete', { targetName, candidateId });
      fetchData();
    } catch (err) {
      alert('Action failed.');
    }
  };

  const handleSaveCandidateAsApproved = async (targetName: string, cand: any) => {
    await handleSaveExtracted(cand);
    await handleDeleteCandidate(targetName, cand.id);
  };

  const handleSaveSnippet = async () => {
    if (!editingSnippet) return;
    try {
      await axios.post('/api/snippets/save', { snippet: editingSnippet });
      closeSnippetEdit();
      fetchData();
    } catch (err) {
      alert('Failed to save snippet');
    }
  };

  const handleDeleteSnippet = async (identifier: string, title: string) => {
    if (!window.confirm(`Delete snippet: ${title}?`)) return;
    try {
      await axios.post('/api/snippets/delete', { identifier });
      fetchData();
    } catch (err) {
      alert('Failed to delete');
    }
  };

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim() || isAiThinking) return;
    const userMsg = { role: 'user' as const, text: userInput };
    setChatHistory(prev => [...prev, userMsg]);
    setUserInput('');
    setIsAiThinking(true);
    try {
      const res = await axios.post('/api/ai/chat', {
        prompt: userInput,
        history: chatHistory.map(h => ({ role: h.role, content: h.text }))
      });
      setChatHistory(prev => [...prev, { role: 'model', text: res.data.text }]);
    } catch (err) {
      setChatHistory(prev => [...prev, { role: 'model', text: 'Error' }]);
    } finally {
      setIsAiThinking(false);
    }
  };

  const filteredSnippets = data?.rootSpec.list.filter(s => {
    const title = s.title || '';
    const completionKey = s.completionKey || '';
    const matchesSearch = title.toLowerCase().includes(searchQuery.toLowerCase()) || completionKey.toLowerCase().includes(searchQuery.toLowerCase());
    if (selectedCategory === 'All') return matchesSearch;
    const category = s.category || 'Utility';
    return matchesSearch && category === selectedCategory;
  }) || [];

  const filteredSkills = data?.skills.filter(s => {
    const name = s.name || '';
    const content = s.content || '';
    const matchesSearch = name.toLowerCase().includes(searchQuery.toLowerCase()) || content.toLowerCase().includes(searchQuery.toLowerCase());
    if (selectedCategory === 'All') return matchesSearch;
    const categoryMatch = content ? content.match(/category:\s*(.*)/) : null;
    const category = categoryMatch ? categoryMatch[1].trim() : 'Utility';
    return matchesSearch && category === selectedCategory;
  }) || [];
  
  const isShellTarget = (name: string) => {
    const shellKeywords = ['Example', 'Demo', 'Sample', 'Tests', 'Spec', 'Mock', 'Runner'];
    return shellKeywords.some(key => name.endsWith(key) || name.includes(key));
  };

  const filteredTargets = targets
    .filter(t => t.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      const aShell = isShellTarget(a.name);
      const bShell = isShellTarget(b.name);
      if (aShell && !bShell) return 1;
      if (!aShell && bShell) return -1;
      return a.name.localeCompare(b.name);
    });

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden font-sans">
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white"><Code size={20} /></div>
          <h1 className="font-bold text-lg">AutoSnippet</h1>
        </div>
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <button type="button" onClick={() => navigateToTab('snippets')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'snippets' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}><Terminal size={20} /><span>Snippets</span></button>
          <button type="button" onClick={() => navigateToTab('skills')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'skills' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}><Cpu size={20} /><span>Knowledge Base</span></button>
          <button type="button" onClick={() => navigateToTab('spm')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'spm' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}><Box size={20} /><span>SPM Explorer</span></button>
          <button type="button" onClick={() => navigateToTab('candidates')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'candidates' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}><Zap size={20} /><span>Candidates ({Object.values(data?.candidates || {}).reduce((acc, curr) => acc + curr.items.length, 0)})</span></button>
          <button type="button" onClick={() => navigateToTab('ai')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'ai' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}><MessageSquare size={20} /><span>AI Assistant</span></button>
          <button type="button" onClick={() => navigateToTab('help')} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${activeTab === 'help' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}><BookOpen size={20} /><span>使用说明</span></button>
        </nav>
        <div className="p-4 border-t border-slate-100">
           <button onClick={handleRefreshProject} className="w-full flex items-center justify-center gap-2 text-[10px] font-bold text-slate-400 uppercase hover:text-blue-600 transition-colors">
              <RefreshCw size={12} /> Refresh Project
           </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0">
          <div className="relative w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input type="text" placeholder="Search knowledge..." className="w-full pl-10 pr-4 py-2 bg-slate-100 border-transparent rounded-lg text-sm outline-none" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowCreateModal(true)} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors">
              <Plus size={16} /> New Knowledge
            </button>
            <button onClick={handleSyncToXcode} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm">
              <RefreshCw size={16} /> Sync to Xcode
            </button>
          </div>
        </header>

        {(activeTab === 'snippets' || activeTab === 'skills') && (
          <div className="bg-white border-b border-slate-100 shrink-0 overflow-hidden">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar px-8 py-3">
              {Object.entries(categoryConfigs).map(([cat, config]) => {
                const Icon = config.icon;
                const isSelected = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold transition-all border whitespace-nowrap
                      ${isSelected 
                        ? `${config.bg} ${config.color} ${config.border} shadow-sm scale-105` 
                        : 'bg-white text-slate-400 border-slate-100 hover:border-slate-200 hover:text-slate-600'}`}
                  >
                    <Icon size={12} />
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-8">
          {loading ? (
            <div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
          ) : activeTab === 'snippets' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredSnippets.map((snippet) => (
                <div key={snippet.identifier} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all group relative">
                  <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); openSnippetEdit(snippet); }} className="p-1.5 bg-slate-50 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"><Edit3 size={14} /></button>
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteSnippet(snippet.identifier, snippet.title); }} className="p-1.5 bg-slate-50 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"><Trash2 size={14} /></button>
                  </div>
                  <div onClick={() => openSnippetEdit(snippet)} className="cursor-pointer">
                    <div className="flex justify-between items-start mb-4 pr-12">
                      <h3 className="font-bold text-slate-900">{snippet.title}</h3>
                          <div className="flex flex-col items-end gap-1">
                        {snippet.completionKey && (
                          <span className="text-[10px] bg-blue-50 text-blue-700 font-bold px-2 py-1 rounded uppercase tracking-wider">{snippet.completionKey}</span>
                        )}
                        {(() => {
                          const finalCategory = snippet.category || 'Utility';
                          const config = categoryConfigs[finalCategory] || categoryConfigs.Utility;
                          const Icon = config.icon;
                          return (
                            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase flex items-center gap-1 border ${config.bg} ${config.color} ${config.border}`}>
                              <Icon size={10} />
                              {finalCategory}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                    <p className="text-sm text-slate-600 line-clamp-2 mb-4">{snippet.summary}</p>
                    <div className="flex items-center gap-2">
                      {snippet.language && (
                        <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-1 rounded">{snippet.language}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : activeTab === 'skills' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {filteredSkills.map((skill) => (
                <div key={skill.name} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all group relative">
                  <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); openSkillEdit(skill); }} className="p-1.5 bg-slate-50 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"><Edit3 size={14} /></button>
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteSkill(skill.name); }} className="p-1.5 bg-slate-50 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"><Trash2 size={14} /></button>
                  </div>
                  <div onClick={() => openSkillEdit(skill)} className="cursor-pointer">
                    <div className="flex justify-between items-center mb-2 pr-12">
                      <h3 className="font-bold text-slate-900">{skill.name}</h3>
                      <div className="flex items-center gap-2">
                        {(() => {
                          const category = skill.content.match(/category:\s*(.*)/)?.[1]?.trim() || 'Utility';
                          const config = categoryConfigs[category] || categoryConfigs.Utility;
                          const Icon = config.icon;
                          return (
                            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase flex items-center gap-1 border ${config.bg} ${config.color} ${config.border}`}>
                              <Icon size={10} />
                              {category}
                            </span>
                          );
                        })()}
                        {skill.content.includes('type: preview') && (
                          <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-bold uppercase">Preview Only</span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 bg-slate-50 p-4 rounded-lg overflow-hidden line-clamp-6 font-mono whitespace-pre-wrap">{skill.content}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : activeTab === 'help' ? (
            <div className="max-w-3xl mx-auto py-8">
              <h1 className="text-2xl font-bold text-slate-900 mb-8 flex items-center gap-2"><BookOpen size={28} className="text-blue-600" /> 使用说明</h1>
              <div className="prose prose-slate max-w-none space-y-8 text-sm">
                <section>
                  <h2 className="text-lg font-bold text-slate-800 mb-3">页面说明</h2>
                  <ul className="list-disc pl-6 space-y-2 text-slate-600">
                    <li><strong>Snippets</strong>：查看、编辑、删除代码片段；点击「Sync to Xcode」同步到 Xcode CodeSnippets。</li>
                    <li><strong>Knowledge Base</strong>：管理 Markdown 技术文档（Skills），与 Snippet 关联。</li>
                    <li><strong>SPM Explorer</strong>：按 Target 扫描源码，AI 提取候选；或从路径/剪贴板创建知识。</li>
                    <li><strong>Candidates</strong>：审核由 CLI <code className="bg-slate-100 px-1 rounded">asd ais</code> 批量扫描产生的候选，通过入库或忽略。</li>
                    <li><strong>AI Assistant</strong>：基于本地 Snippets/Skills 的 RAG 问答。</li>
                  </ul>
                </section>
                <section>
                  <h2 className="text-lg font-bold text-slate-800 mb-3">新建知识</h2>
                  <p className="text-slate-600 mb-2">点击顶部「New Knowledge」打开弹窗：</p>
                  <ul className="list-disc pl-6 space-y-2 text-slate-600">
                    <li><strong>按路径</strong>：输入相对路径（如 <code className="bg-slate-100 px-1 rounded">Sources/MyMod/Foo.m</code>），点击「Scan File」→ AI 提取标题/摘要/触发键/头文件，在 SPM Explorer 审核后保存。</li>
                    <li><strong>按剪贴板</strong>：复制代码后点击「Use Copied Code」→ AI 分析并填充。若由 <code className="bg-slate-100 px-1 rounded">// as:create</code> 打开，会带当前文件路径自动解析头文件。</li>
                  </ul>
                </section>
                <section>
                  <h2 className="text-lg font-bold text-slate-800 mb-3">头文件与 watch</h2>
                  <p className="text-slate-600 mb-2">保存时可勾选「引入头文件」，会写入 <code className="bg-slate-100 px-1 rounded text-xs">// as:include &lt;TargetName/Header.h&gt; path</code>。在项目目录运行 <code className="bg-slate-100 px-1 rounded">asd watch</code> 后，在 Xcode 中选中 Snippet 的 headerVersion 并保存，会自动在文件头部注入对应 <code className="bg-slate-100 px-1 rounded">#import</code>。</p>
                </section>
                <section>
                  <h2 className="text-lg font-bold text-slate-800 mb-3">// as:create 流程</h2>
                  <p className="text-slate-600 mb-2">在源码中写一行 <code className="bg-slate-100 px-1 rounded">// as:create</code>，把要提炼的代码复制到剪贴板并保存文件。watch 检测到后会打开本页并带当前文件路径；若剪贴板有内容会自动走「按剪贴板」创建，并按路径解析头文件。</p>
                </section>
                <section>
                  <h2 className="text-lg font-bold text-slate-800 mb-3">命令行速查</h2>
                  <ul className="list-disc pl-6 space-y-2 text-slate-600">
                    <li><code className="bg-slate-100 px-1 rounded">asd ui</code>：启动本 Dashboard</li>
                    <li><code className="bg-slate-100 px-1 rounded">asd create</code>：从含 <code className="bg-slate-100 px-1 rounded">// as:code</code> 的文件用 AI 创建 Snippet</li>
                    <li><code className="bg-slate-100 px-1 rounded">asd create --clipboard [--path 相对路径]</code>：从剪贴板用 AI 创建</li>
                    <li><code className="bg-slate-100 px-1 rounded">asd install</code>：同步 Snippets 到 Xcode</li>
                    <li><code className="bg-slate-100 px-1 rounded">asd ais [Target]</code> / <code className="bg-slate-100 px-1 rounded">asd ais --all</code>：AI 扫描，结果在 Candidates 审核</li>
                    <li><code className="bg-slate-100 px-1 rounded">asd watch</code>：监听头文件注入、ALink、// as:create</li>
                  </ul>
                </section>
              </div>
            </div>
          ) : activeTab === 'candidates' ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="mb-6 flex justify-between items-center">
                <h2 className="text-xl font-bold flex items-center gap-2"><Zap className="text-amber-500" /> AI Scan Candidates</h2>
                <div className="text-xs text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
                  这些内容由 AI 批量扫描生成，等待您的审核入库。
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto pr-2 space-y-8">
                {(!data?.candidates || Object.keys(data.candidates).length === 0) && (
                  <div className="h-64 flex flex-col items-center justify-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
                    <FileSearch size={48} className="mb-4 opacity-20" />
                    <p>未发现候选内容。请在终端执行 `asd ais --all` 开始扫描。</p>
                  </div>
                )}
                
                {data && Object.entries(data.candidates)
                  .sort(([nameA], [nameB]) => {
                    const aShell = isShellTarget(nameA);
                    const bShell = isShellTarget(nameB);
                    if (aShell && !bShell) return 1;
                    if (!aShell && bShell) return -1;
                    return nameA.localeCompare(nameB);
                  })
                  .map(([targetName, group]) => {
                    const isShell = isShellTarget(targetName);
                    return (
                      <div key={targetName} className="space-y-4">
                        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-100 ${isShell ? 'bg-slate-50/50' : 'bg-white'}`}>
                          {isShell ? <Box size={18} className="text-slate-400" /> : <Box size={18} className="text-blue-600" />}
                          <span className={`text-lg font-bold ${isShell ? 'text-slate-400' : 'text-slate-800'}`}>{targetName}</span>
                          {isShell && <span className="text-[10px] font-bold text-slate-300 border border-slate-200 px-1 rounded ml-2">SHELL MODULE</span>}
                          <span className="text-xs text-slate-400 ml-auto">扫描于 {new Date(group.scanTime).toLocaleString()}</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {group.items.map(cand => (
                            <div key={cand.id} className={`bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow flex flex-col group ${isShell ? 'opacity-80' : ''}`}>
                              <div className="flex justify-between items-start mb-2">
                                <div className="flex flex-col">
                                  <span className={`text-[10px] font-bold uppercase mb-0.5 ${isShell ? 'text-slate-400' : 'text-blue-500'}`}>{targetName}</span>
                                  <h3 className="font-bold text-sm text-slate-800">{cand.title}</h3>
                                  {cand.category && (
                                    <span className={`w-fit mt-1 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase flex items-center gap-1 border ${categoryConfigs[cand.category]?.bg || 'bg-slate-50'} ${categoryConfigs[cand.category]?.color || 'text-slate-400'} ${categoryConfigs[cand.category]?.border || 'border-slate-100'}`}>
                                      {(() => {
                                        const Icon = categoryConfigs[cand.category]?.icon || Layers;
                                        return <Icon size={10} />;
                                      })()}
                                      {cand.category}
                                    </span>
                                  )}
                                </div>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => handleDeleteCandidate(targetName, cand.id)} title="忽略" className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded transition-colors"><Trash2 size={14} /></button>
                                </div>
                              </div>
                              <p className="text-xs text-slate-500 line-clamp-2 mb-4 flex-1 h-8 leading-relaxed">{cand.summary}</p>
                              <div className="flex justify-between items-center mt-2">
                                <div className="flex items-center gap-2">
                                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${isShell ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-blue-600'}`}>{cand.trigger}</span>
                                  <span className="text-[10px] text-slate-400 uppercase font-bold">{cand.language}</span>
                                </div>
                            <button onClick={() => {
                              setScanResults([{ 
                                ...cand, 
                                mode: 'full',
                                lang: 'cn',
                                includeHeaders: true,
                                summary: cand.summary_cn || cand.summary || '',
                                usageGuide: cand.usageGuide_cn || cand.usageGuide || ''
                              }]);
                              navigateToTab('spm');
                            }} className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-1">
                                  <Edit3 size={12} /> 审核并保存
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })
                }
              </div>
            </div>
          ) : activeTab === 'spm' ? (
            <div className="flex gap-8 h-full">
              <div className="w-80 bg-white rounded-xl border border-slate-200 flex flex-col overflow-hidden shrink-0">
                <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-sm">项目 Target ({targets.length})</div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {filteredTargets.map(t => {
                    const isShell = isShellTarget(t.name);
                    const isSelected = selectedTargetName === t.name;
                    return (
                      <button 
                        key={t.name} 
                        onClick={() => handleScanTarget(t)} 
                        disabled={isScanning}
                        className={`w-full text-left p-3 rounded-lg flex items-center justify-between group transition-all border ${
                          isScanning ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'
                        } ${isSelected ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-200' : 'bg-white border-transparent'} ${isShell ? 'opacity-90' : ''}`}
                      >
                        <div className={`flex flex-col max-w-[85%] ${isShell ? 'opacity-60' : ''}`}>
                          <div className="flex items-center gap-2">
                            {!isShell && <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSelected ? 'bg-blue-600' : 'bg-blue-600'}`} />}
                            <span className={`text-sm truncate ${!isShell ? 'font-bold' : 'font-medium'} ${isSelected ? 'text-blue-700' : ''}`}>{t.name}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 truncate pl-3">{t.packageName}</span>
                        </div>
                        {isShell ? (
                          <span className="text-[9px] font-bold text-slate-300 border border-slate-100 px-1 rounded">SHELL</span>
                        ) : (
                          <Zap size={14} className={`shrink-0 ${isSelected ? 'text-blue-500 opacity-100' : 'text-blue-500 opacity-0 group-hover:opacity-100'} transition-opacity`} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex-1 bg-white rounded-xl border border-slate-200 flex flex-col overflow-hidden relative">
                <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-sm flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Edit3 size={16} className="text-slate-400" />
                    <span>审核提取结果 {scanResults.length > 0 && <span className="text-blue-600 ml-1">[{scanResults[0].trigger ? 'Candidate' : 'New'}]</span>}</span>
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-8 relative">
                  {isScanning && (
                    <div className="absolute inset-0 bg-white/80 backdrop-blur-[2px] z-10 flex flex-col items-center justify-center text-blue-600">
                      <div className="relative mb-4">
                        <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
                        <Cpu size={32} className="absolute inset-0 m-auto text-blue-600 animate-pulse" />
                      </div>
                      <p className="font-bold text-lg animate-pulse">正在提取 AI 知识库候选内容...</p>
                      <p className="text-sm text-slate-400 mt-2">Gemini 正在深入分析源代码并总结精华</p>
                    </div>
                  )}

                  {!isScanning && scanResults.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center">
                      <Box size={48} className="mb-4 opacity-20" />
                      <p className="font-medium text-slate-600">深度扫描与提取</p>
                      <p className="text-xs mt-2">从左侧选择一个模块，让 AI 识别可复用的代码片段和最佳实践。</p>
                    </div>
                  )}
                  
                  {scanResults.map((res, i) => (
                    <div key={i} className="bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                      <div className="p-4 bg-white border-b border-slate-100 flex justify-between items-center">
                        <div className="flex items-center gap-4 flex-1">
                           <div className="flex flex-col w-[512px]">
                              <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 mb-0.5">Knowledge Title</label>
                              <input className="font-bold bg-transparent border-b border-transparent hover:border-slate-200 focus:border-blue-500 outline-none px-1 text-base w-full" value={res.title} onChange={e => handleUpdateScanResult(i, { title: e.target.value })} />
                           </div>
                           <div className="flex flex-col w-64">
                              <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 mb-0.5">Triggers</label>
                              <input className="font-mono font-bold text-blue-600 bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-lg outline-none text-xs focus:ring-2 focus:ring-blue-500 w-full" value={res.trigger} placeholder="@cmd" onChange={e => handleUpdateScanResult(i, { trigger: e.target.value })} />
                           </div>
                           <div className="flex flex-col">
                              <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 mb-0.5">Category</label>
                              <select 
                                className="font-bold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-1.5 rounded-lg outline-none text-[10px] focus:ring-2 focus:ring-blue-500"
                                value={res.category}
                                onChange={e => handleUpdateScanResult(i, { category: e.target.value })}
                              >
                                {categories.filter(c => c !== 'All').map(cat => (
                                  <option key={cat} value={cat}>{cat}</option>
                                ))}
                              </select>
                           </div>
                           <div className="flex flex-col">
                              <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 mb-0.5">Language</label>
                              <div className="flex bg-slate-100 p-1 rounded-lg">
                                <button onClick={() => handleUpdateScanResult(i, { language: 'swift' })} className={`px-2 py-1 rounded-md text-[9px] font-bold transition-all ${res.language === 'swift' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}>Swift</button>
                                <button onClick={() => handleUpdateScanResult(i, { language: 'objectivec' })} className={`px-2 py-1 rounded-md text-[9px] font-bold transition-all ${res.language === 'objectivec' || res.language === 'objc' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}>ObjC</button>
                              </div>
                           </div>
                           <div className="flex flex-col">
                              <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 mb-0.5">Content Lang</label>
                              <div className="flex bg-slate-100 p-1 rounded-lg">
                                <button onClick={() => handleUpdateScanResult(i, { lang: 'cn' })} className={`px-2 py-1 rounded-md text-[9px] font-bold transition-all ${res.lang === 'cn' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}>CN</button>
                                <button onClick={() => handleUpdateScanResult(i, { lang: 'en' })} className={`px-2 py-1 rounded-md text-[9px] font-bold transition-all ${res.lang === 'en' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}>EN</button>
                              </div>
                           </div>
                           <div className="flex flex-col">
                              <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 mb-0.5">Mode</label>
                              <div className="flex bg-slate-100 p-1 rounded-lg">
                                <button onClick={() => handleUpdateScanResult(i, { mode: 'full' })} className={`px-4 py-1 rounded-md text-[9px] font-bold transition-all ${res.mode === 'full' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}>SNIPPET + SKILL</button>
                                <button onClick={() => handleUpdateScanResult(i, { mode: 'preview' })} className={`px-4 py-1 rounded-md text-[9px] font-bold transition-all ${res.mode === 'preview' ? 'bg-white shadow-sm text-amber-600' : 'text-slate-400'}`}>KNOWLEDGE ONLY</button>
                              </div>
                           </div>
                           <div className="flex flex-col">
                              <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 mb-0.5">引入头文件</label>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleUpdateScanResult(i, { includeHeaders: !(res.includeHeaders !== false) })}
                                  className={`w-8 h-4 rounded-full relative transition-colors ${res.includeHeaders !== false ? 'bg-blue-600' : 'bg-slate-300'}`}
                                  title={res.includeHeaders !== false ? '开启：snippet 内写入 // as:include 标记，watch 按标记注入' : '关闭：不写入头文件标记'}
                                >
                                  <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${res.includeHeaders !== false ? 'right-0.5' : 'left-0.5'}`} />
                                </button>
                                <span className="text-[9px] text-slate-500">{res.includeHeaders !== false ? '按标记注入' : '不引入'}</span>
                              </div>
                           </div>
                        </div>
                        <div className="ml-4">
                           <button onClick={() => handleSaveExtracted(res)} className={`text-xs px-5 py-2.5 rounded-xl font-bold transition-all shadow-sm flex items-center gap-2 active:scale-95 ${res.mode === 'full' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-amber-600 text-white hover:bg-amber-700'}`}><CheckCircle size={18} />保存到知识库</button>
                        </div>
                      </div>
                      <div className="p-6 space-y-4">
                        <div className="flex gap-4">
                            <div className="flex-1">
                              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Summary (摘要) - {res.lang === 'cn' ? '中文' : 'EN'}</label>
                              <textarea rows={2} className="w-full text-sm text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none resize-none leading-relaxed focus:ring-2 focus:ring-blue-500/10" value={res.summary} onChange={e => handleUpdateScanResult(i, { summary: e.target.value })} />
                            </div>
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">头文件 Headers {res.moduleName && <span className="text-slate-400 font-normal">· {res.moduleName}</span>}</label>
                          {res.headers && res.headers.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {res.headers.map((h, hi) => (
                                <span key={hi} className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded font-mono" title={res.headerPaths?.[hi] ? `相对路径: ${res.headerPaths[hi]}` : undefined}>{h}</span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[10px] text-slate-400">未解析到头文件（剪贴板需含 #import，且路径在 target 下）</p>
                          )}
                        </div>
                        <div><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Standardized Usage Example (标准使用示例)</label><div className="bg-slate-900 rounded-xl p-4 overflow-x-auto"><textarea className="w-full bg-transparent text-xs text-slate-100 font-mono leading-relaxed outline-none resize-none" rows={Math.min(12, res.code.split('\n').length)} value={res.code} onChange={e => handleUpdateScanResult(i, { code: e.target.value })} /></div></div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Usage Guide (使用指南) - {res.lang === 'cn' ? '中文' : 'EN'}</label>
                          <textarea className="w-full text-xs text-slate-500 bg-blue-50 p-4 rounded-xl border border-blue-100 outline-none min-h-[100px] leading-relaxed" value={res.usageGuide} onChange={e => handleUpdateScanResult(i, { usageGuide: e.target.value })} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto flex flex-col h-full">
              <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
                {chatHistory.map((msg, i) => (<div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[80%] p-3 rounded-xl text-sm ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-800'}`}>{msg.text}</div></div>))}
                {isAiThinking && <div className="text-slate-400 text-xs animate-pulse">AI is thinking...</div>}
              </div>
              <form onSubmit={handleChat} className="flex gap-2 bg-white p-2 rounded-xl border border-slate-200 shadow-sm"><input type="text" value={userInput} onChange={(e) => setUserInput(e.target.value)} placeholder="Ask anything about your project..." className="flex-1 px-4 py-2 outline-none text-sm" /><button type="submit" disabled={isAiThinking} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:bg-slate-300">Ask</button></form>
            </div>
          )}
        </div>

        {editingSnippet && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center"><h2 className="text-xl font-bold">Edit Snippet</h2><button onClick={closeSnippetEdit} className="p-2 hover:bg-slate-100 rounded-full"><X size={20} /></button></div>
              <div className="p-6 space-y-4 overflow-y-auto">
                <div className="grid grid-cols-4 gap-4">
                  <div><label className="block text-xs font-bold text-slate-400 uppercase mb-1">Title</label><input className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm" value={editingSnippet.title} onChange={e => setEditingSnippet({...editingSnippet, title: e.target.value})} /></div>
                  <div><label className="block text-xs font-bold text-slate-400 uppercase mb-1">Trigger</label><input className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm" value={editingSnippet.completionKey} onChange={e => setEditingSnippet({...editingSnippet, completionKey: e.target.value})} /></div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Category</label>
                    <select 
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none"
                      value={editingSnippet.category || 'Utility'}
                      onChange={e => setEditingSnippet({...editingSnippet, category: e.target.value})}
                    >
                      {categories.filter(c => c !== 'All').map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Language</label>
                    <div className="flex bg-slate-100 p-1 rounded-lg">
                      <button onClick={() => setEditingSnippet({...editingSnippet, language: 'swift'})} className={`flex-1 px-2 py-1 rounded-md text-[10px] font-bold transition-all ${editingSnippet.language === 'swift' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}>Swift</button>
                      <button onClick={() => setEditingSnippet({...editingSnippet, language: 'objectivec'})} className={`flex-1 px-2 py-1 rounded-md text-[10px] font-bold transition-all ${editingSnippet.language === 'objectivec' || editingSnippet.language === 'objc' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}>ObjC</button>
                    </div>
                  </div>
                </div>
                <div><label className="block text-xs font-bold text-slate-400 uppercase mb-1">Summary</label><textarea rows={2} className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none resize-none" value={editingSnippet.summary} onChange={e => setEditingSnippet({...editingSnippet, summary: e.target.value})} /></div>
                
                <div className="bg-slate-50 p-4 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase"><FileCode size={14} /> Headers / Imports</label>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Auto-include in Snippet</span>
                      <button 
                        onClick={() => setEditingSnippet({...editingSnippet, includeHeaders: !editingSnippet.includeHeaders})}
                        className={`w-8 h-4 rounded-full relative transition-colors ${editingSnippet.includeHeaders ? 'bg-blue-600' : 'bg-slate-300'}`}
                      >
                        <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${editingSnippet.includeHeaders ? 'right-0.5' : 'left-0.5'}`} />
                      </button>
                    </div>
                  </div>
                  <textarea 
                    rows={2} 
                    className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-mono outline-none" 
                    placeholder="e.g. #import <UIKit/UIKit.h> or import Foundation"
                    value={(editingSnippet.headers || []).join('\n')} 
                    onChange={e => setEditingSnippet({...editingSnippet, headers: e.target.value.split('\n')})} 
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-xs font-bold text-slate-400 uppercase">Code</label>
                    <button onClick={async () => { 
                      const res = await axios.post('/api/ai/summarize', { code: (editingSnippet.content || editingSnippet.body || []).join('\n'), language: editingSnippet.language }); 
                      if (res.data.title_cn || res.data.title) { 
                        setEditingSnippet({
                          ...editingSnippet, 
                          title: res.data.title_cn || res.data.title, 
                          summary: res.data.summary_cn || res.data.summary, 
                          completionKey: res.data.trigger,
                          content: res.data.code ? res.data.code.split('\n') : (editingSnippet.content || editingSnippet.body || [])
                        }); 
                      } 
                    }} className="text-[10px] text-blue-600 font-bold hover:underline">
                      AI Rewrite
                    </button>
                  </div>
                  <textarea className="w-full h-64 p-4 bg-slate-900 text-slate-100 font-mono text-xs rounded-xl outline-none" value={(editingSnippet.content || editingSnippet.body || []).join('\n')} onChange={e => setEditingSnippet({...editingSnippet, content: (e.target.value || '').split('\n')})} />
                </div>
              </div>
              <div className="p-6 border-t border-slate-100 flex justify-end gap-3"><button onClick={closeSnippetEdit} className="px-4 py-2 text-slate-600 font-medium">Cancel</button><button onClick={handleSaveSnippet} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium flex items-center gap-2 hover:bg-blue-700"><Save size={18} />Save Changes</button></div>
            </div>
          </div>
        )}

        {editingSkill && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-6xl rounded-2xl shadow-2xl flex flex-col h-[85vh]">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center"><h2 className="text-xl font-bold">Edit Knowledge</h2><button onClick={closeSkillEdit} className="p-2 hover:bg-slate-100 rounded-full"><X size={20} /></button></div>
              <div className="p-6 space-y-4 flex-1 flex flex-col overflow-hidden">
                <div><label className="block text-xs font-bold text-slate-400 uppercase mb-1">Path</label><input className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm" value={editingSkill.name} onChange={e => setEditingSkill({...editingSkill, name: e.target.value})} /></div>
                <div className="flex-1 flex flex-col min-h-0"><label className="block text-xs font-bold text-slate-400 uppercase mb-1">Markdown Content</label><textarea className="w-full flex-1 p-4 bg-slate-900 text-slate-100 font-mono text-xs rounded-xl outline-none leading-relaxed" value={editingSkill.content || ''} onChange={e => setEditingSkill({...editingSkill, content: e.target.value})} /></div>
              </div>
              <div className="p-6 border-t border-slate-100 flex justify-end gap-3"><button onClick={closeSkillEdit} className="px-4 py-2 text-slate-600 font-medium">Cancel</button><button onClick={handleSaveSkill} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium flex items-center gap-2 hover:bg-blue-700"><Save size={18} />Save Changes</button></div>
            </div>
          </div>
        )}

        {showCreateModal && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden">
               <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                  <h2 className="text-xl font-bold flex items-center gap-2 text-slate-800"><Plus size={24} className="text-blue-600" /> New Knowledge</h2>
                  <button onClick={() => setShowCreateModal(false)} className="p-2 hover:bg-white rounded-full transition-colors"><X size={20} /></button>
               </div>
               <div className="p-8 space-y-6">
                  <div className="space-y-3">
                     <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest"><FileSearch size={14} /> Import from Project Path</label>
                     <div className="flex gap-2">
                        <input className="flex-1 p-3 bg-slate-100 border-none rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. Sources/MyModule/Auth.swift" value={createPath} onChange={e => setCreatePath(e.target.value)} />
                        <button onClick={handleCreateFromPath} disabled={!createPath || isExtracting} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-slate-800 disabled:opacity-50">Scan File</button>
                     </div>
                  </div>
                  <div className="relative"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-100"></div></div><div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-slate-300 font-bold">Or</span></div></div>
                  <div className="space-y-3">
                     <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest"><Clipboard size={14} /> Import from Clipboard</label>
                     <button onClick={() => handleCreateFromClipboard()} disabled={isExtracting} className="w-full flex items-center justify-center gap-3 p-4 bg-blue-50 text-blue-700 rounded-xl font-bold hover:bg-blue-100 transition-all border border-blue-100">
                        <Zap size={20} /> Use Copied Code
                     </button>
                  </div>
               </div>
               {isExtracting && (
                 <div className="bg-blue-600 text-white p-4 flex items-center justify-center gap-3 animate-pulse">
                   <Cpu size={20} className="animate-spin" />
                   <span className="font-bold text-sm">AI is thinking...</span>
                 </div>
               )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
