import React, { useState, useCallback, useEffect } from 'react';
import { Check, RotateCcw, ChevronRight, ArrowRight, Loader2 } from 'lucide-react';
import ChatPanel, { ChatMessage, uid } from '../Shared/ChatPanel';
import { CandidateItem } from '../../types';
import api from '../../api';
import { notify } from '../../utils/notification';

/* ═══════════════════════════════════════════════════════════
 * RefineChatPanel — 对话式润色面板
 *
 * 基于 ChatPanel 通用对话面板的润色场景扩展。
 * 注入润色专属逻辑: refinePreview → diff 预览 → Accept/Reject。
 *
 * ChatPanel 提供: 面板骨架、消息列表、输入框、上下文区域
 * 本组件提供: 润色 API 调用、diff 渲染、Accept/Reject 操作栏、batch 模式
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
  /** 嵌入模式 — 不渲染自身遮罩层，由父组件控制定位 */
  embedded?: boolean;
}

// ─── Diff 类型与工具函数 ───────────────────────────────────

interface DiffField {
  field: string;
  label: string;
  before: string;
  after: string;
  changed: boolean;
}

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

// ─── DiffView 子组件 ──────────────────────────────────────

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
            <div className="p-3 bg-red-50/30">
              <div className="text-[10px] font-bold text-red-400 mb-1 uppercase">Before</div>
              <pre className="text-xs text-slate-600 whitespace-pre-wrap break-words max-h-40 overflow-auto font-mono leading-relaxed scrollbar-light">
                {d.before || <span className="italic text-slate-300">（空）</span>}
              </pre>
            </div>
            <div className="p-3 bg-emerald-50/30">
              <div className="text-[10px] font-bold text-emerald-500 mb-1 uppercase">After</div>
              <pre className="text-xs text-slate-700 whitespace-pre-wrap break-words max-h-40 overflow-auto font-mono leading-relaxed scrollbar-light">
                {d.after}
              </pre>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// ─── 主组件 ───────────────────────────────────────────────

const RefineChatPanel: React.FC<RefineChatPanelProps> = ({
  candidateIds, candidates, onClose, onCandidateUpdated, embedded = false,
}) => {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [lastPrompt, setLastPrompt] = useState('');
  const [applied, setApplied] = useState<Set<string>>(new Set());

  const currentId = candidateIds[currentIdx];
  const currentCandidate = candidates.find(c => c.id === currentId);
  const isBatch = candidateIds.length > 1;

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

  /** 发送润色指令 — 注入给 ChatPanel.onSend */
  const handleSend = useCallback(async (prompt: string) => {
    if (loading || !currentId) return;
    setLastPrompt(prompt);

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
        extra: diff.length > 0 ? { diff, preview: result.preview } : undefined,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: uid(),
        role: 'assistant',
        content: `润色预览失败: ${err.response?.data?.error || err.message}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setLoading(false);
    }
  }, [loading, currentId, currentCandidate]);

  /** 接受变更 */
  const handleAccept = useCallback(async () => {
    if (applying || !currentId) return;
    setApplying(true);
    try {
      await api.refineApply(currentId, lastPrompt);
      setApplied(prev => new Set(prev).add(currentId));
      onCandidateUpdated(currentId);
      setMessages(prev => [...prev, {
        id: uid(), role: 'system', content: '✅ 变更已应用！', timestamp: Date.now(),
      }]);
      notify('润色已应用');
    } catch (err: any) {
      notify(`应用失败: ${err.response?.data?.error || err.message}`, { type: 'error' });
    } finally {
      setApplying(false);
    }
  }, [applying, currentId, lastPrompt, onCandidateUpdated]);

  /** 下一条 */
  const handleNext = useCallback(() => {
    if (currentIdx < candidateIds.length - 1) setCurrentIdx(prev => prev + 1);
  }, [currentIdx, candidateIds.length]);

  // 判断是否有待确认的 diff
  const hasPendingDiff = messages.some(m => m.role === 'assistant' && m.extra?.diff?.length > 0)
    && !applied.has(currentId);

  // ── 构建 ChatPanel 上下文 ──
  // embedded 模式下详情抽屉已展示全部候选信息，不重复显示上下文卡片
  const context = embedded ? undefined : (currentCandidate ? {
    title: currentCandidate.title || '(未命名)',
    subtitle: currentCandidate.summary || '(无摘要)',
    badge: currentCandidate.language || undefined,
    tags: currentCandidate.tags,
    indicator: currentCandidate.reasoning?.confidence != null
      ? { label: '置信度', value: `${Math.round(currentCandidate.reasoning.confidence * 100)}%` }
      : undefined,
    code: currentCandidate.code || undefined,
    codeLabel: '文档内容',
  } : undefined);

  // ── 消息扩展渲染（diff 展示） ──
  const renderMessageExtra = useCallback((msg: ChatMessage) => {
    const diff = msg.extra?.diff as DiffField[] | undefined;
    if (!diff || diff.length === 0) return null;
    return (
      <div className="mt-3">
        <DiffView diff={diff} />
      </div>
    );
  }, []);

  // ── 操作栏 ──
  const renderActions = useCallback(() => {
    if (hasPendingDiff && !loading) {
      return (
        <div className="px-5 py-2.5 border-t border-slate-100 bg-emerald-50/50 flex items-center gap-2 shrink-0">
          <button
            onClick={handleAccept}
            disabled={applying}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 rounded-lg shadow-sm transition-all disabled:opacity-50"
          >
            {applying ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            {applying ? '应用中...' : '确认应用变更'}
          </button>
          <button
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
      );
    }

    if (isBatch && applied.has(currentId) && !loading && currentIdx < candidateIds.length - 1) {
      return (
        <div className="px-5 py-2.5 border-t border-slate-100 flex items-center justify-center shrink-0">
          <button
            onClick={handleNext}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-blue-600 hover:text-blue-700 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors"
          >
            润色下一条 ({currentIdx + 2} / {candidateIds.length}) <ChevronRight size={14} />
          </button>
        </div>
      );
    }

    return null;
  }, [hasPendingDiff, loading, applying, handleAccept, handleNext, isBatch, applied, currentId, currentIdx, candidateIds.length]);

  return (
    <ChatPanel
      title="对话式润色"
      titleBadge={isBatch ? `${currentIdx + 1} / ${candidateIds.length}` : undefined}
      subtitle={currentCandidate?.title || '(未命名)'}
      themeColor="emerald"
      embedded={embedded}

      context={context}
      defaultCodeExpanded={true}

      messages={messages}
      loading={loading}
      loadingText="AI 正在分析并生成润色预览..."
      emptyTitle="输入润色指令"
      emptyDescription="描述你希望如何改善这条候选的内容。AI 将生成预览，你可以确认后再应用变更。"
      suggestions={[
        '改善 summary 描述，使其更精准',
        '补充架构洞察和设计模式分析',
        '侧重线程安全和内存管理',
        '用更简洁的语言改写',
      ]}
      assistantName="AI 润色助手"
      renderMessageExtra={renderMessageExtra}

      placeholder="输入润色指令..."
      inputHint="Enter 发送 · Shift+Enter 换行 · AI 先预览 diff 再确认应用"
      inputDisabled={applying}

      onSend={handleSend}
      onClose={onClose}

      renderActions={renderActions}
    />
  );
};

export default RefineChatPanel;
