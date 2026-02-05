#!/usr/bin/env node

/**
 * asd embed - 构建语义索引
 * 调用 IndexingPipeline 扫描 Recipes 并生成向量索引
 */

const IndexingPipeline = require('../context/IndexingPipeline');

/**
 * 执行 embed
 * @param {string} projectRoot 
 * @param {object} options 
 */
async function runEmbed(projectRoot, options = {}) {
  const clear = options.clear || false;
  
  console.log(`🔨 ${clear ? '重建' : '构建'}语义索引...\n`);
  
  try {
  const result = await IndexingPipeline.run(projectRoot, { clear });
  
  console.log('✅ 索引构建完成\n');
  console.log(`   已索引: ${result.indexed || 0} 条`);
  console.log(`   跳过: ${result.skipped || 0} 条`);
  if (result.removed) {
    console.log(`   移除: ${result.removed} 条`);
  }
  console.log('');
  
  console.log('提示：');
  console.log('  - 使用 asd search -m "查询" 进行语义搜索');
  console.log('  - 在代码中使用 ass 快捷联想或 // as:search 检索知识库');
  console.log('  - MCP 工具 autosnippet_context_search 可用');
  
  } catch (err) {
  console.error('❌ 索引构建失败:', err.message);
  console.error('');
  console.error('提示：');
  console.error('  - 检查 .env 中的 AI 配置是否正确');
  console.error('  - 确保 Recipes 目录存在且包含 .md 文件');
  console.error('  - 查看详细错误: ASD_DEBUG=1 asd embed');
  process.exit(1);
  }
}

module.exports = { runEmbed };
