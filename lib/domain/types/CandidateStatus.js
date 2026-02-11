/**
 * CandidateStatus - Candidate 状态枚举
 */
export const CandidateStatus = {
  // 待处理：刚创建的 Candidate
  PENDING: 'pending',
  // 已批准：经过审批的 Candidate
  APPROVED: 'approved',
  // 已拒绝：被拒绝的 Candidate
  REJECTED: 'rejected',
  // 已应用：已被应用到 Recipe 中
  APPLIED: 'applied',
};

export const CandidateStatusDescription = {
  pending: '待处理',
  approved: '已批准',
  rejected: '已拒绝',
  applied: '已应用',
};

/**
 * 检查是否为有效的状态
 */
export function isValidCandidateStatus(status) {
  return Object.values(CandidateStatus).includes(status);
}

/**
 * 检查状态转移是否合法
 * @param {string} fromStatus 当前状态
 * @param {string} toStatus 目标状态
 * @returns {boolean}
 */
export function isValidStateTransition(fromStatus, toStatus) {
  const validTransitions = {
    [CandidateStatus.PENDING]: [
      CandidateStatus.APPROVED,
      CandidateStatus.REJECTED,
    ],
    [CandidateStatus.APPROVED]: [
      CandidateStatus.APPLIED,
      CandidateStatus.REJECTED,
    ],
    [CandidateStatus.REJECTED]: [],
    [CandidateStatus.APPLIED]: [],
  };

  return validTransitions[fromStatus]?.includes(toStatus) || false;
}

export default CandidateStatus;
