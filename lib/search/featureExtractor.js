class FeatureExtractor {
  extract(query, candidate, context = {}) {
    return {
      bm25: candidate.scores?.bm25 || 0,
      semantic: candidate.scores?.semantic || 0,
      queryLength: query ? query.split(/\s+/).length : 0,
      titleLength: candidate.title ? candidate.title.length : 0,
      contentLength: candidate.content ? candidate.content.length : 0,
      freshness: this._computeFreshness(candidate),
      popularity: candidate.usageCount ? Math.log(candidate.usageCount + 1) / 10 : 0,
      languageMatch: context.language && candidate.language ? Number(context.language === candidate.language) : 0,
      categoryMatch: context.category && candidate.category ? Number(context.category === candidate.category) : 0
    };
  }

  _computeFreshness(candidate) {
    const updatedAt = candidate.updatedAt || candidate.modifiedAt || candidate.createdAt;
    if (!updatedAt) return 0;
    const days = (Date.now() - updatedAt) / (1000 * 60 * 60 * 24);
    return Math.exp(-days / 30);
  }
}

module.exports = FeatureExtractor;
