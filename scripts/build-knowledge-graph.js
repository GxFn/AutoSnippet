/**
 * build-knowledge-graph.js - 知识图谱构建脚本
 * 
 * 执行以下步骤：
 * 1. 加载所有 Recipe 元数据
 * 2. 初始化知识图谱
 * 3. 自动推断依赖和关系
 * 4. 计算 PageRank 评分
 * 5. 检测循环依赖
 * 6. 生成图谱统计和可视化报告
 */

const fs = require('fs');
const path = require('path');
const KnowledgeGraph = require('../lib/context/KnowledgeGraph');
const kbConfig = require('../config/knowledge-base.config');

async function buildKnowledgeGraph() {
  console.log('\n========== 知识图谱构建 ==========\n');
  
  try {
    // Step 1: 加载元数据
    console.log('[Step 1] 加载 Recipe 元数据...');
    const recipes = await loadRecipeMetadata();
    console.log(`✅ 加载完成：${recipes.length} 个 Recipe`);
    
    // Step 2: 初始化知识图谱
    console.log('\n[Step 2] 初始化知识图谱...');
    const graph = new KnowledgeGraph({
      persistPath: '.autosnippet/graph',
      enablePersist: true
    });
    
    // Step 3: 添加实体和推断关系
    console.log('\n[Step 3] 添加实体和推断关系...');
    for (const recipe of recipes) {
      graph.addEntity(recipe.id, recipe);
    }
    console.log(`✅ 添加了 ${recipes.length} 个实体`);
    
    // 推断依赖关系
    const inferredCount = graph.inferDependencies(recipes, {
      similarityThreshold: 0.6,
      keywordMatchThreshold: 0.7,
      enableSemanticInference: true
    });
    
    // Step 4: 计算 PageRank
    console.log('\n[Step 4] 计算 PageRank 评分...');
    graph.computePageRank(10, 0.85);
    console.log('✅ PageRank 计算完成');
    
    // Step 5: 检测循环依赖
    console.log('\n[Step 5] 检测循环依赖...');
    const cycles = graph.detectCycles();
    if (cycles.length > 0) {
      console.warn(`⚠️  检测到 ${cycles.length} 个循环依赖:`);
      cycles.forEach((cycle, idx) => {
        console.warn(`   ${idx + 1}. ${cycle.join(' -> ')}`);
      });
    } else {
      console.log('✅ 无循环依赖');
    }
    
    // Step 6: 生成统计报告
    console.log('\n[Step 6] 生成统计报告...');
    const stats = graph.getStats();
    
    console.log('\n📊 图谱统计：');
    console.log(`   实体总数: ${stats.entityCount}`);
    console.log(`   关系总数: ${stats.relationshipCount}`);
    console.log(`   平均入度: ${stats.avgInDegree.toFixed(2)}`);
    console.log(`   平均出度: ${stats.avgOutDegree.toFixed(2)}`);
    console.log(`   最大入度: ${stats.maxInDegree}`);
    console.log(`   最大出度: ${stats.maxOutDegree}`);
    
    console.log('\n关系类型分布：');
    for (const [type, count] of Object.entries(stats.relationshipBreakdown)) {
      if (count > 0) {
        console.log(`   ${type}: ${count}`);
      }
    }
    
    // Step 7: 生成图谱分析报告
    console.log('\n[Step 7] 生成详细分析报告...');
    const report = generateGraphReport(graph, recipes, stats, cycles);
    
    // 保存报告
    const reportPath = path.join('.autosnippet/graph', 'graph-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`✅ 报告已保存至 ${reportPath}`);
    
    // Step 8: 生成 GraphML 用于可视化
    console.log('\n[Step 8] 生成 GraphML 文件用于可视化...');
    const graphml = graph.exportGraphML();
    const graphmlPath = path.join('.autosnippet/graph', 'graph.graphml');
    fs.writeFileSync(graphmlPath, graphml);
    console.log(`✅ GraphML 已保存至 ${graphmlPath}`);
    console.log('   (可用 Gephi、yEd 等工具打开可视化)');
    
    // Step 9: 持久化图谱
    console.log('\n[Step 9] 持久化图谱...');
    graph.persist();
    console.log('✅ 图谱已持久化');
    
    // 生成示例查询
    console.log('\n[Step 10] 示例查询...');
    generateExampleQueries(graph, recipes);
    
    console.log('\n========== 知识图谱构建完成 ==========\n');
    
  } catch (error) {
    console.error(`❌ 错误: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * 加载所有 Recipe 元数据
 */
async function loadRecipeMetadata() {
  const metadataDir = '.autosnippet/metadata';
  const recipes = [];
  
  if (!fs.existsSync(metadataDir)) {
    console.warn('⚠️  元数据目录不存在，使用示例数据');
    return generateSampleRecipes();
  }
  
  // 遍历所有分类目录
  const categories = fs.readdirSync(metadataDir);
  
  for (const category of categories) {
    const categoryPath = path.join(metadataDir, category);
    const stat = fs.statSync(categoryPath);
    
    if (!stat.isDirectory()) continue;
    
    // 遍历该分类下的所有 Recipe 文件
    const files = fs.readdirSync(categoryPath);
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      try {
        const filePath = path.join(categoryPath, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const recipe = JSON.parse(content);
        recipes.push(recipe);
      } catch (error) {
        console.warn(`⚠️  无法读取 ${file}: ${error.message}`);
      }
    }
  }
  
  return recipes;
}

/**
 * 生成示例 Recipe 数据（用于演示）
 */
function generateSampleRecipes() {
  return [
    {
      id: 'recipe_async_await_001',
      title: '使用 async/await 处理异步操作',
      language: 'javascript',
      category: 'async-patterns',
      keywords: ['async', 'await', 'promise', 'error handling'],
      semanticTags: ['asynchronous-programming', 'promise-handling', 'error-recovery'],
      createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      lastModified: Date.now() - 5 * 24 * 60 * 60 * 1000,
      quality: { authorityScore: 4.5, testCoverage: 0.87 }
    },
    {
      id: 'recipe_promise_all_002',
      title: '使用 Promise.all 并行执行',
      language: 'javascript',
      category: 'async-patterns',
      keywords: ['promise', 'parallel', 'concurrent'],
      semanticTags: ['asynchronous-programming', 'parallelization', 'performance'],
      createdAt: Date.now() - 20 * 24 * 60 * 60 * 1000,
      lastModified: Date.now() - 3 * 24 * 60 * 60 * 1000,
      quality: { authorityScore: 4.2, testCoverage: 0.92 }
    },
    {
      id: 'recipe_error_handling_003',
      title: '异步错误处理最佳实践',
      language: 'javascript',
      category: 'error-handling',
      keywords: ['error', 'exception', 'try-catch'],
      semanticTags: ['error-handling', 'resilience', 'debugging'],
      createdAt: Date.now() - 40 * 24 * 60 * 60 * 1000,
      lastModified: Date.now() - 2 * 24 * 60 * 60 * 1000,
      quality: { authorityScore: 4.7, testCoverage: 0.95 }
    },
    {
      id: 'recipe_promise_basics_004',
      title: 'Promise 基础概念',
      language: 'javascript',
      category: 'fundamentals',
      keywords: ['promise', 'basic', 'introduction'],
      semanticTags: ['promise-handling', 'basic', 'fundamental'],
      createdAt: Date.now() - 50 * 24 * 60 * 60 * 1000,
      lastModified: Date.now() - 10 * 24 * 60 * 60 * 1000,
      quality: { authorityScore: 4.0, testCoverage: 0.80 }
    }
  ];
}

/**
 * 生成图谱分析报告
 */
function generateGraphReport(graph, recipes, stats, cycles) {
  // 计算一些额外的指标
  const entities = Array.from(graph.entities.values());
  
  // 找出最重要的节点（按 PageRank）
  const topEntities = entities
    .sort((a, b) => b.pageRank - a.pageRank)
    .slice(0, 10)
    .map(e => ({
      id: e.id,
      title: e.title,
      pageRank: parseFloat(e.pageRank.toFixed(4)),
      inDegree: e.inDegree,
      outDegree: e.outDegree
    }));
  
  // 找出最常见的依赖
  const dependencyCount = {};
  for (const [key, rel] of graph.relationships) {
    if (rel.type === 'requires') {
      const depKey = `${rel.from} -> ${rel.to}`;
      dependencyCount[depKey] = (dependencyCount[depKey] || 0) + 1;
    }
  }
  
  const topDependencies = Object.entries(dependencyCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([pair, count]) => ({ pair, count }));
  
  // 计算图谱密度
  const maxPossibleEdges = stats.entityCount * (stats.entityCount - 1);
  const graphDensity = stats.relationshipCount / maxPossibleEdges;
  
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalEntities: stats.entityCount,
      totalRelationships: stats.relationshipCount,
      graphDensity: parseFloat(graphDensity.toFixed(4)),
      hasycles: cycles.length > 0,
      cycleCount: cycles.length
    },
    statistics: stats,
    topEntities,
    topDependencies,
    cycles: cycles.map(cycle => ({
      length: cycle.length,
      path: cycle.join(' -> ')
    })),
    recommendations: generateRecommendations(graph, entities, cycles)
  };
}

/**
 * 生成改进建议
 */
function generateRecommendations(graph, entities, cycles) {
  const recommendations = [];
  
  // 1. 检查孤立节点
  const isolatedNodes = entities.filter(e => e.inDegree === 0 && e.outDegree === 0);
  if (isolatedNodes.length > 0) {
    recommendations.push({
      issue: '孤立节点',
      count: isolatedNodes.length,
      suggestion: '这些 Recipe 与其他 Recipe 没有关系，考虑添加相关性或标记为独立模块',
      examples: isolatedNodes.slice(0, 3).map(n => n.id)
    });
  }
  
  // 2. 检查高入度节点（被广泛依赖）
  const hubNodes = entities.filter(e => e.inDegree > 5);
  if (hubNodes.length > 0) {
    recommendations.push({
      issue: '关键依赖',
      count: hubNodes.length,
      suggestion: '这些 Recipe 被多个其他 Recipe 依赖，确保它们质量高且文档充分',
      examples: hubNodes.slice(0, 3).map(n => ({ id: n.id, inDegree: n.inDegree }))
    });
  }
  
  // 3. 检查循环依赖
  if (cycles.length > 0) {
    recommendations.push({
      issue: '循环依赖',
      count: cycles.length,
      suggestion: '重构这些 Recipe 以消除循环依赖，可能需要提取公共子模块',
      examples: cycles.slice(0, 3)
    });
  }
  
  // 4. 检查断裂的依赖链
  for (const [key, rel] of graph.relationships) {
    if (rel.type === 'requires' && !graph.entities.has(rel.to)) {
      recommendations.push({
        issue: '缺失依赖',
        suggestion: `Recipe ${rel.from} 依赖不存在的 ${rel.to}`,
        severity: 'high'
      });
    }
  }
  
  return recommendations;
}

/**
 * 生成示例查询
 */
function generateExampleQueries(graph, recipes) {
  if (recipes.length === 0) {
    console.log('   (无示例 Recipe 可用于查询演示)');
    return;
  }
  
  const recipe = recipes[0];
  
  console.log(`\n   示例 Recipe: ${recipe.id} - ${recipe.title}`);
  
  // 查询依赖
  const deps = graph.getDependencies(recipe.id);
  if (deps.length > 0) {
    console.log(`   - 依赖 (${deps.length}): ${deps.map(d => d.id).join(', ')}`);
  }
  
  // 查询使用者
  const users = graph.getUsedBy(recipe.id);
  if (users.length > 0) {
    console.log(`   - 使用者 (${users.length}): ${users.map(u => u.id).join(', ')}`);
  }
  
  // 查询替代方案
  const alternatives = graph.getAlternatives(recipe.id);
  if (alternatives.length > 0) {
    console.log(`   - 替代方案 (${alternatives.length}): ${alternatives.map(a => a.id).join(', ')}`);
  }
  
  // 查询相关
  const related = graph.getRelated(recipe.id, { maxResults: 5 });
  if (related.length > 0) {
    console.log(`   - 相关 Recipe (${related.length}): ${related.map(r => r.id).join(', ')}`);
  }
}

// 运行构建
buildKnowledgeGraph().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
