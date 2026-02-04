function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function buildTermFrequency(tokens) {
  const tf = new Map();
  tokens.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
  return tf;
}

function computeBM25(query, documents, options = {}) {
  const k1 = options.k1 ?? 1.2;
  const b = options.b ?? 0.75;
  const queryTokens = tokenize(query);

  if (queryTokens.length === 0 || documents.length === 0) {
    return documents.map(() => 0);
  }

  const docTokens = documents.map((doc) => tokenize(doc));
  const docLengths = docTokens.map((tokens) => tokens.length);
  const avgDocLength = docLengths.reduce((a, bLen) => a + bLen, 0) / docLengths.length;

  const docFreq = new Map();
  for (const tokens of docTokens) {
    const seen = new Set(tokens);
    for (const token of seen) {
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }
  }

  const scores = [];
  for (let i = 0; i < documents.length; i++) {
    const tokens = docTokens[i];
    const tf = buildTermFrequency(tokens);
    const dl = docLengths[i] || 0;
    let score = 0;

    for (const term of queryTokens) {
      const df = docFreq.get(term) || 0;
      if (df === 0) continue;
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      const freq = tf.get(term) || 0;
      const denom = freq + k1 * (1 - b + b * (dl / (avgDocLength || 1)));
      score += idf * ((freq * (k1 + 1)) / (denom || 1));
    }

    scores.push(score);
  }

  return scores;
}

module.exports = {
  tokenize,
  computeBM25
};
