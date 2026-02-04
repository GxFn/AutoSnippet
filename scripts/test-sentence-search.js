#!/usr/bin/env node

/**
 * 自然语言句子搜索测试
 * 对比三种模式对长查询的处理能力
 */

const { performUnifiedSearch } = require('../lib/search/unifiedSearch');
const AiFactory = require('../lib/ai/AiFactory');

const query = process.argv[2] || '如何实现视频播放器的全局管理';
const projectRoot = process.argv[3] || '/Users/gaoxuefeng/Documents/github/BiliDemo';

console.log('================================================================================');
console.log('🔍 自然语言搜索测试');
console.log('================================================================================');
console.log(`📝 查询: "${query}"`);
console.log(`📁 项目: ${projectRoot}`);
console.log('');

(async () => {
  try {
    // Ranking 模式
    console.log('📊 Ranking 模式 (多因子评分):');
    const rankingResult = await performUnifiedSearch(projectRoot, query, { mode: 'ranking', limit: 5 });
    rankingResult.results.forEach((r, i) => {
      const score = r.compositeScore ? `(${(r.compositeScore * 100).toFixed(0)}%)` : '';
      console.log(`  ${i+1}. ${score} ${r.title}`);
    });
    
    console.log('');
    
    // Keyword 模式
    console.log('🔤 Keyword 模式 (关键词匹配):');
    const keywordResult = await performUnifiedSearch(projectRoot, query, { mode: 'keyword', limit: 5 });
    keywordResult.results.forEach((r, i) => console.log(`  ${i+1}. ${r.title}`));
    
    console.log('');
    
    // AI 模式
    console.log('🤖 AI 模式 (deepseek 语义理解):');
    const candidates = await performUnifiedSearch(projectRoot, query, { mode: 'ranking', limit: 30, enableAgent: false });
    
    if (candidates.results.length === 0) {
      console.log('  ⚠️  没有找到候选结果');
    } else {
      const ai = AiFactory.create({ provider: 'deepseek', model: 'deepseek-chat' });
      const prompt = `你是一个代码知识库搜索助手。用户搜索："${query}"

候选结果：
${candidates.results.slice(0, 20).map((r, i) => `${i + 1}. ${r.title}`).join('\n')}

请理解用户的搜索意图，选出最相关的前 5 个结果。
只返回编号，用逗号分隔（例如：1,3,5,8,12）：`;
      
      const response = await ai.chat(prompt, [], '');
      const indices = response.split(',')
        .map(s => parseInt(s.trim()) - 1)
        .filter(i => i >= 0 && i < candidates.results.length);
      
      if (indices.length === 0) {
        console.log('  ⚠️  AI 返回格式错误:', response);
      } else {
        indices.slice(0, 5).forEach((idx, i) => {
          console.log(`  ${i+1}. ${candidates.results[idx].title}`);
        });
      }
    }
    
    console.log('');
    console.log('✅ 测试完成');
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    if (process.env.ASD_DEBUG === '1') {
      console.error(error.stack);
    }
    process.exit(1);
  }
})();
