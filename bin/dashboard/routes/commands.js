function registerCommandsRoutes(app, ctx) {
  const { projectRoot, path, Paths, snippetInstaller, spmDepMapUpdater } = ctx;

  // API: 执行 Install (同步到 Xcode)
  app.post('/api/commands/install', async (req, res) => {
  try {
    const rootSpecPath = Paths.getProjectSpecPath(projectRoot);
    const result = snippetInstaller.addCodeSnippets(rootSpecPath);
    res.json(result);
  } catch (err) {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message });
  }
  });

  // API: 执行 SPM Map 刷新
  app.post('/api/commands/spm-map', async (req, res) => {
  try {
    const result = await spmDepMapUpdater.updateSpmDepMap(projectRoot, { aggressive: true });
    res.json(result);
  } catch (err) {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message });
  }
  });

  // API: 全量重建语义索引（等同 asd embed，可与「刷新项目」等合并使用）
  app.post('/api/commands/embed', async (req, res) => {
  try {
    const IndexingPipeline = require('../../../lib/context/IndexingPipeline');
    const result = await IndexingPipeline.run(projectRoot, { clear: true });
    res.json({ success: true, indexed: result.indexed, skipped: result.skipped, removed: result.removed });
  } catch (err) {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message });
  }
  });
}

module.exports = {
  registerCommandsRoutes,
};
