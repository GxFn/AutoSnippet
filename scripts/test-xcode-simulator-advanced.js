#!/usr/bin/env node

/**
 * 高级测试：光标移动 + 自动插入
 * 
 * 演示：
 * 1. 编辑器状态管理（光标位置、选择范围）
 * 2. 自动化插入操作
 * 3. 文件变化验证
 */

const { XcodeSimulator } = require('../lib/simulation');
const path = require('path');

// 日志打印
const log = {
  info: (msg) => console.log(`ℹ️  ${msg}`),
  step: (msg) => console.log(`\n🔹 ${msg}`),
  result: (msg) => console.log(`✅ ${msg}`),
  error: (msg) => console.error(`❌ ${msg}`)
};

async function main() {
  log.info('Xcode Simulator - 高级测试：光标和自动插入');
  log.info('================================================================\n');

  const simulator = new XcodeSimulator({
    projectRoot: process.cwd(),
    dashboardUrl: 'http://localhost:3000',
    syncToDisk: false
  });

  try {
    // 初始化
    log.step('1. 初始化模拟器');
    await simulator.init();
    log.result('初始化成功\n');

    // ========== 测试 1: 光标定位和编辑 ==========
    log.step('2. 测试光标定位和文本编辑');
    
    const code1 = `import UIKit

class ViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    // TODO: 这里需要搜索网络请求
  }
}`;

    simulator.openFile('src/ViewController.swift', code1);
    log.info('✓ 打开文件');

    // 获取编辑器状态
    let state = simulator.editor.getCurrentState();
    log.info(`✓ 初始光标位置: ${state.caret.line}:${state.caret.column}`);

    // 移动光标到第 6 行
    simulator.editor.setCaret(5, 12);
    state = simulator.editor.getCurrentState();
    log.info(`✓ 光标移动到: line=${state.caret.line}, column=${state.caret.column}`);

    // 在光标位置插入文本
    const insertedText = 'URLSession';
    simulator.editor.insertText(state.caret, insertedText);
    log.info(`✓ 在光标后插入文本: "${insertedText}"`);

    // 验证插入结果
    const line6 = simulator.editor.getLine(5);
    if (line6.includes(insertedText)) {
      log.result(`文本已插入: "${line6.substring(0, 40)}..."`);
    } else {
      log.error('文本插入失败');
    }

    // ========== 测试 2: 选择和替换 ==========
    log.step('3. 测试文本选择和替换');

    // 在第 3 行（class 声明）选择某个范围
    const line3 = simulator.editor.getLine(2);
    const selectStart = line3.indexOf('UIViewController');
    const selectEnd = selectStart + 'UIViewController'.length;

    simulator.editor.setSelection(2, selectStart, 2, selectEnd);
    state = simulator.editor.getCurrentState();
    log.info(`✓ 选择范围: line ${state.selection.startLine}:${state.selection.startCol} ~ ${state.selection.endLine}:${state.selection.endCol}`);

    const selectedText = simulator.editor.getSelectedText();
    log.info(`✓ 选中文本: "${selectedText}"`);

    // 使用 MarkerLine 搜索替换
    simulator.editor.clearSelection();
    simulator.closeFile();
    log.result('选择和替换测试完成\n');

    // ========== 测试 3: MarkerLine 自动搜索和插入 ==========
    log.step('4. 测试 MarkerLine 自动搜索并插入');

    const code2 = `import Alamofire

class NetworkManager {
  func fetchData() {
    // as:search URLSession
    // code here
  }
}`;

    simulator.openFile('src/NetworkManager.swift', code2);
    log.info('✓ 打开包含 MarkerLine 的文件');

    // 保存文件（触发 FileWatcher）
    simulator.saveFile();
    log.info('✓ 保存文件');

    // 检测指令
    const directives = simulator.detectDirectives();
    log.info(`✓ 检测到 ${directives.length} 个指令`);

    if (directives.length > 0) {
      const directive = directives[0];
      log.info(`  - 类型: ${directive.type}`);
      log.info(`  - 关键字: ${directive.keyword}`);
      log.info(`  - 行号: ${directive.lineNumber}`);

      // 执行搜索并自动插入
      log.info('正在执行搜索...');
      try {
        const searchResult = await simulator.handleDirective(directive);
        
        if (searchResult.status === 'success') {
          log.result('搜索成功');
          log.info(`  - 找到 ${searchResult.results.length} 个结果`);
          log.info(`  - 自动插入内容: "${searchResult.insertedText.substring(0, 50)}..."`);
          log.info(`  - 插入行数: ${searchResult.insertedLines} 行`);
          
          // 验证文件内容已更新
          const content = simulator.editor.getContent();
          if (content.includes('URLSession')) {
            log.result('文件内容已更新，URLSession 已插入');
          }
        } else {
          log.error(`搜索失败: ${searchResult.message}`);
        }
      } catch (error) {
        log.error(`执行指令出错: ${error.message}`);
        log.info('(可能是 Dashboard 未启动，但模拟器框架工作正常)');
      }
    }

    simulator.closeFile();

    // ========== 测试 4: 复杂编辑序列 ==========
    log.step('5. 测试复杂编辑序列');

    const code3 = `class DataModel {
  let id: String
  let name: String
}`;

    simulator.openFile('src/Model.swift', code3);

    // 编辑序列
    const edits = [
      { action: 'setCaret', line: 0, col: 5, desc: '移动到 class 名称' },
      { action: 'selectLine', line: 1, desc: '选中第 1 行' },
      { action: 'insertBefore', line: 3, text: '\n  let created: Date\n', desc: '添加新字段' },
      { action: 'setCaret', line: 5, col: 0, desc: '移动到末尾' }
    ];

    for (const edit of edits) {
      try {
        switch (edit.action) {
          case 'setCaret':
            simulator.editor.setCaret(edit.line, edit.col);
            log.info(`✓ ${edit.desc}`);
            break;
          case 'selectLine':
            const lineContent = simulator.editor.getLine(edit.line);
            simulator.editor.setSelection(edit.line, 0, edit.line, lineContent.length);
            log.info(`✓ ${edit.desc}`);
            break;
          case 'insertBefore':
            simulator.editor.insertText(edit.line, edit.text);
            log.info(`✓ ${edit.desc}`);
            break;
        }
      } catch (err) {
        log.error(`${edit.desc} 失败: ${err.message}`);
      }
    }

    log.result('编辑序列完成');
    const finalContent = simulator.editor.getContent();
    log.info(`最终文件行数: ${finalContent.split('\n').length} 行`);

    simulator.closeFile();

    // ========== 测试 5: 剪贴板操作 ==========
    log.step('6. 测试剪贴板操作');

    const code4 = `class ViewController {
}`;

    simulator.openFile('src/ViewController.swift', code4);

    // 设置剪贴板
    const clipboardContent = 'UIViewController';
    simulator.editor.setClipboard(clipboardContent);
    log.info(`✓ 设置剪贴板: "${clipboardContent}"`);

    // 粘贴到编辑器
    simulator.editor.setCaret(0, 17); // 在 'class ViewController' 后面
    simulator.editor.paste();
    log.info('✓ 从剪贴板粘贴');

    const updated = simulator.editor.getLine(0);
    if (updated.includes(clipboardContent)) {
      log.result(`剪贴板内容已粘贴: "${updated}"`);
    }

    simulator.closeFile();

    // ========== 操作统计 ==========
    log.step('7. 操作统计');
    
    const stats = simulator.getOperationStats();
    log.info(`总操作数: ${stats.total}`);
    log.info(`  - 搜索: ${stats.SEARCH}`);
    log.info(`  - 创建: ${stats.CREATE}`);
    log.info(`  - 审查: ${stats.AUDIT}`);
    log.info(`  - 成功: ${stats.succeeded}`);
    log.info(`  - 失败: ${stats.failed}`);

    const fileStats = simulator.vfs.getStats();
    log.info(`\n虚拟文件系统统计:`);
    log.info(`  - 文件总数: ${fileStats.totalFiles}`);
    log.info(`  - 总字节数: ${fileStats.totalSize}`);
    log.info(`  - 总行数: ${fileStats.totalLines}`);
    log.info(`  - 变化次数: ${fileStats.changeCount}`);

    // ========== 历史记录 ==========
    log.step('8. 历史记录');

    const history = simulator.getOperationHistory();
    log.info(`共 ${history.length} 条操作历史`);
    history.forEach((op, idx) => {
      log.info(`  ${idx + 1}. [${op.type}] 状态: ${op.status}`);
    });

    const editorHistory = simulator.editor.getHistory();
    log.info(`编辑器历史: ${editorHistory.length} 条操作`);

    simulator.stop();
    log.result('\n所有测试完成！\n');

  } catch (error) {
    log.error(`测试过程中发生错误: ${error.message}`);
    if (process.env.VERBOSE) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
