#!/usr/bin/env node

/**
 * 搜索模式对比测试
 * 对比 ranking、keyword 和 AI 三种模式的搜索结果
 * 
 * 使用方式:
 *   node scripts/test-search-modes.js <projectRoot> [numTests]
 * 
 * 示例:
 *   node scripts/test-search-modes.js /path/to/BiliDemo 100
 */

const fs = require('fs');
const path = require('path');

// 常见的搜索关键词列表
const COMMON_KEYWORDS = [
  'delegate',
  'view',
  'controller',
  'animation',
  'cell',
  'table',
  'collection',
  'player',
  'video',
  'gesture',
  'layout',
  'manager',
  'service',
  'protocol',
  'init',
  'config',
  'update',
  'render',
  'fetch',
  'cache',
  'network',
  'model',
  'data',
  'request',
  'response',
  'handler',
  'listener',
  'observer',
  'notification',
  'event',
];

/**
 * 随机选择 N 个关键词
 */
function getRandomKeywords(count = 10) {
  const keywords = [];
  for (let i = 0; i < count; i++) {
    const keyword = COMMON_KEYWORDS[Math.floor(Math.random() * COMMON_KEYWORDS.length)];
    if (!keywords.includes(keyword)) {
      keywords.push(keyword);
    }
  }
  return keywords;
}

/**
 * 执行搜索
 */
async function performSearch(projectRoot, keyword, mode) {
  try {
    const { performUnifiedSearch } = require('../lib/search/unifiedSearch');
    const result = await performUnifiedSearch(projectRoot, keyword, {
      mode,
      limit: 20,
      enableAgent: false, // 禁用 Agent 以保持结果稳定
    });
    return result.results || [];
  } catch (error) {
    console.error(`搜索失败 [${mode}] "${keyword}":`, error.message);
    return [];
  }
}

/**
 * 使用 AI 进行自然语言搜索和排序
 */
async function performAISearch(projectRoot, keyword) {
  try {
    // 使用 ranking 模式获取候选（更优质的候选列表）
    const { performUnifiedSearch } = require('../lib/search/unifiedSearch');
    const result = await performUnifiedSearch(projectRoot, keyword, {
      mode: 'ranking',
      limit: 50, // 获取更多候选供 AI 选择
      enableAgent: false,
    });
    
    const candidates = result.results || [];
    if (candidates.length === 0) return [];
    
    // 调用 AI 让它选出最相关的前 20 个（使用 deepseek）
    const AiFactory = require('../lib/ai/AiFactory');
    const ai = AiFactory.create({
      provider: 'deepseek',
      model: 'deepseek-chat'
    });
    
    const prompt = `你是一个代码知识库搜索助手。用户搜索关键词是："${keyword}"

以下是候选的搜索结果（按文件名列出）：

${candidates.slice(0, 30).map((r, i) => `${i + 1}. ${r.title || r.name}`).join('\n')}

请根据与关键词"${keyword}"的相关性，选出最相关的前 20 个结果。

要求：
1. 理解关键词的语义和意图
2. 考虑文件名/标题的相关性
3. 优先选择直接相关的结果
4. 返回结果编号，用逗号分隔（例如：1,5,8,12...）

只返回编号列表，不要其他解释：`;

    const response = await ai.chat(prompt, [], ''); // 修正参数：空历史数组 + 空系统指令
    const selectedIndices = response.split(',')
      .map(s => parseInt(s.trim()) - 1)
      .filter(i => i >= 0 && i < candidates.length);
    
    return selectedIndices.slice(0, 20).map(i => candidates[i]);
  } catch (error) {
    console.error(`AI 搜索失败 "${keyword}":`, error.message);
    return [];
  }
}

/**
 * 计算两个结果集的相似度
 */
function calculateSimilarity(results1, results2) {
  if (results1.length === 0 && results2.length === 0) return 1.0;
  if (results1.length === 0 || results2.length === 0) return 0.0;

  const set1 = new Set(results1.map(r => `${r.title}|${r.type}`));
  const set2 = new Set(results2.map(r => `${r.title}|${r.type}`));

  let intersection = 0;
  for (const item of set1) {
    if (set2.has(item)) intersection++;
  }

  const union = new Set([...set1, ...set2]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * 计算排序差异
 */
function calculateRankingDifference(results1, results2) {
  if (results1.length === 0 || results2.length === 0) return null;

  const keyedResults2 = {};
  results2.forEach((r, idx) => {
    keyedResults2[`${r.title}|${r.type}`] = idx;
  });

  let totalDiff = 0;
  let count = 0;

  results1.forEach((r, idx1) => {
    const key = `${r.title}|${r.type}`;
    if (keyedResults2[key] !== undefined) {
      totalDiff += Math.abs(idx1 - keyedResults2[key]);
      count++;
    }
  });

  return count > 0 ? (totalDiff / count).toFixed(2) : null;
}

/**
 * 主测试函数
 */
async function runTests(projectRoot, numTests = 10) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔍 搜索模式对比测试 (Ranking vs Keyword vs AI)`);
  console.log(`${'='.repeat(80)}\n`);

  const projectName = path.basename(projectRoot);
  console.log(`📁 项目: ${projectName}`);
  console.log(`🔢 测试数量: ${numTests}\n`);

  const keywords = getRandomKeywords(numTests);
  console.log(`📝 测试关键词: ${keywords.join(', ')}\n`);

  const stats = {
    total: 0,
    rankingBetter: 0,
    keywordBetter: 0,
    aiBetter: 0,
    noChange: 0,
    avgSimilarity: {
      rankingKeyword: 0,
      rankingAI: 0,
      keywordAI: 0
    },
    avgRankingDiff: 0,
    results: [],
  };

  for (let i = 0; i < keywords.length; i++) {
    const keyword = keywords[i];
    console.log(`\n[${i + 1}/${keywords.length}] 测试: "${keyword}"`);

    // 执行三种模式的搜索
    const rankingResults = await performSearch(projectRoot, keyword, 'ranking');
    const keywordResults = await performSearch(projectRoot, keyword, 'keyword');
    
    console.log(`  • Ranking 模式: ${rankingResults.length} 结果`);
    console.log(`  • Keyword 模式: ${keywordResults.length} 结果`);
    
    // AI 模式搜索
    console.log(`  • AI 模式: 正在调用大模型...`);
    const aiResults = await performAISearch(projectRoot, keyword);
    console.log(`  • AI 模式: ${aiResults.length} 结果`);

    // 计算三者之间的相似度
    const simRankingKeyword = calculateSimilarity(rankingResults, keywordResults);
    const simRankingAI = calculateSimilarity(rankingResults, aiResults);
    const simKeywordAI = calculateSimilarity(keywordResults, aiResults);
    
    const rankingDiff = calculateRankingDifference(rankingResults, keywordResults);

    console.log(`  • 相似度: Ranking-Keyword=${(simRankingKeyword * 100).toFixed(1)}%, Ranking-AI=${(simRankingAI * 100).toFixed(1)}%, Keyword-AI=${(simKeywordAI * 100).toFixed(1)}%`);
    if (rankingDiff !== null) {
      console.log(`  • 平均排序差异 (Ranking vs Keyword): ${rankingDiff}`);
    }

    // 分析差异原因
    const maxSim = Math.max(simRankingKeyword, simRankingAI, simKeywordAI);
    if (maxSim < 0.7) {
      console.log(`  ⚠️  三种模式结果差异较大`);
      console.log(`     Ranking Top3: ${rankingResults.slice(0, 3).map(r => r.title).join(', ')}`);
      console.log(`     Keyword Top3: ${keywordResults.slice(0, 3).map(r => r.title).join(', ')}`);
      console.log(`     AI Top3: ${aiResults.slice(0, 3).map(r => r.title).join(', ')}`);
    }

    // 更新统计
    stats.total++;
    stats.avgSimilarity.rankingKeyword += simRankingKeyword;
    stats.avgSimilarity.rankingAI += simRankingAI;
    stats.avgSimilarity.keywordAI += simKeywordAI;
    
    if (rankingDiff !== null) {
      stats.avgRankingDiff += parseFloat(rankingDiff);
    }

    // 判断哪个模式返回结果更多
    const counts = [
      { mode: 'ranking', count: rankingResults.length },
      { mode: 'keyword', count: keywordResults.length },
      { mode: 'ai', count: aiResults.length }
    ].sort((a, b) => b.count - a.count);
    
    if (counts[0].count === counts[1].count && counts[1].count === counts[2].count) {
      stats.noChange++;
    } else if (counts[0].mode === 'ranking') {
      stats.rankingBetter++;
    } else if (counts[0].mode === 'keyword') {
      stats.keywordBetter++;
    } else {
      stats.aiBetter++;
    }

    stats.results.push({
      keyword,
      rankingCount: rankingResults.length,
      keywordCount: keywordResults.length,
      aiCount: aiResults.length,
      similarities: {
        rankingKeyword: simRankingKeyword.toFixed(4),
        rankingAI: simRankingAI.toFixed(4),
        keywordAI: simKeywordAI.toFixed(4)
      },
      rankingDiff,
      rankingTop3: rankingResults.slice(0, 3).map(r => r.title),
      keywordTop3: keywordResults.slice(0, 3).map(r => r.title),
      aiTop3: aiResults.slice(0, 3).map(r => r.title)
    });
  }

  // 计算平均值
  if (stats.total > 0) {
    stats.avgSimilarity.rankingKeyword = (stats.avgSimilarity.rankingKeyword / stats.total * 100).toFixed(1);
    stats.avgSimilarity.rankingAI = (stats.avgSimilarity.rankingAI / stats.total * 100).toFixed(1);
    stats.avgSimilarity.keywordAI = (stats.avgSimilarity.keywordAI / stats.total * 100).toFixed(1);
    if (stats.rankingDiff > 0) {
      stats.avgRankingDiff = (stats.avgRankingDiff / stats.total).toFixed(2);
    }
  }

  // 打印总结
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 测试总结 (Ranking vs Keyword vs AI)`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`✅ 总测试数: ${stats.total}`);
  console.log(`\n📊 结果数量对比:`);
  console.log(`  📈 Ranking 最多: ${stats.rankingBetter}`);
  console.log(`  📉 Keyword 最多: ${stats.keywordBetter}`);
  console.log(`  🤖 AI 最多: ${stats.aiBetter}`);
  console.log(`  ⏸️  三者相同: ${stats.noChange}`);
  console.log(`\n🎯 平均相似度:`);
  console.log(`  Ranking ↔️ Keyword: ${stats.avgSimilarity.rankingKeyword}%`);
  console.log(`  Ranking ↔️ AI: ${stats.avgSimilarity.rankingAI}%`);
  console.log(`  Keyword ↔️ AI: ${stats.avgSimilarity.keywordAI}%`);
  if (stats.avgRankingDiff > 0) {
    console.log(`\n📍 平均排序差异: ${stats.avgRankingDiff}`);
  }

  // 生成详细报告
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📋 详细结果`);
  console.log(`${'='.repeat(80)}\n`);

  stats.results.forEach((result, idx) => {
    console.log(`${idx + 1}. "${result.keyword}"`);
    console.log(`   结果数: Ranking=${result.rankingCount}, Keyword=${result.keywordCount}, AI=${result.aiCount}`);
    console.log(`   相似度: R↔️K=${result.similarities.rankingKeyword}, R↔️AI=${result.similarities.rankingAI}, K↔️AI=${result.similarities.keywordAI}`);
    console.log(`   🏆 Ranking Top3: ${result.rankingTop3.join(' > ')}`);
    console.log(`   🔤 Keyword Top3: ${result.keywordTop3.join(' > ')}`);
    console.log(`   🤖 AI Top3: ${result.aiTop3.join(' > ')}`);
    if (result.rankingDiff) {
      console.log(`   📍 排序差异: ${result.rankingDiff}`);
    }
    console.log('');
  });

  // 保存报告到文件
  const reportPath = path.join(projectRoot, 'search-modes-comparison.json');
  fs.writeFileSync(reportPath, JSON.stringify(stats, null, 2), 'utf8');
  console.log(`📄 完整报告已保存: ${reportPath}\n`);
}

// 主程序入口
async function main() {
  const projectRoot = process.argv[2] || process.cwd();
  const numTests = parseInt(process.argv[3], 10) || 10;

  if (!fs.existsSync(projectRoot)) {
    console.error(`❌ 项目目录不存在: ${projectRoot}`);
    process.exit(1);
  }

  try {
    await runTests(projectRoot, numTests);
    console.log('✅ 测试完成！\n');
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    if (process.env.ASD_DEBUG === '1') {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
