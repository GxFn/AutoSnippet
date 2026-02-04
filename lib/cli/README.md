# CLI 模块化架构

## 概述

AutoSnippet CLI 已通过模块化重构实现了代码拆分和架构改进。本文档说明新的结构和使用方式。

## 目录结构

```
lib/cli/
├── commands/              # CLI 命令实现
│   ├── BaseCommand.js     # 所有命令的基类
│   ├── InitCommand.js     # init 命令
│   ├── CreateCommand.js   # create 命令
│   ├── ShareCommand.js    # share 命令
│   └── ...                # 其他命令
├── utils/                 # CLI 工具函数
│   ├── cliHelpers.js      # 通用辅助函数
│   ├── presetLoader.js    # 配置加载
│   └── clipboardHandler.js # 剪贴板处理
└── CliOrchestrator.js     # 命令路由协调器

bin/
└── asd-cli.js             # 入口点（简化为路由逻辑）
```

## 核心组件

### BaseCommand
所有 CLI 命令的基类，提供通用接口：

```javascript
class MyCommand extends BaseCommand {
  constructor(options) {
    super(options);
    this.name = 'my-command';
    this.description = '我的命令描述';
  }

  async validate() {
    // 预检查逻辑
    return true;
  }

  async execute() {
    // 命令实现
    this.logSuccess('命令执行成功');
  }
}
```

### 工具函数

#### cliHelpers.js
- `getSpecFile(startDir, callback)` - 查找 spec 文件
- `getGlobalOptions(program)` - 解析全局选项
- `ensureSpmDepMapFile(projectRootDir)` - 确保 SPM 映射文件存在

#### presetLoader.js
- `loadPresetConfig(presetPath, defaults)` - 加载预置配置
- `validatePresetConfig(config, requiredFields)` - 验证配置

#### clipboardHandler.js
- `readClipboardText()` - 读取剪贴板
- `writeClipboardText(text)` - 写入剪贴板

## 使用示例

### 创建新命令

1. 继承 BaseCommand
2. 实现 execute() 方法
3. 在 CliOrchestrator 中注册

```javascript
// lib/cli/commands/MyCommand.js
const BaseCommand = require('./BaseCommand');

class MyCommand extends BaseCommand {
  constructor(options) {
    super(options);
    this.name = 'my-command';
    this.description = '执行我的自定义操作';
  }

  async validate() {
    // 验证前置条件
    return true;
  }

  async execute() {
    this.logInfo('命令开始执行...');
    
    try {
      // 执行实际操作
      this.logSuccess('操作完成!');
    } catch (error) {
      this.logError(error.message);
      throw error;
    }
  }
}

module.exports = MyCommand;
```

### 在路由中使用

```javascript
// bin/asd-cli.js
program
  .command('my-command')
  .description('执行我的自定义操作')
  .action(async (options) => {
    const cmd = new MyCommand(options);
    if (await cmd.validate()) {
      await cmd.execute();
    }
  });
```

## 迁移指南

### 从旧结构迁移

**原来的方式**（在 bin/asd-cli.js 中实现所有逻辑）：
```javascript
program
  .command('my-command')
  .action(async () => {
    // 100 行的命令实现代码...
  });
```

**新的方式**（使用命令类）：
```javascript
const MyCommand = require('../lib/cli/commands/MyCommand');

program
  .command('my-command')
  .action(async (options) => {
    const cmd = new MyCommand(options);
    if (await cmd.validate()) {
      await cmd.execute();
    }
  });
```

## 测试策略

### 单元测试

```javascript
// test/unit/cli/MyCommand.test.js
const MyCommand = require('../../../lib/cli/commands/MyCommand');

describe('MyCommand', () => {
  it('should execute successfully', async () => {
    const cmd = new MyCommand({});
    expect(await cmd.validate()).toBe(true);
    await expect(cmd.execute()).resolves.not.toThrow();
  });

  it('should handle errors gracefully', async () => {
    const cmd = new MyCommand({});
    // 测试错误处理...
  });
});
```

### 集成测试

```javascript
// test/integration/cli.test.js
const { execSync } = require('child_process');

describe('CLI Integration', () => {
  it('should run my-command successfully', () => {
    const output = execSync('node bin/asd-cli.js my-command').toString();
    expect(output).toContain('✅');
  });
});
```

## 性能优化

### 懒加载命令

对于不常使用的命令，可以实现懒加载以加快启动时间：

```javascript
program
  .command('heavy-command')
  .action(async (options) => {
    // 仅在需要时加载重命令类
    const HeavyCommand = require('../lib/cli/commands/HeavyCommand');
    const cmd = new HeavyCommand(options);
    await cmd.execute();
  });
```

## 常见问题

### Q: 为什么要拆分命令？
A: 拆分后更容易：
- 维护和调试（每个文件 <300 行）
- 编写单元测试
- 重用共同逻辑
- 添加新命令

### Q: 如何访问全局选项？
A: 通过构造函数传递：
```javascript
const cmd = new MyCommand({ preset: '/path/to/preset.json', yes: true });
```

### Q: 可以添加新的工具函数吗？
A: 当然，在 `lib/cli/utils/` 中创建新文件即可。

## 后续改进

- [ ] 命令中间件系统支持
- [ ] 插件化命令注册
- [ ] 国际化（i18n）支持
- [ ] 性能分析工具
- [ ] 命令重试机制
