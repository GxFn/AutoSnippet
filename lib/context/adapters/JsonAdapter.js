#!/usr/bin/env node

/**
 * 上下文存储 - JSON 文件适配器
 * 存储路径: Knowledge/.autosnippet/context/index/vector_index.json
 * 格式: { version: '1.0', items: [{ id, vector, content, metadata, updatedAt }] }
 * 与现有 VectorStore 的 items 格式兼容，便于渐进迁移
 */

const fs = require('fs');
const path = require('path');
const paths = require('../../infra/paths');
const VectorMath = require('../../infra/vectorMath');
const persistence = require('../persistence');

const INDEX_FILENAME = 'vector_index.json';
const DATA_VERSION = '1.0';

class JsonAdapter {
	constructor(projectRoot, options = {}) {
		this.projectRoot = projectRoot;
		this.options = options;
		this.indexPath = path.join(paths.getContextIndexPath(projectRoot), INDEX_FILENAME);
		this.oldIndexPath = path.join(projectRoot, 'Knowledge', '.autosnippet', INDEX_FILENAME);
		this.data = this._load();
	}

	_load() {
		// 优先读新路径
		if (fs.existsSync(this.indexPath)) {
			try {
				return JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
			} catch (e) {
				console.warn('[JsonAdapter] 索引文件损坏，将重新创建');
			}
		}
		// 兼容：若旧路径存在且新路径不存在，一次性迁移
		if (fs.existsSync(this.oldIndexPath)) {
			try {
				const data = JSON.parse(fs.readFileSync(this.oldIndexPath, 'utf8'));
				if (data && data.items && Array.isArray(data.items)) {
					this._save(data);
					return data;
				}
			} catch (e) {
				console.warn('[JsonAdapter] 旧索引迁移失败:', e.message);
			}
		}
		return { version: DATA_VERSION, items: [] };
	}

	_save(data) {
		const dir = path.dirname(this.indexPath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		persistence.atomicWrite(this.indexPath, JSON.stringify(data, null, 2));
	}

	async init() {
		this.data = this._load();
	}

	async upsert(item) {
		const { id, content, vector, metadata = {}, parentId } = item;
		const updatedAt = metadata.updatedAt ?? Date.now();
		const entry = {
			id,
			content: content ?? '',
			vector: vector || [],
			metadata: { ...metadata, updatedAt },
			updatedAt,
			...(parentId !== undefined && { parentId })
		};
		const index = this.data.items.findIndex(i => i.id === id);
		if (index >= 0) {
			this.data.items[index] = entry;
		} else {
			this.data.items.push(entry);
		}
		this._save(this.data);
	}

	async batchUpsert(items) {
		if (!items || items.length === 0) return;
		for (const item of items) {
			const { id, content, vector, metadata = {}, parentId } = item;
			const updatedAt = metadata.updatedAt ?? Date.now();
			const entry = {
				id,
				content: content ?? '',
				vector: vector || [],
				metadata: { ...metadata, updatedAt },
				updatedAt,
				...(parentId !== undefined && { parentId })
			};
			const index = this.data.items.findIndex(i => i.id === id);
			if (index >= 0) {
				this.data.items[index] = entry;
			} else {
				this.data.items.push(entry);
			}
		}
		this._save(this.data);
	}

	async remove(id) {
		const prev = this.data.items.length;
		this.data.items = this.data.items.filter(item => item.id !== id);
		if (this.data.items.length !== prev) {
			this._save(this.data);
		}
	}

	async getById(id) {
		const item = this.data.items.find(i => i.id === id);
		if (!item) return null;
		return {
			id: item.id,
			content: item.content,
			vector: item.vector,
			metadata: item.metadata || {},
			parentId: item.parentId
		};
	}

	_applyFilter(items, filter) {
		if (!filter || typeof filter !== 'object') return items;
		let out = items;
		if (filter.type) {
			out = out.filter(i => (i.metadata && i.metadata.type) === filter.type);
		}
		if (filter.sourcePath) {
			out = out.filter(i => (i.metadata && i.metadata.sourcePath) === filter.sourcePath);
		}
		if (filter.category) {
			out = out.filter(i => (i.metadata && i.metadata.category) === filter.category);
		}
		if (filter.module) {
			out = out.filter(i => (i.metadata && i.metadata.module) === filter.module);
		}
		if (filter.language) {
			out = out.filter(i => (i.metadata && i.metadata.language) === filter.language);
		}
		if (filter.deprecated === false) {
			out = out.filter(i => !(i.metadata && i.metadata.deprecated));
		}
		if (filter.tags && Array.isArray(filter.tags)) {
			out = out.filter(i => {
				const itemTags = i.metadata && i.metadata.tags;
				if (!Array.isArray(itemTags)) return false;
				return filter.tags.some(t => itemTags.includes(t));
			});
		}
		return out;
	}

	_keywordMatch(items, keywords) {
		if (!keywords || !Array.isArray(keywords) || keywords.length === 0) return items;
		const lower = keywords.map(k => String(k).toLowerCase()).filter(Boolean);
		return items.filter(i => {
			const text = [
				i.content || '',
				...(i.metadata ? Object.values(i.metadata).filter(v => typeof v === 'string') : [])
			].join(' ').toLowerCase();
			return lower.some(k => text.includes(k));
		});
	}

	async searchVector(queryVector, options = {}) {
		const limit = options.limit ?? 5;
		const metric = options.metric || 'cosine';
		const filter = options.filter;
		const keywords = options.keywords;
		const hasVector = queryVector && queryVector.length > 0;
		const hasKeywords = keywords && Array.isArray(keywords) && keywords.length > 0;
		if (this.data.items.length === 0 || (!hasVector && !hasKeywords)) return [];

		let items = this.data.items;
		if (queryVector && queryVector.length > 0) {
			items = items.filter(i => i.vector && i.vector.length > 0);
		}
		items = this._applyFilter(items, filter);
		items = this._keywordMatch(items, keywords);

		if (items.length === 0) return [];

		if (hasVector) {
			const ranked = VectorMath.rank(queryVector, items, metric);
			return ranked.slice(0, limit).map(item => ({
				...item,
				similarity: item._score
			}));
		}
		return items.slice(0, limit).map(item => ({
			...item,
			similarity: 1
		}));
	}

	async searchByFilter(filter = {}) {
		return this._applyFilter(this.data.items, filter);
	}

	async listIds() {
		return this.data.items.map(i => i.id);
	}

	async clear() {
		this.data = { version: DATA_VERSION, items: [] };
		this._save(this.data);
	}

	getStats() {
		return {
			count: this.data.items.length,
			version: this.data.version
		};
	}
}

module.exports = JsonAdapter;
