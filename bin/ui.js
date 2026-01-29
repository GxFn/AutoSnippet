const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const open = require('open');
const AiFactory = require('../lib/ai/AiFactory');
const specRepository = require('../lib/snippet/specRepository');
const snippetInstaller = require('../lib/snippet/snippetInstaller');
const spmDepMapUpdater = require('../lib/spm/spmDepMapUpdater');
const watch = require('../lib/watch/fileWatcher');
const findPath = require('./findPath');
const targetScanner = require('../lib/spm/targetScanner');
const candidateService = require('../lib/ai/candidateService');
const headerResolution = require('../lib/ai/headerResolution');
const markerLine = require('../lib/snippet/markerLine');

/** 将 spec 中存储的 XML 转义还原为原始代码，供前端编辑显示，避免保存时重复转义 */
function unescapeSnippetLine(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

/**
 * 启动 Dashboard Server
 * @param {string} projectRoot 
 * @param {number} port 
 */
function launch(projectRoot, port = 3000) {
  // 1. 在后台启动 Watcher
  console.log(`[Dashboard] 正在后台启动项目监听器...`);
  const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
  try {
    watch.watchFileChange(rootSpecPath, projectRoot, { quiet: true });
    console.log(`[Dashboard] ✅ 监听器已就绪`);
  } catch (err) {
    console.error(`[Dashboard] ❌ 监听器启动失败: ${err.message}`);
  }

  const app = express();
  app.use(cors());
  app.use(express.json());

  // API: 执行 Install (同步到 Xcode)
  app.post('/api/commands/install', async (req, res) => {
    try {
      const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
      const result = snippetInstaller.addCodeSnippets(rootSpecPath);
      res.json(result);
    } catch (err) {
      console.error(`[API Error]`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: 执行 SPM Map 刷新
  app.post('/api/commands/spm-map', async (req, res) => {
    try {
      const result = spmDepMapUpdater.updateSpmDepMap(projectRoot, { aggressive: true });
      res.json(result);
    } catch (err) {
      console.error(`[API Error]`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: 从路径精准提取 (优先支持 // as:code 标记)
  app.post('/api/extract/path', async (req, res) => {
    try {
      const { relativePath } = req.body;
      const fullPath = path.resolve(projectRoot, relativePath);
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'File not found' });
      }

      let content = fs.readFileSync(fullPath, 'utf8');
      
      // 1. 尝试使用标记锁定代码范围 (as:code 或 autosnippet:code)
      const markerRegex = /\/\/\s*(?:as|autosnippet):code\s*\n([\s\S]*?)\n\s*\/\/\s*(?:as|autosnippet):code/i;
      const match = content.match(markerRegex);
      
      let targetCode = '';
      let isMarked = false;

      if (match && match[1]) {
        targetCode = match[1].trim();
        isMarked = true;
      } else {
        targetCode = content.slice(0, 5000); // 未找到标记，回退到 AI 全文分析
      }

      // 2. 提取文件头部的 import (无论是否有标记，都从全文提取 imports)
      const importRegex = /^(?:#import|import)\s+.*$/gm;
      const headers = content.match(importRegex) || [];

      const ai = AiFactory.create();
      // 调用 AI 生成摘要和技能描述，但限定在我们锁定的 targetCode 上
      const result = await ai.extractSkills(isMarked ? 'Marked Code' : 'Full File', [{ 
        name: relativePath, 
        content: targetCode 
      }]);

      // 注入提取到的真实 headers、相对路径与 target 名（与 create/headName 一致：<TargetName/Header.h> path）
      const targetRootDir = await findPath.findTargetRootDir(fullPath);
      const moduleName = targetRootDir ? path.basename(targetRootDir) : null;
      if (Array.isArray(result)) {
        for (const item of result) {
          item.headers = Array.from(new Set([...(item.headers || []), ...headers]));
          const headerList = item.headers || [];
          item.headerPaths = await Promise.all(headerList.map(h => headerResolution.resolveHeaderRelativePath(h, targetRootDir)));
          item.moduleName = moduleName;
        }
      }

      res.json({ result, isMarked });
    } catch (err) {
      console.error(`[API Error]`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: 从文本提取 (针对剪贴板)；可选 relativePath 用于 // as:create 场景，按路径解析头文件
  app.post('/api/extract/text', async (req, res) => {
    try {
      const { text, language, relativePath } = req.body;
      const ai = AiFactory.create();
      const result = await ai.summarize(text, language);

      // 若由 // as:create 传入路径，则按该文件所在 target 解析头文件（与 create/headName 一致）
      if (relativePath && typeof relativePath === 'string' && result && !result.error) {
        const resolved = await headerResolution.resolveHeadersForText(projectRoot, relativePath, text);
        result.headers = Array.from(new Set([...(result.headers || []), ...resolved.headers]));
        result.headerPaths = resolved.headerPaths;
        result.moduleName = resolved.moduleName;
      }

      res.json(result);
    } catch (err) {
      console.error(`[API Error]`, err);
      res.status(500).json({ error: err.message });
    }
  });

// 获取所有 Snippets 和 Skills
  app.get('/api/data', async (req, res) => {
    try {
      const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
      // 使用 specRepository 的增强读取逻辑（自动合并 snippets/ 目录）
      let rootSpec = specRepository.readSpecFile(rootSpecPath);
      
      // ✅ 字段映射：确保前端拿到的是统一的字段名
      if (rootSpec && Array.isArray(rootSpec.list)) {
        const skillsDir = path.join(projectRoot, 'Knowledge', 'skills');
        const skillFiles = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir).filter(f => f.endsWith('.md')) : [];
        const skillContents = skillFiles.map(f => fs.readFileSync(path.join(skillsDir, f), 'utf8'));

        rootSpec.list = rootSpec.list.map(s => {
          let category = s.category || '';
          if (!category) {
            // 尝试从相关的 skill 文件中找分类
            const relatedSkill = skillContents.find(content => content.includes(`id: ${s.identifier}`));
            if (relatedSkill) {
              const match = relatedSkill.match(/category:\s*(.*)/);
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
      
      const skillsDir = path.join(projectRoot, 'Knowledge', 'skills');
      let skills = [];
      if (fs.existsSync(skillsDir)) {
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

        const allMdFiles = getAllFiles(skillsDir);
        skills = allMdFiles.map(filePath => {
          const content = fs.readFileSync(filePath, 'utf8');
          const relativePath = path.relative(skillsDir, filePath);
          return { name: relativePath, content };
        });
      }

      res.json({ 
        rootSpec, 
        skills, 
        candidates: candidateService.listCandidates(projectRoot),
        projectRoot,
        watcherStatus: 'active' 
      });
    } catch (err) {
      console.error(`[API Error]`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: AI 摘要
  app.post('/api/ai/summarize', async (req, res) => {
    try {
      const { code, language } = req.body;
      const ai = AiFactory.create();
      const result = await ai.summarize(code, language);
      res.json(result);
    } catch (err) {
      console.error(`[API Error]`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: AI 聊天
  app.post('/api/ai/chat', async (req, res) => {
    try {
      const { prompt, history } = req.body;
      
      // 构建 RAG 上下文
      const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
      // 使用增强读取（包含分体片段）
      const fullSpec = specRepository.readSpecFile(rootSpecPath);
      const snippets = fullSpec.list || [];
      
      const skillsDir = path.join(projectRoot, 'Knowledge', 'skills');
      let skillsContent = '';
      if (fs.existsSync(skillsDir)) {
        // 优先加载 README.md 作为核心上下文
        const readmePath = path.join(skillsDir, 'README.md');
        let readmeContent = '';
        if (fs.existsSync(readmePath)) {
          readmeContent = `[CORE PROJECT GUIDELINE]\n${fs.readFileSync(readmePath, 'utf8')}\n\n`;
        }

        const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md') && f !== 'README.md');
        skillsContent = readmeContent + files.map(file => {
          return `--- SKILL: ${file} ---\n${fs.readFileSync(path.join(skillsDir, file), 'utf8')}`;
        }).join('\n\n');
      }

      const systemInstruction = `
        You are an expert iOS Development Assistant for this project.
        Use the provided knowledge base to answer questions accurately and recommend best practices.
        
        [PROJECT SNIPPETS]
        ${snippets.map(s => `- ${s.title} (Trigger: ${s.completion || s.trigger}): ${s.summary}`).join('\n')}
        
        [DETAILED SKILLS & GUIDES]
        ${skillsContent}
        
        Rules:
        1. If a snippet exists for a task, MUST mention its trigger key.
        2. Prioritize project-specific patterns from SKILLS over general iOS knowledge.
        3. Response should be concise and professional.
      `;

      const ai = AiFactory.create();
      const result = await ai.chat(prompt, history, systemInstruction);
      res.json({ text: result });
    } catch (err) {
      console.error(`[API Error]`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: 保存 Skill
  app.post('/api/skills/save', (req, res) => {
    try {
      const { name, content } = req.body;
      const skillsDir = path.join(projectRoot, 'Knowledge', 'skills');
      if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
      
      const filePath = path.join(skillsDir, name.endsWith('.md') ? name : `${name}.md`);
      fs.writeFileSync(filePath, content, 'utf8');
      res.json({ success: true });
    } catch (err) {
      console.error(`[API Error]`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: 保存 Snippet (更新 boxspec.json)
  app.post('/api/snippets/save', (req, res) => {
    try {
      const { snippet } = req.body;
      const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');

      // ✅ 映射 Dashboard Snippet 格式到内部 specRepository 格式
      const triggerBase = snippet.trigger || snippet.completionKey;
      // 支持 # 作为新触发标识，但也兼容旧的 @
      const triggerPrefix = triggerBase.startsWith('@') ? '@' : '#';
      const normalizedTrigger = triggerBase.startsWith(triggerPrefix) ? triggerBase : triggerPrefix + triggerBase;
      const categoryPart = snippet.category ? `${triggerPrefix}${snippet.category}` : '';
      
      // 处理 body：确保是数组；若前端误传了已转义内容则先还原，再清理触发符，最后只转义一次写入
      const rawBody = snippet.body || snippet.content || [];
      let cleanedBody = Array.isArray(rawBody) ? rawBody.map(unescapeSnippetLine) : [];
      
      if (cleanedBody.length > 0) {
        let firstLine = String(cleanedBody[0]).trim();
        if (firstLine === normalizedTrigger || firstLine === triggerBase || firstLine === normalizedTrigger.slice(1)) {
          cleanedBody.shift();
        }
        while (cleanedBody.length && String(cleanedBody[0]).trim() === '#') cleanedBody.shift();
        if (cleanedBody.length) {
          firstLine = String(cleanedBody[0]).trim();
          if (/^#\s*\/\/\s*as:(include|import)\s+/.test(firstLine)) cleanedBody[0] = firstLine.replace(/^#\s*/, '');
        }
      }

      if (snippet.includeHeaders && Array.isArray(snippet.headers) && snippet.headers.length > 0) {
        const isSwift = snippet.language === 'swift';
        const headerSet = new Set((snippet.headers || []).map(h => String(h).trim()).filter(Boolean));
        while (cleanedBody.length) {
          const line = String(cleanedBody[0]).trim();
          const isMarker = /^\/\/\s*as:(include|import)\s+/.test(line);
          if (line === '' || headerSet.has(line) || isMarker) cleanedBody.shift();
          else break;
        }
        const headerPaths = Array.isArray(snippet.headerPaths) ? snippet.headerPaths : [];
        const moduleName = snippet.moduleName || null;
        const markerLines = snippet.headers.map((h, idx) => markerLine.toAsMarkerLine(h, isSwift, headerPaths[idx], moduleName)).filter(Boolean);
        cleanedBody = [...markerLines, '', ...cleanedBody];
      }

      const internalSnippet = {
        identifier: snippet.identifier,
        title: snippet.category ? `[${snippet.category}] ${snippet.title.replace(/^\[.*?\]\s*/, '')}` : snippet.title,
        trigger: normalizedTrigger,
        completion: `${normalizedTrigger}${categoryPart}`, // 强制使用规范格式
        summary: snippet.summary,
        category: snippet.category,
        headers: snippet.headers, // 保存头文件列表
        includeHeaders: snippet.includeHeaders, // 保存是否引入的偏好
        languageShort: snippet.language === 'swift' ? 'swift' : 'objc',
        body: cleanedBody.map(line => {
          return String(line)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        })
      };

      specRepository.saveSnippet(rootSpecPath, internalSnippet, { syncRoot: true, installSingle: true });
      res.json({ success: true });
    } catch (err) {
      console.error(`[API Error]`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: 删除 Snippet
  app.post('/api/snippets/delete', async (req, res) => {
    try {
      const { identifier } = req.body;
      const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
      await specRepository.deleteSnippet(rootSpecPath, identifier, { syncRoot: true });
      res.json({ success: true });
    } catch (err) {
      console.error(`[API Error]`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: 删除 Skill
  app.post('/api/skills/delete', (req, res) => {
    try {
      const { name } = req.body;
      const skillsDir = path.join(projectRoot, 'Knowledge', 'skills');
      const filePath = path.join(skillsDir, name);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'File not found' });
      }
    } catch (err) {
      console.error(`[API Error]`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: 获取 SPM Targets
  app.get('/api/spm/targets', async (req, res) => {
    try {
      const targets = await targetScanner.listAllTargets(projectRoot);
      res.json(targets);
    } catch (err) {
      console.error(`[API Error]`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: 扫描 Target 并提取 Skills
  app.post('/api/spm/scan', async (req, res) => {
    try {
      const { target } = req.body;
      const files = await targetScanner.getTargetFilesContent(target);
      if (files.length === 0) {
        return res.json({ message: 'No source files found for this target.' });
      }

      const ai = AiFactory.create();
      const skills = await ai.extractSkills(target.name, files);
      // 为每条 skill 的 headers 解析相对路径并带上 target 名（与 create/headName 一致：<TargetName/Header.h> path）
      const targetRootDir = await findPath.findTargetRootDir(files[0].path);
      const moduleName = target.name;
      if (Array.isArray(skills)) {
        for (const skill of skills) {
          const headerList = skill.headers || [];
          skill.headerPaths = await Promise.all(headerList.map(h => headerResolution.resolveHeaderRelativePath(h, targetRootDir)));
          skill.moduleName = moduleName;
        }
      }
      res.json(skills);
    } catch (err) {
      console.error(`[API Error]`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: 删除候选内容
  app.post('/api/candidates/delete', async (req, res) => {
    try {
      const { targetName, candidateId } = req.body;
      await candidateService.removeCandidate(projectRoot, targetName, candidateId);
      res.json({ success: true });
    } catch (err) {
      console.error(`[API Error]`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // 静态资源（前端编译后的代码）；若未构建则自动在包目录执行 install + build（-g 安装也适用）
  const pkgRoot = path.resolve(__dirname, '..');
  const dashboardDir = path.join(pkgRoot, 'dashboard');
  let distPath = path.join(dashboardDir, 'dist');
  if (!fs.existsSync(distPath)) {
    console.log('⚠️  未检测到 dashboard/dist，正在自动构建（首次约需 1–2 分钟）...');
    const { execSync } = require('child_process');
    try {
      if (!fs.existsSync(path.join(dashboardDir, 'node_modules'))) {
        console.log('   安装 dashboard 依赖...');
        execSync('npm install', { cwd: dashboardDir, stdio: 'inherit' });
      }
      execSync('npm run build:dashboard', { cwd: pkgRoot, stdio: 'inherit' });
    } catch (err) {
      console.error('❌ 自动构建失败:', err.message);
    }
  }
  distPath = path.join(dashboardDir, 'dist');
  if (fs.existsSync(distPath)) {
    app.use('/', express.static(distPath));
    app.get(/^((?!\/api).)*$/, (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    app.get('/', (req, res) => {
      res.status(200).send(
        '<h1>AutoSnippet Dashboard Server</h1>' +
        '<p>前端构建失败。请检查：</p>' +
        '<ul><li>在 AutoSnippet 安装目录执行 <code>npm run build:dashboard</code></li>' +
        '<li>或到 <a href="https://github.com/GxFn/AutoSnippet">GitHub</a> 查看说明</li></ul>'
      );
    });
    console.warn('⚠️  构建后仍无 dashboard/dist，请手动在包目录执行: npm run build:dashboard');
  }

  app.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`🚀 AutoSnippet Dashboard 运行在: ${url}`);
    open(url);
  });
}

module.exports = { launch };
