#!/usr/bin/env node
/**
 * 清除向量数据库缓存
 * 用于解决向量维度不匹配问题
 */

const fs = require('fs');
const path = require('path');

console.log('🧹 清理向量数据库缓存');
console.log('   原因: 向量维度不匹配 (Vectors must have the same length)');
console.log('   操作: 删除旧的向量索引，让系统重新生成 768 维向量');
console.log('');

// 获取项目路径（从参数或当前目录）
const projectRoot = process.argv[2] || process.cwd();
console.log(`📂 项目路径: ${projectRoot}`);
console.log('');

// 向量索引文件位置
const vectorIndexPaths = [
  // 新位置：{projectRoot}/.autosnippet/context/index/vector_index.json
  path.join(projectRoot, '.autosnippet', 'context', 'index', 'vector_index.json'),
  // 旧位置（兼容）
  path.join(projectRoot, '.autosnippet', 'vector_index.json'),
  path.join(projectRoot, 'AutoSnippet', '.autosnippet', 'context', 'index', 'vector_index.json'),
];

let deletedCount = 0;
let totalVectors = 0;

for (const filePath of vectorIndexPaths) {
  if (fs.existsSync(filePath)) {
    try {
      // 读取并显示信息
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const vectorCount = data.items ? data.items.length : 0;
      const firstVectorDim = data.items?.[0]?.vector?.length || 0;
      
      console.log(`📄 找到向量索引: ${filePath}`);
      console.log(`   向量数量: ${vectorCount}`);
      console.log(`   向量维度: ${firstVectorDim}${firstVectorDim !== 768 ? ' ⚠️  (不匹配，应为 768)' : ' ✅'}`);
      
      totalVectors += vectorCount;
      
      // 删除文件
      fs.unlinkSync(filePath);
      console.log(`   ✅ 已删除`);
      deletedCount++;
    } catch (err) {
      console.log(`   ❌ 处理失败: ${err.message}`);
    }
    console.log('');
  }
}

if (deletedCount > 0) {
  console.log(`✅ 成功清理 ${deletedCount} 个向量索引文件 (共 ${totalVectors} 个向量)`);
  console.log('');
  console.log('📝 下一步：');
  console.log('   1. 重新运行搜索 (例如在 Xcode 中输入 // as:search color)');
  console.log('   2. 系统会自动重建向量索引，使用统一的 768 维度');
  console.log('   3. 首次搜索可能较慢（需要重新生成 embedding）');
} else {
  console.log('ℹ️  未找到向量索引文件（可能已经是干净状态）');
  console.log('');
  console.log('📝 如果问题仍然存在，请尝试：');
  console.log(`   1. 手动检查项目中的 .autosnippet 目录`);
  console.log(`   2. 运行: node ${__filename} <your-project-path>`);
}

console.log('');
console.log('🔧 Google Gemini Embedding 配置:');
console.log('   模型: gemini-embedding-001');
console.log('   维度: 768 (统一)');
console.log('   API: v1beta');
