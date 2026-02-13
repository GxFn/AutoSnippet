/**
 * Skills API 路由
 * 管理 Agent Skills 的查询、加载和创建（项目级）
 */

import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { listSkills, loadSkill, createSkill } from '../../external/mcp/handlers/skill.js';
import { ValidationError } from '../../shared/errors/index.js';

const router = express.Router();

/**
 * GET /api/v1/skills
 * 列出所有可用 Skills（内置 + 项目级）
 */
router.get('/', asyncHandler(async (_req, res) => {
  const raw = listSkills();
  const parsed = JSON.parse(raw);

  if (!parsed.success) {
    return res.status(500).json(parsed);
  }

  res.json({ success: true, data: parsed.data });
}));

/**
 * GET /api/v1/skills/:name
 * 加载指定 Skill 的完整文档
 * Query: ?section=xxx 可只返回指定章节
 */
router.get('/:name', asyncHandler(async (req, res) => {
  const { name } = req.params;
  const { section } = req.query;

  const raw = loadSkill(null, { skillName: name, section });
  const parsed = JSON.parse(raw);

  if (!parsed.success) {
    const status = parsed.error?.code === 'SKILL_NOT_FOUND' ? 404 : 400;
    return res.status(status).json(parsed);
  }

  res.json({ success: true, data: parsed.data });
}));

/**
 * POST /api/v1/skills
 * 创建项目级 Skill
 * Body: { name, description, content, overwrite? }
 */
router.post('/', asyncHandler(async (req, res) => {
  const { name, description, content, overwrite } = req.body;

  if (!name || !description || !content) {
    throw new ValidationError('name, description, content are all required');
  }

  const raw = createSkill(null, { name, description, content, overwrite });
  const parsed = JSON.parse(raw);

  if (!parsed.success) {
    const status = parsed.error?.code === 'BUILTIN_CONFLICT' ? 409
      : parsed.error?.code === 'ALREADY_EXISTS' ? 409
        : parsed.error?.code === 'INVALID_NAME' ? 400 : 500;
    return res.status(status).json(parsed);
  }

  res.status(201).json({ success: true, data: parsed.data });
}));

export default router;
