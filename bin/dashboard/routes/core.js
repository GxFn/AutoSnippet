const Paths = require('../../../lib/infrastructure/config/Paths.js');

function registerCoreRoutes(app, ctx) {
  const {
  projectRoot,
  path,
  fs,
  AiFactory,
  specRepository,
  candidateService,
  unescapeSnippetLine,
  } = ctx;

  const resolveProjectPath = (inputPath) => {
  if (!inputPath) return null;
  const rawPath = String(inputPath);
  return path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(projectRoot, rawPath);
  };

  // API: 健康检查（用于检测 Dashboard 是否运行）
  app.get('/api/health', (req, res) => {
  res.json({ 
    service: 'AutoSnippet Dashboard',
    status: 'running',
    projectRoot: projectRoot,
    timestamp: Date.now()
  });
  });

  // API: Recipe 关键词查找（asd ui 启动时可用，供 Cursor/MCP/脚本调用）
  app.get('/api/recipes/search', async (req, res) => {
  try {
    const q = (req.query.q || req.query.keyword || '').trim().toLowerCase();
    const rootSpecPath = Paths.getProjectSpecPath(projectRoot);
    let rootSpec = {};
    try {
    rootSpec = JSON.parse(fs.readFileSync(rootSpecPath, 'utf8'));
    } catch (_) {}
    const recipesDir = Paths.getProjectRecipesPath(projectRoot, rootSpec);
    if (!fs.existsSync(recipesDir)) {
    return res.json({ results: [], total: 0 });
    }
    const getAllMd = (dirPath, list = []) => {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dirPath, e.name);
      if (e.isDirectory() && !e.name.startsWith('.')) {
      getAllMd(full, list);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      list.push(full);
      }
    }
    return list;
    };
    const allMd = getAllMd(recipesDir);
    const results = [];
    for (const full of allMd) {
    const content = fs.readFileSync(full, 'utf8');
    const rel = path.relative(recipesDir, full).replace(/\\/g, '/');
    if (!q || rel.toLowerCase().includes(q) || content.toLowerCase().includes(q)) {
      results.push({ name: rel, path: full, content });
    }
    }
    res.json({ results, total: results.length });
  } catch (err) {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message });
  }
  });

  // 获取所有 Snippets 和 Recipes
  app.get('/api/data', async (req, res) => {
  try {
    const rootSpecPath = Paths.getProjectSpecPath(projectRoot);
    // 使用 specRepository 的增强读取逻辑（自动合并 snippets/ 目录）
    let rootSpec = specRepository.readSpecFile(rootSpecPath);
    const recipesDir = Paths.getProjectRecipesPath(projectRoot, rootSpec);

    // ✅ 字段映射：确保前端拿到的是统一的字段名
    if (rootSpec && Array.isArray(rootSpec.list)) {
    const recipeFiles = fs.existsSync(recipesDir) ? fs.readdirSync(recipesDir).filter(f => f.endsWith('.md')) : [];
    const recipeContents = recipeFiles.map(f => fs.readFileSync(path.join(recipesDir, f), 'utf8'));

    rootSpec.list = rootSpec.list.map(s => {
      let category = s.category || '';
      if (!category) {
      // 尝试从相关的 recipe 文件中找分类
      const relatedRecipe = recipeContents.find(content => content.includes(`id: ${s.identifier}`));
      if (relatedRecipe) {
        const match = relatedRecipe.match(/category:\s*(.*)/);
        if (match) category = match[1].trim();
      }
      }

      return {
      ...s,
      completionKey: s.completion || s.completionKey || '',
      language: s.languageShort || s.language || '',
      category: category || 'Utility', // 默认 Utility
      content: (s.body || s.content || []).map(unescapeSnippetLine),
      headers: (s.headers || []).map(unescapeSnippetLine),
      includeHeaders: !!s.includeHeaders
      };
    });
    }
    
    let recipes = [];
    if (fs.existsSync(recipesDir)) {
    // 递归获取所有 md 文件
    const getAllFiles = (dirPath, arrayOfFiles) => {
      const files = fs.readdirSync(dirPath);
      arrayOfFiles = arrayOfFiles || [];
      files.forEach(file => {
      const fullPath = path.join(dirPath, file);
      if (fs.statSync(fullPath).isDirectory()) {
        arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
      } else if (file.endsWith('.md') && file !== 'README.md') {
        arrayOfFiles.push(fullPath);
      }
      });
      return arrayOfFiles;
    };

    const allMdFiles = getAllFiles(recipesDir);
    let statsMap = {};
    try {
      const recipeStats = require('../../../lib/recipe/recipeStats');
      const stats = recipeStats.getRecipeStats(projectRoot);
      statsMap = stats.byFile || {};
    } catch (_) {}
    const byFileEntries = Object.values(statsMap);
    recipes = allMdFiles.map(filePath => {
      const content = fs.readFileSync(filePath, 'utf8');
      const relativePath = path.relative(recipesDir, filePath).replace(/\\/g, '/');
      const fileKey = path.basename(relativePath);
      const entry = statsMap[fileKey];
      let stats = null;
      if (entry) {
      try {
        const recipeStats = require('../../../lib/recipe/recipeStats');
        const score = recipeStats.getAuthorityScore(entry, byFileEntries, {});
        stats = {
        authority: entry.authority ?? 0,
        guardUsageCount: entry.guardUsageCount ?? 0,
        humanUsageCount: entry.humanUsageCount ?? 0,
        aiUsageCount: entry.aiUsageCount ?? 0,
        lastUsedAt: entry.lastUsedAt || null,
        authorityScore: Math.round(score * 100) / 100
        };
      } catch (_) {}
      }
      return { name: relativePath, content, stats };
    });
    }

    const aiConfig = AiFactory.getConfigSync(projectRoot);
    // 过滤过期项，_pending 排到底端；按质量分排序候选（高分靠前）
    const qualityRules = require('../../../lib/candidate/qualityRules');
    let candidates = candidateService.listCandidatesWithPrune(projectRoot);
    for (const [targetName, group] of Object.entries(candidates)) {
    if (group && Array.isArray(group.items)) {
      group.items.sort((a, b) => {
      const sa = qualityRules.evaluateCandidate(a);
      const sb = qualityRules.evaluateCandidate(b);
      return sb - sa;
      });
    }
    }
    const sorted = Object.entries(candidates).sort(([a], [b]) => {
    if (a === '_pending' && b !== '_pending') return 1;
    if (a !== '_pending' && b === '_pending') return -1;
    return a.localeCompare(b);
    });
    candidates = Object.fromEntries(sorted);

    res.json({ 
    rootSpec, 
    recipes, 
    candidates,
    projectRoot,
    watcherStatus: 'active',
    aiConfig: { provider: aiConfig.provider, model: aiConfig.model }
    });
  } catch (err) {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message });
  }
  });

  // API: 获取文件树（仅 .h .m .swift 文件和文件夹）
  app.get('/api/files/tree', (req, res) => {
    try {
      const rootPath = projectRoot;
      const allowedExtensions = ['.h', '.m', '.swift'];
      
      const buildTree = (dirPath, maxDepth = 10, currentDepth = 0) => {
        if (currentDepth >= maxDepth) return { type: 'folder', name: '...', path: dirPath, children: [] };
        
        try {
          const entries = fs.readdirSync(dirPath, { withFileTypes: true });
          const children = [];
          
          for (const entry of entries) {
            // 跳过隐藏文件和常见的构建/依赖文件夹
            if (entry.name.startsWith('.') || 
                ['node_modules', 'build', 'dist', 'DerivedData', 'Pods', '.git'].includes(entry.name)) {
              continue;
            }
            
            const fullPath = path.join(dirPath, entry.name);
            const relativePath = path.relative(rootPath, fullPath);
            
            if (entry.isDirectory()) {
              const subtree = buildTree(fullPath, maxDepth, currentDepth + 1);
              if (subtree.children && subtree.children.length > 0) {
                children.push(subtree);
              }
            } else if (entry.isFile()) {
              const ext = path.extname(entry.name).toLowerCase();
              if (allowedExtensions.includes(ext)) {
                children.push({
                  type: 'file',
                  name: entry.name,
                  path: fullPath,
                  relativePath: relativePath,
                  ext: ext
                });
              }
            }
          }
          
          return {
            type: 'folder',
            name: path.basename(dirPath) || dirPath,
            path: dirPath,
            relativePath: path.relative(rootPath, dirPath) || '',
            children: children.sort((a, b) => {
              // 文件夹优先，然后按名字排序
              if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
              return a.name.localeCompare(b.name);
            })
          };
        } catch (err) {
          console.error(`[File Tree Error] ${dirPath}:`, err.message);
          return { type: 'folder', name: path.basename(dirPath), path: dirPath, children: [] };
        }
      };
      
      const tree = buildTree(rootPath);
      res.json({ tree, projectRoot });
    } catch (err) {
      console.error('[API Error]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: 获取文件树（用于 Xcode 模拟器）
  app.get('/api/tree', (req, res) => {
    try {
      const sourceFileExts = ['.h', '.m', '.swift']; // 只显示这些扩展名的文件
      
      const buildTree = (dirPath, maxDepth = 3, currentDepth = 0) => {
        if (currentDepth >= maxDepth) return null;
        
        if (!fs.existsSync(dirPath)) {
          return null;
        }

        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const filtered = entries.filter(e => {
          if (e.name.startsWith('.')) return false;
          if (e.name === 'node_modules') return false;
          
          // 如果是文件，只保留指定扩展名的文件
          if (!e.isDirectory()) {
            const ext = path.extname(e.name).toLowerCase();
            return sourceFileExts.includes(ext);
          }
          
          return true; // 文件夹总是保留（用于递归遍历）
        });

        const children = filtered.map(entry => {
          const fullPath = path.join(dirPath, entry.name);
          const relPath = path.relative(projectRoot, fullPath);
          
          if (entry.isDirectory()) {
            const subtree = buildTree(fullPath, maxDepth, currentDepth + 1);
            // 只返回有内容的文件夹
            if (subtree && subtree.children && subtree.children.length > 0) {
              return {
                type: 'folder',
                name: entry.name,
                path: relPath.replace(/\\/g, '/'),
                children: subtree.children
              };
            }
            return null; // 空文件夹不显示
          } else {
            return {
              type: 'file',
              name: entry.name,
              path: relPath.replace(/\\/g, '/')
            };
          }
        }).filter(item => item !== null) // 移除空文件夹
          .sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name);
            return a.type === 'folder' ? -1 : 1;
          });

        return {
          type: 'folder',
          name: path.basename(dirPath),
          path: path.relative(projectRoot, dirPath).replace(/\\/g, '/'),
          children
        };
      };

      const srcPath = path.join(projectRoot, 'src');
      const tree = fs.existsSync(srcPath) ? buildTree(srcPath, 4) : buildTree(projectRoot, 3);
      res.json(tree);
    } catch (err) {
      console.error('[API Error]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: 保存文件内容（用于 Xcode 模拟器）
  app.post('/api/save', (req, res) => {
    try {
      const { path: filePath, content } = req.body;
      
      if (!filePath || content === undefined) {
        return res.status(400).json({ error: 'Missing path or content' });
      }

      // 验证路径安全性
      const resolvedPath = resolveProjectPath(filePath);
      const projectRootResolved = path.resolve(projectRoot);
      
      if (!resolvedPath.startsWith(projectRootResolved)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // 确保目录存在
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(resolvedPath, content, 'utf8');
      res.json({ success: true, path: filePath });
    } catch (err) {
      console.error('[API Error]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: 执行 Xcode 编辑器中的指令（search/create/audit）
  // ⚠️ 已禁用：不再通过临时文件触发 watch - 模拟器搜索处理已关闭
  app.post('/api/execute', async (req, res) => {
    try {
      const { type, query, line, content } = req.body;
      
      if (!type || !query) {
        return res.status(400).json({ error: 'Missing type or query' });
      }

      console.log(`[API Execute] 模拟器搜索已禁用: type=${type}, query=${query}`);

      // 对于搜索请求，直接返回搜索结果（不创建临时文件）
      let searchResults = [];
      if (type === 'search') {
        const rootSpecPath = Paths.getProjectSpecPath(projectRoot);
        try {
          const rootSpec = specRepository.readSpecFile(rootSpecPath);
          
          // 遍历所有 snippets，查找匹配的
          for (const [snippetId, snippet] of Object.entries(rootSpec.snippets || {})) {
            if (!snippet) continue;
            
            const title = snippet.title || '';
            const body = snippet.body || '';
            const category = snippet.category || '';
            const trigger = snippet.trigger || '';
            
            // 搜索关键词匹配
            if (title.toLowerCase().includes(query.toLowerCase()) ||
                body.toLowerCase().includes(query.toLowerCase()) ||
                trigger.toLowerCase().includes(query.toLowerCase()) ||
                category.toLowerCase().includes(query.toLowerCase())) {
              searchResults.push({
                id: snippetId,
                title: title || snippetId,
                body: body,
                category: category,
                language: snippet.language || 'swift',
                trigger: trigger
              });
            }
          }
          
          // 限制返回最多 10 个结果
          searchResults = searchResults.slice(0, 10);
          console.log(`[API Execute] 搜索到 ${searchResults.length} 个结果: ${query}`);
        } catch (err) {
          console.warn(`[API Execute] 搜索失败: ${err.message}`);
        }
      }

      // 等待一段时间让 watch 处理
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 清理临时文件（延迟 3 秒后删除，给 SearchHandler 足够的时间读取）
      setTimeout(() => {
        try {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
            console.log(`[API Execute] 已清理临时文件: ${tempFilePath}`);
          }
        } catch (err) {
          console.error(`[API Execute] 清理临时文件失败: ${err.message}`);
        }
      }, 3000);

      // 返回成功响应
      res.json({
        success: true,
        type,
        query,
        line,
        message: `已触发 ${type} 指令，watch 监听器正在处理...`,
        results: searchResults,  // 搜索结果（如果有）
        timestamp: Date.now()
      });
    } catch (err) {
      console.error('[API Execute Error]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: 读取文件内容
  app.get('/api/files/read', (req, res) => {
    try {
      let filePath = req.query.path || '';
      // 验证路径安全性（防止路径遍历）
      const resolvedPath = resolveProjectPath(filePath);
      if (!resolvedPath) {
        return res.status(400).json({ error: 'Missing path' });
      }
      const projectRootResolved = path.resolve(projectRoot);
      
      if (!resolvedPath.startsWith(projectRootResolved)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      if (!fs.existsSync(resolvedPath)) {
        return res.status(404).json({ error: 'File not found' });
      }
      
      const content = fs.readFileSync(resolvedPath, 'utf8');
      res.json({
        content,
        path: resolvedPath,
        relativePath: path.relative(projectRoot, resolvedPath).replace(/\\/g, '/')
      });
    } catch (err) {
      console.error('[API Error]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: 调用原生弹窗（macOS Native UI）
  app.post('/api/native-dialog', async (req, res) => {
    try {
      const { type, title, message, options } = req.body;
      const { execFileSync } = require('child_process');
      
      // 使用 AutoSnippet 项目根目录（相对于此文件）
      const autoSnippetRoot = path.resolve(__dirname, '../../..');
      const nativeUiPath = path.join(autoSnippetRoot, 'resources/native-ui/native-ui');
      
      console.log('[Native Dialog] Request:', { type, title, options });
      console.log('[Native Dialog] Native UI path:', nativeUiPath);
      
      // 检查 native-ui 是否存在
      if (!fs.existsSync(nativeUiPath)) {
        console.error('[Native Dialog] Binary not found at:', nativeUiPath);
        return res.status(503).json({ 
          error: 'Native UI not built', 
          fallback: true,
          suggestion: 'Run: npm run build:native-ui' 
        });
      }

      let result = null;
      
      if (type === 'preview') {
        // 预览确认弹窗
        console.log('[Native Dialog] Executing preview...');
        execFileSync(nativeUiPath, ['preview', title || 'Preview', message || ''], {
          stdio: ['ignore', 'pipe', 'inherit']
        });
        result = { confirmed: true };
        console.log('[Native Dialog] Preview confirmed');
      } else if (type === 'list' && options && Array.isArray(options)) {
        // 列表选择弹窗
        console.log('[Native Dialog] Executing list with options:', options);
        const args = ['list', ...options];
        const output = execFileSync(nativeUiPath, args, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'inherit']
        }).trim();
        const selectedIndex = parseInt(output, 10);
        result = { selectedIndex, selectedOption: options[selectedIndex] };
        console.log('[Native Dialog] User selected:', result);
      } else {
        return res.status(400).json({ error: 'Invalid dialog type or missing options' });
      }

      res.json({ success: true, result });
    } catch (err) {
      console.error('[Native Dialog Error]', err);
      // 用户取消或其他错误
      res.json({ success: false, cancelled: true, error: err.message });
    }
  });
}

module.exports = {
  registerCoreRoutes,
};
