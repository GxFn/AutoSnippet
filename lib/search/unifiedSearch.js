/**
 * 统一搜索函数 - CLI 和 Xcode 都使用这个函数
 * 确保两者的搜索逻辑完全一致，不会有偏差
 * 
 * 调用链路：
 * - CLI: cli/searchCommand.js -> unifiedSearch()
 * - Xcode: watch/handlers/SearchHandler.js -> unifiedSearch()
 * -> SearchServiceV2.search()
 * -> IntelligentServiceLayer (可选)
 */

const SearchServiceV2 = require('./SearchServiceV2');
const { getAgentService } = require('../services/agent/agentServiceHelper');

/**
 * 执行统一的搜索
 * @param {string} projectRoot 
 * @param {string} keyword 搜索关键词
 * @param {object} options 
 *   - mode: 'keyword' | 'semantic' | 'ranking' | 'hybrid' (默认 'ranking')
 *   - limit: 结果数量限制 (默认 50)
 *   - sessionId: Agent 会话标识
 *   - userId: Agent 用户标识
 *   - filter: { language?, type?, category? }
 *   - context: 额外上下文 { source?, language?, filePath?, around?, structured? }
 *   - enableAgent: 是否启用 Agent (默认 true，可由环境变量禁用)
 *   - cache: 是否使用缓存 (默认 false)
 * @returns {Promise<Array>} 搜索结果数组
 */
async function performUnifiedSearch(projectRoot, keyword, options = {}) {
  // 默认选项
  const {
  mode = 'ranking',           // 默认 ranking 模式以获得最佳结果
  limit = 50,
  sessionId,
  userId,
  filter,
  context = {},
  enableAgent = true,
  cache = false,
  enableAiAssist = true       // 新增：AI 辅助开关（混合模式使用）
  } = options;

  // 验证关键词
  if (!keyword || keyword.trim() === '') {
  throw new Error('关键词不能为空');
  }

  const cleanKeyword = keyword.trim();

  // 混合模式：合并三种搜索结果
  const normalizedMode = mode.toLowerCase();
  if (normalizedMode === 'hybrid') {
  return performHybridSearch(projectRoot, cleanKeyword, { ...options, limit, enableAiAssist });
  }

  // 创建 SearchServiceV2 实例
  const searchService = new SearchServiceV2(projectRoot, {
  useIndex: process.env.ASD_SEARCH_USE_INDEX !== '0',
  enableIntelligentLayer: enableAgent && process.env.ASD_SEARCH_AGENT !== '0',
  enableLearning: process.env.ASD_SEARCH_AGENT_LEARNING !== '0'
  });

  // 确定搜索模式（统一的模式决策逻辑）
  const useSemantic = normalizedMode === 'keyword' ? false : (normalizedMode === 'semantic' || normalizedMode === 'ranking');
  const useRanking = normalizedMode === 'ranking' ? true : false;
  const modeName = useSemantic ? (useRanking ? 'ranking' : 'semantic') : 'keyword';

  // 调试输出
  if (process.env.ASD_DEBUG_SEARCH_CHAIN === '1') {
  console.log('[CHAIN] unifiedSearch', {
    projectRoot,
    keyword: cleanKeyword,
    mode: modeName,
    sessionId,
    userId,
    source: context.source
  });
  }

  // 执行搜索
  const results = await searchService.search(cleanKeyword, {
  mode: modeName,
  semantic: useSemantic,
  ranking: useRanking,
  limit,
  cache,
  filter: filter && Object.keys(filter).length > 0 ? filter : undefined,
  sessionId,
  userId,
  context
  });

  // 返回结果和 intelligentLayer 实例
  return {
  results: results || [],
  intelligentLayer: searchService.intelligentLayer
  };
}

/**
 * Agent 辅助搜索（基于 keyword + ranking 候选）
 * 从两类候选中挑选 Top N 结果加入返回池
 * 
 * 失败策略：Agent 请求失败直接返回 []，不重试（混合搜索中 ranking/keyword 已有结果）
 */
async function performAgentAssistSearch(projectRoot, keyword, rankingCandidates, keywordCandidates, limit = 3) {
  try {
  const mergedCandidates = [];
  const seen = new Set();

  const append = (items) => {
    for (const item of items) {
    const key = `${item.title}|${item.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      mergedCandidates.push(item);
    }
    }
  };

  append(rankingCandidates || []);
  append(keywordCandidates || []);

  if (mergedCandidates.length === 0) return [];

  const { agentService } = await getAgentService(projectRoot);

  const candidateList = mergedCandidates.slice(0, 30).map((r, i) => {
    const title = r.title || 'Untitled';
    const description = r.description ? r.description.substring(0, 60) : '';
    return `${i + 1}. ${title}${description ? ' - ' + description : ''}`;
  }).join('\n');

  const prompt = `你是代码知识库搜索助手。关键词："${keyword}"

以下是 keyword 与 ranking 两种模式的候选汇总：
${candidateList}

请从中选出最相关的前 ${limit} 个结果。只返回编号，用逗号分隔（例如：1,5,8）：`;

  // 为了避免 Agent 失败时的长时间等待，直接调用 chat
  // 失败时直接放弃 Agent 辅助，混合搜索已有 ranking/keyword 结果
  let response;
  try {
    response = await agentService.chat('code', prompt);
  } catch (chatError) {
    // Agent 失败不重试，直接返回空数组
    console.debug('[Agent Assist] 调用失败，放弃辅助结果:', chatError.message);
    return [];
  }

  const reply = typeof response === 'string' ? response : response.reply;
  const selectedIndices = String(reply || '')
    .split(',')
    .map(s => parseInt(s.trim()) - 1)
    .filter(i => !isNaN(i) && i >= 0 && i < mergedCandidates.length);

  return selectedIndices.slice(0, limit).map(i => ({
    ...mergedCandidates[i],
    _aiSelected: true,
    _searchMode: 'ai'
  }));
  } catch (error) {
  // 其他错误（如候选合并）放弃 AI
  console.debug('[Agent Assist] 失败:', error.message);
  return [];
  }
}

/**
 * 混合搜索模式：合并 ranking、keyword、AI 三种模式的前 N 名
 * 自动去重，返回最多 limit 条结果
 */
async function performHybridSearch(projectRoot, keyword, options = {}) {
  const { limit = 9, filter, context, sessionId, userId, enableAiAssist } = options;
  
  // 支持从环境变量 ASD_DISABLE_AI_ASSIST 禁用 AI 辅助
  const aiEnabled = enableAiAssist !== false && process.env.ASD_DISABLE_AI_ASSIST !== '1';
  
  const topN = 3; // 每种模式取前 3 名
  const candidateLimit = Math.max(30, topN * 10);
  
  const searchOptions = {
  filter,
  context,
  sessionId,
  userId,
  enableAgent: false, // 混合模式不使用 Agent 增强
  cache: false
  };
  
  // 并行执行 keyword + ranking 获取完整候选
  const [rankingAll, keywordAll] = await Promise.all([
  performUnifiedSearch(projectRoot, keyword, { ...searchOptions, mode: 'ranking', limit: candidateLimit })
    .then(r => r.results || []),
  performUnifiedSearch(projectRoot, keyword, { ...searchOptions, mode: 'keyword', limit: candidateLimit })
    .then(r => r.results || [])
  ]);

  const rankingResults = rankingAll.slice(0, topN).map(item => ({ ...item, _searchMode: 'ranking' }));
  const keywordResults = keywordAll.slice(0, topN).map(item => ({ ...item, _searchMode: 'keyword' }));

  // Agent 从 key + rank 候选中挑选 3 条辅助结果
  // 可通过 enableAiAssist 选项或环境变量禁用（如 AI 服务故障时）
  const aiResults = aiEnabled ? (await performAgentAssistSearch(projectRoot, keyword, rankingAll, keywordAll, topN)) : [];
  
  // 合并结果并去重（基于 title + type）
  const seen = new Set();
  const merged = [];
  
  // 交错合并：ranking[0], keyword[0], ai[0], ranking[1], ...
  const maxLength = Math.max(rankingResults.length, keywordResults.length, aiResults.length);
  for (let i = 0; i < maxLength && merged.length < limit; i++) {
  const candidates = [
    rankingResults[i],
    keywordResults[i],
    aiResults[i]
  ].filter(Boolean);
  
  for (const item of candidates) {
    const key = `${item.title}|${item.type}`;
    if (!seen.has(key) && merged.length < limit) {
    seen.add(key);
    merged.push(item);
    }
  }
  }
  
  return {
  results: merged,
  intelligentLayer: null,
  _hybridMeta: {
    rankingCount: rankingResults.length,
    keywordCount: keywordResults.length,
    aiCount: aiResults.length,
    totalBeforeDedup: rankingResults.length + keywordResults.length + aiResults.length,
    finalCount: merged.length
  }
  };
}

module.exports = { performUnifiedSearch, performHybridSearch, performAgentAssistSearch };
