import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Snippet, Recipe, ProjectData, SPMTarget, ExtractedRecipe } from './types';
import { TabType, validTabs } from './constants';
import { isShellTarget } from './utils';

// Components
import Sidebar from './components/Layout/Sidebar';
import Header from './components/Layout/Header';
import CategoryBar from './components/Shared/CategoryBar';
import SnippetsView from './components/Views/SnippetsView';
import RecipesView from './components/Views/RecipesView';
import HelpView from './components/Views/HelpView';
import CandidatesView from './components/Views/CandidatesView';
import SPMExplorerView from './components/Views/SPMExplorerView';
import DepGraphView from './components/Views/DepGraphView';
import AiChatView from './components/Views/AiChatView';
import SnippetEditor from './components/Modals/SnippetEditor';
import RecipeEditor from './components/Modals/RecipeEditor';
import CreateModal from './components/Modals/CreateModal';
import SearchModal from './components/Modals/SearchModal';

const App: React.FC = () => {
	const getTabFromPath = (): TabType => {
		const path = window.location.pathname.replace(/^\//, '').split('/')[0] || '';
		return (validTabs.includes(path as any) ? path : 'snippets') as any;
	};

	// State
	const [data, setData] = useState<ProjectData | null>(null);
	const [activeTab, setActiveTab] = useState<TabType>(getTabFromPath());
	const [searchQuery, setSearchQuery] = useState('');
	const [loading, setLoading] = useState(true);
	const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);
	const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
	const [targets, setTargets] = useState<SPMTarget[]>([]);
	const [selectedTargetName, setSelectedTargetName] = useState<string | null>(null);
	const [isScanning, setIsScanning] = useState(false);
	const [scanProgress, setScanProgress] = useState<{ current: number, total: number, status: string }>({ current: 0, total: 0, status: '' });
	const [scanFileList, setScanFileList] = useState<{ name: string; path: string }[]>([]);
	const [scanResults, setScanResults] = useState<(ExtractedRecipe & { mode: 'full' | 'preview', lang: 'cn' | 'en', includeHeaders?: boolean })[]>([]);
	const [selectedCategory, setSelectedCategory] = useState<string>('All');
	const [showCreateModal, setShowCreateModal] = useState(false);
	const [createPath, setCreatePath] = useState('');
	const [isExtracting, setIsExtracting] = useState(false);
	const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'model', text: string }[]>([]);
	const [userInput, setUserInput] = useState('');
	const [isAiThinking, setIsAiThinking] = useState(false);
	const [semanticResults, setSemanticResults] = useState<any[] | null>(null);
	const [searchAction, setSearchAction] = useState<{ q: string; path: string } | null>(null);

	const abortControllerRef = useRef<AbortController | null>(null);
	const chatAbortControllerRef = useRef<AbortController | null>(null);

	/** 切换 AI 前停止当前 AI 任务（扫描、聊天等）；不置空 ref，由各任务 finally 清理并更新 UI */
	const stopCurrentAiTasks = () => {
		if (abortControllerRef.current) abortControllerRef.current.abort();
		if (chatAbortControllerRef.current) chatAbortControllerRef.current.abort();
		setIsAiThinking(false);
	};

	// Navigation
	const navigateToTab = (tab: TabType, options?: { preserveSearch?: boolean }) => {
		setActiveTab(tab);
		const search = options?.preserveSearch && window.location.search ? window.location.search : '';
		window.history.pushState({}, document.title, `/${tab}${search}`);
	};

	// Handlers
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

	const openRecipeEdit = (recipe: Recipe) => {
		setEditingRecipe(recipe);
		setActiveTab('recipes');
		const q = new URLSearchParams(window.location.search);
		q.set('edit', encodeURIComponent(recipe.name));
		window.history.pushState({}, document.title, `/recipes?${q.toString()}`);
	};

	const closeRecipeEdit = () => {
		setEditingRecipe(null);
		window.history.replaceState({}, document.title, '/recipes');
	};

	useEffect(() => {
		if (searchQuery === '') {
			setSemanticResults(null);
		}
	}, [searchQuery]);

	// Effects
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
		if (pathname === 'recipes' && editId && data.recipes) {
			try {
				const name = decodeURIComponent(editId);
				const recipe = data.recipes.find((s: Recipe) => s.name === name);
				if (recipe && !editingRecipe) {
					setActiveTab('recipes');
					openRecipeEdit(recipe);
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
		const q = params.get('q') || '';

		if (action === 'search' && path) {
			setSearchAction({ q, path });
		} else if (action === 'create' && path) {
			setCreatePath(path);
			setShowCreateModal(true);
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

	// API Calls
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

	const handleCreateFromPathWithSpecifiedPath = async (specifiedPath: string) => {
		setIsExtracting(true);
		try {
			const res = await axios.post<{ result: ExtractedRecipe[], isMarked: boolean }>('/api/extract/path', { relativePath: specifiedPath });
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

	const handleCreateFromPath = async () => {
		if (!createPath) return;
		setIsExtracting(true);
		try {
			const res = await axios.post<{ result: ExtractedRecipe[], isMarked: boolean }>('/api/extract/path', { relativePath: createPath });
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
			const relativePath = contextPath || createPath;
			const res = await axios.post<ExtractedRecipe>('/api/extract/text', {
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

	const SCAN_PHASES = [
		{ status: '正在读取 Target 源文件...', percent: 15 },
		{ status: '正在发送到 AI 分析...', percent: 35 },
		{ status: '正在识别可复用代码片段...', percent: 55 },
		{ status: '正在生成摘要与使用指南...', percent: 75 },
		{ status: '即将完成...', percent: 92 }
	];

	const handleScanTarget = async (target: SPMTarget) => {
		if (isScanning) return;
		if (abortControllerRef.current) abortControllerRef.current.abort();
		const controller = new AbortController();
		abortControllerRef.current = controller;

		setSelectedTargetName(target.name);
		setIsScanning(true);
		setScanResults([]);
		setScanFileList([]);
		setScanProgress({ current: 0, total: 100, status: '正在获取待扫描文件列表...' });

		const phaseInterval = 4000;
		let phaseIndex = 0;
		const progressTimer = setInterval(() => {
			phaseIndex = Math.min(phaseIndex + 1, SCAN_PHASES.length);
			const phase = SCAN_PHASES[phaseIndex - 1];
			if (phase) {
				setScanProgress(prev => ({ ...prev, current: phase.percent, status: phase.status }));
			}
		}, phaseInterval);

		try {
			const filesRes = await axios.post<{ files: { name: string; path: string }[]; count: number }>('/api/spm/target-files', { target }, {
				signal: controller.signal
			});
			const fileList = filesRes.data?.files || [];
			const fileCount = filesRes.data?.count ?? fileList.length;
			setScanFileList(fileList);
			setScanProgress(prev => ({ ...prev, current: 10, status: `正在分析 ${fileCount} 个文件...` }));

			const res = await axios.post<{ recipes?: ExtractedRecipe[]; scannedFiles?: { name: string; path: string }[] } | ExtractedRecipe[]>('/api/spm/scan', { target }, {
				signal: controller.signal
			});
			clearInterval(progressTimer);
			setScanProgress({ current: 100, total: 100, status: '扫描完成' });

			const data = res.data;
			const recipes = Array.isArray(data) ? data : (data?.recipes ?? []);
			const scannedFiles = !Array.isArray(data) && data?.scannedFiles ? data.scannedFiles : fileList;

			if (recipes.length > 0 || scannedFiles.length > 0) {
				setScanResults(recipes.map((item: ExtractedRecipe) => ({
					...item,
					mode: 'full' as const,
					lang: 'cn' as const,
					includeHeaders: item.includeHeaders !== false,
					category: item.category || 'Utility',
					summary: item.summary_cn || item.summary || '',
					usageGuide: item.usageGuide_cn || item.usageGuide || ''
				})));
				setScanFileList(scannedFiles);
			} else if (typeof data === 'object' && data !== null && 'message' in data) {
				alert((data as { message?: string }).message || 'Scan failed: No source files.');
			} else {
				alert('Scan failed: Unexpected response format');
			}
		} catch (err: any) {
			clearInterval(progressTimer);
			if (axios.isCancel(err)) return;
			alert(`Scan failed: ${err.response?.data?.error || err.message}`);
		} finally {
			if (abortControllerRef.current === controller) {
				setIsScanning(false);
				setScanProgress({ current: 0, total: 0, status: '' });
				abortControllerRef.current = null;
			}
		}
	};

	const handleUpdateScanResult = (index: number, updates: Partial<ExtractedRecipe & { mode: 'full' | 'preview', lang: 'cn' | 'en'; includeHeaders?: boolean }>) => {
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

	const handleSaveExtracted = async (extracted: ExtractedRecipe & { mode: 'full' | 'preview' }) => {
		try {
			const triggers = extracted.trigger.split(/[,，\s]+/).map(t => t.trim()).filter(Boolean);
			const primarySnippetId = crypto.randomUUID().toUpperCase();
			
			if (extracted.mode === 'full') {
				for (let i = 0; i < triggers.length; i++) {
					const t = triggers[i];
					const includeHeaders = (extracted as any).includeHeaders !== false;
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

			const recipeName = `${extracted.title.replace(/\s+/g, '-')}.md`;
			const recipeContent = `---
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
			await axios.post('/api/recipes/save', { name: recipeName, content: recipeContent });
			
			alert(extracted.mode === 'full' ? '✅ Saved as Snippet & Recipe!' : '✅ Saved to KB!');
			fetchData();
			setScanResults(prev => prev.filter(item => item.title !== extracted.title));
		} catch (err) {
			alert('❌ Failed to save');
		}
	};

	const handleSaveRecipe = async () => {
		if (!editingRecipe) return;
		try {
			await axios.post('/api/recipes/save', { name: editingRecipe.name, content: editingRecipe.content });
			closeRecipeEdit();
			fetchData();
		} catch (err) {
			alert('Failed to save recipe');
		}
	};

	const handleDeleteRecipe = async (name: string) => {
		if (!window.confirm(`Are you sure?`)) return;
		try {
			await axios.post('/api/recipes/delete', { name });
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
		if (chatAbortControllerRef.current) chatAbortControllerRef.current.abort();
		const controller = new AbortController();
		chatAbortControllerRef.current = controller;
		const userMsg = { role: 'user' as const, text: userInput };
		setChatHistory(prev => [...prev, userMsg]);
		setUserInput('');
		setIsAiThinking(true);
		try {
			const res = await axios.post('/api/ai/chat', {
				prompt: userInput,
				history: chatHistory.map(h => ({ role: h.role, content: h.text }))
			}, { signal: controller.signal });
			setChatHistory(prev => [...prev, { role: 'model', text: res.data.text }]);
		} catch (err: any) {
			if (axios.isCancel(err)) return;
			setChatHistory(prev => [...prev, { role: 'model', text: 'Error' }]);
		} finally {
			if (chatAbortControllerRef.current === controller) {
				chatAbortControllerRef.current = null;
				setIsAiThinking(false);
			}
		}
	};

	// Filters
	const filteredSnippets = data?.rootSpec.list.filter(s => {
		const title = s.title || '';
		const completionKey = s.completionKey || '';
		const matchesSearch = title.toLowerCase().includes(searchQuery.toLowerCase()) || completionKey.toLowerCase().includes(searchQuery.toLowerCase());
		if (selectedCategory === 'All') return matchesSearch;
		const category = s.category || 'Utility';
		return matchesSearch && category === selectedCategory;
	}) || [];

	const filteredRecipes = (data?.recipes || []).filter(s => {
		// 语义搜索结果优先
		if (semanticResults) {
			return semanticResults.some(res => res.metadata.type === 'recipe' && res.metadata.name === s.name);
		}
		const name = s.name || '';
		const content = s.content || '';
		const matchesSearch = name.toLowerCase().includes(searchQuery.toLowerCase()) || content.toLowerCase().includes(searchQuery.toLowerCase());
		if (selectedCategory === 'All') return matchesSearch;
		const categoryMatch = content ? content.match(/category:\s*(.*)/) : null;
		const category = categoryMatch ? categoryMatch[1].trim() : 'Utility';
		return matchesSearch && category === selectedCategory;
	}).sort((a, b) => {
		// 如果有语义搜索，按照相似度排序
		if (semanticResults) {
			const scoreA = semanticResults.find(r => r.metadata.name === a.name)?.similarity || 0;
			const scoreB = semanticResults.find(r => r.metadata.name === b.name)?.similarity || 0;
			return scoreB - scoreA;
		}
		return 0;
	});

	const filteredTargets = targets
		.filter(t => t.name.toLowerCase().includes(searchQuery.toLowerCase()))
		.sort((a, b) => {
			const aShell = isShellTarget(a.name);
			const bShell = isShellTarget(b.name);
			if (aShell && !bShell) return 1;
			if (!aShell && bShell) return -1;
			return a.name.localeCompare(b.name);
		});

	const candidateCount = Object.values(data?.candidates || {}).reduce((acc, curr) => acc + curr.items.length, 0);

	return (
		<div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden font-sans">
			<Sidebar 
				activeTab={activeTab} 
				navigateToTab={navigateToTab} 
				handleRefreshProject={handleRefreshProject} 
				candidateCount={candidateCount} 
			/>

			<main className="flex-1 flex flex-col overflow-hidden relative">
				<Header 
					searchQuery={searchQuery} 
					setSearchQuery={setSearchQuery} 
					setShowCreateModal={setShowCreateModal} 
					handleSyncToXcode={handleSyncToXcode} 
					aiConfig={data?.aiConfig}
					onBeforeAiSwitch={stopCurrentAiTasks}
					onAiConfigChange={fetchData}
					onSemanticSearchResults={(results) => {
						setSemanticResults(results);
						if (activeTab !== 'recipes' && activeTab !== 'snippets') {
							navigateToTab('recipes');
						}
					}}
				/>

				{(activeTab === 'snippets' || activeTab === 'recipes') && (
					<CategoryBar 
						selectedCategory={selectedCategory} 
						setSelectedCategory={setSelectedCategory} 
					/>
				)}

				<div className="flex-1 overflow-y-auto p-8">
					{loading ? (
						<div className="flex items-center justify-center h-full">
							<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
						</div>
					) : activeTab === 'snippets' ? (
						<SnippetsView 
							snippets={filteredSnippets} 
							openSnippetEdit={openSnippetEdit} 
							handleDeleteSnippet={handleDeleteSnippet} 
						/>
					) : activeTab === 'recipes' ? (
						<RecipesView 
							recipes={filteredRecipes} 
							openRecipeEdit={openRecipeEdit} 
							handleDeleteRecipe={handleDeleteRecipe} 
						/>
					) : activeTab === 'help' ? (
						<HelpView />
					) : activeTab === 'candidates' ? (
						<CandidatesView 
							data={data} 
							isShellTarget={isShellTarget} 
							handleDeleteCandidate={handleDeleteCandidate} 
							onAuditCandidate={(cand) => {
								setScanResults([{ 
									...cand, 
									mode: 'full',
									lang: 'cn',
									includeHeaders: true,
									summary: cand.summary_cn || cand.summary || '',
									usageGuide: cand.usageGuide_cn || cand.usageGuide || ''
								}]);
								navigateToTab('spm');
							}} 
						/>
					) : activeTab === 'depgraph' ? (
						<DepGraphView />
					) : activeTab === 'spm' ? (
						<SPMExplorerView 
							targets={targets}
							filteredTargets={filteredTargets}
							selectedTargetName={selectedTargetName}
							isScanning={isScanning}
							scanProgress={scanProgress}
							scanFileList={scanFileList}
							scanResults={scanResults}
							handleScanTarget={handleScanTarget}
							handleUpdateScanResult={handleUpdateScanResult}
							handleSaveExtracted={handleSaveExtracted}
							isShellTarget={isShellTarget}
						/>
					) : (
						<AiChatView 
							chatHistory={chatHistory} 
							userInput={userInput} 
							setUserInput={setUserInput} 
							handleChat={handleChat} 
							isAiThinking={isAiThinking} 
						/>
					)}
				</div>

				{editingSnippet && (
					<SnippetEditor 
						editingSnippet={editingSnippet} 
						setEditingSnippet={setEditingSnippet} 
						handleSaveSnippet={handleSaveSnippet} 
						closeSnippetEdit={closeSnippetEdit} 
					/>
				)}

				{editingRecipe && (
					<RecipeEditor 
						editingRecipe={editingRecipe} 
						setEditingRecipe={setEditingRecipe} 
						handleSaveRecipe={handleSaveRecipe} 
						closeRecipeEdit={closeRecipeEdit} 
					/>
				)}

				{showCreateModal && (
					<CreateModal 
						setShowCreateModal={setShowCreateModal} 
						createPath={createPath} 
						setCreatePath={setCreatePath} 
						handleCreateFromPath={handleCreateFromPath} 
						handleCreateFromClipboard={handleCreateFromClipboard} 
						isExtracting={isExtracting} 
					/>
				)}

				{searchAction && (
					<SearchModal
						searchQ={searchAction.q}
						insertPath={searchAction.path}
						onClose={() => {
							setSearchAction(null);
							window.history.replaceState({}, document.title, window.location.pathname);
						}}
					/>
				)}
			</main>
		</div>
	);
};

export default App;
