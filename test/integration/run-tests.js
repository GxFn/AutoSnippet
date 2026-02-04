/**
 * 集成测试运行器
 * 执行所有测试套件并生成报告
 */

const path = require('path');
const fs = require('fs').promises;

// 加载所有测试套件
const recipesTests = require('./suites/recipes.test');
const permissionsTests = require('./suites/permissions.test');
const crossProjectTests = require('./suites/cross-project.test');

const allTestSuites = [
  recipesTests,
  permissionsTests,
  crossProjectTests
];

/**
 * 运行所有测试
 */
async function runAllTests() {
  console.log(`\n${'='.repeat(80)}`);
  console.log('AutoSnippet 集成测试套件执行');
  console.log(`${'='.repeat(80)}\n`);

  const startTime = Date.now();
  const allResults = [];

  // 运行每个测试套件
  for (const suite of allTestSuites) {
    const results = await suite.run();
    allResults.push({
      suiteName: suite.name,
      results
    });
  }

  const totalTime = Date.now() - startTime;

  // 生成总结报告
  console.log(`\n${'='.repeat(80)}`);
  console.log('测试总结');
  console.log(`${'='.repeat(80)}\n`);

  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const suiteResult of allResults) {
    const summary = suiteResult.results.getSummary();
    totalPassed += summary.passed;
    totalFailed += summary.failed;
    totalSkipped += summary.skipped;

    console.log(`${suiteResult.suiteName}:`);
    console.log(`  ✓ 通过: ${summary.passed}`);
    console.log(`  ✗ 失败: ${summary.failed}`);
    console.log(`  ⊘ 跳过: ${summary.skipped}`);
    console.log(`  成功率: ${summary.successRate}`);
    console.log();
  }

  const totalTests = totalPassed + totalFailed + totalSkipped;
  const overallSuccessRate = totalTests > 0 ? (totalPassed / totalTests * 100).toFixed(2) : 0;

  console.log(`${'='.repeat(80)}`);
  console.log('整体统计');
  console.log(`${'='.repeat(80)}`);
  console.log(`总测试数: ${totalTests}`);
  console.log(`✓ 通过: ${totalPassed}`);
  console.log(`✗ 失败: ${totalFailed}`);
  console.log(`⊘ 跳过: ${totalSkipped}`);
  console.log(`整体成功率: ${overallSuccessRate}%`);
  console.log(`总耗时: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);
  console.log(`${'='.repeat(80)}\n`);

  // 如果有失败的测试，输出详细信息
  if (totalFailed > 0) {
    console.log('\n失败测试详情:');
    console.log(`${'='.repeat(80)}\n`);

    for (const suiteResult of allResults) {
      const failed = suiteResult.results.failed;
      if (failed.length > 0) {
        console.log(`${suiteResult.suiteName}:`);
        for (const test of failed) {
          console.log(`  ✗ ${test.name}`);
          console.log(`    错误: ${test.error}`);
          if (test.stack) {
            console.log(`    堆栈: ${test.stack.split('\n')[0]}`);
          }
        }
        console.log();
      }
    }
  }

  return {
    totalTests,
    totalPassed,
    totalFailed,
    totalSkipped,
    overallSuccessRate,
    totalTime,
    suites: allResults
  };
}

/**
 * 生成 HTML 报告
 */
async function generateHtmlReport(results) {
  const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AutoSnippet 集成测试报告</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }
    
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }
    
    .header h1 {
      font-size: 28px;
      margin-bottom: 10px;
    }
    
    .header p {
      opacity: 0.9;
      font-size: 14px;
    }
    
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      padding: 30px;
      background: #f8f9fa;
    }
    
    .summary-card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #667eea;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
    }
    
    .summary-card h3 {
      color: #666;
      font-size: 12px;
      text-transform: uppercase;
      margin-bottom: 10px;
    }
    
    .summary-card .value {
      font-size: 28px;
      font-weight: bold;
      color: #333;
    }
    
    .summary-card.passed {
      border-left-color: #28a745;
    }
    
    .summary-card.passed .value {
      color: #28a745;
    }
    
    .summary-card.failed {
      border-left-color: #dc3545;
    }
    
    .summary-card.failed .value {
      color: #dc3545;
    }
    
    .summary-card.success-rate .value {
      color: #007bff;
    }
    
    .content {
      padding: 30px;
    }
    
    .suite {
      margin-bottom: 30px;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      overflow: hidden;
    }
    
    .suite-header {
      background: #f8f9fa;
      padding: 20px;
      border-bottom: 1px solid #e0e0e0;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .suite-header:hover {
      background: #e9ecef;
    }
    
    .suite-header h2 {
      font-size: 18px;
      color: #333;
    }
    
    .suite-stats {
      display: flex;
      gap: 20px;
      font-size: 14px;
    }
    
    .suite-stats span {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    
    .suite-content {
      padding: 20px;
    }
    
    .test-item {
      padding: 12px;
      margin-bottom: 8px;
      border-left: 4px solid #28a745;
      background: #f0f8f5;
      border-radius: 4px;
    }
    
    .test-item.failed {
      border-left-color: #dc3545;
      background: #fdf8f8;
    }
    
    .test-name {
      font-weight: 500;
      color: #333;
      margin-bottom: 5px;
    }
    
    .test-duration {
      font-size: 12px;
      color: #999;
    }
    
    .test-error {
      font-size: 12px;
      color: #dc3545;
      margin-top: 5px;
      font-family: monospace;
    }
    
    .footer {
      background: #f8f9fa;
      padding: 20px;
      text-align: center;
      color: #666;
      font-size: 12px;
      border-top: 1px solid #e0e0e0;
    }
    
    @media (max-width: 768px) {
      .summary {
        grid-template-columns: 1fr;
      }
      
      .header {
        padding: 20px;
      }
      
      .header h1 {
        font-size: 22px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>AutoSnippet 集成测试报告</h1>
      <p>生成时间: ${new Date().toLocaleString('zh-CN')}</p>
    </div>
    
    <div class="summary">
      <div class="summary-card passed">
        <h3>通过</h3>
        <div class="value">${results.totalPassed}</div>
      </div>
      <div class="summary-card failed">
        <h3>失败</h3>
        <div class="value">${results.totalFailed}</div>
      </div>
      <div class="summary-card success-rate">
        <h3>成功率</h3>
        <div class="value">${results.overallSuccessRate}%</div>
      </div>
      <div class="summary-card">
        <h3>总耗时</h3>
        <div class="value">${(results.totalTime / 1000).toFixed(2)}s</div>
      </div>
    </div>
    
    <div class="content">
      ${results.suites.map(suite => `
        <div class="suite">
          <div class="suite-header">
            <h2>${suite.suiteName}</h2>
            <div class="suite-stats">
              <span style="color: #28a745;">✓ ${suite.results.passed.length}</span>
              <span style="color: #dc3545;">✗ ${suite.results.failed.length}</span>
              <span style="color: #999;">⊘ ${suite.results.skipped.length}</span>
            </div>
          </div>
          <div class="suite-content">
            ${suite.results.passed.map(test => `
              <div class="test-item">
                <div class="test-name">✓ ${test.name}</div>
                <div class="test-duration">${test.duration}ms</div>
              </div>
            `).join('')}
            ${suite.results.failed.map(test => `
              <div class="test-item failed">
                <div class="test-name">✗ ${test.name}</div>
                <div class="test-error">${test.error}</div>
                <div class="test-duration">${test.duration}ms</div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
    
    <div class="footer">
      <p>AutoSnippet 集成测试框架 - ${results.totalTests} 项测试, ${(results.totalTime / 1000).toFixed(2)}s 完成</p>
    </div>
  </div>
</body>
</html>`;

  return htmlContent;
}

/**
 * 生成 JSON 报告
 */
async function generateJsonReport(results) {
  return JSON.stringify(results, null, 2);
}

/**
 * 主函数
 */
async function main() {
  try {
    // 检查 Dashboard 是否运行
    const { TestClient } = require('./framework/test-framework');
    const client = new TestClient();

    console.log('🔍 检查 Dashboard 连接...');
    const health = await client.get('/api/health');

    if (health.status !== 200) {
      console.error('❌ 无法连接到 Dashboard (http://localhost:3100)');
      console.error('   请确保 Dashboard 正在运行:');
      console.error('   npm run dashboard');
      process.exit(1);
    }

    console.log('✓ Dashboard 已连接');
    console.log(`  项目路径: ${health.body.projectRoot}`);

    // 运行所有测试
    const results = await runAllTests();

    // 生成报告
    const reportDir = path.join(__dirname, 'reports');
    await fs.mkdir(reportDir, { recursive: true });

    // 生成 JSON 报告
    const jsonReport = await generateJsonReport(results);
    const jsonPath = path.join(reportDir, `report-${Date.now()}.json`);
    await fs.writeFile(jsonPath, jsonReport);
    console.log(`\n📄 JSON 报告已保存: ${jsonPath}`);

    // 生成 HTML 报告
    const htmlReport = await generateHtmlReport(results);
    const htmlPath = path.join(reportDir, `report-${Date.now()}.html`);
    await fs.writeFile(htmlPath, htmlReport);
    console.log(`📄 HTML 报告已保存: ${htmlPath}`);

    // 如果有失败，返回非零退出码
    if (results.totalFailed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ 测试执行出错:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  runAllTests,
  generateHtmlReport,
  generateJsonReport
};
