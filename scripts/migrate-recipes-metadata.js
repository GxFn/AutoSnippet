#!/usr/bin/env node

/**
 * Recipe 元数据迁移脚本
 * 将现有 Recipe Markdown 文件转换为扩展元数据格式（v2）
 * 支持批量提取、验证、存储和索引元数据
 */

const fs = require('fs');
const path = require('path');
const RecipeExtractor = require('../lib/context/RecipeExtractor');
const kbConfig = require('../config/knowledge-base.config');

const projectRoot = path.resolve(__dirname, '..');
const recipesDir = path.join(projectRoot, 'recipes');
const metadataDir = path.join(projectRoot, '.autosnippet', 'metadata');
const logPath = path.join(projectRoot, '.autosnippet', 'logs');

// 初始化日志目录
if (!fs.existsSync(logPath)) {
  fs.mkdirSync(logPath, { recursive: true });
}

const logger = {
  log: (msg) => {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] ${msg}`;
    console.log(logMsg);
    fs.appendFileSync(path.join(logPath, 'migrate-metadata.log'), logMsg + '\n');
  },
  error: (msg, err) => {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] ERROR: ${msg}`;
    console.error(logMsg);
    if (err) console.error(err);
    fs.appendFileSync(path.join(logPath, 'migrate-metadata.log'), logMsg + '\n');
    if (err) fs.appendFileSync(path.join(logPath, 'migrate-metadata.log'), err.toString() + '\n');
  },
  warn: (msg) => {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] WARN: ${msg}`;
    console.warn(logMsg);
    fs.appendFileSync(path.join(logPath, 'migrate-metadata.log'), logMsg + '\n');
  }
};

/**
 * 主迁移函数
 */
async function migrateMetadata(options = {}) {
  try {
    logger.log('========== Recipe 元数据迁移开始 ==========');
    logger.log(`Recipe 目录: ${recipesDir}`);
    logger.log(`输出目录: ${metadataDir}`);
    
    // 1. 初始化环境
    logger.log('\n[1/6] 初始化环境...');
    if (!fs.existsSync(metadataDir)) {
      fs.mkdirSync(metadataDir, { recursive: true });
      logger.log(`  ✅ 创建目录: ${metadataDir}`);
    }
    
    // 2. 发现 Recipe 文件
    logger.log('[2/6] 发现 Recipe 文件...');
    const recipeFiles = findRecipeFiles(recipesDir);
    logger.log(`  ✅ 发现 ${recipeFiles.length} 个 Recipe 文件`);
    
    if (recipeFiles.length === 0) {
      logger.warn('未发现 Recipe 文件，检查目录结构');
      return;
    }
    
    // 3. 初始化提取器
    logger.log('[3/6] 初始化元数据提取器...');
    const extractor = new RecipeExtractor({
      extractSemanticTags: true,
      analyzeCodeQuality: true,
      inferDependencies: true,
      contentHashEnabled: true
    });
    logger.log(`  ✅ 提取器就绪`);
    
    // 4. 批量提取元数据
    logger.log('[4/6] 批量提取元数据...');
    const extractionResults = batchExtractMetadata(
      extractor,
      recipeFiles,
      options.batchSize || 32
    );
    logger.log(`  ✅ 成功提取: ${extractionResults.success}`);
    logger.log(`  ⚠️  失败: ${extractionResults.failed}`);
    
    // 5. 存储元数据
    logger.log('[5/6] 存储元数据...');
    const storageResults = storeMetadata(
      extractionResults.metadata,
      metadataDir
    );
    logger.log(`  ✅ 存储成功: ${storageResults.stored}`);
    logger.log(`  ⚠️  存储失败: ${storageResults.failed}`);
    
    // 6. 生成迁移报告
    logger.log('[6/6] 生成迁移报告...');
    generateMigrationReport(
      recipeFiles,
      extractionResults,
      storageResults,
      metadataDir
    );
    
    logger.log('\n========== Recipe 元数据迁移完成 ==========');
    logger.log(`\n📊 迁移统计：`);
    logger.log(`  - 总 Recipe 数: ${recipeFiles.length}`);
    logger.log(`  - 成功提取: ${extractionResults.success}`);
    logger.log(`  - 提取失败: ${extractionResults.failed}`);
    logger.log(`  - 成功存储: ${storageResults.stored}`);
    logger.log(`  - 存储失败: ${storageResults.failed}`);
    logger.log(`\n✅ 元数据已准备好进行向量化索引`);
    logger.log(`\n📁 元数据文件位置: ${metadataDir}`);
    logger.log(`\n下一步：`);
    logger.log(`  1. 生成向量嵌入: node scripts/embed-recipes.js`);
    logger.log(`  2. 构建索引: node scripts/build-indexes.js`);
    logger.log(`  3. 验证系统: node scripts/verify-knowledge-base.js`);
    
    return {
      success: extractionResults.success > 0 && storageResults.stored > 0,
      stats: {
        totalRecipes: recipeFiles.length,
        extracted: extractionResults.success,
        stored: storageResults.stored,
        metadataDir
      }
    };
    
  } catch (err) {
    logger.error('迁移过程失败', err);
    process.exit(1);
  }
}

/**
 * 发现所有 Recipe 文件
 */
function findRecipeFiles(dir, results = []) {
  const entries = fs.readdirSync(dir);
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      // 递归查找子目录
      findRecipeFiles(fullPath, results);
    } else if (entry.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  
  return results;
}

/**
 * 批量提取元数据
 */
function batchExtractMetadata(extractor, files, batchSize) {
  const results = {
    success: 0,
    failed: 0,
    metadata: [],
    errors: []
  };
  
  logger.log(`  处理 ${files.length} 个文件，批大小: ${batchSize}...`);
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const relativePath = path.relative(projectRoot, file);
    
    try {
      const metadata = extractor.extractFromFile(file);
      results.metadata.push(metadata);
      results.success++;
      
      // 定期输出进度
      if ((i + 1) % batchSize === 0 || i === files.length - 1) {
        const progress = Math.round(((i + 1) / files.length) * 100);
        logger.log(`    进度: ${progress}% (${i + 1}/${files.length})`);
      }
    } catch (err) {
      results.failed++;
      results.errors.push({
        file: relativePath,
        error: err.message
      });
      logger.warn(`提取失败: ${relativePath} - ${err.message}`);
    }
  }
  
  return results;
}

/**
 * 存储元数据
 */
function storeMetadata(metadataList, outputDir) {
  const results = {
    stored: 0,
    failed: 0,
    files: []
  };
  
  logger.log(`  存储 ${metadataList.length} 条元数据...`);
  
  for (let i = 0; i < metadataList.length; i++) {
    const metadata = metadataList[i];
    
    try {
      // 按 ID 和分类组织文件
      const categoryDir = path.join(outputDir, metadata.category || 'other');
      if (!fs.existsSync(categoryDir)) {
        fs.mkdirSync(categoryDir, { recursive: true });
      }
      
      const filename = `${metadata.id}.json`;
      const filepath = path.join(categoryDir, filename);
      
      // 存储元数据
      fs.writeFileSync(
        filepath,
        JSON.stringify(metadata, null, 2),
        'utf-8'
      );
      
      results.stored++;
      results.files.push(filepath);
      
      // 定期输出进度
      if ((i + 1) % 32 === 0 || i === metadataList.length - 1) {
        const progress = Math.round(((i + 1) / metadataList.length) * 100);
        logger.log(`    进度: ${progress}% (${i + 1}/${metadataList.length})`);
      }
    } catch (err) {
      results.failed++;
      logger.warn(`存储失败: ${metadata.id} - ${err.message}`);
    }
  }
  
  return results;
}

/**
 * 生成迁移报告
 */
function generateMigrationReport(files, extractionResults, storageResults, outputDir) {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalRecipes: files.length,
      extracted: extractionResults.success,
      stored: storageResults.stored,
      extractionErrors: extractionResults.failed,
      storageErrors: storageResults.failed
    },
    metadata: {
      categories: {},
      languages: {},
      totalKeywords: 0,
      totalTags: 0
    },
    quality: {
      averageExtractionConfidence: 0,
      recipesWithCode: 0,
      recipesWithDocumentation: 0,
      averageAuthorityScore: 0
    },
    errors: extractionResults.errors
  };
  
  // 统计元数据信息
  let totalConfidence = 0;
  let codesCount = 0;
  let docsCount = 0;
  let totalAuthority = 0;
  
  for (const metadata of extractionResults.metadata) {
    // 分类统计
    const category = metadata.category || 'other';
    report.metadata.categories[category] = (report.metadata.categories[category] || 0) + 1;
    
    // 语言统计
    const lang = metadata.language || 'other';
    report.metadata.languages[lang] = (report.metadata.languages[lang] || 0) + 1;
    
    // 关键词和标签
    report.metadata.totalKeywords += metadata.keywords?.length || 0;
    report.metadata.totalTags += metadata.semanticTags?.length || 0;
    
    // 质量指标
    if (metadata.extraction?.confidence) {
      totalConfidence += metadata.extraction.confidence;
    }
    if (metadata.codeBlocks?.length > 0) {
      codesCount++;
    }
    if (metadata.documentation) {
      docsCount++;
    }
    if (metadata.quality?.authorityScore) {
      totalAuthority += metadata.quality.authorityScore;
    }
  }
  
  // 计算平均值
  if (extractionResults.success > 0) {
    report.quality.averageExtractionConfidence = (totalConfidence / extractionResults.success).toFixed(3);
    report.quality.recipesWithCode = codesCount;
    report.quality.recipesWithDocumentation = docsCount;
    report.quality.averageAuthorityScore = (totalAuthority / extractionResults.success).toFixed(2);
  }
  
  // 保存报告
  const reportPath = path.join(outputDir, '..', 'migration-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  
  logger.log(`  ✅ 迁移报告已保存: migration-report.json`);
  
  return report;
}

// 运行迁移
if (require.main === module) {
  migrateMetadata().catch(err => {
    logger.error('未捕获的错误', err);
    process.exit(1);
  });
}

module.exports = { migrateMetadata };
