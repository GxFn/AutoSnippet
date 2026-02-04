const { generateId } = require('./id');

class SnippetV2 {
  constructor(data = {}) {
    this.id = data.id || generateId('snippet');
    this.version = data.version || '1.0.0';
    this.trigger = data.trigger || '';
    this.completion = data.completion || '';
    this.body = this._normalizeBody(data.body);
    this.title = data.title || '';
    this.summary = data.summary || '';
    this.language = data.language || data.languageShort || '';
    this.category = data.category || '';
    this.tags = Array.isArray(data.tags) ? data.tags : [];
    this.relatedSnippets = Array.isArray(data.relatedSnippets) ? data.relatedSnippets : [];
    this.author = data.author || '';
    this.createdAt = data.createdAt || Date.now();
    this.modifiedAt = data.modifiedAt || Date.now();
    this.usageCount = data.usageCount || 0;
    this.userRating = data.userRating || 0;
    this.frameworks = Array.isArray(data.frameworks) ? data.frameworks : [];
    this.minSDK = data.minSDK;
    this.metadata = data.metadata || {};
    this.status = data.status || 'active';
  }

  isValid() {
    return !!(this.id && this.title && this.trigger && this.body.length > 0);
  }

  validate() {
    if (!this.id) return 'Snippet id is required';
    if (!this.title) return 'Snippet title is required';
    if (!this.trigger) return 'Snippet trigger is required';
    if (!this.body || this.body.length === 0) return 'Snippet body is required';

    return null;
  }

  update(updates = {}) {
    Object.assign(this, updates);
    if (updates.body !== undefined) {
      this.body = this._normalizeBody(updates.body);
    }
    this.modifiedAt = Date.now();
    return this;
  }

  addTag(tag) {
    if (tag && !this.tags.includes(tag)) {
      this.tags.push(tag);
      this.modifiedAt = Date.now();
    }
    return this;
  }

  addRelatedSnippet(snippetId) {
    if (snippetId && !this.relatedSnippets.includes(snippetId)) {
      this.relatedSnippets.push(snippetId);
      this.modifiedAt = Date.now();
    }
    return this;
  }

  recordUsage(count = 1) {
    this.usageCount += Math.max(0, count);
    this.modifiedAt = Date.now();
    return this;
  }

  setRating(rating) {
    const normalized = Math.max(0, Math.min(5, Number(rating)));
    this.userRating = Number.isNaN(normalized) ? this.userRating : normalized;
    this.modifiedAt = Date.now();
    return this;
  }

  toJSON() {
    return {
      id: this.id,
      version: this.version,
      trigger: this.trigger,
      completion: this.completion,
      body: this.body,
      title: this.title,
      summary: this.summary,
      language: this.language,
      category: this.category,
      tags: this.tags,
      relatedSnippets: this.relatedSnippets,
      author: this.author,
      createdAt: this.createdAt,
      modifiedAt: this.modifiedAt,
      usageCount: this.usageCount,
      userRating: this.userRating,
      frameworks: this.frameworks,
      minSDK: this.minSDK,
      metadata: this.metadata,
      status: this.status
    };
  }

  static fromJSON(json) {
    return new SnippetV2(json);
  }

  clone() {
    return new SnippetV2(this.toJSON());
  }

  _normalizeBody(body) {
    if (Array.isArray(body)) return body;
    if (typeof body === 'string') return body.split('\n');
    return [];
  }
}

module.exports = SnippetV2;
