import React, { useState, useCallback, useRef, useEffect } from 'react';
import { X, Send, Check, RotateCcw, Sparkles, Loader2, ChevronRight, ArrowRight, Tag, MessageSquare, FileText, Brain } from 'lucide-react';
import { CandidateItem } from '../../types';
import api from '../../api';
import { notify } from '../../utils/notification';

/* ═══════════════════════════════════════════════════════════
 * RefineChatPanel — 对话式润色面板
 *
 * 右侧滑出面板，包含:
 *   1. 候选概要（当前正在润色的候选）
 *   2. 对话区域（用户输入 → AI 返回 before/after diff）
 *   3. 底部输入框 + 按钮
 *
 * 交互流:
 *   点击润色 → 面板打开 → 用户输入指令 → AI 预览 diff
 *   → 用户确认 Accept 或继续对话 → 应用变更（无页面刷新）
 * ═══════════════════════════════════════════════════════════ */

interface RefineChatPanelProps {
  /** 要润色的候选 ID 列表 */
  candidateIds: string[];
  /** 完整候选数据（用于展示 before 状态） */
  candidates: CandidateItem[];
  /** 关闭面板 */
  onClose: () => void;
  /** 数据变更后通知父组件刷新（不触发整页刷新） */
  onCandidateUpdated: (candidateId: string) => void;
}

interface DiffField {
  field: string;
  label: string;
  before: string;
  after: string;
  changed: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  diff?: DiffField[];
  preview?: Record<string, any>;
  timestamp: number;
}

/** 生成随机 ID */
const uid = () => Math.random().toString(36).substring(2, 10);

/** 对比两个值生成 DiffField */
function buildDiffFields(before: Record<string, any>, after: Record<string, any>): DiffField[] {
  const fields: DiffField[] = [];

  const fieldDefs: { key: string; label: string; format?: (v: any) => string }[] = [
    { key: 'summary', label: '摘要 (summary)' },
    { key: 'code', label: '代码 (code)' },
    { key: 'tags', label: '标签 (tags)', format: (v) => (Array.isArray(v) ? v.join(', ') : String(v || '')) },
    { key: 'confidence', label: '置信度 (confidence)', format: (v) => String(v ?? '—') },
    { key: 'insight', label: 'AI 洞察 (insight)' },
    { key: 'agentNotes', label: 'Agent 笔记', format: (v) => (Array.isArray(v) ? v.join('\n') : String(v || '')) },
    { key: 'relations', label: '关联关系 (relations)', format: (v) => JSON.stringify(v || [], null, 2) },
  ];

  for (const def of fieldDefs) {
    const bVal = before[def.key];
    const aVal = after[def.key];
    const fmt = def.format || ((v: any) => String(v ?? ''));
    const bStr = fmt(bVal);
    const aStr = fmt(aVal);
    if (aStr && aStr !== bStr) {
      fields.push({ field: def.key, label: def.label, before: bStr, after: aStr, changed: true });
    }
  }

  return fields;
}

/** 从候选提取 before 快照 */
function extractBefore(cand: CandidateItem): Record<string, any> {
  return {
    title: cand.title || '',
    summary: cand.summary || '',
    code: cand.code || '',
    tags: cand.tags || [],
    confidence: cand.reasoning?.confidence ?? 0.6,
    relations: (cand as any).relations || [],
    insight: null,
    agentNotes: null,
  };
}

/* ── DiffView 子组件 ── */
const DiffView: React.FC<{ diff: DiffField[] }> = ({ diff }) => {
  if (diff.length === 0) {
    return <p className="text-xs text-slate-400 italic py-2">未检测到变更</p>;
  }
  return (
    <div className="space-y-3">
      {diff.map((d) => (
        <div key={d.field} className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center gap-1.5">
            <ArrowRight size={12} className="text-emerald-500" />
            <span className="text-[11px] font-bold text-slate-600">{d.label}</span>
          </div>
          <div className="grid grid-cols-2 divide-x divide-slate-200">
            {/* Before */}
            <div className="p-3 bg-red-50/30">
              <div className="text-[10px] font-bold text-red-400 mb-1 uppercase">Before</div>
              <pre className="text-xs text-slate-600 whitespace-pre-wrap break-words max-h-40 overflow-auto font-mono leading-relaxed">
                {d.before || <span className="italic text-slate-300">（空）</span>}
              </pre>
            </div>
            {/* After */}
            <div className="p-3 bg-emerald-50/30">
              <div className="text-[10px] font-bold text-emerald-500 mb-1 uppercase">After</div>
              <pre className="text-xs text-slate-700 whitespace-pre-wrap break-words max-h-40 overflow-auto font-mono leading-relaxed">
                {d.after}
              </pre>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

/* ── 主组件 ── */
const RefineChatPanel: React.FC<RefineChatPanelProps> = ({
  candidateIds, candidates, onClose, onCandidateUpdated,
}) => {
  // 当前正在润色的候选索引（batch 模式下逐个推进）
  const [currentIdx, setCurrentIdx] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [lastPrompt, setLastPrompt] = useState('');
  const [applied, setApplied] = useState<Set<string>>(new Set());

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const currentId = candidateIds[currentIdx];
  const currentCandidate = candidates.find(c => c.id === currentId);
  const isBatch = candidateIds.length > 1;

  // 自动滚动到底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 面板打开时聚焦输入框
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 300);
  }, [currentIdx]);

  // 切换候选时添加系统消息
  useEffect(() => {
    if (currentCandidate) {
      setMessages([{
        id: uid(),
        role: 'system',
        content: `正在润色: **${currentCandidate.title}**\n\n当前摘要: ${currentCandidate.summary || '(无)'}`,
        timestamp: Date.now(),
      }]);
      setLastPrompt('');
    }
  }, [currentIdx]);

  /** 发送润色指令 */
  const handleSend = useCallback(async () => {
    if (!input.trim() || loading || !currentId) return;
    const prompt = input.trim();
    setInput('');
    setLastPrompt(prompt);

    // 添加用户消息
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: prompt, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const result = await api.refinePreview(currentId, prompt);
      const before = result.before || extractBefore(currentCandidate!);
      const after = result.after || {};
      const diff = buildDiffFields(before, after);

      const assistantMsg: ChatMessage = {
        id: uid(),
        role: 'assistant',
        content: diff.length > 0
          ? `已生成润色预览，共 ${diff.length} 个字段变更：`
          : '未检测到需要变更的内容，请尝试更具体的指令。',
        diff: diff.length > 0 ? diff : undefined,
        preview: result.preview,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      const errMsg: ChatMessage = {
        id: uid(),
        role: 'assistant',
        content: `润色预览失败: ${err.response?.data?.error || err.message}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, currentId, currentCandidate]);

  /** 接受变更 — 应用到数据库 */
  const handleAccept = useCallback(async () => {
    if (applying || !currentId) return;
    setApplying(true);

    try {
      await api.refineApply(currentId, lastPrompt);
      setApplied(prev => new Set(prev).add(currentId));
      onCandidateUpdated(currentId);

      const sysMsg: ChatMessage = {
        id: uid(),
        role: 'system',
        content: '✅ 变更已应用！',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, sysMsg]);
      notify('润色已应用');
    } catch (err: any) {
      notify(`应用失败: ${err.response?.data?.error || err.message}`, { type: 'error' });
    } finally {
      setApplying(false);
    }
  }, [applying, currentId, lastPrompt, onCandidateUpdated]);

  /** 批量模式 — 下一条候选 */
  const handleNext = useCallback(() => {
    if (currentIdx < candidateIds.length - 1) {
      setCurrentIdx(prev => prev + 1);
    }
  }, [currentIdx, candidateIds.length]);

  /** 键盘: Enter 发送, Shift+Enter 换行 */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // 判断是否有待确认的 diff
  const hasPendingDiff = messages.some(m => m.role === 'assistant' && m.diff && m.diff.length > 0)
    && !applied.has(currentId);

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* 遮罩 */}
      <div className="flex-1 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      {/* 右侧面板 */}
      <div className="w-[680px] max-w-[90vw] bg-white shadow-2xl flex flex-col animate-slide-in-right">
        {/* ── Header ── */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 flex items-center justify-center">
              <MessageSquare className="text-emerald-600" size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                对话式润色
                {isBatch && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-medium">
                    {currentIdx + 1} / {candidateIds.length}
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-slate-400 truncate max-w-[400px]">
                {currentCandidate?.title || '(未命名)'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X size={18} className="text-slate-400" />
          </button>
        </div>

        {/* ── 当前候选信息 ── */}
        {currentCandidate && (
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 shrink-0">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <FileText size={12} className="text-slate-400 shrink-0" />
                  <span className="text-xs font-bold text-slate-700 truncate">{currentCandidate.title}</span>
                  {currentCandidate.language && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">
                      {currentCandidate.language}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                  {currentCandidate.summary || '(无摘要)'}
                </p>
                {currentCandidate.tags && currentCandidate.tags.length > 0 && (
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    <Tag size={10} className="text-slate-300" />
                    {currentCandidate.tags.slice(0, 6).map(t => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{t}</span>
                    ))}
                    {currentCandidate.tags.length > 6 && (
                      <span className="text-[10px] text-slate-400">+{currentCandidate.tags.length - 6}</span>
                    )}
                  </div>
                )}
              </div>
              {currentCandidate.reasoning?.confidence != null && (
                <div className="text-center shrink-0">
                  <div className="text-[10px] text-slate-400">置信度</div>
                  <div className="text-sm font-bold text-slate-700">
                    {Math.round(currentCandidate.reasoning.confidence * 100)}%
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── 对话区域 ── */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-4">
                <Sparkles className="text-emerald-500" size={24} />
              </div>
              <h4 className="text-sm font-bold text-slate-700 mb-1">输入润色指令</h4>
              <p className="text-xs text-slate-400 max-w-sm leading-relaxed mb-4">
                描述你希望如何改善这条候选的内容。AI 将生成预览，你可以确认后再应用变更。
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {[
                  '改善 summary 描述，使其更精准',
                  '补充架构洞察和设计模式分析',
                  '侧重线程安全和内存管理',
                  '用更简洁的语言改写',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(suggestion)}
                    className="text-[11px] px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 transition-colors border border-transparent hover:border-emerald-200"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[95%] ${
                msg.role === 'user'
                  ? 'bg-emerald-600 text-white rounded-2xl rounded-tr-md px-4 py-2.5'
                  : msg.role === 'system'
                    ? 'bg-slate-50 border border-slate-200 text-slate-600 rounded-2xl px-4 py-2.5 w-full'
                    : 'bg-white border border-slate-200 rounded-2xl rounded-tl-md px-4 py-3 shadow-sm w-full'
              }`}>
                {/* 消息头 */}
                {msg.role === 'assistant' && (
                  <div className="flex items-center gap-1.5 mb-2">
                    <Brain size={14} className="text-emerald-500" />
                    <span className="text-[11px] font-bold text-emerald-600">AI 润色助手</span>
                  </div>
                )}

                {/* 消息内容 */}
                <p className={`text-xs leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'user' ? '' : msg.role === 'system' ? 'text-slate-500' : 'text-slate-700'
                }`}>
                  {msg.content}
                </p>

                {/* Diff 展示 */}
                {msg.diff && msg.diff.length > 0 && (
                  <div className="mt-3">
                    <DiffView diff={msg.diff} />
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Loading */}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-md px-4 py-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin text-emerald-500" />
                  <span className="text-xs text-slate-500">AI 正在分析并生成润色预览...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* ── 操作按钮区域（有 diff 时显示） ── */}
        {hasPendingDiff && !loading && (
          <div className="px-5 py-2.5 border-t border-slate-100 bg-emerald-50/50 flex items-center gap-2 shrink-0">
            <button
              onClick={handleAccept}
              disabled={applying}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 rounded-lg shadow-sm transition-all disabled:opacity-50"
            >
              {applying
                ? <Loader2 size={12} className="animate-spin" />
                : <Check size={12} />
              }
              {applying ? '应用中...' : '确认应用变更'}
            </button>
            <button
              onClick={() => {
                setInput('');
                inputRef.current?.focus();
              }}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <RotateCcw size={12} />
              继续调整
            </button>
            {isBatch && applied.has(currentId) && currentIdx < candidateIds.length - 1 && (
              <button
                onClick={handleNext}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-blue-600 hover:text-blue-700 rounded-lg hover:bg-blue-50 transition-colors ml-auto"
              >
                下一条 <ChevronRight size={12} />
              </button>
            )}
          </div>
        )}

        {/* 批量已应用，显示下一条按钮 */}
        {isBatch && applied.has(currentId) && !hasPendingDiff && !loading && currentIdx < candidateIds.length - 1 && (
          <div className="px-5 py-2.5 border-t border-slate-100 flex items-center justify-center shrink-0">
            <button
              onClick={handleNext}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-blue-600 hover:text-blue-700 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors"
            >
              润色下一条 ({currentIdx + 2} / {candidateIds.length}) <ChevronRight size={14} />
            </button>
          </div>
        )}

        {/* ── 输入区域 ── */}
        <div className="px-5 py-3 border-t border-slate-200 bg-white shrink-0">
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入润色指令..."
                rows={2}
                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 resize-none placeholder:text-slate-300"
                disabled={loading || applying}
              />
            </div>
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading || applying}
              className="p-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
            >
              <Send size={16} />
            </button>
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">
            Enter 发送 · Shift+Enter 换行 · AI 先预览 diff 再确认应用
          </p>
        </div>
      </div>

      {/* 滑入动画 */}
      <style>{`
        @keyframes slide-in-right {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.25s ease-out;
        }
      `}</style>
    </div>
  );
};

export default RefineChatPanel;
