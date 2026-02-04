const fs = require('fs');
const path = require('path');

class MigrationFramework {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.checkpointPath = options.checkpointPath || null;
    this.reportPath = options.reportPath || null;
  }

  async migrate({ items = [], migrator, batchSize = 100, onProgress } = {}) {
    if (!migrator || typeof migrator.migrateOne !== 'function') {
      throw new Error('Migrator with migrateOne() is required');
    }

    const total = items.length;
    const results = [];
    const errors = [];
    const startedAt = Date.now();

    let startIndex = 0;
    if (this.checkpointPath) {
      startIndex = this._loadCheckpoint() || 0;
    }

    for (let i = startIndex; i < total; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      for (const item of batch) {
        try {
          const migrated = await migrator.migrateOne(item);
          results.push(migrated);
        } catch (error) {
          errors.push({ item, error: error.message || String(error) });
        }
      }

      if (this.checkpointPath) {
        this._saveCheckpoint(i + batch.length);
      }

      if (onProgress) {
        onProgress({ processed: Math.min(i + batch.length, total), total });
      }
    }

    const report = this._buildReport({ total, results, errors, startedAt });
    if (this.reportPath) {
      this._writeReport(report);
    }

    return { results, errors, report };
  }

  validateRecords(records = []) {
    const errors = [];

    records.forEach((record, index) => {
      if (typeof record.validate === 'function') {
        const error = record.validate();
        if (error) {
          errors.push({ index, error, record: record.toJSON ? record.toJSON() : record });
        }
      }
    });

    return errors;
  }

  _buildReport({ total, results, errors, startedAt }) {
    const durationMs = Date.now() - startedAt;
    return {
      total,
      migrated: results.length,
      failed: errors.length,
      successRate: total === 0 ? '0.00%' : `${((results.length / total) * 100).toFixed(2)}%`,
      durationMs,
      timestamp: new Date().toISOString()
    };
  }

  _saveCheckpoint(index) {
    fs.mkdirSync(path.dirname(this.checkpointPath), { recursive: true });
    fs.writeFileSync(this.checkpointPath, JSON.stringify({ index }), 'utf8');
  }

  _loadCheckpoint() {
    if (!fs.existsSync(this.checkpointPath)) return 0;
    try {
      const data = JSON.parse(fs.readFileSync(this.checkpointPath, 'utf8'));
      return data.index || 0;
    } catch {
      return 0;
    }
  }

  _writeReport(report) {
    fs.mkdirSync(path.dirname(this.reportPath), { recursive: true });
    fs.writeFileSync(this.reportPath, JSON.stringify(report, null, 2), 'utf8');
  }
}

module.exports = MigrationFramework;
