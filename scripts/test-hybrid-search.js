#!/usr/bin/env node

/**
 * 混合搜索模式测试
 * 测试合并 ranking、keyword、AI 三种模式的前3名
 */

const { performUnifiedSearch } = require('../lib/search/unifiedSearch');

const query = process.argv[2] || 'player';
const projectRoot = process.argv[3] || '/Users/gaoxuefeng/Documents/github/BiliDemo';

console.log('================================================================================');
console.log('🔀 混合搜索模式测试');
console.log('================================================================================');
console.log(`📝 查询: "${query}"`);
console.log(`📁 项目: ${projectRoot}`);
console.log('');

(async () => {
  try {
    console.log('🔀 Hybrid 模式 (合并三种模式的前3名并去重):');
    const result = await performUnifiedSearch(projectRoot, query, { 
      mode: 'hybrid', 
      limit: 9 
    });
    
    console.log(`\n📊 返回结果: ${result.results.length} 条`);
    if (result._hybridMeta) {
      console.log(`   - Ranking 提供: ${result._hybridMeta.rankingCount} 条`);
      console.log(`   - Keyword 提供: ${result._hybridMeta.keywordCount} 条`);
      console.log(`   - AI 提供: ${result._hybridMeta.aiCount} 条`);
      console.log(`   - 去重前总数: ${result._hybridMeta.totalBeforeDedup} 条`);
      console.log(`   - 去重后: ${result._hybridMeta.finalCount} 条`);
    }
    
    console.log('\n🎯 混合搜索结果:');
    result.results.forEach((r, i) => {
      const mode = r._searchMode || 'unknown';
      const modeIcon = mode === 'ranking' ? '📊' : mode === 'keyword' ? '🔤' : mode === 'ai' ? '🤖' : '❓';
      const score = r.compositeScore ? `(${(r.compositeScore * 100).toFixed(0)}%)` : '';
      console.log(`  ${i+1}. ${modeIcon} ${score} ${r.title}`);
    });
    
    console.log('\n✅ 测试完成');
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    if (process.env.ASD_DEBUG === '1') {
      console.error(error.stack);
    }
    process.exit(1);
  }
})();
