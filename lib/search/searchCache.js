class SearchCache {
  constructor(options = {}) {
  this.max = options.max || 200;
  this.ttlMs = options.ttlMs || 5 * 60 * 1000;
  this.store = new Map();
  }

  get(key) {
  const entry = this.store.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    this.store.delete(key);
    return null;
  }

  this.store.delete(key);
  this.store.set(key, entry);
  return entry.value;
  }

  set(key, value) {
  if (this.store.has(key)) {
    this.store.delete(key);
  }

  this.store.set(key, {
    value,
    expiresAt: Date.now() + this.ttlMs
  });

  if (this.store.size > this.max) {
    const oldestKey = this.store.keys().next().value;
    if (oldestKey) {
    this.store.delete(oldestKey);
    }
  }
  }

  clear() {
  this.store.clear();
  }
}

module.exports = SearchCache;
