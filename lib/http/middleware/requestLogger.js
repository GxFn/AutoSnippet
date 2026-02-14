/**
 * 请求日志中间件
 * 使用 res.on('finish') 替代猴子补丁 res.send
 *
 * 精简策略:
 *   - GET 请求 + 2xx 状态码: 降为 debug（Dashboard 轮询高频噪音）
 *   - 非 GET / 非 2xx / 慢请求(>2s): 保留 info 级别
 */

// 轮询/心跳路径 — 完全静默
const SILENT_PATHS = ['/api/health', '/api/realtime/events', '/api/sse'];

export function requestLogger(logger) {
  return (req, res, next) => {
    const startTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startTime;

      // 完全静默的路径
      if (SILENT_PATHS.some(p => req.path.startsWith(p))) return;

      const logData = {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
      };

      // 非 GET / 非 2xx / 慢请求 → info; 其余 → debug
      const isNoisy = req.method === 'GET' && res.statusCode >= 200 && res.statusCode < 300 && duration < 2000;
      const isSlow = duration >= 1000;
      if (isSlow) {
        logger.warn(`🐌慢请求： ${req.method} ${req.path} - ${duration}ms`, logData);
      } else if (isNoisy) {
        logger.debug('HTTP', logData);
      } else {
        logger.info('HTTP', logData);
      }
    });

    next();
  };
}
