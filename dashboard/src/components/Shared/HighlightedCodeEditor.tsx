import React, { useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface HighlightedCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onCursorChange?: (cursorPos: number) => void;
  language?: string;
  height?: string;
  className?: string;
  placeholder?: string;
  rows?: number;
  showLineNumbers?: boolean;
}

/**
 * 带代码高亮的编辑器组件
 * 采用分层正叠方案（Overlay Pattern）：
 * - 下层：SyntaxHighlighter 显示高亮代码（不可交互）
 * - 上层：textarea 用于输入（透明背景，显示光标）
 * - 同时滚动保持两层同步
 */
const HighlightedCodeEditor: React.FC<HighlightedCodeEditorProps> = ({
  value,
  onChange,
  onCursorChange,
  language = 'javascript',
  height = '400px',
  className = '',
  placeholder = '',
  rows,
  showLineNumbers = true
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const lineNumberRef = useRef<HTMLDivElement>(null);

  // 语言映射
  const langMap: Record<string, string> = {
    objectivec: 'objectivec',
    'objective-c': 'objectivec',
    'obj-c': 'objectivec',
    objc: 'objectivec',
    swift: 'swift',
    javascript: 'javascript',
    js: 'javascript',
    typescript: 'typescript',
    ts: 'typescript',
    python: 'python',
    py: 'python',
    bash: 'bash',
    shell: 'bash',
    markdown: 'markdown',
    md: 'markdown',
    json: 'json',
    text: 'text'
  };
  
  const lang = langMap[language?.toLowerCase()] || language?.toLowerCase() || 'text';

  // 处理 textarea 滚动 - 同步高亮层和行号列的滚动
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    
    // 直接同步滚动位置（包括水平和垂直）
    if (highlightRef.current) {
      highlightRef.current.scrollTop = textarea.scrollTop;
      highlightRef.current.scrollLeft = textarea.scrollLeft;
    }
    if (lineNumberRef.current) {
      lineNumberRef.current.scrollTop = textarea.scrollTop;
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    if (onCursorChange) {
      onCursorChange(e.target.selectionStart || 0);
    }
  };

  const handleCursorUpdate = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    if (!onCursorChange) return;
    const target = e.currentTarget as HTMLTextAreaElement;
    onCursorChange(target.selectionStart || 0);
  };

  const lineCount = (value || '').split('\n').length;

  // 统一的样式变量
  const editorStyles = {
    padding: '1rem 1.25rem',
    fontSize: '0.8125rem',
    lineHeight: 1.5,
    fontFamily: 'ui-monospace, monospace',
    minHeight: '200px'
  };

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
      style={{ 
        height: rows ? 'auto' : height,
        minHeight: editorStyles.minHeight,
        display: 'flex',
        borderRadius: '0',
        backgroundColor: '#282c34'
      }}
    >
      {/* 行号列 - 独立渲染 */}
      {showLineNumbers && (
        <div
          ref={lineNumberRef}
          className="flex-shrink-0 overflow-hidden pointer-events-none select-none"
          style={{
            width: '3.5em',
            backgroundColor: '#282c34',
            color: '#5c6370',
            fontSize: editorStyles.fontSize,
            lineHeight: editorStyles.lineHeight,
            textAlign: 'right',
            paddingTop: '1rem',
            paddingRight: '0.75em',
            paddingBottom: '1rem',
            borderRadius: '0',
            fontFamily: editorStyles.fontFamily
          }}
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
      )}

      {/* 代码区域容器 */}
      <div 
        className="relative flex-1"
        style={{
          borderRadius: '0',
          backgroundColor: '#282c34'
        }}
      >
        {/* 高亮显示层 - 不可交互，可滚动但滚动条隐藏 */}
        <div
          ref={highlightRef}
          className="absolute inset-0 pointer-events-none highlight-scroll-hidden"
          style={{
            zIndex: 0,
            overflow: 'scroll'
          }}
        >
          <SyntaxHighlighter
            language={lang}
            style={oneDark}
            showLineNumbers={false}
            customStyle={{
              margin: 0,
              padding: editorStyles.padding,
              fontSize: editorStyles.fontSize,
              lineHeight: editorStyles.lineHeight,
              borderRadius: '0',
              whiteSpace: 'pre',
              verticalAlign: 'top',
              display: 'inline-block',
              minWidth: '100%',
              minHeight: '100%',
              backgroundColor: '#282c34'
            }}
            codeTagProps={{
              style: {
                fontFamily: editorStyles.fontFamily,
                whiteSpace: 'pre' as const,
                verticalAlign: 'top' as const,
                fontSize: editorStyles.fontSize,
                lineHeight: editorStyles.lineHeight
              }
            }}
            PreTag="div"
          >
            {(() => {
              const content = value || placeholder;
              return content[content.length - 1] === '\n' ? content + ' ' : content;
            })()}
          </SyntaxHighlighter>
        </div>

        {/* 输入层 - textarea（透明，显示光标） */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onSelect={handleCursorUpdate}
          onKeyUp={handleCursorUpdate}
          onClick={handleCursorUpdate}
          onScroll={handleScroll}
          rows={rows}
          placeholder={placeholder}
          className="absolute inset-0 w-full h-full resize-none outline-none"
          style={{
            padding: editorStyles.padding,
            lineHeight: editorStyles.lineHeight,
            fontSize: editorStyles.fontSize,
            fontFamily: editorStyles.fontFamily,
            caretColor: '#61afef',
            backgroundColor: 'transparent',
            color: 'transparent',
            WebkitTextFillColor: 'transparent',
            zIndex: 10,
            border: 'none',
            margin: 0,
            overflow: 'auto',
            WebkitAppearance: 'none',
            appearance: 'none' as const,
            boxSizing: 'border-box',
            whiteSpace: 'pre'
          }}
        />
      </div>
    </div>
  );
};
export default HighlightedCodeEditor;
