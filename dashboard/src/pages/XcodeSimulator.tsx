import React, { useState, useRef, useEffect } from 'react';
import '../styles/XcodeSimulator.css';
import HighlightedCodeEditor from '../components/Shared/HighlightedCodeEditor';
import { 
  Code, Save, Trash2, RefreshCw, Folder, File, X, 
  Target, Search, Sparkles, Loader2, Play, ChevronDown, Menu, 
  ChevronLeft, Settings, Copy, MoreVertical
} from 'lucide-react';
import { ICON_SIZES } from '../constants/icons';

interface FileNode {
  type: 'file' | 'folder';
  name: string;
  path: string;
  relativePath?: string;
  ext?: string;
  children?: FileNode[];
}

interface EditorState {
  content: string;
  cursorPos: number;
  cursorLine: number;
  cursorCol: number;
}

interface MarkerLine {
  line: number;
  type: 'search' | 'create' | 'audit';
  directive: string;
  query?: string;
}

const XcodeSimulator: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);
  const initialContent = `// AutoSnippet Xcode 模拟器
// 支持的指令:
// // as:search <query>    - 搜索代码片段
// // as:create <query>    - 创建代码片段  
// // as:audit <path>      - 审计代码
//
// 示例:
// // as:search useState hooks
// // as:create custom form validation utility
// // as:audit /src/components
`;
  const contentRef = useRef<string>(initialContent);
  const cursorPosRef = useRef<number>(0);

  // 状态
  const [editorState, setEditorState] = useState<EditorState>({
    content: initialContent,
    cursorPos: 0,
    cursorLine: 0,
    cursorCol: 0,
  });

  const [markerLines, setMarkerLines] = useState<MarkerLine[]>([]);
  const [executionResult, setExecutionResult] = useState<string>('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [fileTree, setFileTree] = useState<FileNode | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [currentFile, setCurrentFile] = useState<string>('');
  const [selectedMarker, setSelectedMarker] = useState<number | null>(null);

  const computeCursorPosition = (content: string, cursorPos: number) => {
    const lines = content.split('\n');
    let line = 0;
    let col = 0;
    let charCount = 0;

    for (let i = 0; i < lines.length; i++) {
      if (charCount + lines[i].length + 1 > cursorPos) {
        line = i;
        col = cursorPos - charCount;
        break;
      }
      charCount += lines[i].length + 1;
    }

    return { line, col };
  };

  const setEditorContent = (content: string, cursorPos: number = 0) => {
    contentRef.current = content;
    cursorPosRef.current = cursorPos;
    const { line, col } = computeCursorPosition(content, cursorPos);

    setEditorState({
      content,
      cursorPos,
      cursorLine: line,
      cursorCol: col,
    });
    parseDirectives(content);
  };

  const updateCursorPosition = (cursorPos: number) => {
    cursorPosRef.current = cursorPos;
    const { line, col } = computeCursorPosition(contentRef.current, cursorPos);
    setEditorState((prev) => ({
      ...prev,
      cursorPos,
      cursorLine: line,
      cursorCol: col,
    }));
  };

  // 初始化
  useEffect(() => {
    isMountedRef.current = true;
    parseDirectives(editorState.content);
    loadFileTree();
    
    const handleResize = () => {
      if (containerRef.current) {
        const height = containerRef.current.clientHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      isMountedRef.current = false;
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // 解析指令
  const parseDirectives = (content = editorState.content) => {
    const lines = content.split('\n');
    const markers: MarkerLine[] = [];
    
    lines.forEach((line, idx) => {
      const match = line.match(/\/\/\s*as:(search|create|audit)\s+(.+)/);
      if (match) {
        markers.push({
          line: idx,
          type: match[1] as 'search' | 'create' | 'audit',
          directive: match[0],
          query: match[2].trim(),
        });
      }
    });
    
    setMarkerLines(markers);
  };

  // 加载文件树
  const loadFileTree = async () => {
    try {
      // 尝试从 API 获取
      const response = await fetch('/api/files/tree');
      if (response.ok) {
        const data = await response.json();
        const tree = data.tree || data;
        setFileTree(tree);
        if (tree?.path) {
          setExpandedFolders(new Set([tree.path]));
        }
        return;
      }
    } catch (error) {
      console.error('Failed to load file tree from API:', error);
    }

    // 如果 API 失败，使用本地示例数据
    const sampleTree: FileNode = {
      type: 'folder',
      name: 'src',
      path: '/src',
      children: [
        {
          type: 'file',
          name: 'index.ts',
          path: '/src/index.ts',
        },
        {
          type: 'folder',
          name: 'components',
          path: '/src/components',
          children: [
            {
              type: 'file',
              name: 'Button.tsx',
              path: '/src/components/Button.tsx',
            },
            {
              type: 'file',
              name: 'Header.tsx',
              path: '/src/components/Header.tsx',
            },
            {
              type: 'file',
              name: 'Footer.tsx',
              path: '/src/components/Footer.tsx',
            },
          ],
        },
        {
          type: 'folder',
          name: 'hooks',
          path: '/src/hooks',
          children: [
            {
              type: 'file',
              name: 'useAuth.ts',
              path: '/src/hooks/useAuth.ts',
            },
            {
              type: 'file',
              name: 'useFetch.ts',
              path: '/src/hooks/useFetch.ts',
            },
          ],
        },
        {
          type: 'folder',
          name: 'utils',
          path: '/src/utils',
          children: [
            {
              type: 'file',
              name: 'helpers.ts',
              path: '/src/utils/helpers.ts',
            },
            {
              type: 'file',
              name: 'validators.ts',
              path: '/src/utils/validators.ts',
            },
          ],
        },
      ],
    };
    setFileTree(sampleTree);
  };

  const openFile = async (filePath: string) => {
    try {
      const response = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
      if (!response.ok) {
        throw new Error(`Open failed with status ${response.status}`);
      }
      const data = await response.json();
      setEditorContent(data.content || '', 0);
      setCurrentFile(data.path || filePath);
      setExecutionResult('');
    } catch (error) {
      console.error('Open file failed:', error);
      setExecutionResult(`✗ 打开文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  // 保存文件
  const handleSave = async () => {
    try {
      await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: currentFile,
          content: editorState.content,
        }),
      });
    } catch (error) {
      console.error('Save failed:', error);
    }
  };

  // 清空编辑器
  const handleClear = () => {
    if (window.confirm('确定要清空编辑器吗?')) {
      setEditorContent('', 0);
    }
  };

  // 执行指令：搜索结果在模拟器中插入，同时触发真实 watch
  const executeDirective = async (marker: MarkerLine) => {
    setIsExecuting(true);
    setSelectedMarker(markerLines.indexOf(marker));

    try {
      console.log(`[Execute] 触发 ${marker.type} 指令...`, { query: marker.query, line: marker.line });

      // 执行指令
      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: marker.type,
          query: marker.query,
          line: marker.line,
          content: editorState.content,
          source: 'simulator',  // 标记请求来自 Xcode 模拟器
        }),
      });

      const data = await response.json();
      console.log(`[Execute] 响应:`, data);

      if (!response.ok) {
        throw new Error(data.error || '执行失败');
      }

      // 如果是搜索并有结果，显示选择对话框并插入
      if (marker.type === 'search' && data.results && data.results.length > 0) {
        console.log(`[Execute] 搜索到 ${data.results.length} 个结果，准备显示 NativeUI 弹窗`);
        
        // 显示 NativeUI 对话框让用户选择
        const options = data.results.map((result: any, idx: number) => 
          `${idx + 1}. ${result.title} (${result.category || 'uncategorized'})`
        );
        
        const dialogResponse = await fetch('/api/native-dialog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'list',
            title: `搜索结果: ${marker.query}`,
            options: options,
          }),
        });

        const dialogData = await dialogResponse.json();
        
        if (dialogData.success && dialogData.result?.selectedIndex >= 0) {
          const selectedResult = data.results[dialogData.result.selectedIndex];
          console.log(`[Execute] 用户选择了: ${selectedResult.title}`);
          
          // 在模拟器中插入选中的代码片段
          const lines = editorState.content.split('\n');
          const insertLineIndex = marker.line + 1;
          
          const snippetBody = selectedResult.body || `// ${selectedResult.title}`;
          const snippetLines = snippetBody.split('\n');
          
          lines.splice(insertLineIndex, 0, ...snippetLines);
          const newContent = lines.join('\n');
          
          const insertionPos = editorState.content.split('\n').slice(0, insertLineIndex).join('\n').length + 1;
          setEditorContent(newContent, insertionPos);
          
          console.log(`✓ 已插入代码片段: ${selectedResult.title}`);
        } else {
          console.log(`[Execute] 用户取消了选择`);
        }
      } else if (marker.type === 'search') {
        console.warn(`[Execute] 未找到匹配的搜索结果`);
      }

      // Watch 已在后端处理（通过临时文件触发）
      if (data.success) {
        console.log(`✓ 指令已执行: ${data.message}`);
      }
    } catch (error) {
      console.error(`✗ 错误: ${error instanceof Error ? error.message : '执行失败'}`);
    } finally {
      setIsExecuting(false);
    }
  };

  // 格式化路径显示（中间省略，类似 Xcode）
  const formatPathDisplay = (path: string, maxLength: number = 60): string => {
    if (!path || path.length <= maxLength) return path;
    
    const parts = path.split('/');
    if (parts.length <= 2) return path;
    
    const fileName = parts[parts.length - 1];
    const firstPart = parts.slice(0, 2).join('/');
    
    // 如果文件名+开头部分就超长，只保留文件名和最少路径
    if ((firstPart.length + fileName.length + 5) > maxLength) {
      const availableLength = maxLength - fileName.length - 5;
      const truncatedFirst = firstPart.substring(0, Math.max(10, availableLength));
      return `${truncatedFirst}/.../${fileName}`;
    }
    
    // 计算中间可以保留多少
    const availableForMiddle = maxLength - firstPart.length - fileName.length - 5;
    if (availableForMiddle > 0 && parts.length > 3) {
      const middleParts = parts.slice(2, -1);
      let middleStr = middleParts.join('/');
      if (middleStr.length > availableForMiddle) {
        middleStr = '...';
      }
      return `${firstPart}/${middleStr}/${fileName}`;
    }
    
    return `${firstPart}/.../${fileName}`;
  };

  // 渲染文件树项
  const renderFileTree = (node: FileNode | null, depth: number = 0): React.ReactNode => {
    if (!node) return null;

    if (node.type === 'folder') {
      const isExpanded = expandedFolders.has(node.path);
      return (
        <div key={node.path}>
          <div
            className="file-tree-item folder-item"
            onClick={() => {
              const newSet = new Set(expandedFolders);
              if (isExpanded) {
                newSet.delete(node.path);
              } else {
                newSet.add(node.path);
              }
              setExpandedFolders(newSet);
            }}
            style={{ paddingLeft: `${depth * 16}px` }}
          >
            <ChevronDown
              size={ICON_SIZES.sm}
              className={`folder-toggle ${isExpanded ? 'expanded' : ''}`}
            />
            <Folder size={ICON_SIZES.sm} className="folder-icon" />
            <span className="file-name">{node.name}</span>
          </div>
          {isExpanded && node.children && (
            <div>
              {node.children.map(child => renderFileTree(child, depth + 1))}
            </div>
          )}
        </div>
      );
    } else {
      return (
        <div
          key={node.path}
          className={`file-tree-item file-item ${currentFile === node.path ? 'active' : ''}`}
          onClick={() => openFile(node.path)}
          style={{ paddingLeft: `${depth * 16}px` }}
        >
          <File size={ICON_SIZES.sm} className="file-icon" />
          <span className="file-name">{node.name}</span>
        </div>
      );
    }
  };

  return (
    <div className="xcode-container" ref={containerRef}>
      {/* 顶部工具栏 */}
      <div className="xcode-toolbar">
        <div className="toolbar-left">
          <button
            className="toolbar-btn toggle-sidebar"
            onClick={() => setShowSidebar(!showSidebar)}
            title="切换侧栏"
          >
            <Menu size={ICON_SIZES.md} />
          </button>
          <div className="file-info" title={currentFile}>
            <Code size={ICON_SIZES.sm} />
            <span className="file-name">{formatPathDisplay(currentFile || 'untitled.js', 80)}</span>
          </div>
        </div>

        <div className="toolbar-right">
          <button className="toolbar-btn" onClick={handleSave} title="保存">
            <Save size={ICON_SIZES.md} />
          </button>
          <button className="toolbar-btn" onClick={handleClear} title="清空">
            <Trash2 size={ICON_SIZES.md} />
          </button>
          <button className="toolbar-btn" title="更多选项">
            <MoreVertical size={ICON_SIZES.md} />
          </button>
        </div>
      </div>

      <div className="xcode-main">
        {/* 左侧边栏 */}
        {showSidebar && (
          <div className="xcode-sidebar">
            <div className="sidebar-header">
              <Folder size={ICON_SIZES.md} />
              <h3>文件浏览</h3>
            </div>
            <div className="file-tree">
              {fileTree && renderFileTree(fileTree)}
            </div>
          </div>
        )}

        {/* 编辑器区域 */}
        <div className="xcode-editor-wrapper">
          {/* 代码编辑器 */}
          <div className="xcode-editor">
            <HighlightedCodeEditor
              value={editorState.content}
              onChange={(value) => setEditorContent(value, cursorPosRef.current)}
              onCursorChange={updateCursorPosition}
              language="javascript"
              height="100%"
              className="w-full h-full"
              showLineNumbers
              placeholder="// Start typing..."
            />
          </div>

          {/* 状态栏 */}
          <div className="editor-status">
            <span>Ln {editorState.cursorLine + 1}, Col {editorState.cursorCol + 1}</span>
            <span>|</span>
            <span>{editorState.content.length} characters</span>
            <span>|</span>
            <span>{editorState.content.split('\n').length} lines</span>
          </div>
        </div>

        {/* 右侧结果面板 */}
        <div className="xcode-result-panel">
          {/* 指令列表 */}
          <div className="result-section directives">
            <div className="section-header">
              <Target size={ICON_SIZES.md} />
              <h3>检测到的指令</h3>
              <span className="count">{markerLines.length}</span>
            </div>

            {markerLines.length === 0 ? (
              <div className="empty-state">
                <Sparkles size={32} />
                <p>暂无指令</p>
                <small>在代码中添加 // as:search 来创建指令</small>
              </div>
            ) : (
              <div className="directives-list">
                {markerLines.map((marker, idx) => (
                  <div
                    key={idx}
                    className={`directive-card ${marker.type} ${selectedMarker === idx ? 'active' : ''}`}
                    onClick={() => setSelectedMarker(idx)}
                  >
                    <div className="directive-header">
                      <div className="type-badge">{marker.type.toUpperCase()}</div>
                      <div className="line-badge">L{marker.line + 1}</div>
                    </div>
                    <div className="directive-query">{marker.query}</div>
                    <button
                      className="execute-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        executeDirective(marker);
                      }}
                      disabled={isExecuting}
                    >
                      {isExecuting && selectedMarker === idx ? (
                        <>
                          <Loader2 size={ICON_SIZES.xs} className="spin" />
                          执行中...
                        </>
                      ) : (
                        <>
                          <Play size={ICON_SIZES.xs} />
                          执行
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 执行结果 */}
          {executionResult && (
            <div className="result-section result">
              <div className="section-header">
                <Search size={ICON_SIZES.md} />
                <h3>执行结果</h3>
              </div>
              <div className="result-content">
                <pre>{executionResult}</pre>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 执行结果 Modal */}
      {showResultModal && (
        <div className="result-modal-backdrop" onClick={() => setShowResultModal(false)}>
          <div className="result-modal" onClick={(e) => e.stopPropagation()}>
            <div className="result-modal-header">
              <h2>执行结果</h2>
              <button
                className="result-modal-close"
                onClick={() => setShowResultModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="result-modal-content">
              <pre>{executionResult}</pre>
            </div>
            <div className="result-modal-footer">
              <button
                className="result-modal-btn"
                onClick={() => {
                  navigator.clipboard.writeText(executionResult);
                }}
              >
                复制
              </button>
              <button
                className="result-modal-btn"
                onClick={() => setShowResultModal(false)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default XcodeSimulator;
