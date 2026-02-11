import { BaseRepository } from '../base/BaseRepository.js';
import { Candidate, Reasoning, CandidateStatus } from '../../domain/index.js';
import Logger from '../../infrastructure/logging/Logger.js';

/**
 * CandidateRepository 实现
 * 面向 SQLite 数据库的 Candidate 实体持久化
 */
export class CandidateRepositoryImpl extends BaseRepository {
  constructor(database) {
    super(database, 'candidates');
    this.logger = Logger.getInstance();
  }

  /**
   * 创建 Candidate
   */
  async create(candidate) {
    if (!candidate || !candidate.isValid()) {
      throw new Error('Invalid candidate entity');
    }

    try {
      const row = this._mapEntityToRow(candidate);
      const keys = Object.keys(row);
      const placeholders = keys.map(() => '?').join(', ');
      const query = `
        INSERT INTO candidates (${keys.join(', ')})
        VALUES (${placeholders})
      `;

      const stmt = this.db.prepare(query);
      stmt.run(...Object.values(row));

      return this.findById(candidate.id);
    } catch (error) {
      this.logger.error('Error creating candidate', {
        candidateId: candidate.id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 根据状态查询
   */
  async findByStatus(status, { page = 1, pageSize = 20 } = {}) {
    if (!Object.values(CandidateStatus).includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    try {
      return this.findWithPagination({ status }, { page, pageSize });
    } catch (error) {
      this.logger.error('Error finding by status', {
        status,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 根据编程语言查询
   */
  async findByLanguage(language, { page = 1, pageSize = 20 } = {}) {
    try {
      return this.findWithPagination({ language }, { page, pageSize });
    } catch (error) {
      this.logger.error('Error finding by language', {
        language,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 根据创建者查询
   */
  async findByCreatedBy(createdBy, { page = 1, pageSize = 20 } = {}) {
    try {
      return this.findWithPagination({ created_by: createdBy }, { page, pageSize });
    } catch (error) {
      this.logger.error('Error finding by creator', {
        createdBy,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 搜索候选项（按代码或类别）
   */
  async search(keyword, { page = 1, pageSize = 20 } = {}) {
    try {
      const offset = (page - 1) * pageSize;
      const escaped = keyword.replace(/[%_]/g, '\\$&');
      const like = `%${escaped}%`;

      // 搜索 code / category / metadata_json（title, description, summary）
      const whereClause = `
        WHERE code LIKE @kw ESCAPE '\\'
           OR category LIKE @kw ESCAPE '\\'
           OR metadata_json LIKE @kw ESCAPE '\\'
      `;

      // 获取总数
      const countStmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM candidates ${whereClause}
      `);
      const countResult = countStmt.get({ kw: like });
      const total = countResult.count;

      // 获取分页数据
      const stmt = this.db.prepare(`
        SELECT * FROM candidates ${whereClause}
        ORDER BY created_at DESC
        LIMIT @limit OFFSET @offset
      `);
      const data = stmt.all({ kw: like, limit: pageSize, offset });

      return {
        data: data.map((row) => this._mapRowToEntity(row)),
        pagination: {
          page,
          pageSize,
          total,
          pages: Math.ceil(total / pageSize),
        },
      };
    } catch (error) {
      this.logger.error('Error searching candidates', {
        keyword,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 获取统计信息
   */
  async getStats() {
    try {
      const stmt = this.db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
          SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) as applied
        FROM candidates
      `);
      return stmt.get();
    } catch (error) {
      this.logger.error('Error getting candidate stats', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 映射 SQLite 行到 Candidate 实体
   */
  _mapRowToEntity(row) {
    if (!row) return null;

    const reasoning = row.reasoning_json
      ? Reasoning.fromJSON(this._safeJsonParse(row.reasoning_json, {}))
      : null;

    return new Candidate({
      id: row.id,
      code: row.code,
      language: row.language,
      category: row.category,
      source: row.source,
      reasoning,
      status: row.status,
      statusHistory: this._safeJsonParse(row.status_history_json, []),
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      rejectionReason: row.rejection_reason,
      rejectedBy: row.rejected_by,
      appliedRecipeId: row.applied_recipe_id,
      metadata: this._safeJsonParse(row.metadata_json, {}),
    });
  }

  _safeJsonParse(str, fallback) {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch { return fallback; }
  }

  /**
   * 映射 Candidate 实体到 SQLite 行
   */
  _mapEntityToRow(entity) {
    const now = Math.floor(Date.now() / 1000);

    return {
      id: entity.id,
      code: entity.code,
      language: entity.language,
      category: entity.category,
      source: entity.source,
      reasoning_json: entity.reasoning ? JSON.stringify(entity.reasoning.toJSON()) : null,
      status: entity.status,
      status_history_json: JSON.stringify(entity.statusHistory),
      created_by: entity.createdBy,
      created_at: entity.createdAt || now,
      updated_at: entity.updatedAt || now,
      approved_by: entity.approvedBy,
      approved_at: entity.approvedAt,
      rejection_reason: entity.rejectionReason,
      rejected_by: entity.rejectedBy,
      applied_recipe_id: entity.appliedRecipeId,
      metadata_json: JSON.stringify(entity.metadata || {}),
    };
  }
}

export default CandidateRepositoryImpl;
