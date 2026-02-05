#!/usr/bin/env node

const assert = require('assert');
const { QualityScorer } = require('../../../lib/quality');

function testQualityScorer() {
  const scorer = new QualityScorer();
  const candidate = {
  title: 'Test',
  trigger: 'as-test',
  code: 'const a = 1;',
  usageGuide: 'Use it',
  category: 'general',
  summary: 'summary here'
  };

  const result = scorer.score(candidate);
  assert(result.overall >= 0 && result.overall <= 1);
  assert(result.dimensions.completeness !== undefined);
}

function main() {
  testQualityScorer();
  console.log('✅ QualityScorer.test.js 通过');
}

main();
