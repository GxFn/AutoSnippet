#!/usr/bin/env node

/**
 * 测试 AI 失败快速放弃的行为
 * 对比启用和禁用 AI 辅助时的搜索性能和结果
 */

const path = require('path');
const fs = require('fs');
const { performUnifiedSearch } = require('../lib/search/unifiedSearch');

// 确定项目根
const specFile = path.resolve(__dirname, '../AutoSnippet/AutoSnippet.boxspec.json');
const projectRoot = path.dirname(specFile);

async function testAiFailureHandling() {
  const testCases = [
    { keyword: 'player', label: '单词查询' },
    { keyword: 'video player', label: '两词查询' },
    { keyword: 'global video player manager', label: '英文多词' }
  ];

  console.log(`\n${'='.repeat(70)}`);
  console.log(`${'='.repeat(70)}  🤖 AI 失败处理测试`);
  console.log(`${'='.repeat(70)}`);
  console.log(`项目: ${projectRoot}\n`);

  for (const testCase of testCases) {
    console.log(`▶️  ${testCase.label.padEnd(15)} | 查询: "${testCase.keyword.padEnd(30)}" ...`);

    // 测试 1: 启用 AI 辅助（正常）
    const startWith = Date.now();
    let resultsWith;
    try {
      const res = await performUnifiedSearch(projectRoot, testCase.keyword, {
        mode: 'hybrid',
        limit: 9,
        enableAiAssist: true  // 启用 AI
      });
      resultsWith = res.results || [];
    } catch (err) {
      console.error(`  ❌ 启用 AI 失败: ${err.message}`);
      continue;
    }
    const timeWith = Date.now() - startWith;

    // 测试 2: 禁用 AI 辅助（快速响应）
    const startWithout = Date.now();
    const resWithout = await performUnifiedSearch(projectRoot, testCase.keyword, {
      mode: 'hybrid',
      limit: 9,
      enableAiAssist: false  // 禁用 AI
    });
    const resultWithout = resWithout.results || [];
    const timeWithout = Date.now() - startWithout;

    // 统计
    const speedup = ((timeWith - timeWithout) / timeWith * 100).toFixed(1);
    const aiContribution = resultsWith.length - resultWithout.length;

    console.log(`  ✅ 启用 AI:  ${timeWith}ms | 结果: ${resultsWith.length} 条`);
    console.log(`  ⚡ 禁用 AI:  ${timeWithout}ms | 结果: ${resultWithout.length} 条`);
    console.log(`  📊 性能提升: ${speedup}% 更快 | AI 贡献: ${aiContribution > 0 ? '+' : ''}${aiContribution} 条\n`);
  }

  console.log(`${'='.repeat(70)}`);
  console.log(`${'='.repeat(70)}  环境变量说明`);
  console.log(`${'='.repeat(70)}`);
  console.log(`
设置 ASD_DISABLE_AI_ASSIST=1 可禁用 AI 辅助（AI 服务故障时使用）:
  export ASD_DISABLE_AI_ASSIST=1
  node scripts/test-hybrid-comprehensive.js

启用时输出样例: [DeepSeek Assist] AI 调用失败，放弃辅助结果: xxx
禁用时输出样例: 不会尝试调用 AI，直接返回 ranking/keyword 结果
`);
}

testAiFailureHandling().catch(console.error);
