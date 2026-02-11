/**
 * CandidateAggregator — 候选去重与聚合
 * 对批量提交的候选进行标题相似度去重，合并重复项
 */

/**
 * 简易字符串相似度（Jaccard on words）
 */
function wordSimilarity(a, b) {
  if (!a || !b) return 0;
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 对候选数组去重聚合
 * @param {Array<object>} items - 候选数组
 * @param {object} [opts] - { titleThreshold: 0.8 }
 * @returns {{ items: Array<object>, removed: number }}
 */
export function aggregateCandidates(items, opts = {}) {
  if (!Array.isArray(items) || items.length === 0) return { items: [], removed: 0 };

  const threshold = opts.titleThreshold ?? 0.8;
  const unique = [];
  const seen = [];

  for (const item of items) {
    const title = item.title || '';
    let isDup = false;
    for (const existing of seen) {
      if (wordSimilarity(title, existing) >= threshold) {
        isDup = true;
        break;
      }
    }
    if (!isDup) {
      unique.push(item);
      seen.push(title);
    }
  }

  return { items: unique, removed: items.length - unique.length };
}

export default { aggregateCandidates };
