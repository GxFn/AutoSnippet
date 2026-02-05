#!/usr/bin/env node

/**
 * chunker.js 单元测试
 * 覆盖：whole、section、fixed、auto 策略
 */

const chunker = require('../../lib/context/chunker');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function testWhole() {
  const short = 'Hello world';
  const chunks = chunker.chunk(short, { type: 'recipe' }, { strategy: 'whole' });
  assert(chunks.length === 1, 'whole: 短文本应单块');
  assert(chunks[0].content === short);
  assert(chunks[0].metadata.chunkIndex === 0);
}

function testSection() {
  const content = [
  '## Intro',
  'Intro content here.',
  '',
  '## API',
  'API content here.'
  ].join('\n');
  const chunks = chunker.chunk(content, { sourcePath: 'x.md' }, { strategy: 'section' });
  assert(chunks.length >= 2, 'section: 应有至少 2 块');
  const titles = chunks.map(c => c.metadata.sectionTitle).filter(Boolean);
  assert(titles.some(t => /Intro|API/.test(t)), 'section: 应有 sectionTitle');
}

function testFixed() {
  const long = 'a'.repeat(3000);
  const chunks = chunker.chunk(long, { type: 'doc' }, { strategy: 'fixed', maxChunkTokens: 200 });
  assert(chunks.length >= 2, 'fixed: 长文本应多块');
  chunks.forEach((c, i) => {
  assert(c.metadata.chunkIndex === i);
  });
}

function testAuto() {
  // 短文本 → 整篇
  const short = 'Short';
  const c1 = chunker.chunk(short, {}, { strategy: 'auto' });
  assert(c1.length === 1, 'auto+short: 单块');

  // 有 ## 的且足够长 → section（需超过 maxTokens 才不走 whole）
  const withSections = '## A\n' + 'x'.repeat(1500) + '\n\n## B\n' + 'y'.repeat(1500);
  const c2 = chunker.chunk(withSections, {}, { strategy: 'auto' });
  assert(c2.length >= 2, 'auto+##: 按章节');

  // 长且无 ## → fixed
  const long = 'x'.repeat(5000);
  const c3 = chunker.chunk(long, {}, { strategy: 'auto' });
  assert(c3.length >= 2, 'auto+long: 固定长度');
}

function testEstimateTokens() {
  const text = 'abc'; // 3 chars → 1 token @ CHARS_PER_TOKEN=3
  const t = chunker.estimateTokens(text);
  assert(t === 1);
  assert(chunker.estimateTokens('') === 0);
}

function main() {
  testWhole();
  testSection();
  testFixed();
  testAuto();
  testEstimateTokens();
  console.log('✅ chunker.test.js 通过');
}

main();
