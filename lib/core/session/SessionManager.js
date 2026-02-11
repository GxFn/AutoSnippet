import { v4 as uuidv4 } from 'uuid';
import Logger from '../../infrastructure/logging/Logger.js';

/**
 * SessionManager - 会话管理器
 * 管理不同作用域的会话（project, target, file, developer）
 */
export class SessionManager {
  static MAX_CACHED_SESSIONS = 500;

  constructor(db) {
    this.db = db.getDb();
    this.logger = Logger.getInstance();
    this.activeSessions = new Map();
  }

  /**
   * 创建会话
   */
  create(options) {
    const sessionId = uuidv4();
    const {
      scope,
      scopeId,
      context = {},
      metadata = {},
      actor = 'unknown',
    } = options;

    const now = Math.floor(Date.now() / 1000); // UNIX timestamp
    const expiresAt = now + this._getExpirationSeconds(scope);

    const session = {
      id: sessionId,
      scope, // 'project' | 'target' | 'file' | 'developer'
      scope_id: scopeId,
      context: JSON.stringify(context),
      metadata: JSON.stringify(metadata),
      actor,
      created_at: now,
      last_active_at: now,
      expired_at: expiresAt,
    };

    // 保存到数据库
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, scope, scope_id, context, metadata, actor, created_at, last_active_at, expired_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      session.scope,
      session.scope_id,
      session.context,
      session.metadata,
      session.actor,
      session.created_at,
      session.last_active_at,
      session.expired_at
    );

    // 加入内存缓存（带上限保护）
    if (this.activeSessions.size >= SessionManager.MAX_CACHED_SESSIONS) {
      // 淘汰最老的会话缓存
      const oldest = this.activeSessions.keys().next().value;
      this.activeSessions.delete(oldest);
    }
    this.activeSessions.set(sessionId, session);

    this.logger.info('Session created', {
      sessionId,
      scope,
      scopeId,
    });

    return session;
  }

  /**
   * 获取会话
   */
  get(sessionId) {
    // 先从缓存获取
    if (this.activeSessions.has(sessionId)) {
      const session = this.activeSessions.get(sessionId);
      if (!this.isExpired(session)) {
        return session;
      } else {
        this.activeSessions.delete(sessionId);
      }
    }

    // 从数据库获取
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const session = stmt.get(sessionId);

    if (session && !this.isExpired(session)) {
      this.activeSessions.set(sessionId, session);
      return session;
    }

    return null;
  }

  /**
   * 根据作用域查询会话
   */
  findByScope(scope, scopeId) {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions
      WHERE scope = ? AND scope_id = ?
      AND expired_at > ?
      ORDER BY created_at DESC
      LIMIT 1
    `);
    return stmt.get(scope, scopeId, Math.floor(Date.now() / 1000));
  }

  /**
   * 更新会话元数据
   */
  updateMetadata(sessionId, metadata) {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET metadata = ?, last_active_at = ?
      WHERE id = ?
    `);

    stmt.run(
      JSON.stringify(metadata),
      now,
      sessionId
    );

    // 更新缓存
    if (this.activeSessions.has(sessionId)) {
      const session = this.activeSessions.get(sessionId);
      session.metadata = JSON.stringify(metadata);
      session.last_active_at = now;
    }

    this.logger.debug('Session metadata updated', { sessionId });
  }

  /**
   * 关闭会话
   */
  close(sessionId) {
    // 直接从数据库删除（更彻底）
    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    stmt.run(sessionId);

    // 从缓存移除
    this.activeSessions.delete(sessionId);

    this.logger.info('Session closed', { sessionId });
  }

  /**
   * 清理过期会话
   */
  cleanupExpired() {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare('DELETE FROM sessions WHERE expired_at < ?');
    const result = stmt.run(now);

    if (result.changes > 0) {
      this.logger.info(`Cleaned up ${result.changes} expired sessions`);
    }

    // 清理缓存中的过期会话
    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (this.isExpired(session)) {
        this.activeSessions.delete(sessionId);
      }
    }
  }

  /**
   * 判断会话是否过期
   */
  isExpired(session) {
    const now = Math.floor(Date.now() / 1000);
    return session.expired_at < now;
  }

  /**
   * 获取作用域的过期秒数
   */
  _getExpirationSeconds(scope) {
    switch (scope) {
      case 'project':
        return 7 * 24 * 60 * 60; // 7 天
      case 'target':
        return 24 * 60 * 60; // 1 天
      case 'file':
        return 60 * 60; // 1 小时
      case 'developer':
        return 30 * 24 * 60 * 60; // 30 天
      default:
        return 24 * 60 * 60; // 默认 1 天
    }
  }

  /**
   * 获取活跃会话数
   */
  getActiveCount() {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM sessions WHERE expired_at > ?');
    const result = stmt.get(now);
    return result.count;
  }

  /**
   * 获取所有活跃会话
   */
  getActiveSessions(limit = 100) {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      SELECT * FROM sessions
      WHERE expired_at > ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(now, limit);
  }
}

export default SessionManager;
