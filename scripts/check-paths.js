#!/usr/bin/env node

/**
 * 检查项目中所有使用相对路径的地方是否正确
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

// 需要检查的路径配置
const pathChecks = [
  // OpenBrowser.js
  {
  file: 'lib/infrastructure/external/OpenBrowser.js',
  line: 64,
  relativePath: '../../../resources/openChrome.applescript',
  description: 'AppleScript for browser tab reuse'
  },
  
  // snippetInstaller.js
  {
  file: 'lib/snippet/snippetInstaller.js',
  line: 130,
  relativePath: '../../template.json',
  description: 'Snippet template file'
  },
  
  // bootstrap.js
  {
  file: 'lib/bootstrap.js',
  line: 82,
  relativePath: './ai/providers',
  description: 'AI providers directory'
  },
  {
  file: 'lib/bootstrap.js',
  line: 194,
  relativePath: './context/adapters',
  description: 'Context adapters directory'
  },
  
  // cli-commands.js
  {
  file: 'bin/cli-commands.js',
  line: 855,
  relativePath: '../scripts/install-cursor-skill.js',
  description: 'Cursor skill installation script'
  },
  {
  file: 'bin/cli-commands.js',
  line: 864,
  relativePath: '../scripts/install-full.js',
  description: 'Full installation script'
  },
  {
  file: 'bin/cli-commands.js',
  line: 879,
  relativePath: '../lib/application/services/IntelligentServiceLayer',
  description: 'Intelligent service layer module'
  },
  
  // dashboard-server.js
  {
  file: 'bin/dashboard-server.js',
  line: 22,
  relativePath: './dashboard/routes',
  description: 'Dashboard routes module'
  },
  {
  file: 'bin/dashboard-server.js',
  line: 144,
  relativePath: '../dashboard',
  description: 'Dashboard directory'
  },
  
  // Dashboard routes (bin/dashboard/routes/)
  {
  file: 'bin/dashboard/routes/recipes.js',
  line: 42,
  relativePath: '../../../lib/context',
  description: 'Context module'
  },
  {
  file: 'bin/dashboard/routes/recipes.js',
  line: 154,
  relativePath: '../../../lib/recipe/recipeStats',
  description: 'Recipe stats module'
  },
  {
  file: 'bin/dashboard/routes/guard.js',
  line: 7,
  relativePath: '../../../lib/guard/guardRules',
  description: 'Guard rules module'
  },
  {
  file: 'bin/dashboard/routes/guard.js',
  line: 93,
  relativePath: '../../../lib/guard/guardViolations',
  description: 'Guard violations module'
  },
  {
  file: 'bin/dashboard/routes/extract.js',
  line: 74,
  relativePath: '../../../lib/recipe/parseRecipeMd.js',
  description: 'Recipe markdown parser'
  },
  {
  file: 'bin/dashboard/routes/candidates.js',
  line: 63,
  relativePath: '../../../lib/candidate/similarityService',
  description: 'Similarity service'
  },
  {
  file: 'bin/dashboard/routes/commands.js',
  line: 30,
  relativePath: '../../../lib/context/IndexingPipeline',
  description: 'Indexing pipeline'
  },
  {
  file: 'bin/dashboard/routes/core.js',
  line: 118,
  relativePath: '../../../lib/recipe/recipeStats',
  description: 'Recipe stats module'
  },
  {
  file: 'bin/dashboard/routes/core.js',
  line: 149,
  relativePath: '../../../lib/candidate/qualityRules',
  description: 'Quality rules module'
  },
  
  // Scripts directory
  {
  file: 'scripts/init-vector-db.js',
  line: 14,
  relativePath: '..',
  description: 'Project root from scripts'
  },
  {
  file: 'scripts/verify-code-upgrade.js',
  line: 16,
  relativePath: '..',
  description: 'Project root from scripts'
  },
  {
  file: 'scripts/mcp-server.js',
  line: 17,
  relativePath: '../node_modules/@modelcontextprotocol/sdk/dist/cjs/server',
  description: 'MCP SDK server module'
  }
];

console.log('🔍 检查项目路径引用...\n');

let hasErrors = false;
let checkedCount = 0;
let errorCount = 0;

pathChecks.forEach(check => {
  const sourceFile = path.join(projectRoot, check.file);
  const sourceDir = path.dirname(sourceFile);
  const targetPath = path.join(sourceDir, check.relativePath);
  
  // 检查目标是否存在（可能是文件或目录）
  let exists = false;
  let targetType = '';
  
  if (fs.existsSync(targetPath)) {
  exists = true;
  targetType = fs.statSync(targetPath).isDirectory() ? 'directory' : 'file';
  } else if (fs.existsSync(targetPath + '.js')) {
  exists = true;
  targetType = 'file (with .js)';
  } else if (fs.existsSync(targetPath + '/index.js')) {
  exists = true;
  targetType = 'module (index.js)';
  }
  
  checkedCount++;
  
  if (exists) {
  console.log(`✅ ${check.file}:${check.line}`);
  console.log(`   ${check.description}`);
  console.log(`   ${check.relativePath} -> ${targetType}`);
  } else {
  hasErrors = true;
  errorCount++;
  console.log(`❌ ${check.file}:${check.line}`);
  console.log(`   ${check.description}`);
  console.log(`   ${check.relativePath}`);
  console.log(`   预期路径: ${targetPath}`);
  console.log(`   错误: 路径不存在`);
  }
  console.log('');
});

console.log(`\n📊 检查完成: ${checkedCount} 个路径引用`);
if (hasErrors) {
  console.log(`❌ 发现 ${errorCount} 个路径错误`);
  process.exit(1);
} else {
  console.log(`✅ 所有路径引用正确`);
  process.exit(0);
}
