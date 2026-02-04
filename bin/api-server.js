/**
 * API Server 启动脚本
 * 
 * 用法：
 *   node bin/api-server.js [options]
 * 
 * 选项：
 *   --port <port>     API 服务器端口 (默认: 8080)
 *   --host <host>     API 服务器主机 (默认: localhost)
 *   --config <path>   配置文件路径
 */

const { APIGateway } = require('../lib/api/APIGateway');
const { Agent } = require('../lib/agent/Agent');
const { RecipeHub } = require('../lib/business/recipe/RecipeHub');
const { SearchHub } = require('../lib/business/search/SearchHub');
const { MetricsHub } = require('../lib/business/metrics/MetricsHub');

/**
 * 解析命令行参数
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    port: 8080,
    host: 'localhost',
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') {
      options.port = parseInt(args[++i], 10);
    } else if (args[i] === '--host') {
      options.host = args[++i];
    }
  }

  return options;
}

/**
 * 启动 API 服务器
 */
async function startServer() {
  const options = parseArgs();

  // 创建 Agent
  const agent = new Agent({ name: 'APIAgent' });

  // 注册 Hub
  agent.registerHub('recipe', new RecipeHub());
  agent.registerHub('search', new SearchHub());
  agent.registerHub('metric', new MetricsHub());

  // 创建 API Gateway
  const gateway = new APIGateway(agent, {
    port: options.port,
    host: options.host,
  });

  // 启动服务器
  try {
    await gateway.start();
    console.log(`✨ API 服务器运行中...`);
    console.log(`📝 API 文档: http://${options.host}:${options.port}/api/docs`);
    console.log(`🏥 健康检查: http://${options.host}:${options.port}/api/health`);
    console.log(`\n按 Ctrl+C 停止服务器`);
  } catch (error) {
    console.error('❌ 启动服务器失败:', error);
    process.exit(1);
  }

  // 处理信号
  process.on('SIGINT', async () => {
    console.log('\n🛑 停止服务器...');
    await gateway.stop();
    console.log('✅ 服务器已停止');
    process.exit(0);
  });
}

startServer().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
