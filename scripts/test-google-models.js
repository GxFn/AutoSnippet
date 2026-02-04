#!/usr/bin/env node

/**
 * Google 模型稳定性测试
 * 使用当前 Google API Key 对多个模型进行对比
 */

const AiFactory = require('../lib/ai/AiFactory');

const MODELS = [
  'gemini-3.0-flash',
  'gemini-3.0-pro',
  'gemini-3.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro'
];

const rounds = parseInt(process.argv[2], 10) || 3;
const delayMs = parseInt(process.argv[3], 10) || 1500;
const prompt = '请用一句话概括代码搜索的目的。';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function testModel(model) {
  const ai = AiFactory.create({ provider: 'google', model });
  const results = [];

  for (let i = 0; i < rounds; i++) {
    const start = Date.now();
    try {
      let response;
      let retries = 0;
      while (retries < 2) {
        try {
          response = await ai.chat(prompt, [], '');
          break;
        } catch (err) {
          retries += 1;
          if (String(err.message).includes('429') && retries < 2) {
            await sleep(2000 * retries);
            continue;
          }
          throw err;
        }
      }
      const duration = Date.now() - start;
      results.push({ ok: true, duration, length: (response || '').length });
      process.stdout.write(`  ✅ ${model} [${i + 1}/${rounds}] ${duration}ms\n`);
    } catch (error) {
      const duration = Date.now() - start;
      results.push({ ok: false, duration, error: error.message });
      process.stdout.write(`  ❌ ${model} [${i + 1}/${rounds}] ${duration}ms - ${error.message}\n`);
    }
    await sleep(delayMs);
  }

  const okCount = results.filter(r => r.ok).length;
  const avgMs = results.filter(r => r.ok).reduce((s, r) => s + r.duration, 0) / Math.max(1, okCount);
  const p95 = results.filter(r => r.ok).map(r => r.duration).sort((a,b)=>a-b)[Math.floor(okCount * 0.95) - 1] || 0;

  return { model, okCount, total: rounds, successRate: (okCount / rounds * 100).toFixed(1), avgMs: Math.round(avgMs), p95 };
}

(async () => {
  console.log('================================================================================');
  console.log('🔍 Google 模型稳定性测试');
  console.log('================================================================================');
  console.log(`回合数: ${rounds} (间隔 ${delayMs}ms)`);
  console.log('');

  const summary = [];
  for (const model of MODELS) {
    console.log(`\n▶️ 测试模型: ${model}`);
    const result = await testModel(model);
    summary.push(result);
  }

  console.log('\n================================================================================');
  console.log('📊 测试汇总');
  console.log('================================================================================');
  summary.forEach(s => {
    console.log(`${s.model} | 成功率: ${s.successRate}% | 平均耗时: ${s.avgMs}ms | P95: ${s.p95}ms | 成功: ${s.okCount}/${s.total}`);
  });
})();
