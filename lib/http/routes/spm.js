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

export default router;
