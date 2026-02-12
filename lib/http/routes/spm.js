/**
 * SPM API 路由
 * SPM Target 管理、依赖关系图、文件扫描
 */

import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getServiceContainer } from '../../injection/ServiceContainer.js';
import { ValidationError } from '../../shared/errors/index.js';
import Logger from '../../infrastructure/logging/Logger.js';

const router = express.Router();
const logger = Logger.getInstance();

/**
 * GET /api/v1/spm/targets
 * 获取所有 SPM Target 列表
 */
router.get('/targets', asyncHandler(async (req, res) => {
  const container = getServiceContainer();
  const spmService = container.get('spmService');

  const targets = await spmService.listTargets();

  res.json({
    success: true,
    data: {
      targets,
      total: targets.length,
    },
  });
}));

/**
 * GET /api/v1/spm/dep-graph
 * 获取 SPM 依赖关系图
 */
router.get('/dep-graph', asyncHandler(async (req, res) => {
  const container = getServiceContainer();
  const spmService = container.get('spmService');

  const level = req.query.level || 'package'; // 'package' | 'target'
  const graph = await spmService.getDependencyGraph({ level });

  if (!graph || (!graph.nodes && !graph.packages)) {
    return res.json({
      success: true,
      data: { nodes: [], edges: [], projectRoot: null },
    });
  }

  // 标准化为 { nodes, edges } 格式
  let nodes = [];
  let edges = [];

  if (graph.nodes && graph.edges) {
    // 已经是标准格式
    nodes = graph.nodes;
    edges = graph.edges;
  } else if (graph.packages) {
    // 从 packages 构建图
    if (level === 'target') {
      for (const [pkgName, pkgInfo] of Object.entries(graph.packages)) {
        const targetsInfo = pkgInfo?.targetsInfo || {};
        for (const [targetName, info] of Object.entries(targetsInfo)) {
          const id = `${pkgName}::${targetName}`;
          nodes.push({
            id,
            label: targetName,
            type: 'target',
            packageName: pkgName,
          });
          for (const d of (info?.dependencies || [])) {
            if (!d?.name) continue;
            const depPkg = d?.package || pkgName;
            edges.push({ from: id, to: `${depPkg}::${d.name}`, source: 'base' });
          }
        }
      }
    } else {
      nodes = Object.keys(graph.packages).map(id => ({
        id,
        label: id,
        type: 'package',
        packageDir: graph.packages[id]?.packageDir,
        targets: graph.packages[id]?.targets,
      }));
      for (const [from, tos] of Object.entries(graph.edges || {})) {
        for (const to of (tos || [])) {
          edges.push({ from, to, source: 'base' });
        }
      }
    }
  }

  res.json({
    success: true,
    data: {
      nodes,
      edges,
      projectRoot: graph.projectRoot || null,
      generatedAt: graph.generatedAt || null,
    },
  });
}));

/**
 * POST /api/v1/spm/target-files
 * 获取 Target 的文件列表
 */
router.post('/target-files', asyncHandler(async (req, res) => {
  const { target, targetName } = req.body;

  if (!target && !targetName) {
    throw new ValidationError('target object or targetName is required');
  }

  const container = getServiceContainer();
  const spmService = container.get('spmService');

  let resolvedTarget = target;
  if (!resolvedTarget && targetName) {
    const targets = await spmService.listTargets();
    resolvedTarget = targets.find(t => t.name === targetName);
    if (!resolvedTarget) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Target not found: ${targetName}` },
      });
    }
  }

  const files = await spmService.getTargetFiles(resolvedTarget);

  res.json({
    success: true,
    data: {
      target: resolvedTarget.name || targetName,
      files,
      total: files.length,
    },
  });
}));

/**
 * POST /api/v1/spm/scan
 * AI 扫描 Target，发现候选项
 */
router.post('/scan', asyncHandler(async (req, res) => {
  const { target, targetName, options = {} } = req.body;

  if (!target && !targetName) {
    throw new ValidationError('target object or targetName is required');
  }

  const container = getServiceContainer();
  const spmService = container.get('spmService');

  let resolvedTarget = target;
  if (!resolvedTarget && targetName) {
    const targets = await spmService.listTargets();
    resolvedTarget = targets.find(t => t.name === targetName);
    if (!resolvedTarget) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Target not found: ${targetName}` },
      });
    }
  }

  logger.info('SPM scan started via dashboard', { target: resolvedTarget.name });
  const result = await spmService.scanTarget(resolvedTarget, options);

  res.json({
    success: true,
    data: result,
  });
}));

/**
 * POST /api/v1/spm/scan-project
 * 全项目扫描：AI 提取候选 + Guard 审计
 */
router.post('/scan-project', asyncHandler(async (req, res) => {
  const { options = {} } = req.body;

  const container = getServiceContainer();
  const spmService = container.get('spmService');

  logger.info('Full project scan started via dashboard');
  const result = await spmService.scanProject(options);

  res.json({
    success: true,
    data: result,
  });
}));

/**
 * POST /api/v1/spm/bootstrap
 * 冷启动：结构收集 + 9 维度 Candidate 创建
 *
 * 分离式执行策略（避免前端超时）：
 *   ① 同步阶段: bootstrap_knowledge（SPM 扫描 + AST + Skill 增强 + 候选创建）→ 立即返回
 *   ② 异步阶段: enrich + refine（AI 结构补齐 + 内容润色）→ 后台执行
 *
 * 前端立即获得候选列表，AI 增强在后台完成后候选会自动更新。
 */
router.post('/bootstrap', asyncHandler(async (req, res) => {
  const { maxFiles, skipGuard, contentMaxLines, autoRefine } = req.body || {};

  const container = getServiceContainer();
  const chatAgent = container.get('chatAgent');

  logger.info('Bootstrap cold start initiated (split mode: sync + async AI)');

  // ── 同步阶段: 快速执行启发式 bootstrap（~1s）──
  const bootstrapResult = await chatAgent.executeTool('bootstrap_knowledge', {
    maxFiles: maxFiles || 500,
    skipGuard: skipGuard || false,
    contentMaxLines: contentMaxLines || 120,
    loadSkills: true,
  });

  // 立即返回启发式结果给前端
  const responseData = {
    ...bootstrapResult,
    aiEnhancement: 'pending',  // 告知前端 AI 增强正在后台进行
  };

  res.json({
    success: true,
    data: responseData,
  });

  // ── 异步阶段: 后台 AI 增强（enrich + refine）不阻塞响应 ──
  const shouldRefine = (autoRefine ?? true) && chatAgent.hasAI;
  const created = bootstrapResult?.bootstrapCandidates?.created || 0;
  if (shouldRefine && created > 0) {
    setImmediate(async () => {
      try {
        logger.info(`[Bootstrap] Background AI enhancement starting for ${created} candidates`);

        // enrich: 结构补齐
        const candidateIds = bootstrapResult?.bootstrapCandidates?.ids
          || bootstrapResult?.bootstrapCandidates?.candidateIds;
        if (Array.isArray(candidateIds) && candidateIds.length > 0) {
          try {
            await chatAgent.executeTool('enrich_candidate', { candidateIds });
            logger.info(`[Bootstrap] Background enrich done for ${candidateIds.length} candidates`);
          } catch (e) {
            logger.warn(`[Bootstrap] Background enrich failed (non-fatal): ${e.message}`);
          }
        }

        // loadSkill + refine: AI 内容润色
        try {
          let userPrompt = '';
          // 加载 Skill 内容
          const loaded = bootstrapResult?.skillsLoaded || [];
          const skillName = loaded.find(s => s.startsWith('autosnippet-reference-')) || 'autosnippet-coldstart';
          try {
            const skillResult = await chatAgent.executeTool('load_skill', { skillName });
            if (skillResult?.content) {
              userPrompt = `请参考以下业界最佳实践标准润色候选，确保 summary 精准、tags 丰富、confidence 合理:\n${skillResult.content.substring(0, 3000)}`;
            }
          } catch { /* skill load failed, proceed without */ }

          // AST 上下文注入
          if (bootstrapResult?.astContext) {
            userPrompt += `\n\n# 项目代码结构分析 (Tree-sitter AST)\n${bootstrapResult.astContext.substring(0, 2000)}`;
          }

          await chatAgent.executeTool('refine_bootstrap_candidates', {
            userPrompt: userPrompt || undefined,
          });
          logger.info(`[Bootstrap] Background refine done`);
        } catch (e) {
          logger.warn(`[Bootstrap] Background refine failed (non-fatal): ${e.message}`);
        }

        logger.info('[Bootstrap] Background AI enhancement completed');
      } catch (e) {
        logger.error(`[Bootstrap] Background AI enhancement error: ${e.message}`);
      }
    });
  }
}));

export default router;
