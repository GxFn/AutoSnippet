import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Toaster } from 'react-hot-toast';
import { notify } from './utils/notification';
import { Snippet, Recipe, ProjectData, SPMTarget, ExtractedRecipe, ScanResultItem } from './types';
import { TabType, validTabs } from './constants';
import { isShellTarget, isSilentTarget, isPendingTarget, getWritePermissionErrorMsg, getSaveErrorMsg } from './utils';

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
import GuardView from './components/Views/GuardView';
import AiChatView from './components/Views/AiChatView';
import SnippetEditor from './components/Modals/SnippetEditor';
import RecipeEditor from './components/Modals/RecipeEditor';
import CreateModal from './components/Modals/CreateModal';
import SearchModal from './components/Modals/SearchModal';
import XcodeSearchSimulator from './components/Views/XcodeSearchSimulator';

const App: React.FC = () => {
	const getTabFromPath = (): TabType => {
		const path = window.location.pathname.replace(/^\//, '').split('/')[0] || '';
		return (validTabs.includes(path as any) ? path : 'help') as any;
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
	const [scanResults, setScanResults] = useState<ScanResultItem[]>([]);
	const [selectedCategory, setSelectedCategory] = useState<string>('All');
	const [recipePage, setRecipePage] = useState(1);
	const [recipePageSize, setRecipePageSize] = useState(12);
	const [showCreateModal, setShowCreateModal] = useState(false);
	const [createPath, setCreatePath] = useState('');
	const [isExtracting, setIsExtracting] = useState(false);
	const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'model', text: string }[]>([]);
	const [userInput, setUserInput] = useState('');
	const [isAiThinking, setIsAiThinking] = useState(false);
	const [semanticResults, setSemanticResults] = useState<any[] | null>(null);
	const [searchAction, setSearchAction] = useState<{ q: string; path: string } | null>(null);
	const [isSavingRecipe, setIsSavingRecipe] = useState(false);
	const [showXcodeSimulator, setShowXcodeSimulator] = useState(false);

	const abortControllerRef = useRef<AbortController | null>(null);
	const chatAbortControllerRef = useRef<AbortController | null>(null);

	// 搜索/分类变化时 Recipes 列表重置到第一页；刷新数据（fetchData）不重置页码
	useEffect(() => {
		setRecipePage(1);
	}, [searchQuery, selectedCategory]);

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
		const q = params.get('q') || '';

		if (action === 'search' && path) {
			setSearchAction({ q, path });
		} else if (action === 'create' && path) {
			setCreatePath(path);
			setShowCreateModal(true);
			const autoScan = params.get('autoScan') === '1';
			if (autoScan) {
				// as:create -f：先显示 New Recipe 窗口，再在该窗口内自动执行 Scan File（AI 分析），完成后跳转
				setTimeout(() => handleCreateFromPathWithSpecifiedPath(path), 500);
			}
		}
	}, []);

	// API Calls
	const fetchData = async () => {
		setLoading(true);
		try {
			const res = await axios.get<ProjectData>('/api/data');
			// 清理候选池中重复的语言版本
			if (res.data.candidates) {
				const cleanedCandidates: typeof res.data.candidates = {};
				Object.entries(res.data.candidates).forEach(([targetName, targetData]) => {
					const cleanedItems = targetData.items.map(item => {
						// 清理重复的语言版本：如果 summary_en 和 summary_cn/summary 相同，则删除 summary_en
						const summary_cn = item.summary_cn || item.summary || '';
						const summary_en = item.summary_en && item.summary_en !== summary_cn ? item.summary_en : undefined;
						const usageGuide_cn = item.usageGuide_cn || item.usageGuide || '';
						const usageGuide_en = item.usageGuide_en && item.usageGuide_en !== usageGuide_cn ? item.usageGuide_en : undefined;
						
						return {
							...item,
							summary_cn,
							summary_en,
							usageGuide_cn,
							usageGuide_en
						};
					});
					cleanedCandidates[targetName] = { ...targetData, items: cleanedItems };
				});
				res.data.candidates = cleanedCandidates;
			}
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
			notify('已同步到 Xcode CodeSnippets');
		} catch (err) {
			notify('同步失败', { type: 'error' });
		}
	};

	const handleRefreshProject = async () => {
		try {
			await axios.post('/api/commands/spm-map');
			fetchTargets();
			notify('项目结构已刷新');
		} catch (err) {
			notify('刷新失败', { type: 'error' });
		}
	};

	const handleCreateFromPathWithSpecifiedPath = async (specifiedPath: string) => {
		setIsExtracting(true);
		try {
			const res = await axios.post<{ result: ExtractedRecipe[], isMarked: boolean }>('/api/extract/path', { relativePath: specifiedPath });
			setScanResults(res.data.result.map(item => {
				// 清理重复的语言版本：如果 summary_en 和 summary_cn/summary 相同，则删除 summary_en
				const summary_cn = item.summary_cn || item.summary || '';
				const summary_en = item.summary_en && item.summary_en !== summary_cn ? item.summary_en : undefined;
				const usageGuide_cn = item.usageGuide_cn || item.usageGuide || '';
				const usageGuide_en = item.usageGuide_en && item.usageGuide_en !== usageGuide_cn ? item.usageGuide_en : undefined;
				
				return {
					...item,
					summary_cn,
					summary_en,
					usageGuide_cn,
					usageGuide_en,
					mode: 'full',
					lang: 'cn',
					includeHeaders: true,
					category: item.category || 'Utility',
					summary: summary_cn,
					usageGuide: usageGuide_cn
				};
			}));
			navigateToTab('spm', { preserveSearch: true });
			setShowCreateModal(false);
			fetchData();
			if (res.data.result?.length > 0) {
				notify('提取完成，已加入候选池，请在 Candidates 页审核');
			}
		} catch (err) {
			notify('Extraction failed', { type: 'error' });
		} finally {
			setIsExtracting(false);
		}
	};

	const handleCreateFromPath = async () => {
		if (!createPath) return;
		setIsExtracting(true);
		try {
			const res = await axios.post<{ result: ExtractedRecipe[], isMarked: boolean }>('/api/extract/path', { relativePath: createPath });
			setScanResults(res.data.result.map(item => {
				// 清理重复的语言版本：如果 summary_en 和 summary_cn/summary 相同，则删除 summary_en
				const summary_cn = item.summary_cn || item.summary || '';
				const summary_en = item.summary_en && item.summary_en !== summary_cn ? item.summary_en : undefined;
				const usageGuide_cn = item.usageGuide_cn || item.usageGuide || '';
				const usageGuide_en = item.usageGuide_en && item.usageGuide_en !== usageGuide_cn ? item.usageGuide_en : undefined;
				
				return {
					...item,
					summary_cn,
					summary_en,
					usageGuide_cn,
					usageGuide_en,
					mode: 'full',
					lang: 'cn',
					includeHeaders: true,
					category: item.category || 'Utility',
					summary: summary_cn,
					usageGuide: usageGuide_cn
				};
			}));
			navigateToTab('spm');
			setShowCreateModal(false);
			fetchData();
			if (res.data.result?.length > 0) {
				notify(res.data.isMarked ? '提取完成（精准锁定），已加入候选池' : '提取完成，已加入候选池');
			} else if (!res.data.isMarked) {
				notify('未找到标记，AI 正在分析完整文件');
			}
		} catch (err) {
			notify('Extraction failed', { type: 'error' });
		} finally {
			setIsExtracting(false);
		}
	};

	const handleCreateFromClipboard = async (contextPath?: string) => {
		try {
			const text = await navigator.clipboard.readText();
			if (!text) return notify('剪贴板为空');
			
			// 立即提示收到代码
			notify('已收到剪贴板内容，正在调用 AI 识别...');
			
			setIsExtracting(true);
			const relativePath = contextPath || createPath;
			
			try {
				const res = await axios.post<ExtractedRecipe>('/api/extract/text', {
					text,
					...(relativePath ? { relativePath } : {})
				});
				const item = res.data;
				
				// 清理重复的语言版本
				const summary_cn = item.summary_cn || item.summary || '';
				const summary_en = item.summary_en && item.summary_en !== summary_cn ? item.summary_en : undefined;
				const usageGuide_cn = item.usageGuide_cn || item.usageGuide || '';
				const usageGuide_en = item.usageGuide_en && item.usageGuide_en !== usageGuide_cn ? item.usageGuide_en : undefined;
				
				const multipleCount = (item as ExtractedRecipe & { _multipleCount?: number })._multipleCount;
				setScanResults([{ 
					...item,
					summary_cn,
					summary_en,
					usageGuide_cn,
					usageGuide_en,
					mode: 'full', 
					lang: 'cn',
					includeHeaders: true,
					category: item.category || 'Utility',
					summary: summary_cn,
					usageGuide: usageGuide_cn
				}]);
				navigateToTab('spm', { preserveSearch: true });
				setShowCreateModal(false);
				fetchData();
				notify(multipleCount ? `已识别 ${multipleCount} 条 Recipe，已加入候选池` : 'AI 识别成功，已加入候选池');
			} catch (err: any) {
				// 区分 AI 错误和其他错误
				const isAiError = err.response?.data?.aiError === true;
				const errorMsg = err.response?.data?.error || err.message;
				
				if (isAiError) {
					notify(`AI 识别失败: ${errorMsg}`, { type: 'error' });
				} else {
					notify(`操作失败: ${errorMsg}`, { type: 'error' });
				}
			}
		} catch (err) {
			notify('剪贴板读取失败', { type: 'error' });
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
				fetchData(); // 刷新候选数
				if (recipes.length > 0) {
					notify(`${recipes.length} 条已加入候选池（24h），请在 Candidates 页审核`);
				}
			} else if (typeof data === 'object' && data !== null && 'message' in data) {
				notify((data as { message?: string }).message || 'Scan failed: No source files.', { type: 'error' });
			} else {
				notify('Scan failed: Unexpected response format', { type: 'error' });
			}
		} catch (err: any) {
			clearInterval(progressTimer);
			if (axios.isCancel(err)) return;
			notify(`Scan failed: ${err.response?.data?.error || err.message}`, { type: 'error' });
		} finally {
			if (abortControllerRef.current === controller) {
				setIsScanning(false);
				setScanProgress({ current: 0, total: 0, status: '' });
				abortControllerRef.current = null;
			}
		}
	};

	const handleUpdateScanResult = (index: number, updates: Partial<ScanResultItem>) => {
		const newResults = [...scanResults];
		const current = { ...newResults[index], ...updates };
		
		// 初始化语言字段：确保 summary_cn 有值（作为中文版本的基础）
		// 但要避免覆盖已存在的 summary_en
		if (!current.summary_cn && current.summary && !current.summary_en) {
			// 只有在既没有 summary_cn 也没有 summary_en 时，才初始化 summary_cn
			current.summary_cn = current.summary;
		}
		if (!current.usageGuide_cn && current.usageGuide && !current.usageGuide_en) {
			// 只有在既没有 usageGuide_cn 也没有 usageGuide_en 时，才初始化 usageGuide_cn
			current.usageGuide_cn = current.usageGuide;
		}
		
		// 当直接设置 summary/usageGuide（用于翻译后直接显示）时，跳过语言判断
		// 只有在没有直接提供这些字段时，才根据 lang 来决定使用哪个版本
		if (updates.lang !== undefined && updates.summary === undefined) {
			current.summary = updates.lang === 'cn' ? (current.summary_cn || current.summary) : (current.summary_en || current.summary);
		}
		if (updates.lang !== undefined && updates.usageGuide === undefined) {
			current.usageGuide = updates.lang === 'cn' ? (current.usageGuide_cn || current.usageGuide) : (current.usageGuide_en || current.usageGuide);
		}
		
		// 编辑 summary 或 usageGuide 时，保存到对应的语言版本
		if (updates.summary !== undefined && updates.lang === undefined) {
			if (current.lang === 'cn') current.summary_cn = updates.summary;
			else current.summary_en = updates.summary;
		}
		if (updates.usageGuide !== undefined && updates.lang === undefined) {
			if (current.lang === 'cn') current.usageGuide_cn = updates.usageGuide;
			else current.usageGuide_en = updates.usageGuide;
		}

		newResults[index] = current;
		setScanResults(newResults);
	};

	const handleSaveExtracted = async (extracted: ScanResultItem) => {
		if (isSavingRecipe) return;
		setIsSavingRecipe(true);
		try {
			const triggers = (extracted.trigger || '').split(/[,，\s]+/).map(t => t.trim()).filter(Boolean);
			if (triggers.length === 0) {
				notify('请输入 Trigger', { type: 'error' });
				setIsSavingRecipe(false);
				return;
			}
			const primarySnippetId = crypto.randomUUID().toUpperCase();
			
			if (extracted.mode === 'full') {
				for (let i = 0; i < triggers.length; i++) {
					const t = triggers[i];
					const includeHeaders = (extracted as any).includeHeaders !== false;
					const snippet: Snippet = {
						identifier: i === 0 ? primarySnippetId : crypto.randomUUID().toUpperCase(),
						title: triggers.length > 1 ? `${extracted.title || 'Untitled'} (${t})` : (extracted.title || 'Untitled'),
						completionKey: t,
						category: extracted.category || 'Utility',
						summary: extracted.summary || '',
						language: extracted.language || 'swift',
						content: (extracted.code || '').split('\n'),
						headers: includeHeaders ? (extracted.headers || []) : [],
						headerPaths: includeHeaders ? (extracted.headerPaths || []) : undefined,
						moduleName: extracted.moduleName,
						includeHeaders
					};
					await axios.post('/api/snippets/save', { snippet });
				}
			}

		const recipeName = `${(extracted.title || 'Untitled').replace(/\s+/g, '-')}.md`;
		
		// 准备中英文版本
		const summary_cn = extracted.summary_cn || extracted.summary || '';
		const summary_en = extracted.summary_en || extracted.summary || '';
		const usageGuide_cn = extracted.usageGuide_cn || extracted.usageGuide || '';
		const usageGuide_en = extracted.usageGuide_en || extracted.usageGuide || '';
		
		// 构建 Frontmatter
		let frontmatter = `---
id: ${extracted.mode === 'full' ? primarySnippetId : 'preview-only'}
title: ${extracted.title || 'Untitled Recipe'}
language: ${extracted.language || 'swift'}
trigger: ${triggers.join(', ')}
category: ${extracted.category || 'Utility'}
summary: ${summary_cn}
summary_cn: ${summary_cn}`;

		if (summary_en && summary_en !== summary_cn) {
			frontmatter += `\nsummary_en: ${summary_en}`;
		}
		
		frontmatter += `
headers: ${JSON.stringify(extracted.headers || [])}`;
		
		if (extracted.difficulty) {
			frontmatter += `\ndifficulty: ${extracted.difficulty}`;
		}
		if (extracted.authority) {
			frontmatter += `\nauthority: ${extracted.authority}`;
		}
		
		frontmatter += `
version: "1.0.0"
updatedAt: ${Date.now()}
---`;

		// 构建正文
		let body = `
## Snippet / Code Reference

\`\`\`${extracted.language || 'swift'}
${extracted.code || ''}
\`\`\`

## AI Context / Usage Guide

${usageGuide_cn}`;

		if (usageGuide_en && usageGuide_en !== usageGuide_cn) {
			body += `

## AI Context / Usage Guide (EN)

${usageGuide_en}`;
		}
		
		const recipeContent = frontmatter + body;
			await axios.post('/api/recipes/save', { name: recipeName, content: recipeContent });
			
			notify(extracted.mode === 'full' ? '已保存为 Snippet 和 Recipe' : '已保存到 KB');
			setScanResults(prev => prev.filter(item => item.title !== extracted.title));
			// 若来自候选池，保存后从候选池移除
			const candTarget = extracted.candidateTargetName;
			const candId = extracted.candidateId;
			if (candTarget && candId) {
				try {
					await axios.post('/api/candidates/delete', { targetName: candTarget, candidateId: candId });
				} catch (_) {}
			}
			fetchData();
		} catch (err) {
			const msg = getSaveErrorMsg(err) ?? getWritePermissionErrorMsg(err);
			notify(msg ?? '保存失败', { type: 'error' });
		} finally {
			setIsSavingRecipe(false);
		}
	};

	const handleSaveRecipe = async () => {
		if (!editingRecipe || isSavingRecipe) return;
		setIsSavingRecipe(true);
		try {
			// 清理重复的英文版本：保留只有一份 "## AI Context / Usage Guide (EN)"
			let cleanedContent = editingRecipe.content;
			
			// 用简单的方式：找到第一份英文版本，删除之后的所有重复英文版本
			const enGuidePattern = '\n## AI Context / Usage Guide (EN)';
			const firstIndex = cleanedContent.indexOf(enGuidePattern);
			
			if (firstIndex !== -1) {
				// 找第一份英文版本后面是否还有其他 "## AI Context / Usage Guide (EN)"
				const afterFirst = cleanedContent.substring(firstIndex + enGuidePattern.length);
				const secondIndex = afterFirst.indexOf(enGuidePattern);
				
				if (secondIndex !== -1) {
					// 有重复，找出第一份的完整范围（到下一个标题或末尾）
					const nextHeaderMatch = afterFirst.match(/\n## /);
					let endOfFirst = afterFirst.length;
					
					if (nextHeaderMatch && nextHeaderMatch.index !== undefined && nextHeaderMatch.index < secondIndex) {
						// 第一份英文版本后有其他标题
						endOfFirst = nextHeaderMatch.index;
						cleanedContent = cleanedContent.substring(0, firstIndex + enGuidePattern.length) + 
										  afterFirst.substring(0, endOfFirst);
					} else {
						// 第一份英文版本就到文件末尾（或只到第二份之前）
						cleanedContent = cleanedContent.substring(0, firstIndex + enGuidePattern.length) + 
										  afterFirst.substring(0, secondIndex);
					}
				}
			}
			
			await axios.post('/api/recipes/save', { name: editingRecipe.name, content: cleanedContent });
			closeRecipeEdit();
			fetchData();
		} catch (err) {
			const msg = getSaveErrorMsg(err) ?? getWritePermissionErrorMsg(err);
			notify(msg ?? '保存 Recipe 失败', { type: 'error' });
		} finally {
			setIsSavingRecipe(false);
		}
	};

	const handleDeleteRecipe = async (name: string) => {
		if (!window.confirm(`Are you sure?`)) return;
		try {
			await axios.post('/api/recipes/delete', { name });
			fetchData();
		} catch (err) {
			const msg = getWritePermissionErrorMsg(err);
			notify(msg ?? '删除失败', { type: 'error' });
		}
	};

	const handleDeleteCandidate = async (targetName: string, candidateId: string): Promise<void> => {
		try {
			await axios.post('/api/candidates/delete', { targetName, candidateId });
			setScanResults(prev => prev.filter(r => !(r.candidateId === candidateId && r.candidateTargetName === targetName)));
			fetchData();
		} catch (err) {
			notify('操作失败', { type: 'error' });
			throw err;
		}
	};

	const handleDeleteAllInTarget = async (targetName: string) => {
		if (!window.confirm(`确定移除「${targetName}」下的全部候选？`)) return;
		try {
			await axios.post('/api/candidates/delete-target', { targetName });
			fetchData();
			notify(`已移除 ${targetName} 下的全部候选`);
		} catch (err) {
			notify('操作失败', { type: 'error' });
		}
	};

	const handleSaveSnippet = async () => {
		if (!editingSnippet) return;
		try {
			await axios.post('/api/snippets/save', { snippet: editingSnippet });
			closeSnippetEdit();
			fetchData();
		} catch (err) {
			const msg = getWritePermissionErrorMsg(err);
			notify(msg ?? '保存 Snippet 失败', { type: 'error' });
		}
	};

	const handleDeleteSnippet = async (identifier: string, title: string) => {
		if (!window.confirm(`Delete snippet: ${title}?`)) return;
		try {
			await axios.post('/api/snippets/delete', { identifier });
			fetchData();
		} catch (err) {
			const msg = getWritePermissionErrorMsg(err);
			notify(msg ?? '删除失败', { type: 'error' });
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
		// 默认按综合分（authorityScore）降序
		const sa = a.stats?.authorityScore ?? 0;
		const sb = b.stats?.authorityScore ?? 0;
		return sb - sa;
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
			<Toaster position="top-center" toastOptions={{ duration: 3000 }} />
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
					setShowXcodeSimulator={setShowXcodeSimulator}
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
							onRefresh={fetchData}
							currentPage={recipePage}
							onPageChange={setRecipePage}
							pageSize={recipePageSize}
							onPageSizeChange={(size) => { setRecipePageSize(size); setRecipePage(1); }}
						/>
					) : activeTab === 'guard' ? (
						<GuardView onRefresh={fetchData} />
					) : activeTab === 'help' ? (
						<HelpView />
					) : activeTab === 'candidates' ? (
						<CandidatesView 
							data={data} 
							isShellTarget={isShellTarget}
							isSilentTarget={isSilentTarget}
							isPendingTarget={isPendingTarget}
							handleDeleteCandidate={handleDeleteCandidate} 
							onEditRecipe={openRecipeEdit}
							onAuditCandidate={(cand, targetName) => {
								setScanResults([{ 
									...cand, 
									mode: 'full',
									lang: 'cn',
									includeHeaders: true,
									summary: cand.summary_cn || cand.summary || '',
									usageGuide: cand.usageGuide_cn || cand.usageGuide || '',
									candidateId: cand.id,
									candidateTargetName: targetName
								}]);
								navigateToTab('spm');
							}}
							onAuditAllInTarget={(items, targetName) => {
								setScanResults(items.map(cand => ({
									...cand,
									mode: 'full' as const,
									lang: 'cn' as const,
									includeHeaders: true,
									summary: cand.summary_cn || cand.summary || '',
									usageGuide: cand.usageGuide_cn || cand.usageGuide || '',
									candidateId: cand.id,
									candidateTargetName: targetName
								})));
								navigateToTab('spm');
							}}
							handleDeleteAllInTarget={handleDeleteAllInTarget} 
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
							handleDeleteCandidate={handleDeleteCandidate}
							onEditRecipe={openRecipeEdit}
							isShellTarget={isShellTarget}
							recipes={data?.recipes ?? []}
							isSavingRecipe={isSavingRecipe}
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
						isSavingRecipe={isSavingRecipe}
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

			{/* Xcode 搜索模拟器 */}
			<XcodeSearchSimulator 
				isOpen={showXcodeSimulator}
				onClose={() => setShowXcodeSimulator(false)}
			/>
		</main>
		</div>
	);
};

export default App;
