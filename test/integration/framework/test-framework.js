/**
 * 集成测试基础框架
 * 提供 HTTP 请求、断言和工具函数
 */

const http = require('http');
const url = require('url');
const assert = require('assert');

const DEFAULT_TIMEOUT = 5000;
const DEFAULT_PORT = 3100;

/**
 * HTTP 请求客户端
 */
class TestClient {
  constructor(baseUrl = `http://localhost:${DEFAULT_PORT}`) {
  this.baseUrl = baseUrl;
  this.timeout = DEFAULT_TIMEOUT;
  this.headers = {
    'Content-Type': 'application/json'
  };
  }

  /**
   * 执行 GET 请求
   */
  async get(path, options = {}) {
  return this.request('GET', path, null, options);
  }

  /**
   * 执行 POST 请求
   */
  async post(path, data, options = {}) {
  return this.request('POST', path, data, options);
  }

  /**
   * 执行 PUT 请求
   */
  async put(path, data, options = {}) {
  return this.request('PUT', path, data, options);
  }

  /**
   * 执行 DELETE 请求
   */
  async delete(path, data, options = {}) {
  return this.request('DELETE', path, data, options);
  }

  /**
   * 核心请求方法
   */
  async request(method, path, data, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(path, this.baseUrl);
    const options_merged = {
    method,
    headers: { ...this.headers, ...options.headers },
    timeout: options.timeout || this.timeout
    };

    const req = http.request(urlObj, options_merged, (res) => {
    let body = '';

    res.on('data', chunk => {
      body += chunk;
    });

    res.on('end', () => {
      try {
      const parsed = body ? JSON.parse(body) : null;
      resolve({
        status: res.statusCode,
        headers: res.headers,
        body: parsed,
        rawBody: body
      });
      } catch (e) {
      resolve({
        status: res.statusCode,
        headers: res.headers,
        body: null,
        rawBody: body,
        parseError: e.message
      });
      }
    });
    });

    req.on('error', reject);
    req.on('timeout', () => {
    req.destroy();
    reject(new Error(`Request timeout after ${options.timeout || this.timeout}ms`));
    });

    if (data) {
    req.write(JSON.stringify(data));
    }

    req.end();
  });
  }

  /**
   * 设置请求头
   */
  setHeader(key, value) {
  this.headers[key] = value;
  }

  /**
   * 移除请求头
   */
  removeHeader(key) {
  delete this.headers[key];
  }
}

/**
 * 断言工具类
 */
class TestAssert {
  static assertEquals(actual, expected, message) {
  assert.strictEqual(actual, expected, message || `Expected ${expected}, got ${actual}`);
  }

  static assertNotEquals(actual, expected, message) {
  assert.notStrictEqual(actual, expected, message || `Expected not ${expected}, got ${actual}`);
  }

  static assertTrue(value, message) {
  assert.strictEqual(value, true, message || `Expected true, got ${value}`);
  }

  static assertFalse(value, message) {
  assert.strictEqual(value, false, message || `Expected false, got ${value}`);
  }

  static assertExists(value, message) {
  assert.ok(value !== null && value !== undefined, message || `Expected value to exist`);
  }

  static assertNotExists(value, message) {
  assert.ok(value === null || value === undefined, message || `Expected value not to exist`);
  }

  static assertIncludes(array, value, message) {
  assert.ok(array.includes(value), message || `Expected array to include ${value}`);
  }

  static assertArrayLength(array, length, message) {
  assert.strictEqual(array.length, length, message || `Expected array length ${length}, got ${array.length}`);
  }

  static assertObjectHasKeys(obj, keys, message) {
  keys.forEach(key => {
    assert.ok(key in obj, message || `Expected object to have key ${key}`);
  });
  }

  static assertStatusCode(response, expectedCode, message) {
  assert.strictEqual(response.status, expectedCode, message || `Expected status ${expectedCode}, got ${response.status}`);
  }

  static assertContentType(response, expectedType, message) {
  const contentType = response.headers['content-type'] || '';
  assert.ok(contentType.includes(expectedType), message || `Expected content-type to include ${expectedType}`);
  }

  static assertResponseSuccess(response, message) {
  this.assertStatusCode(response, 200, message);
  this.assertExists(response.body, 'Response body should not be empty');
  }
}

/**
 * 测试上下文管理
 */
class TestContext {
  constructor() {
  this.data = {};
  this.cleanup = [];
  this.startTime = null;
  this.endTime = null;
  }

  /**
   * 设置上下文数据
   */
  set(key, value) {
  this.data[key] = value;
  }

  /**
   * 获取上下文数据
   */
  get(key) {
  return this.data[key];
  }

  /**
   * 注册清理函数
   */
  onCleanup(fn) {
  this.cleanup.push(fn);
  }

  /**
   * 执行所有清理函数
   */
  async cleanup_all() {
  for (const fn of this.cleanup) {
    try {
    await fn();
    } catch (e) {
    console.error('Cleanup error:', e);
    }
  }
  this.cleanup = [];
  }

  /**
   * 记录测试时间
   */
  startTimer() {
  this.startTime = Date.now();
  }

  /**
   * 结束测试计时
   */
  endTimer() {
  this.endTime = Date.now();
  return this.endTime - this.startTime;
  }

  /**
   * 获取耗时
   */
  getElapsedTime() {
  if (!this.startTime || !this.endTime) {
    return null;
  }
  return this.endTime - this.startTime;
  }
}

/**
 * 测试结果收集器
 */
class TestResults {
  constructor() {
  this.passed = [];
  this.failed = [];
  this.skipped = [];
  this.startTime = Date.now();
  }

  /**
   * 记录通过的测试
   */
  recordPass(testName, duration) {
  this.passed.push({ name: testName, duration });
  }

  /**
   * 记录失败的测试
   */
  recordFail(testName, error, duration) {
  this.failed.push({ name: testName, error: error.message, stack: error.stack, duration });
  }

  /**
   * 记录跳过的测试
   */
  recordSkip(testName) {
  this.skipped.push({ name: testName });
  }

  /**
   * 获取总结
   */
  getSummary() {
  const totalTime = Date.now() - this.startTime;
  const total = this.passed.length + this.failed.length + this.skipped.length;
  const successRate = total > 0 ? (this.passed.length / total * 100).toFixed(2) : 0;

  return {
    total,
    passed: this.passed.length,
    failed: this.failed.length,
    skipped: this.skipped.length,
    successRate: `${successRate}%`,
    totalTime: `${totalTime}ms`,
    averageTime: total > 0 ? `${(totalTime / total).toFixed(2)}ms` : 'N/A',
    details: {
    passed: this.passed,
    failed: this.failed,
    skipped: this.skipped
    }
  };
  }

  /**
   * 生成测试报告
   */
  generateReport() {
  const summary = this.getSummary();
  return {
    timestamp: new Date().toISOString(),
    summary,
    failedTests: this.failed.map(t => ({
    name: t.name,
    error: t.error,
    duration: `${t.duration}ms`
    }))
  };
  }
}

/**
 * 测试运行器
 */
class TestRunner {
  constructor(name) {
  this.name = name;
  this.tests = [];
  this.results = new TestResults();
  }

  /**
   * 注册测试
   */
  test(description, fn) {
  this.tests.push({ description, fn, skip: false });
  }

  /**
   * 跳过测试
   */
  skip(description, fn) {
  this.tests.push({ description, fn, skip: true });
  }

  /**
   * 运行所有测试
   */
  async run() {
  console.log(`\n\n========== 测试套件: ${this.name} ==========\n`);

  for (const test of this.tests) {
    if (test.skip) {
    this.results.recordSkip(test.description);
    console.log(`⊘ SKIP: ${test.description}`);
    continue;
    }

    const startTime = Date.now();
    try {
    const context = new TestContext();
    await test.fn(context);
    const duration = Date.now() - startTime;
    this.results.recordPass(test.description, duration);
    console.log(`✓ PASS: ${test.description} (${duration}ms)`);
    await context.cleanup_all();
    } catch (error) {
    const duration = Date.now() - startTime;
    this.results.recordFail(test.description, error, duration);
    console.log(`✗ FAIL: ${test.description} (${duration}ms)`);
    console.log(`  Error: ${error.message}`);
    }
  }

  return this.results;
  }
}

module.exports = {
  TestClient,
  TestAssert,
  TestContext,
  TestResults,
  TestRunner,
  DEFAULT_TIMEOUT,
  DEFAULT_PORT
};
