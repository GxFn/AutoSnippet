import { v4 as uuidv4 } from 'uuid';
import { CandidateStatus, isValidStateTransition } from '../types/CandidateStatus.js';
import Reasoning from './Reasoning.js';
import Logger from '../../infrastructure/logging/Logger.js';

/**
 * Candidate - 代码片段候选实体
 * 代表一个待审批的代码片段
 */
export class Candidate {
  constructor(props) {
    this.id = props.id || uuidv4();
    this.code = props.code;
    this.language = props.language; // javascript, python, swift, etc
    this.category = props.category; // 分类：pattern, utility, hook, etc
    this.source = props.source; // AI, user, imported, etc
    
    // Reasoning 对象 — 所有提交路径必须提供推理依据
    this.reasoning = props.reasoning instanceof Reasoning
      ? props.reasoning
      : new Reasoning(props.reasoning || {});
    
    // 状态管理
    this.status = props.status || CandidateStatus.PENDING;
    this.statusHistory = props.statusHistory || [];
    
    // 元数据
    this.createdBy = props.createdBy || 'unknown';
    this.createdAt = props.createdAt || Math.floor(Date.now() / 1000);
    this.updatedAt = props.updatedAt || Math.floor(Date.now() / 1000);
    this.approvedAt = props.approvedAt;
    this.approvedBy = props.approvedBy;
    
    // 额外信息
    this.rejectionReason = props.rejectionReason;
    this.rejectedBy = props.rejectedBy;
    this.appliedRecipeId = props.appliedRecipeId; // 应用到的 Recipe
    this.metadata = props.metadata || {};          // 附加元数据
    
    this.logger = Logger.getInstance();
  }

  /**
   * 验证 Candidate 的完整性
   */
  isValid() {
    return (
      this.code &&
      this.code.trim().length > 0 &&
      this.language &&
      this.language.trim().length > 0 &&
      this.reasoning.isValid() &&
      this.createdBy
    );
  }

  /**
   * 验证代码内容（格式等）
   */
  validateCodeContent() {
    if (!this.code || this.code.trim().length === 0) {
      return { valid: false, error: 'Code cannot be empty' };
    }
    
    if (this.code.length > 50000) {
      return { valid: false, error: 'Code is too long (max 50000 chars)' };
    }
    
    return { valid: true };
  }

  /**
   * 批准 Candidate
   */
  approve(approver) {
    if (!isValidStateTransition(this.status, CandidateStatus.APPROVED)) {
      return {
        success: false,
        error: `Cannot approve a Candidate in ${this.status} status`,
      };
    }

    this._changeStatus(CandidateStatus.APPROVED);
    this.approvedAt = Math.floor(Date.now() / 1000);
    this.approvedBy = approver;

    this.logger.info('Candidate approved', {
      candidateId: this.id,
      approver,
    });

    return { success: true, candidate: this };
  }

  /**
   * 拒绝 Candidate
   */
  reject(reason, rejectedBy = 'system') {
    if (!isValidStateTransition(this.status, CandidateStatus.REJECTED)) {
      return {
        success: false,
        error: `Cannot reject a Candidate in ${this.status} status`,
      };
    }

    this._changeStatus(CandidateStatus.REJECTED);
    this.rejectionReason = reason;
    this.rejectedBy = rejectedBy;
    this.updatedAt = Math.floor(Date.now() / 1000);

    this.logger.info('Candidate rejected', {
      candidateId: this.id,
      rejectedBy,
      reason,
    });

    return { success: true, candidate: this };
  }

  /**
   * 应用到 Recipe
   */
  applyToRecipe(recipeId) {
    if (!isValidStateTransition(this.status, CandidateStatus.APPLIED)) {
      return {
        success: false,
        error: `Cannot apply a Candidate in ${this.status} status`,
      };
    }

    this._changeStatus(CandidateStatus.APPLIED);
    this.appliedRecipeId = recipeId;
    this.updatedAt = Math.floor(Date.now() / 1000);

    this.logger.info('Candidate applied to recipe', {
      candidateId: this.id,
      recipeId,
    });

    return { success: true, candidate: this };
  }

  /**
   * 获取状态历史
   */
  getStatusHistory() {
    return this.statusHistory;
  }

  /**
   * 改变状态（内部方法）
   */
  _changeStatus(newStatus) {
    this.statusHistory.push({
      from: this.status,
      to: newStatus,
      changedAt: Math.floor(Date.now() / 1000),
    });
    this.status = newStatus;
    this.updatedAt = Math.floor(Date.now() / 1000);
  }

  /**
   * 转换为 JSON
   */
  toJSON() {
    return {
      id: this.id,
      code: this.code,
      language: this.language,
      category: this.category,
      source: this.source,
      reasoning: this.reasoning.toJSON(),
      status: this.status,
      statusHistory: this.statusHistory,
      createdBy: this.createdBy,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      approvedAt: this.approvedAt,
      approvedBy: this.approvedBy,
      rejectionReason: this.rejectionReason,
      rejectedBy: this.rejectedBy,
      appliedRecipeId: this.appliedRecipeId,
      metadata: this.metadata,
    };
  }

  /**
   * 从 JSON 创建 Candidate
   */
  static fromJSON(data) {
    return new Candidate(data);
  }
}

export default Candidate;
