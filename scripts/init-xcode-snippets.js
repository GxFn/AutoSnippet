#!/usr/bin/env node

/**
 * Xcode Snippet 初始化脚本
 * 自动为 AutoSnippet 添加快速输入 Snippets 到 Xcode
 * 
 * 用法：
 *   node scripts/init-xcode-snippets.js
 *   npm run init-snippets
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

class XcodeSnippetInitializer {
  constructor() {
    this.snippetsDir = path.join(
      os.homedir(),
      'Library/Developer/Xcode/UserData/CodeSnippets'
    );
    
    this.snippets = [
      {
        id: 'com.autosnippet.search.long',
        shortcut: 'ass',
        title: 'AutoSnippet: Search (Long)',
        summary: 'Search and insert Recipe/Snippet from knowledge base',
        content: '// as:search <#keyword#>',
        scopes: ['All']
      },
      {
        id: 'com.autosnippet.create',
        shortcut: 'asc',
        title: 'AutoSnippet: Create Recipe',
        summary: 'Create new Recipe (Dashboard or clipboard/file)',
        content: '// as:create <#-c or -f#>',
        scopes: ['All']
      },
      {
        id: 'com.autosnippet.audit',
        shortcut: 'asa',
        title: 'AutoSnippet: Audit Code',
        summary: 'AI code review against knowledge base',
        content: '// as:audit <#keyword or scope (file/target/project)#>',
        scopes: ['All']
      }
    ];
  }

  /**
   * 生成 plist 格式的 Snippet 文件内容
   */
  generateSnippetPlist(snippet) {
    const escapedContent = snippet.content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    const scopesXml = snippet.scopes
      .map(scope => `        <string>${scope}</string>`)
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>IDECodeSnippetCompletionPrefix</key>
	<string>${snippet.shortcut}</string>
	<key>IDECodeSnippetCompletionScopes</key>
	<array>
${scopesXml}
	</array>
	<key>IDECodeSnippetContents</key>
	<string>${escapedContent}</string>
	<key>IDECodeSnippetIdentifier</key>
	<string>${snippet.id}</string>
	<key>IDECodeSnippetLanguage</key>
	<string>Xcode.SourceCodeLanguage.Generic</string>
	<key>IDECodeSnippetRelatedIdentifiers</key>
	<array/>
	<key>IDECodeSnippetSummary</key>
	<string>${snippet.summary}</string>
	<key>IDECodeSnippetTitle</key>
	<string>${snippet.title}</string>
	<key>IDECodeSnippetUserSnippet</key>
	<true/>
	<key>IDECodeSnippetVersion</key>
	<integer>2</integer>
</dict>
</plist>`;
  }

  /**
   * 创建或更新 Snippet 文件
   */
  createSnippet(snippet) {
    try {
      const filename = `${snippet.id}.codesnippet`;
      const filePath = path.join(this.snippetsDir, filename);
      const content = this.generateSnippetPlist(snippet);

      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`  ✅ ${snippet.title}`);
      console.log(`     快捷键: ${snippet.shortcut}`);
      console.log(`     内容: ${snippet.content}`);
      return true;
    } catch (err) {
      console.warn(`  ❌ ${snippet.title}: ${err.message}`);
      return false;
    }
  }

  /**
   * 检查 Snippets 目录是否存在
   */
  ensureSnippetsDir() {
    if (!fs.existsSync(this.snippetsDir)) {
      try {
        fs.mkdirSync(this.snippetsDir, { recursive: true });
        console.log(`✅ 创建 Snippets 目录: ${this.snippetsDir}`);
        return true;
      } catch (err) {
        console.error(`❌ 无法创建 Snippets 目录: ${err.message}`);
        return false;
      }
    }
    return true;
  }

  /**
   * 检查 Xcode 是否已安装
   */
  checkXcodeInstalled() {
    try {
      execSync('xcode-select -p', { stdio: 'ignore' });
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * 初始化所有 Snippets
   */
  async initialize() {
    console.log('\n🚀 AutoSnippet Xcode Snippets 初始化\n');

    // 检查平台
    if (process.platform !== 'darwin') {
      console.log('⚠️  此脚本仅支持 macOS');
      return false;
    }

    // 检查 Xcode
    if (!this.checkXcodeInstalled()) {
      console.log('⚠️  未检测到 Xcode，Snippets 可能无法正常工作');
      console.log('   请确保已安装 Xcode 或运行: xcode-select --install\n');
    }

    // 创建目录
    if (!this.ensureSnippetsDir()) {
      return false;
    }

    // 创建 Snippets
    console.log('\n📝 创建 Snippets:\n');
    let successCount = 0;
    for (const snippet of this.snippets) {
      if (this.createSnippet(snippet)) {
        successCount++;
      }
    }

    // 总结
    console.log(`\n${successCount}/${this.snippets.length} 个 Snippets 已创建\n`);

    if (successCount === this.snippets.length) {
      console.log('✅ 所有 Snippets 已成功添加到 Xcode！\n');
      console.log('📌 快速开始：');
      console.log('   1. 在 Xcode 中打开任何源代码文件');
      console.log('   2. 输入 "ass" 并按 Tab 自动完成');
      console.log('   3. 在提示中输入关键词并保存');
      console.log('   4. AutoSnippet watch 会自动处理\n');
      console.log('📚 可用快捷键：');
      this.snippets.forEach(s => {
        console.log(`   • ${s.shortcut.padEnd(6)} → ${s.title}`);
      });
      console.log();
      return true;
    } else {
      console.log('⚠️  部分 Snippets 创建失败，请检查权限');
      return false;
    }
  }

  /**
   * 列出已安装的 Snippets
   */
  listSnippets() {
    console.log('\n📋 AutoSnippet Snippets 清单\n');
    
    if (!fs.existsSync(this.snippetsDir)) {
      console.log('未找到 Snippets 目录');
      return;
    }

    const files = fs.readdirSync(this.snippetsDir);
    const autoSnippets = files.filter(f => f.startsWith('com.autosnippet'));

    if (autoSnippets.length === 0) {
      console.log('未安装任何 AutoSnippet Snippets');
    } else {
      autoSnippets.forEach(file => {
        const filePath = path.join(this.snippetsDir, file);
        const stat = fs.statSync(filePath);
        console.log(`  ✓ ${file}`);
        console.log(`    大小: ${(stat.size / 1024).toFixed(2)} KB`);
        console.log(`    更新: ${stat.mtime.toLocaleString('zh-CN')}`);
      });
    }
    console.log();
  }

  /**
   * 移除所有 AutoSnippet Snippets
   */
  removeSnippets() {
    console.log('\n🗑️  移除 AutoSnippet Snippets\n');
    
    if (!fs.existsSync(this.snippetsDir)) {
      console.log('未找到 Snippets 目录');
      return;
    }

    const files = fs.readdirSync(this.snippetsDir);
    const autoSnippets = files.filter(f => f.startsWith('com.autosnippet'));

    let removedCount = 0;
    autoSnippets.forEach(file => {
      try {
        const filePath = path.join(this.snippetsDir, file);
        fs.unlinkSync(filePath);
        console.log(`  ✓ 已移除: ${file}`);
        removedCount++;
      } catch (err) {
        console.warn(`  ✗ 移除失败: ${file}`);
      }
    });

    console.log(`\n已移除 ${removedCount} 个 Snippets\n`);
  }
}

// 命令行接口
async function main() {
  const command = process.argv[2] || 'init';
  const initializer = new XcodeSnippetInitializer();

  switch (command) {
    case 'init':
      await initializer.initialize();
      break;
    case 'list':
      initializer.listSnippets();
      break;
    case 'remove':
      initializer.removeSnippets();
      break;
    case 'help':
      console.log(`
用法: node scripts/init-xcode-snippets.js [命令]

命令:
  init      初始化 AutoSnippet Snippets（默认）
  list      列出已安装的 Snippets
  remove    移除所有 AutoSnippet Snippets
  help      显示此帮助信息

示例:
  node scripts/init-xcode-snippets.js init
  node scripts/init-xcode-snippets.js list
      `);
      break;
    default:
      console.log(`未知命令: ${command}`);
      console.log('使用 "help" 查看可用命令');
      process.exit(1);
  }
}

// 导出供其他脚本使用
module.exports = {
  XcodeSnippetInitializer,
  initialize: async () => {
    const initializer = new XcodeSnippetInitializer();
    return initializer.initialize();
  }
};

// 如果直接执行此文件
if (require.main === module) {
  main().catch(err => {
    console.error('❌ 初始化失败:', err.message);
    process.exit(1);
  });
}
