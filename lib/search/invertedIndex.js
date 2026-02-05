const { tokenize } = require('./bm25');

function buildInvertedIndex(documents) {
  const inverted = {};
  documents.forEach((doc, idx) => {
  const tokens = tokenize(`${doc.title || ''} ${doc.content || ''}`);
  const unique = new Set(tokens);
  for (const token of unique) {
    if (!inverted[token]) inverted[token] = [];
    inverted[token].push(idx);
  }
  });

  return inverted;
}

function lookup(invertedIndex, query) {
  const tokens = tokenize(query);
  const docSet = new Set();

  tokens.forEach((token) => {
  const list = invertedIndex[token] || [];
  list.forEach((idx) => docSet.add(idx));
  });

  return Array.from(docSet);
}

module.exports = {
  buildInvertedIndex,
  lookup
};
