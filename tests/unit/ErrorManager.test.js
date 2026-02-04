/**
 * ErrorManager 单元测试
 */

const {
  AppError,
  ApiError,
  ValidationError,
  SystemError,
  BusinessError,
  AuthError,
  PermissionError,
  NotFoundError,
  ErrorManager
} = require('../../lib/infrastructure/error/ErrorManager');

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function run() {
  console.log('🧪 ErrorManager 单元测试\n');

  for (const t of tests) {
    try {
      await t.fn();
      console.log(`✅ ${t.name}`);
      passed++;
    } catch (err) {
      console.log(`❌ ${t.name}`);
      console.error(`   ${err.message}`);
      failed++;
    }
  }

  console.log(`\n📊 结果: ${passed} 通过, ${failed} 失败\n`);
  process.exit(failed > 0 ? 1 : 0);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(a, b, message) {
  if (a !== b) {
    throw new Error(message || `Expected ${b}, got ${a}`);
  }
}

// ============ 测试用例开始 ============

test('AppError 应该创建正确的实例', () => {
  const err = new AppError('Test error', {
    code: 'TEST_ERROR',
    category: 'SYSTEM',
    statusCode: 500,
    userMessage: 'Something went wrong'
  });

  assertEqual(err.message, 'Test error');
  assertEqual(err.code, 'TEST_ERROR');
  assertEqual(err.category, 'SYSTEM');
  assertEqual(err.statusCode, 500);
  assertEqual(err.userMessage, 'Something went wrong');
  assert(err instanceof Error);
});

test('ApiError 应该有正确的默认值', () => {
  const err = new ApiError('API failed', {
    statusCode: 404,
    userMessage: 'Not found'
  });

  assertEqual(err.category, 'API');
  assertEqual(err.statusCode, 404);
  assertEqual(err.userMessage, 'Not found');
});

test('ValidationError 应该有正确的默认值', () => {
  const err = new ValidationError('Invalid input');

  assertEqual(err.category, 'VALIDATION');
  assertEqual(err.statusCode, 400);
  assert(err.userMessage.includes('输入参数不合法'));
});

test('SystemError 应该有正确的默认值', () => {
  const err = new SystemError('Internal error');

  assertEqual(err.category, 'SYSTEM');
  assertEqual(err.statusCode, 500);
  assert(err.userMessage.includes('系统内部错误'));
});

test('BusinessError 应该有正确的默认值', () => {
  const err = new BusinessError('Invalid state');

  assertEqual(err.category, 'BUSINESS');
  assertEqual(err.statusCode, 422);
});

test('AuthError 应该有正确的默认值', () => {
  const err = new AuthError('Not authenticated');

  assertEqual(err.category, 'AUTH');
  assertEqual(err.statusCode, 401);
});

test('PermissionError 应该有正确的默认值', () => {
  const err = new PermissionError('Access denied');

  assertEqual(err.category, 'PERMISSION');
  assertEqual(err.statusCode, 403);
});

test('NotFoundError 应该有正确的默认值', () => {
  const err = new NotFoundError('Resource not found');

  assertEqual(err.category, 'NOT_FOUND');
  assertEqual(err.statusCode, 404);
});

test('AppError 应该支持错误链', () => {
  const cause = new Error('Root cause');
  const err = new AppError('Wrapped error', {
    code: 'WRAPPED',
    cause
  });

  assertEqual(err.cause, cause);
  assert(err.getFullMessage().includes('Root cause'));
});

test('ErrorManager 应该创建实例', () => {
  const manager = new ErrorManager();

  assert(manager instanceof ErrorManager);
  assert(manager.errorMap instanceof Map);
  assert(manager.stats.total === 0);
});

test('ErrorManager 应该注册默认错误代码', () => {
  const manager = new ErrorManager();
  const codes = manager.getCodes();

  assert(codes.includes('API_BAD_REQUEST'));
  assert(codes.includes('VALIDATION_REQUIRED_FIELD'));
  assert(codes.includes('BUSINESS_DUPLICATE'));
  assert(codes.includes('SYSTEM_DATABASE_ERROR'));
});

test('ErrorManager 应该创建错误', () => {
  const manager = new ErrorManager();
  const err = manager.create('API_NOT_FOUND', 'Product not found');

  assertEqual(err.code, 'API_NOT_FOUND');
  assertEqual(err.message, 'Product not found');
  assertEqual(err.category, 'API');
  assertEqual(err.statusCode, 404);
  assert(err instanceof ApiError);
});

test('ErrorManager 应该注册自定义错误代码', () => {
  const manager = new ErrorManager();

  manager.register('CUSTOM_ERROR', {
    category: 'BUSINESS',
    statusCode: 422,
    userMessage: 'Custom error message'
  });

  const err = manager.create('CUSTOM_ERROR', 'Test');
  assertEqual(err.userMessage, 'Custom error message');
  assertEqual(err.statusCode, 422);
});

test('ErrorManager 应该包装现有错误', () => {
  const manager = new ErrorManager();
  const originalErr = new Error('Original error');

  const wrapped = manager.wrap(originalErr, 'SYSTEM_ERROR', 'System error occurred');

  assert(wrapped instanceof SystemError);
  assertEqual(wrapped.code, 'SYSTEM_ERROR');
  assertEqual(wrapped.cause, originalErr);
});

test('ErrorManager 应该捕获 AppError', () => {
  const manager = new ErrorManager();
  const appErr = new ValidationError('Invalid');

  const caught = manager.catch(appErr);

  assertEqual(caught, appErr);
  assertEqual(manager.stats.total, 1);
});

test('ErrorManager 应该捕获普通 Error', () => {
  const manager = new ErrorManager();
  const err = new Error('Something failed');

  const caught = manager.catch(err);

  assert(caught instanceof SystemError);
  assertEqual(caught.cause, err);
});

test('ErrorManager 应该检查错误分类', () => {
  const manager = new ErrorManager();
  const apiErr = new ApiError('Failed');
  const validErr = new ValidationError('Invalid');

  assert(manager.isCategory(apiErr, 'API'));
  assert(!manager.isCategory(apiErr, 'VALIDATION'));
  assert(manager.isCategory(validErr, 'VALIDATION'));
});

test('ErrorManager 应该检查错误代码', () => {
  const manager = new ErrorManager();
  const err = manager.create('API_NOT_FOUND', 'Not found');

  assert(manager.isCode(err, 'API_NOT_FOUND'));
  assert(!manager.isCode(err, 'API_BAD_REQUEST'));
});

test('ErrorManager 应该生成用户响应', () => {
  const manager = new ErrorManager();
  const err = manager.create('API_NOT_FOUND', 'Product not found');

  const response = manager.getUserResponse(err);

  assertEqual(response.code, 'API_NOT_FOUND');
  assert(response.message.includes('资源不存在'));
  assertEqual(response.statusCode, 404);
});

test('ErrorManager 应该生成详细响应', () => {
  const manager = new ErrorManager();
  const err = manager.create('VALIDATION_REQUIRED_FIELD', 'Email is required', {
    details: { field: 'email' }
  });

  const response = manager.getDetailedResponse(err);

  assert(response.code);
  assert(response.message);
  assert(response.stack);
  assert(response.timestamp);
});

test('ErrorManager 应该跟踪统计信息', () => {
  const manager = new ErrorManager();

  manager.create('API_NOT_FOUND', 'Not found');
  manager.create('VALIDATION_REQUIRED_FIELD', 'Required');
  manager.create('API_NOT_FOUND', 'Not found again');

  const stats = manager.getStats();

  assertEqual(stats.total, 3);
  assertEqual(stats.byCategory['API'], 2);
  assertEqual(stats.byCategory['VALIDATION'], 1);
  assertEqual(stats.byCode['API_NOT_FOUND'], 2);
});

test('ErrorManager 应该重置统计信息', () => {
  const manager = new ErrorManager();

  manager.create('API_NOT_FOUND', 'Not found');
  manager.create('VALIDATION_REQUIRED_FIELD', 'Required');

  manager.resetStats();
  const stats = manager.getStats();

  assertEqual(stats.total, 0);
  assertEqual(Object.keys(stats.byCategory).length, 0);
});

test('ErrorManager 应该获取错误配置', () => {
  const manager = new ErrorManager();

  const config = manager.getConfig('API_NOT_FOUND');

  assert(config !== null);
  assertEqual(config.statusCode, 404);
  assert(config.userMessage.includes('不存在'));
});

test('AppError 应该支持转换为 JSON', () => {
  const err = new AppError('Test error', {
    code: 'TEST_ERROR',
    category: 'SYSTEM',
    statusCode: 500
  });

  const json = err.toJSON();

  assert(typeof json === 'object');
  assertEqual(json.code, 'TEST_ERROR');
  assertEqual(json.message, 'Test error');
  assert(json.timestamp);
  assert(json.stack);
});

test('ErrorManager 应该支持链式调用', () => {
  const manager = new ErrorManager();

  const result = manager
    .register('CUSTOM1', { statusCode: 400, userMessage: 'Error 1' })
    .register('CUSTOM2', { statusCode: 500, userMessage: 'Error 2' })
    .resetStats();

  assert(result instanceof ErrorManager);
  assert(manager.getCodes().includes('CUSTOM1'));
  assert(manager.getCodes().includes('CUSTOM2'));
});

test('AppError 应该有有效的时间戳', () => {
  const err = new AppError('Test', { code: 'TEST' });

  assert(err.timestamp);
  assert(new Date(err.timestamp) instanceof Date);
  assert(!isNaN(new Date(err.timestamp).getTime()));
});

test('ErrorManager 应该支持多层错误链', () => {
  const manager = new ErrorManager();

  const root = new Error('Root cause');
  const level1 = new AppError('Level 1', { cause: root });
  const level2 = manager.wrap(level1, 'SYSTEM_ERROR', 'Level 2');

  assert(level2.cause instanceof AppError);
  assert(level2.cause.cause instanceof Error);
  assert(level2.getFullMessage().includes('Root cause'));
});

// ============ 测试运行 ============

run();
