/**
 * BootstrapProgressView — 冷启动异步进度面板
 *
 * 展示每个维度任务的卡片状态：
 *   skeleton  → 灰色骨架动画
 *   filling   → 蓝色脉冲动画
 *   completed → 绿色勾号
 *   failed    → 红色叉号
 *
 * 全部完成后弹出通知。
 */

import React, { useEffect, useRef, useState } from 'react';
import { Check, X, Loader2, Sparkles, Code2, Layers, BookOpen, Zap, Settings, Bot, Brain, Filter, Wand2, GitMerge, Clock, Wrench } from 'lucide-react';
import { notify } from '../../utils/notification';
import type { BootstrapSession, BootstrapTask, ReviewState } from '../../hooks/useBootstrapSocket';

/* ═══════════════════════════════════════════════════════
 *  Icon & Color mapping
 * ═══════════════════════════════════════════════════════ */

/** 与 orchestrator.js DIMENSION_EXECUTION_ORDER 保持一致 */
const DIMENSION_EXECUTION_ORDER = [
  'objc-deep-scan', 'category-scan',
  'project-profile',
  'code-standard',
  'architecture',
  'code-pattern',
  'event-and-data-flow',
  'best-practice',
  'agent-guidelines',
];

const DIM_ICON_MAP: Record<string, React.ReactNode> = {
  'code-standard':      <BookOpen className="w-5 h-5" />,
  'code-pattern':       <Code2 className="w-5 h-5" />,
  'architecture':       <Layers className="w-5 h-5" />,
  'best-practice':      <Sparkles className="w-5 h-5" />,
  'event-and-data-flow': <Zap className="w-5 h-5" />,
  'project-profile':    <Settings className="w-5 h-5" />,
  'agent-guidelines':   <Bot className="w-5 h-5" />,
};

function getDimIcon(dimId: string) {
  return DIM_ICON_MAP[dimId] || <Code2 className="w-5 h-5" />;
}

/* ═══════════════════════════════════════════════════════
 *  Task card component
 * ═══════════════════════════════════════════════════════ */

const TaskCard: React.FC<{ task: BootstrapTask }> = ({ task }) => {
  const { status, meta } = task;

  const statusStyles: Record<string, string> = {
    skeleton:  'bg-slate-50 border-slate-200',
    filling:   'bg-blue-50 border-blue-300',
    completed: 'bg-emerald-50 border-emerald-300',
    failed:    'bg-red-50 border-red-300',
  };

  const statusBadge: Record<string, React.ReactNode> = {
    skeleton: (
      <span className="flex items-center gap-1 text-xs text-slate-400">
        <div className="w-2 h-2 rounded-full bg-slate-300" />
        等待中
      </span>
    ),
    filling: (
      <span className="flex items-center gap-1 text-xs text-blue-600">
        <Loader2 className="w-3 h-3 animate-spin" />
        填充中
      </span>
    ),
    completed: (
      <span className="flex items-center gap-1 text-xs text-emerald-600">
        <Check className="w-3 h-3" />
        已完成
      </span>
    ),
    failed: (
      <span className="flex items-center gap-1 text-xs text-red-600">
        <X className="w-3 h-3" />
        失败
      </span>
    ),
  };

  return (
    <div className={`relative rounded-xl border p-4 transition-all duration-300 ${statusStyles[status] || statusStyles.skeleton}`}>
      {/* Skeleton shimmer overlay */}
      {status === 'skeleton' && (
        <div className="absolute inset-0 rounded-xl overflow-hidden">
          <div className="animate-pulse bg-gradient-to-r from-transparent via-slate-200/40 to-transparent h-full w-full" />
        </div>
      )}

      {/* Filling pulse overlay */}
      {status === 'filling' && (
        <div className="absolute inset-0 rounded-xl overflow-hidden">
          <div className="animate-pulse bg-gradient-to-r from-transparent via-blue-200/30 to-transparent h-full w-full" />
        </div>
      )}

      <div className="relative z-10 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex-shrink-0 p-2 rounded-lg ${
            status === 'completed' ? 'bg-emerald-100 text-emerald-600' :
            status === 'filling' ? 'bg-blue-100 text-blue-600' :
            status === 'failed' ? 'bg-red-100 text-red-600' :
            'bg-slate-100 text-slate-400'
          }`}>
            {getDimIcon(task.id)}
          </div>
          <div>
            <h3 className={`font-medium text-sm ${
              status === 'skeleton' ? 'text-slate-400' : 'text-slate-800'
            }`}>
              {meta.label}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {meta.skillWorthy ? 'Skill' : 'Candidate'}
              {task.result && status === 'completed' && (
                <span className="ml-2 text-emerald-600">
                  {(() => {
                    const r = task.result as Record<string, unknown>;
                    const sourceCount = (r.sourceCount as number) ?? 0;
                    const extracted = (r.extracted as number) ?? 0;
                    if (r.type === 'empty') return '✓ 无匹配内容';
                    if (r.type === 'skill') {
                      if (r.empty) return '✓ 无匹配内容';
                      // dualOutput 维度同时有 Skill + Candidate
                      return extracted > 0
                        ? `✓ ${sourceCount} 项特征 · ${extracted} 条候选`
                        : `✓ ${sourceCount} 项特征`;
                    }
                    // candidate 类型
                    return extracted > 0 ? `✓ ${extracted} 条候选` : '✓ 无匹配内容';
                  })()}
                </span>
              )}
              {task.error && status === 'failed' && (
                <span className="ml-2 text-red-500 truncate max-w-[200px] inline-block align-bottom">
                  {task.error}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex-shrink-0">
          {statusBadge[status]}
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════
 *  AI Review Pipeline panel
 * ═══════════════════════════════════════════════════════ */

const REVIEW_ROUNDS = [
  { key: 'round1' as const, label: '资格审查', desc: '过滤误报 · 识别合并', icon: <Filter className="w-4 h-4" /> },
  { key: 'round2' as const, label: '内容精炼', desc: 'AI 改写摘要 · 动态置信度', icon: <Wand2 className="w-4 h-4" /> },
  { key: 'round3' as const, label: '去重 & 关系', desc: '语义去重 · 关系推断', icon: <GitMerge className="w-4 h-4" /> },
] as const;

const ReviewPipelinePanel: React.FC<{ review: ReviewState }> = ({ review }) => {
  if (review.activeRound === 0) return null;

  return (
    <div className="mt-5 border border-purple-200 rounded-xl bg-purple-50/50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Brain className="w-5 h-5 text-purple-600" />
        <h3 className="text-sm font-semibold text-purple-800">AI 审查管线</h3>
      </div>

      <div className="space-y-2.5">
        {REVIEW_ROUNDS.map(({ key, label, desc, icon }) => {
          const round = review[key];
          const isActive = round.status === 'running';
          const isDone = round.status === 'completed';
          const isIdle = round.status === 'idle';

          return (
            <div
              key={key}
              className={`flex items-center gap-3 p-2.5 rounded-lg border transition-all duration-300 ${
                isActive ? 'border-purple-300 bg-purple-100/60' :
                isDone    ? 'border-emerald-300 bg-emerald-50/60' :
                            'border-slate-200 bg-white/40'
              }`}
            >
              {/* Icon */}
              <div className={`flex-shrink-0 p-1.5 rounded-md ${
                isActive ? 'bg-purple-200 text-purple-700' :
                isDone    ? 'bg-emerald-100 text-emerald-600' :
                            'bg-slate-100 text-slate-400'
              }`}>
                {icon}
              </div>

              {/* Label + detail */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${isIdle ? 'text-slate-400' : 'text-slate-800'}`}>{label}</span>
                  <span className="text-xs text-slate-400">{desc}</span>
                </div>

                {/* Round-specific progress details */}
                {key === 'round1' && isDone && (
                  <p className="text-xs text-emerald-600 mt-0.5">
                    保留 {review.round1.kept ?? '?'} · 合并 {review.round1.merged ?? 0} · 丢弃 {review.round1.dropped ?? 0}
                  </p>
                )}
                {key === 'round2' && isActive && typeof review.round2.progress === 'number' && (
                  <div className="mt-1.5">
                    <div className="w-full h-1.5 bg-purple-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 rounded-full transition-all duration-300"
                        style={{ width: `${review.round2.progress}%` }}
                      />
                    </div>
                    <p className="text-xs text-purple-600 mt-0.5">{review.round2.current ?? 0}/{review.round2.total ?? '?'} 条</p>
                  </div>
                )}
                {key === 'round2' && isDone && (
                  <p className="text-xs text-emerald-600 mt-0.5">
                    已精炼 {review.round2.refined ?? '?'}/{review.round2.total ?? '?'} 条
                  </p>
                )}
                {key === 'round3' && isDone && (
                  <p className="text-xs text-emerald-600 mt-0.5">
                    去重后 {review.round3.afterDedup ?? '?'} 条 · {review.round3.relationsFound ?? 0} 条关系
                  </p>
                )}
              </div>

              {/* Status indicator */}
              <div className="flex-shrink-0">
                {isActive && <Loader2 className="w-4 h-4 text-purple-500 animate-spin" />}
                {isDone && <Check className="w-4 h-4 text-emerald-500" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════
 *  Time formatting helper
 * ═══════════════════════════════════════════════════════ */

function formatDuration(ms: number): string {
  if (ms < 0) return '--';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec.toString().padStart(2, '0')}s`;
}

/* ═══════════════════════════════════════════════════════
 *  Main progress panel
 * ═══════════════════════════════════════════════════════ */

interface BootstrapProgressViewProps {
  session: BootstrapSession | null;
  isAllDone: boolean;
  /** AI review pipeline state */
  reviewState?: ReviewState;
  /** Called when user acknowledges completion */
  onDismiss?: () => void;
}

const BootstrapProgressView: React.FC<BootstrapProgressViewProps> = ({
  session,
  isAllDone,
  reviewState,
  onDismiss,
}) => {
  const notifiedRef = useRef(false);
  const [now, setNow] = useState(Date.now());

  // Tick every second while running
  useEffect(() => {
    if (!session || session.status !== 'running') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session?.status]);

  // Notify on completion
  useEffect(() => {
    if (isAllDone && session && !notifiedRef.current) {
      notifiedRef.current = true;
      const msg = session.failed > 0
        ? `${session.completed}/${session.total} 成功，${session.failed} 失败`
        : `${session.completed} 个维度全部填充成功`;
      notify(msg, { title: '冷启动完成', type: session.failed > 0 ? 'error' : 'success' });
    }
  }, [isAllDone, session]);

  // Reset notification flag when session changes
  useEffect(() => {
    if (!session) notifiedRef.current = false;
  }, [session?.id]);

  if (!session) return null;

  // ── Compute elapsed & estimated remaining time ──
  const elapsedMs = session.startedAt ? now - session.startedAt : (session.elapsedMs ?? 0);
  const done = session.completed + session.failed;
  const remaining = session.total - done;
  // Use server-reported elapsed (from last task completion) for remaining estimate — fixed, not ticking
  const serverElapsedMs = session.elapsedMs ?? 0;
  const estimatedRemainingMs = done > 0 && serverElapsedMs > 0 ? Math.round((serverElapsedMs / done) * remaining) : -1;
  const toolCalls = session.totalToolCalls ?? 0;

  const statusText =
    session.status === 'completed' ? '全部完成' :
    session.status === 'completed_with_errors' ? '完成（有错误）' :
    null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">冷启动进度</h2>
          {statusText && <p className="text-sm text-slate-500 mt-0.5">{statusText}</p>}
        </div>
        {isAllDone && onDismiss && (
          <button
            onClick={onDismiss}
            className="text-sm px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
          >
            关闭
          </button>
        )}
      </div>

      {/* Stats bar — elapsed time, remaining time, tool calls */}
      <div className="flex flex-wrap items-center gap-4 mb-5 text-sm">
        <div className="flex items-center gap-1.5 text-slate-600">
          <Clock size={14} className="text-slate-400" />
          <span>已用 <span className="font-medium text-slate-800">{formatDuration(elapsedMs)}</span></span>
        </div>
        {session.status === 'running' && remaining > 0 && estimatedRemainingMs > 0 && (
          <div className="flex items-center gap-1.5 text-slate-600">
            <Clock size={14} className="text-blue-400" />
            <span>预计剩余 <span className="font-medium text-blue-600">{formatDuration(estimatedRemainingMs)}</span></span>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-slate-600">
          <Wrench size={14} className="text-slate-400" />
          <span>工具调用 <span className="font-medium text-slate-800">{toolCalls}</span></span>
        </div>
        <div className="text-slate-400 text-xs">
          {done}/{session.total} 维度
        </div>
      </div>

      {/* Task cards grid — sorted by execution order */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {[...session.tasks]
          .sort((a, b) => {
            const ai = DIMENSION_EXECUTION_ORDER.indexOf(a.meta?.dimId ?? a.id);
            const bi = DIMENSION_EXECUTION_ORDER.indexOf(b.meta?.dimId ?? b.id);
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
          })
          .map(task => (
            <TaskCard key={task.id} task={task} />
          ))}
      </div>

      {/* AI Review pipeline progress */}
      {reviewState && reviewState.activeRound > 0 && (
        <ReviewPipelinePanel review={reviewState} />
      )}
    </div>
  );
};

export default BootstrapProgressView;
