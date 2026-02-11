/**
 * 请求日志中间件
 * 使用 res.on('finish') 替代猴子补丁 res.send
 */

export function requestLogger(logger) {
  return (req, res, next) => {
    const startTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startTime;

      logger.info('HTTP Request', {
        method: req.method,
        path: req.path,
        query: Object.keys(req.query).length > 0 ? req.query : undefined,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString(),
      });
    });

    next();
  };
}
