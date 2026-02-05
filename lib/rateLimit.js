/**
 * Recipe 保存频率控制：进程内固定窗口，按 projectRoot + 客户端标识限流，防止短时间内多次创建/保存。
 * 未配置时不启用（不限制）。
 */

const DEFAULT_LIMIT = 20;
const DEFAULT_WINDOW_SECONDS = 60;

/** key: projectRoot + '\0' + clientId, value: { count, windowStart } */
const store = new Map();

/**
 * 检查是否允许本次保存；若允许则计数 +1。
 * @param {string} projectRoot 项目根
 * @param {string} clientId 客户端标识（如 IP）
 * @param {{ limit?: number, windowSeconds?: number }} options 可选，未设则用环境变量或默认
 * @returns {{ allowed: boolean, remaining?: number, retryAfter?: number }}
 */
function checkRecipeSave(projectRoot, clientId, options = {}) {
  if (process.env.ASD_DISABLE_RATE_LIMIT === '1') return { allowed: true };
  const envLimitRaw = process.env.ASD_RECIPE_SAVE_RATE_LIMIT;
  const envWindowRaw = process.env.ASD_RECIPE_SAVE_RATE_WINDOW_SECONDS;
  const hasEnvConfig = envLimitRaw != null || envWindowRaw != null;
  if (options.limit == null && options.windowSeconds == null && !hasEnvConfig) {
  return { allowed: true };
  }
  const envLimit = Number(envLimitRaw);
  const envWindow = Number(envWindowRaw);
  const limit = options.limit ?? (Number.isFinite(envLimit) && envLimit > 0 ? envLimit : DEFAULT_LIMIT);
  const windowSec = options.windowSeconds ?? (Number.isFinite(envWindow) && envWindow > 0 ? envWindow : DEFAULT_WINDOW_SECONDS);
  if (limit <= 0 || windowSec <= 0) return { allowed: true };

  const key = projectRoot + '\0' + (clientId || 'unknown');
  const now = Date.now();
  const windowMs = windowSec * 1000;
  let entry = store.get(key);
  if (!entry || (now - entry.windowStart >= windowMs)) {
  entry = { count: 0, windowStart: now };
  store.set(key, entry);
  }
  if (entry.count >= limit) {
  const retryAfter = Math.ceil((entry.windowStart + windowMs - now) / 1000);
  return { allowed: false, remaining: 0, retryAfter };
  }
  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count };
}

module.exports = { checkRecipeSave };
