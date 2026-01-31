#!/usr/bin/env node

/**
 * 上下文存储 - LanceDB 适配器（按需安装：npm install @lancedb/lancedb）
 * 存储路径: Knowledge/.autosnippet/context/index/lancedb/
 * 适用于较大规模上下文（万级），需显式安装依赖
 */

const path = require('path');
const paths = require('../../infra/paths');

const TABLE_NAME = 'context';

class LanceAdapter {
	constructor(projectRoot, options = {}) {
		this.projectRoot = projectRoot;
		this.options = options;
		this.tableName = options.tableName || TABLE_NAME;
		this.dbPath = path.join(paths.getContextIndexPath(projectRoot), 'lancedb');
		this._db = null;
		this._table = null;
	}

	async _getDb() {
		if (this._db) return this._db;
		try {
			const lancedb = require('@lancedb/lancedb');
			this._db = await lancedb.connect(this.dbPath);
			return this._db;
		} catch (e) {
			if (e.code === 'MODULE_NOT_FOUND') {
				throw new Error('LanceDB 未安装。请执行: npm install @lancedb/lancedb');
			}
			throw e;
		}
	}

	async _getTable() {
		if (this._table) return this._table;
		const db = await this._getDb();
		const names = await db.tableNames();
		if (names.includes(this.tableName)) {
			this._table = await db.openTable(this.tableName);
		}
		return this._table;
	}

	_toRow(item) {
		const { id, content, vector, metadata = {}, parentId } = item;
		const updatedAt = metadata.updatedAt ?? Date.now();
		return {
			id: String(id),
			content: content ?? '',
			vector: Array.isArray(vector) ? vector : [],
			type: metadata.type || 'recipe',
			sourcePath: metadata.sourcePath || '',
			metadata: JSON.stringify({ ...metadata, updatedAt }),
			parentId: parentId || '',
			updatedAt
		};
	}

	_fromRow(row) {
		if (!row) return null;
		let metadata = {};
		try {
			metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
		} catch (_) {}
		return {
			id: row.id,
			content: row.content || '',
			vector: row.vector || [],
			metadata,
			parentId: row.parentId || undefined
		};
	}

	async init() {
		await this._getDb();
	}

	async upsert(item) {
		const row = this._toRow(item);
		let table = await this._getTable();
		if (table) {
			try {
				await table.delete(`"id" = '${String(item.id).replace(/'/g, "''")}'`);
			} catch (_) {}
		} else {
			const db = await this._getDb();
			table = await db.createTable(this.tableName, [row]);
			this._table = table;
			return;
		}
		await table.add([row]);
	}

	async batchUpsert(items) {
		if (!items || items.length === 0) return;
		const rows = items.map(i => this._toRow(i));
		let table = await this._getTable();
		if (!table) {
			const db = await this._getDb();
			table = await db.createTable(this.tableName, rows);
			this._table = table;
			return;
		}
		for (const item of items) {
			try {
				await table.delete(`"id" = '${String(item.id).replace(/'/g, "''")}'`);
			} catch (_) {}
		}
		await table.add(rows);
	}

	async remove(id) {
		const table = await this._getTable();
		if (!table) return;
		const escaped = String(id).replace(/'/g, "''");
		try {
			await table.delete(`"id" = '${escaped}'`);
		} catch (_) {}
	}

	async getById(id) {
		const table = await this._getTable();
		if (!table) return null;
		const results = await table.query().where(`"id" = '${String(id).replace(/'/g, "''")}'`).limit(1).toArray();
		return results.length > 0 ? this._fromRow(results[0]) : null;
	}

	_buildWhere(filter) {
		if (!filter || typeof filter !== 'object') return '';
		const parts = [];
		if (filter.type) parts.push(`"type" = '${String(filter.type).replace(/'/g, "''")}'`);
		if (filter.sourcePath) parts.push(`"sourcePath" = '${String(filter.sourcePath).replace(/'/g, "''")}'`);
		return parts.length > 0 ? parts.join(' AND ') : '';
	}

	async searchVector(queryVector, options = {}) {
		const limit = options.limit ?? 5;
		const filter = options.filter;
		const keywords = options.keywords;
		const hasVector = queryVector && queryVector.length > 0;
		const hasKeywords = keywords && Array.isArray(keywords) && keywords.length > 0;

		let table = await this._getTable();
		if (!table) return [];

		const whereClause = this._buildWhere(filter);

		const applyKeywordFilter = (rows) => {
			if (!hasKeywords) return rows;
			const lower = keywords.map(k => String(k).toLowerCase()).filter(Boolean);
			return rows.filter(row => {
				const text = [
					row.content || '',
					(row.metadata && typeof row.metadata === 'string' ? row.metadata : '')
				].join(' ').toLowerCase();
				return lower.some(k => text.includes(k));
			});
		};

		if (hasVector) {
			const searchMethod = table.search || table.vectorSearch;
			if (!searchMethod) return [];
			let q = searchMethod.call(table, queryVector).limit(limit * 2);
			if (whereClause && q.where) q = q.where(whereClause);
			const rows = await (q.toArray ? q.toArray() : q.execute());
			let filtered = applyKeywordFilter(rows);
			return filtered.slice(0, limit).map(row => {
				const obj = this._fromRow(row);
				const dist = row._distance;
				obj.similarity = typeof dist === 'number' ? Math.max(0, 1 - Math.min(1, dist / 2)) : 1;
				return obj;
			});
		}

		let query = table.query();
		if (whereClause) query = query.where(whereClause);
		const rows = applyKeywordFilter(await query.toArray());
		return rows.slice(0, limit).map(row => {
			const obj = this._fromRow(row);
			obj.similarity = 1;
			return obj;
		});
	}

	async searchByFilter(filter = {}) {
		const table = await this._getTable();
		if (!table) return [];
		const whereClause = this._buildWhere(filter);
		const query = whereClause ? table.query().where(whereClause) : table.query();
		const rows = await query.toArray();
		return rows.map(r => this._fromRow(r));
	}

	async listIds() {
		const table = await this._getTable();
		if (!table) return [];
		const rows = await table.query().select(['id']).toArray();
		return rows.map(r => r.id);
	}

	async clear() {
		const db = await this._getDb();
		const names = await db.tableNames();
		if (names.includes(this.tableName)) {
			await db.dropTable(this.tableName);
		}
		this._table = null;
	}

	async getStats() {
		const table = await this._getTable();
		if (!table) return { count: 0 };
		const rows = await table.query().toArray();
		return { count: rows.length };
	}
}

module.exports = LanceAdapter;
