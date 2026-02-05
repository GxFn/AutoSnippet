/**
 * 候选去重与聚合（轻量版）
 * - 基于 title/trigger/language 进行去重
 * - 合并缺失字段与数组
 */

function normalize(text) {
  return String(text || '').trim().toLowerCase();
}

function mergeArray(target, source) {
  const result = Array.isArray(target) ? [...target] : [];
  const incoming = Array.isArray(source) ? source : [];
  for (const item of incoming) {
  if (!result.includes(item)) result.push(item);
  }
  return result.length > 0 ? result : undefined;
}

function mergeObject(target, source) {
  const a = target && typeof target === 'object' ? target : {};
  const b = source && typeof source === 'object' ? source : {};
  return Object.keys({ ...a, ...b }).length > 0 ? { ...a, ...b } : undefined;
}

function buildKey(candidate) {
  const title = normalize(candidate.title);
  const trigger = normalize(candidate.trigger);
  const language = normalize(candidate.language);
  return `${title}|${trigger}|${language}`;
}

function aggregateCandidates(items = []) {
  const map = new Map();
  let deduplicated = 0;

  for (const item of items) {
  if (!item || typeof item !== 'object') continue;
  const key = buildKey(item);
  if (!key) continue;
  if (!map.has(key)) {
    map.set(key, { ...item });
    continue;
  }

  const existing = map.get(key);
  // 优先保留已有字段，补齐缺失字段
  const merged = {
    ...existing,
    summary: existing.summary || item.summary,
    summary_cn: existing.summary_cn || item.summary_cn,
    summary_en: existing.summary_en || item.summary_en,
    usageGuide: existing.usageGuide || item.usageGuide,
    usageGuide_cn: existing.usageGuide_cn || item.usageGuide_cn,
    usageGuide_en: existing.usageGuide_en || item.usageGuide_en,
    category: existing.category || item.category,
    code: existing.code || item.code,
    headers: mergeArray(existing.headers, item.headers),
    keywords: mergeArray(existing.keywords, item.keywords),
    tags: mergeArray(existing.tags, item.tags),
    metadata: mergeObject(existing.metadata, item.metadata),
    quality: mergeObject(existing.quality, item.quality),
    relatedRecipes: mergeArray(existing.relatedRecipes, item.relatedRecipes)
  };

  map.set(key, merged);
  deduplicated += 1;
  }

  return {
  items: Array.from(map.values()),
  stats: {
    input: items.length,
    deduplicated
  }
  };
}

module.exports = { aggregateCandidates };
