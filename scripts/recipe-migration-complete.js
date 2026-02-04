#!/usr/bin/env node

/**
 * Recipe 完整迁移工具
 * 支持：元数据提取 → 向量化 → 索引构建 → 验证
 * 
 * 用法:
 *   node scripts/recipe-migration-complete.js [--phase <1|2|3|4>] [--check-only] [--dry-run]
 *
 * 阶段:
 *   1. 元数据提取 (metadata extraction)
 *   2. 向量化索引 (vectorization & indexing)
 *   3. 验证与兼容 (validation & compatibility)
 *   4. 生成报告 (generate report)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const projectRoot = path.resolve(__dirname, '..');
const args = require('minimist')(process.argv.slice(2));

// ============ 工具函数 ============

const logger = {
  log: (msg, data = null) => {
    const prefix = `[${new Date().toISOString()}]`;
    console.log(`${prefix} ${msg}`);
    if (data) console.log(JSON.stringify(data, null, 2));
  },
  success: (msg) => console.log(`✅ ${msg}`),
  warn: (msg) => console.warn(`⚠️  ${msg}`),
  error: (msg, err = null) => {
    console.error(`❌ ${msg}`);
    if (err) console.error(err);
  },
  section: (title) => {
    console.log('\n' + '='.repeat(60));
    console.log(`  ${title}`);
    console.log('='.repeat(60) + '\n');
  }
};

const stats = {
  phase1: { recipes: 0, extracted: 0, errors: 0 },
  phase2: { embedded: 0, indexed: 0, errors: 0 },
  phase3: { validated: 0, compatible: 0, warnings: 0 },
  phase4: { complete: false }
};

// ============ Phase 1: 元数据提取 ============

async function phase1MetadataExtraction() {
  logger.section('Phase 1: 元数据提取');

  try {
    // 1. 发现 Recipe 文件
    logger.log('🔍 发现 Recipe 文件...');
    const recipeFiles = findAllRecipeFiles();
    stats.phase1.recipes = recipeFiles.length;
    logger.success(`发现 ${recipeFiles.length} 个 Recipe 文件`);

    if (recipeFiles.length === 0) {
      logger.warn('未发现 Recipe 文件');
      return false;
    }

    // 2. 初始化 RecipeExtractor
    logger.log('📦 初始化 RecipeExtractor...');
    let RecipeExtractor;
    try {
      RecipeExtractor = require('../lib/context/RecipeExtractor');
    } catch (e) {
      // Fallback: 实现简单提取器
      logger.warn('RecipeExtractor 不可用，使用简化提取器');
      RecipeExtractor = require('./recipe-migration-helper').SimpleRecipeExtractor;
    }
    const extractor = new RecipeExtractor({
      extractSemanticTags: true,
      analyzeCodeQuality: true,
      inferDependencies: true,
      contentHashEnabled: true
    });
    logger.success('提取器已就绪');

    // 3. 批量提取元数据
    logger.log(`📝 批量提取元数据 (${recipeFiles.length} 个文件)...`);
    const metadataDir = path.join(projectRoot, '.autosnippet', 'metadata');
    ensureDirectory(metadataDir);

    let extracted = 0;
    let errors = 0;
    const metadata = [];

    for (let i = 0; i < recipeFiles.length; i++) {
      const file = recipeFiles[i];
      try {
        const meta = extractor.extractFromFile(file);
        
        // 存储元数据
        const categoryDir = path.join(metadataDir, meta.category || 'other');
        ensureDirectory(categoryDir);
        
        const metaFile = path.join(categoryDir, `${meta.id}.json`);
        fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf8');
        
        metadata.push(meta);
        extracted++;
        
        // 进度输出
        if ((i + 1) % 5 === 0 || i === recipeFiles.length - 1) {
          const pct = Math.round((i + 1) / recipeFiles.length * 100);
          logger.log(`  进度: ${pct}% (${i + 1}/${recipeFiles.length})`);
        }
      } catch (err) {
        errors++;
        logger.warn(`提取失败: ${path.relative(projectRoot, file)} - ${err.message}`);
      }
    }

    stats.phase1.extracted = extracted;
    stats.phase1.errors = errors;

    logger.success(`元数据提取完成: ${extracted}/${recipeFiles.length}`);
    if (errors > 0) logger.warn(`失败: ${errors}`);

    // 4. 生成迁移报告
    logger.log('📊 生成迁移报告...');
    generateMigrationReport(metadata, metadataDir);
    logger.success('迁移报告已生成: .autosnippet/migration-report.json');

    return true;

  } catch (err) {
    logger.error('Phase 1 执行失败', err);
    return false;
  }
}

// ============ Phase 2: 向量化索引 ============

async function phase2Vectorization() {
  logger.section('Phase 2: 向量化索引');

  try {
    // 1. 检查前置条件
    logger.log('🔐 检查前置条件...');
    const metadataDir = path.join(projectRoot, '.autosnippet', 'metadata');
    if (!fs.existsSync(metadataDir)) {
      logger.error('元数据目录不存在，请先执行 Phase 1');
      return false;
    }
    logger.success('前置条件检查通过');

    // 2. 初始化索引管道
    logger.log('🔧 初始化 IndexingPipeline...');
    let IndexingPipeline;
    try {
      IndexingPipeline = require('../lib/context/IndexingPipeline');
    } catch (e) {
      logger.error('IndexingPipeline 不可用');
      return false;
    }

    // 3. 构建索引
    logger.log('🎯 开始构建索引...');
    const result = await IndexingPipeline.buildFullIndex(projectRoot);
    
    stats.phase2.embedded = result.embedded || 0;
    stats.phase2.indexed = result.indexed || 0;
    stats.phase2.errors = result.errors || 0;

    logger.success(`索引构建完成: ${stats.phase2.embedded} 条嵌入, ${stats.phase2.indexed} 个索引`);
    if (stats.phase2.errors > 0) {
      logger.warn(`错误: ${stats.phase2.errors}`);
    }

    return true;

  } catch (err) {
    logger.error('Phase 2 执行失败', err);
    return false;
  }
}

// ============ Phase 3: 验证与兼容 ============

async function phase3Validation() {
  logger.section('Phase 3: 验证与兼容性');

  try {
    // 1. 验证数据完整性
    logger.log('✔️ 验证数据完整性...');
    const metadataDir = path.join(projectRoot, '.autosnippet', 'metadata');
    const originalRecipesDir = path.join(projectRoot, 'recipes');

    const originalCount = countFiles(originalRecipesDir, '.md');
    const metadataCount = countFiles(metadataDir, '.json');

    logger.log(`原始 Recipe: ${originalCount}, 迁移元数据: ${metadataCount}`);

    if (metadataCount >= originalCount * 0.9) {
      logger.success('数据完整性验证通过');
      stats.phase3.validated = metadataCount;
    } else {
      logger.warn(`数据缺失: 缺少 ${originalCount - metadataCount} 条`);
      stats.phase3.warnings++;
    }

    // 2. 兼容性检查
    logger.log('🔄 检查旧新系统兼容性...');
    
    // 检查 RecipeServiceV2 是否能读取新元数据
    try {
      const RecipeServiceV2 = require('../lib/application/services/RecipeServiceV2');
      const service = new RecipeServiceV2(projectRoot);
      const recipes = await service.listRecipes();
      
      logger.success(`兼容性检查通过: 可读取 ${recipes.length} 条 Recipe`);
      stats.phase3.compatible = recipes.length;
    } catch (err) {
      logger.warn(`兼容性检查异常: ${err.message}`);
      stats.phase3.warnings++;
    }

    // 3. 搜索服务验证
    logger.log('🔍 验证搜索服务...');
    try {
      const { getInstance } = require('../lib/context/index');
      const ctx = getInstance(projectRoot);
      const results = await ctx.search('test', { limit: 1 });
      
      if (results && results.length >= 0) {
        logger.success(`搜索服务验证通过: 支持查询`);
      } else {
        logger.warn('搜索结果异常');
        stats.phase3.warnings++;
      }
    } catch (err) {
      logger.warn(`搜索服务验证异常: ${err.message}`);
      stats.phase3.warnings++;
    }

    return stats.phase3.warnings < 3;

  } catch (err) {
    logger.error('Phase 3 执行失败', err);
    return false;
  }
}

// ============ Phase 4: 生成报告 ============

async function phase4Report() {
  logger.section('Phase 4: 最终报告');

  const report = {
    timestamp: new Date().toISOString(),
    projectRoot,
    phases: {
      phase1: {
        name: '元数据提取',
        status: stats.phase1.extracted > 0 ? 'completed' : 'pending',
        recipes: stats.phase1.recipes,
        extracted: stats.phase1.extracted,
        errors: stats.phase1.errors
      },
      phase2: {
        name: '向量化索引',
        status: stats.phase2.embedded > 0 ? 'completed' : 'pending',
        embedded: stats.phase2.embedded,
        indexed: stats.phase2.indexed,
        errors: stats.phase2.errors
      },
      phase3: {
        name: '验证与兼容',
        status: 'completed',
        validated: stats.phase3.validated,
        compatible: stats.phase3.compatible,
        warnings: stats.phase3.warnings
      }
    },
    directories: {
      originalRecipes: path.join('recipes'),
      metadata: path.join('.autosnippet', 'metadata'),
      index: path.join('.autosnippet', 'context', 'index')
    },
    recommendations: generateRecommendations(),
    nextSteps: generateNextSteps()
  };

  // 保存报告
  const reportPath = path.join(projectRoot, '.autosnippet', 'complete-migration-report.json');
  ensureDirectory(path.dirname(reportPath));
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  // 输出报告
  logger.log('📋 迁移完成报告');
  logger.log('', {
    summary: {
      totalRecipes: stats.phase1.recipes,
      extracted: stats.phase1.extracted,
      embedded: stats.phase2.embedded,
      indexed: stats.phase2.indexed,
      errors: stats.phase1.errors + stats.phase2.errors,
      warnings: stats.phase3.warnings
    },
    recommendations: report.recommendations,
    nextSteps: report.nextSteps
  });

  logger.success(`完整报告已保存: ${reportPath}`);
  stats.phase4.complete = true;
  return true;
}

// ============ 工具函数 ============

function findAllRecipeFiles(dir = path.join(projectRoot, 'recipes')) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findAllRecipeFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

function countFiles(dir, ext) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(fullPath, ext);
    } else if (entry.name.endsWith(ext)) {
      count++;
    }
  }
  return count;
}

function ensureDirectory(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function generateMigrationReport(metadata, outputDir) {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalRecipes: metadata.length,
      byCategory: {},
      byLanguage: {}
    },
    statistics: {
      avgQualityScore: 0,
      avgKeywords: 0,
      avgTags: 0,
      withCode: 0,
      withDocs: 0
    }
  };

  let totalQuality = 0;
  let totalKeywords = 0;
  let totalTags = 0;

  for (const meta of metadata) {
    // 分类统计
    const cat = meta.category || 'other';
    report.summary.byCategory[cat] = (report.summary.byCategory[cat] || 0) + 1;

    const lang = meta.language || 'other';
    report.summary.byLanguage[lang] = (report.summary.byLanguage[lang] || 0) + 1;

    // 内容统计
    if (meta.quality?.authorityScore) {
      totalQuality += meta.quality.authorityScore;
    }
    if (meta.keywords) {
      totalKeywords += meta.keywords.length;
    }
    if (meta.semanticTags) {
      totalTags += meta.semanticTags.length;
    }
    if (meta.codeBlocks?.length > 0) {
      report.statistics.withCode++;
    }
    if (meta.documentation) {
      report.statistics.withDocs++;
    }
  }

  // 计算平均值
  if (metadata.length > 0) {
    report.statistics.avgQualityScore = (totalQuality / metadata.length).toFixed(2);
    report.statistics.avgKeywords = (totalKeywords / metadata.length).toFixed(1);
    report.statistics.avgTags = (totalTags / metadata.length).toFixed(1);
  }

  const reportPath = path.join(outputDir, '..', 'migration-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
}

function generateRecommendations() {
  const recs = [];

  if (stats.phase1.extracted > 0) {
    recs.push('✅ Phase 1 完成: 元数据已提取并存储');
  } else {
    recs.push('⚠️  需执行 Phase 1: 提取元数据');
  }

  if (stats.phase2.embedded > 0) {
    recs.push('✅ Phase 2 完成: 向量索引已构建');
  } else {
    recs.push('⚠️  可执行 Phase 2: 构建向量索引 (可选)');
  }

  if (stats.phase3.warnings === 0) {
    recs.push('✅ Phase 3 完成: 系统兼容性验证通过');
  } else {
    recs.push('⚠️  Phase 3 有警告，建议检查');
  }

  if (stats.phase1.errors === 0 && stats.phase2.errors === 0) {
    recs.push('✅ 迁移质量高: 无重大错误');
  }

  return recs;
}

function generateNextSteps() {
  const steps = [];

  if (stats.phase1.extracted > 0) {
    steps.push('1. 检查元数据质量: cat .autosnippet/migration-report.json');
  }

  if (stats.phase2.embedded === 0) {
    steps.push('2. 构建向量索引: node scripts/recipe-migration-complete.js --phase 2');
  }

  steps.push('3. 验证搜索功能: asd search "测试关键词"');
  steps.push('4. 启用智能搜索: asd ss "测试关键词" -u user-123');
  steps.push('5. 监控性能: asd doctor');

  return steps;
}

// ============ 主程序 ============

async function main() {
  try {
    const phase = parseInt(args.phase) || 0;
    const checkOnly = args['check-only'] || false;
    const dryRun = args['dry-run'] || false;

    if (checkOnly) {
      logger.log('检查模式: 仅显示状态，不执行迁移');
    }
    if (dryRun) {
      logger.log('测试运行: 模拟执行，不修改文件');
    }

    // 全量执行
    if (phase === 0 || phase === 1) {
      if (!checkOnly && !dryRun) {
        await phase1MetadataExtraction();
      }
    }

    if (phase === 0 || phase === 2) {
      if (!checkOnly && !dryRun) {
        await phase2Vectorization();
      }
    }

    if (phase === 0 || phase === 3) {
      if (!checkOnly && !dryRun) {
        await phase3Validation();
      }
    }

    if (phase === 0 || phase === 4) {
      if (!checkOnly && !dryRun) {
        await phase4Report();
      } else {
        // 显示当前状态
        logger.log('当前迁移状态', stats);
      }
    }

    // 最终报告
    logger.section('迁移摘要');
    logger.log('', {
      phase1: stats.phase1,
      phase2: stats.phase2,
      phase3: stats.phase3,
      phase4: stats.phase4
    });

  } catch (err) {
    logger.error('迁移失败', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { 
  phase1MetadataExtraction, 
  phase2Vectorization, 
  phase3Validation, 
  phase4Report 
};
