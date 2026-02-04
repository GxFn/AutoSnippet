#!/usr/bin/env node

/**
 * 随机搜索测试脚本
 * - 从 Recipe 标题/触发词生成关键词池
 * - 随机抽取关键词进行 SearchServiceV2 搜索
 * - 输出命中率与结果统计
 */

const fs = require('fs');
const path = require('path');
const ProjectStructure = require('../lib/infrastructure/paths/ProjectStructure');
const SearchServiceV2 = require('../lib/application/services/SearchServiceV2');
const { parseRecipeMd } = require('../lib/recipe/parseRecipeMd');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.split('=');
    const key = k.replace(/^--/, '');
    if (v !== undefined) args[key] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      args[key] = argv[i + 1];
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function tokenize(text) {
  return String(text || '')
    .split(/[\s,;|\/]+/)
    .map(s => s.replace(/^@/, '').trim())
    .filter(Boolean)
    .filter(s => s.length >= 2);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getRecipesDir(projectRoot) {
  return path.join(projectRoot, 'AutoSnippet', 'recipes');
}

function buildKeywordPool(recipesDir) {
  const pool = new Set();
  const files = fs.readdirSync(recipesDir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const full = path.join(recipesDir, file);
    const content = fs.readFileSync(full, 'utf8');
    let parsed = null;
    try {
      parsed = parseRecipeMd(content);
    } catch (_) {}

    if (parsed?.title) tokenize(parsed.title).forEach(t => pool.add(t));
    if (parsed?.trigger) tokenize(parsed.trigger).forEach(t => pool.add(t));
  }
  return Array.from(pool);
}

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = args.projectRoot
    ? path.resolve(args.projectRoot)
    : (ProjectStructure.findProjectRoot(process.cwd()) || process.cwd());

  const count = Number(args.count || 20);
  const mode = String(args.mode || 'ranking').toLowerCase();
  const semantic = args.semantic !== undefined
    ? String(args.semantic) === 'true'
    : (mode !== 'keyword');
  const ranking = args.ranking !== undefined
    ? String(args.ranking) === 'true'
    : (mode !== 'semantic');

  const recipesDir = getRecipesDir(projectRoot);
  if (!fs.existsSync(recipesDir)) {
    console.error(`recipesDir 不存在: ${recipesDir}`);
    process.exit(1);
  }

  const keywords = buildKeywordPool(recipesDir);
  if (keywords.length === 0) {
    console.error('关键词池为空，请确认 recipes 目录内有可解析的 Recipe');
    process.exit(1);
  }

  const searchService = new SearchServiceV2(projectRoot, {
    enableIntelligentLayer: process.env.ASD_SEARCH_AGENT !== '0',
    enableLearning: process.env.ASD_SEARCH_AGENT_LEARNING !== '0'
  });

  const sessionId = args.sessionId || 'random-search-test';
  const userId = process.env.ASD_USER_ID || process.env.USER || process.env.USERNAME;

  const picks = shuffle(keywords.slice()).slice(0, Math.min(count, keywords.length));
  let hit = 0;
  let totalResults = 0;

  for (const keyword of picks) {
    const results = await searchService.search(keyword, {
      mode,
      semantic,
      ranking,
      limit: Number(args.limit || 8),
      cache: false,
      sessionId,
      userId
    });

    if (results.length > 0) hit++;
    totalResults += results.length;

    if (args.verbose) {
      console.log(`- ${keyword}: ${results.length}`);
    }
  }

  const hitRate = ((hit / picks.length) * 100).toFixed(1);
  const avg = (totalResults / picks.length).toFixed(2);

  console.log('随机搜索测试完成');
  console.log(`projectRoot: ${projectRoot}`);
  console.log(`mode: ${mode}, semantic: ${semantic}, ranking: ${ranking}`);
  console.log(`queries: ${picks.length}, hit: ${hit}, hitRate: ${hitRate}%`);
  console.log(`avgResults: ${avg}`);
}

main().catch(err => {
  console.error('随机搜索测试失败:', err.message);
  process.exit(1);
});
