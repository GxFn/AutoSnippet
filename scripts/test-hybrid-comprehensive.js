#!/usr/bin/env node

/**
 * 混合搜索综合测试套件
 * 对不同类型查询进行完整的 hybrid 搜索验证
 */

const { performHybridSearch } = require('../lib/search/unifiedSearch');

const testCases = [
  { query: 'player', type: 'single-word', desc: '单词查询' },
  { query: 'video player', type: 'two-words', desc: '两词查询' },
  { query: 'global video player manager', type: 'multi-words-en', desc: '英文多词' },
  { query: '视频播放', type: 'chinese', desc: '中文双词' },
  { query: '如何实现视频播放器的全局管理', type: 'chinese-long', desc: '中文长句' },
];

const projectRoot = process.argv[2] || '/Users/gaoxuefeng/Documents/github/BiliDemo';

async function runTest(testCase) {
  const { query, type, desc } = testCase;
  const start = Date.now();

  try {
    const result = await performHybridSearch(projectRoot, query, { limit: 9 });
    const duration = Date.now() - start;

    const results = result.results || [];
    const meta = result._hybridMeta || {};

    return {
      query,
      type,
      desc,
      success: true,
      duration,
      resultCount: results.length,
      ranking: meta.rankingCount || 0,
      keyword: meta.keywordCount || 0,
      ai: meta.aiCount || 0,
      dedup: meta.totalBeforeDedup - meta.finalCount,
      results: results.slice(0, 3).map(r => ({
        title: r.title,
        mode: r._searchMode
      }))
    };
  } catch (error) {
    return {
      query,
      type,
      desc,
      success: false,
      duration: Date.now() - start,
      error: error.message
    };
  }
}

(async () => {
  console.log('================================================================================');
  console.log('🔀 混合搜索综合测试');
  console.log('================================================================================');
  console.log(`项目: ${projectRoot}`);
  console.log(`用例数: ${testCases.length}\n`);

  const results = [];
  for (const testCase of testCases) {
    process.stdout.write(`▶️  ${testCase.desc.padEnd(12)} | 查询: "${testCase.query.padEnd(30)}" ... `);
    const result = await runTest(testCase);
    results.push(result);

    if (result.success) {
      console.log(
        `✅ ${result.duration.toString().padStart(4)}ms | ` +
        `结果: ${result.resultCount} | ` +
        `Rank:${result.ranking} Key:${result.keyword} AI:${result.ai} | ` +
        `去重: ${result.dedup}`
      );
    } else {
      console.log(`❌ ${result.error}`);
    }
  }

  console.log('\n================================================================================');
  console.log('📊 测试统计');
  console.log('================================================================================\n');

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`总计: ${results.length} | ✅ 成功: ${successful.length} | ❌ 失败: ${failed.length}`);

  if (successful.length > 0) {
    const avgDuration = Math.round(successful.reduce((s, r) => s + r.duration, 0) / successful.length);
    const totalResults = successful.reduce((s, r) => s + r.resultCount, 0);
    const totalDedup = successful.reduce((s, r) => s + r.dedup, 0);

    console.log(`\n响应时间:`);
    console.log(`  - 平均: ${avgDuration}ms`);
    console.log(`  - 最快: ${Math.min(...successful.map(r => r.duration))}ms`);
    console.log(`  - 最慢: ${Math.max(...successful.map(r => r.duration))}ms`);

    console.log(`\n结果数据:`);
    console.log(`  - 总共返回: ${totalResults} 条`);
    console.log(`  - 平均每次: ${Math.round(totalResults / successful.length)} 条`);
    console.log(`  - 总去重: ${totalDedup} 条`);

    console.log(`\n Top3 结果预览:`);
    results.forEach((r, idx) => {
      if (r.success && r.results.length > 0) {
        console.log(`  ${idx + 1}. ${r.desc}`);
        r.results.forEach((item, i) => {
          console.log(`     ${item.title.substring(0, 60)}`);
        });
      }
    });
  }

  console.log('\n✅ 测试完成\n');
})();
