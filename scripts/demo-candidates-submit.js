#!/usr/bin/env node
/**
 * Demo: Submit candidates to Dashboard via HTTP API
 * - Avoids require() to bypass local package.json parsing issues
 * - Uses ASD_UI_URL or defaults to http://localhost:3000
 */
const http = require('http');
const https = require('https');

function getBaseUrl() {
  return process.env.ASD_UI_URL || 'http://localhost:3000';
}

function requestJson(method, pathname, body) {
  const base = getBaseUrl();
  const url = new URL(pathname, base);
  const client = url.protocol === 'https:' ? https : http;
  const payload = JSON.stringify(body || {});
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
  if (process.env.ASD_MCP_TOKEN && process.env.ASD_MCP_TOKEN.trim()) {
    headers['Authorization'] = `Bearer ${process.env.ASD_MCP_TOKEN.trim()}`;
  }
  const opts = { hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: url.pathname, method, headers };
  return new Promise((resolve, reject) => {
    const req = client.request(opts, (res) => {
      let data = '';
      res.on('data', (ch) => { data += ch; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ statusCode: res.statusCode, raw: data }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

(async () => {
  const items = [
    {
      title: 'Request with Retry',
      summary: '带重试的网络请求示例',
      summary_en: 'Network request example with retry logic',
      trigger: '@network_retry',
      language: 'swift',
      code: 'func requestWithRetry() { /* ... */ }',
      usageGuide: '在网络不稳定时采用指数退避进行重试；注意幂等性与超时设置。',
      usageGuide_en: 'Use exponential backoff on unstable networks; mind idempotency and timeouts.'
    },
    {
      title: 'WebView Load URL',
      summary: '使用 WebView 加载 URL 的标准方式',
      summary_en: 'Standard way to load a URL into WebView',
      trigger: '@webview_load_url',
      language: 'objectivec',
      code: '[webView loadRequest:[NSURLRequest requestWithURL:url]]; // ...',
      usageGuide: '在主线程发起加载；校验 URL 格式与空值；必要时添加缓存策略。',
      usageGuide_en: 'Initiate on main thread; validate URL and nulls; optional cache policy.'
    }
  ];

  const payload = {
    targetName: '_demo',
    items,
    source: 'demo-script',
    expiresInHours: 24
  };

  try {
    const res = await requestJson('POST', '/api/candidates/append', payload);
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.error('Submit failed:', e.message);
    process.exit(1);
  }
})();
