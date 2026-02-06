#!/usr/bin/env node
/**
 * 清除旧的向量索引（含 AutoSnippet/recipes 前缀的形式）
 * 使用源头修复后，需要重新生成新的索引（无前缀形式）
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const projectRoot = args[0] || '/Users/gaoxuefeng/Documents/github/BiliDemo';

console.log('🧹 清除旧形式的向量索引（含 AutoSnippet/recipes 前缀）\n');
console.log('═══════════════════════════════════════════════════════════\n');

const indexDir = path.join(projectRoot, 'AutoSnippet/.autosnippet/context/index');
const vectorIndexPath = path.join(indexDir, 'vector_index.json');

if (!fs.existsSync(vectorIndexPath)) {
  console.log('✅ 无需清除：向量索引不存在或已清除\n');
  process.exit(0);
}

// 检查索引格式
const data = JSON.parse(fs.readFileSync(vectorIndexPath, 'utf8'));
const hasOldFormat = data.items?.some(item => 
  item.metadata?.sourcePath?.startsWith('AutoSnippet/recipes/')
);

if (!hasOldFormat) {
  console.log('✅ 索引已是新格式（无 AutoSnippet/recipes 前缀）\n');
  process.exit(0);
}

console.log('📊 检测到旧形式的索引：\n');
const oldItems = data.items.filter(item => 
  item.metadata?.sourcePath?.startsWith('AutoSnippet/recipes/')
);
console.log(`   • 含前缀的项目：${oldItems.length}`);
console.log(`   • 总项目数：${data.items.length}\n`);

console.log('示例：');
oldItems.slice(0, 3).forEach(item => {
  console.log(`   "${item.metadata.sourcePath}"`);
});
console.log('\n');

// 删除旧索引
try {
  fs.unlinkSync(vectorIndexPath);
  console.log('✅ 已删除旧索引\n');
  
  // 删除 manifest.json
  const manifestPath = path.join(indexDir, '../manifest.json');
  if (fs.existsSync(manifestPath)) {
    fs.unlinkSync(manifestPath);
    console.log('✅ 已删除 manifest.json\n');
  }
  
  console.log('📝 下一步：\n');
  console.log('1. 使用源头修复版本重新生成索引：');
  console.log(`   cd ${"'" + projectRoot + "'"}`);
  console.log('   asd embed\n');
  console.log('2. 或在开发模式下（本地测试）：');
  console.log('   npm run dev:link');
  console.log('   cd ' + projectRoot);
  console.log('   ASD_SKIP_ENTRY_CHECK=1 asd embed\n');
  
  console.log('3. 新生成的索引将采用无前缀形式：');
  console.log('   "Check-Network-Permission.md"  // 不再是 AutoSnippet/recipes/Check-Network-Permission.md\n');
  
  console.log('4. 搜索 API 会自动兼容两种形式（新旧数据均支持）\n');
  
} catch (e) {
  console.error('❌ 删除失败:', e.message);
  process.exit(1);
}
