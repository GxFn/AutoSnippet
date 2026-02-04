const { computeBM25 } = require('./bm25');
const { buildInvertedIndex, lookup } = require('./invertedIndex');
const { saveIndex, loadIndex } = require('./indexStore');

// 延迟加载 SearchServiceV2 以避免循环依赖
let SearchServiceV2;

async function buildSearchIndex(projectRoot) {
  // 延迟加载
  if (!SearchServiceV2) {
    SearchServiceV2 = require('./SearchServiceV2');
  }
  
  const service = new SearchServiceV2(projectRoot);
  const results = await service.keywordSearch('');
  const documents = results.map((item) => ({
    id: item.name || item.title,
    title: item.title || '',
    content: item.content || '',
    code: item.code || '',
    type: item.type,
    trigger: item.trigger
  }));

  const invertedIndex = buildInvertedIndex(documents);
  const payload = {
    documents,
    invertedIndex,
    createdAt: Date.now()
  };

  saveIndex(projectRoot, payload);
  return payload;
}

function searchIndex(projectRoot, query, options = {}) {
  const { limit = 100 } = options;
  const index = loadIndex(projectRoot);
  if (!index) return [];

  const docIds = lookup(index.invertedIndex || {}, query);
  if (docIds.length === 0) return [];

  const docs = docIds.map((id) => index.documents[id]).filter(Boolean);
  const scores = computeBM25(query, docs.map((d) => `${d.title}\n${d.content}`));

  return docs
    .map((doc, idx) => ({
      ...doc,
      scores: { bm25: scores[idx] || 0, semantic: 0 }
    }))
    .sort((a, b) => (b.scores?.bm25 || 0) - (a.scores?.bm25 || 0))
    .slice(0, limit);
}

module.exports = {
  buildSearchIndex,
  searchIndex
};
