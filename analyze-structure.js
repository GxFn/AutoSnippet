const fs = require('fs');
const path = require('path');

const ignore = ['.git', '.github', 'node_modules', 'dist', 'build', '.autosnippet', '.cache', '.test-cache', '.cursor', '.vscode'];

function categorizeDir(name) {
  if (name === 'lib') return '核心库';
  if (name === 'bin') return '可执行文件';
  if (name === 'test' || name === 'tests') return '测试';
  if (name === 'scripts') return '脚本';
  if (name === 'dashboard') return '前端应用';
  if (name === 'docs') return '文档';
  if (name === 'resources') return '资源';
  if (name === 'skills') return '技能/文档';
  if (name === 'recipes' || name === 'templates') return '模板/示例';
  if (name === 'config') return '配置';
  if (name === 'tools') return '工具';
  if (name === 'copilotDocs') return 'Copilot文档';
  if (name === 'AutoSnippet') return '知识库';
  if (name === 'images') return '图片资源';
  return '其他';
}

const root = '.';
const dirs = fs.readdirSync(root).filter(f => {
  return fs.statSync(path.join(root, f)).isDirectory() && !ignore.includes(f);
});

console.log('\n=== 项目目录分类 ===\n');
const categorized = {};
dirs.forEach(d => {
  const cat = categorizeDir(d);
  if (!categorized[cat]) categorized[cat] = [];
  categorized[cat].push(d);
});

Object.entries(categorized).forEach(([cat, dirs]) => {
  console.log(`${cat}:`);
  dirs.forEach(d => {
    const count = countFilesDeep(d);
    console.log(`  - ${d} (${count} 个文件)`);
  });
  console.log();
});

// 检查重复/相似目录
console.log('=== 潜在的重复目录 ===\n');
if (dirs.includes('test') && dirs.includes('tests')) {
  console.log('⚠️  test 和 tests 都存在 - 这是重复的吗？');
  console.log(`   - test: ${countFilesDeep('test')} 文件`);
  console.log(`   - tests: ${countFilesDeep('tests')} 文件\n`);
}

if (dirs.includes('recipes') && dirs.includes('templates')) {
  console.log('⚠️  recipes 和 templates 都存在');
  console.log(`   - recipes: ${countFilesDeep('recipes')} 文件`);
  console.log(`   - templates: ${countFilesDeep('templates')} 文件\n`);
}

if (dirs.includes('docs') && dirs.includes('copilotDocs')) {
  console.log('⚠️  docs 和 copilotDocs 都存在');
  console.log(`   - docs: ${countFilesDeep('docs')} 文件`);
  console.log(`   - copilotDocs: ${countFilesDeep('copilotDocs')} 文件\n`);
}

// 检查嵌套问题
console.log('=== 嵌套问题 ===\n');
if (fs.existsSync('AutoSnippet/AutoSnippet')) {
  console.log('⚠️  AutoSnippet/AutoSnippet 目录重复');
  const boxspec = 'AutoSnippet/AutoSnippet.boxspec.json';
  if (fs.existsSync(boxspec)) {
    console.log(`   ✓ 找到 ${boxspec}\n`);
  }
}

function countFilesDeep(dir, depth = 0, maxDepth = 2) {
  if (depth > maxDepth || !fs.existsSync(dir)) return 0;
  try {
    const files = fs.readdirSync(dir);
    let count = 0;
    files.forEach(f => {
      if (ignore.includes(f)) return;
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) {
        count += countFilesDeep(p, depth + 1, maxDepth);
      } else {
        count++;
      }
    });
    return count;
  } catch (e) {
    return 0;
  }
}
