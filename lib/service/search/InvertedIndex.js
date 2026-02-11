/**
 * InvertedIndex — 倒排索引
 * 构建和查询 token → docIndex 映射
 */

/**
 * Unicode-aware 分词（含 camelCase 拆分 + 最小长度过滤）
 * 与 SearchEngine.tokenize 保持一致的拆分策略
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  // 拆分 camelCase/PascalCase（与 SearchEngine.tokenize 一致）
  const expanded = text.replace(/([a-z])([A-Z])/g, '$1 $2');
  const tokens = expanded
    .toLowerCase()
    .match(/[\p{L}\p{N}_]+/gu) || [];
  // 过滤过短 token（≥2 字符），减少噪声
  return tokens.filter(t => t.length >= 2);
}

/**
 * 构建倒排索引
 * @param {Array<{ id: string, content: string }>} documents
 * @returns {Map<string, Set<number>>}
 */
export function buildInvertedIndex(documents) {
  const index = new Map();

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    const text = [doc.title, doc.trigger, doc.content, doc.code, doc.description].filter(Boolean).join(' ');
    const tokens = tokenize(text);

    for (const token of tokens) {
      if (!index.has(token)) index.set(token, new Set());
      index.get(token).add(i);
    }
  }

  return index;
}

/**
 * 查询倒排索引（OR 语义 — 匹配任一 token）
 * @param {Map<string, Set<number>>} invertedIndex
 * @param {string} query
 * @returns {number[]} — document indices
 */
export function lookup(invertedIndex, query) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const resultSet = new Set();
  for (const token of queryTokens) {
    const docs = invertedIndex.get(token);
    if (docs) {
      for (const docIdx of docs) resultSet.add(docIdx);
    }
  }

  return [...resultSet];
}

/**
 * 查询倒排索引（AND 语义 — 匹配所有 token）
 * @param {Map<string, Set<number>>} invertedIndex
 * @param {string} query
 * @returns {number[]}
 */
export function lookupAll(invertedIndex, query) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  let result = null;
  for (const token of queryTokens) {
    const docs = invertedIndex.get(token);
    if (!docs) return [];
    if (result === null) {
      result = new Set(docs);
    } else {
      for (const idx of result) {
        if (!docs.has(idx)) result.delete(idx);
      }
    }
  }

  return result ? [...result] : [];
}
