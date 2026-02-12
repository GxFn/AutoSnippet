import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { RefreshCw, Share2, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import api from '../../api';
import { ICON_SIZES } from '../../constants/icons';

// ─── Types ────────────────────────────────────────────

interface GraphEdge {
  id: number;
  fromId: string;
  fromType: string;
  toId: string;
  toType: string;
  relation: string;
  weight: number;
  metadata: Record<string, any>;
}

interface GraphNode {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

// ─── Constants ────────────────────────────────────────

const NODE_R = 24;
const FONT_SIZE = 11;
const PADDING = 60;

/** 关系类型 → 颜色 */
const RELATION_COLORS: Record<string, string> = {
  depends_on:   '#3b82f6',  // blue
  requires:     '#3b82f6',
  extends:      '#10b981',  // green
  implements:   '#10b981',
  inherits:     '#10b981',
  enforces:     '#f59e0b',  // amber
  related:      '#8b5cf6',  // purple
  conflicts:    '#ef4444',  // red
  calls:        '#06b6d4',  // cyan
  prerequisite: '#f97316',  // orange
  data_flow_to: '#14b8a6',  // teal
  references:   '#6b7280',  // gray
  alternative:  '#a855f7',
  deprecated_by:'#dc2626',
  solves:       '#22c55e',
};

const RELATION_LABELS: Record<string, string> = {
  depends_on:   '依赖',
  requires:     '需要',
  extends:      '扩展',
  implements:   '实现',
  inherits:     '继承',
  enforces:     '约束',
  related:      '关联',
  conflicts:    '冲突',
  calls:        '调用',
  prerequisite: '前置',
  data_flow_to: '数据流',
  references:   '引用',
  alternative:  '替代',
  deprecated_by:'废弃',
  solves:       '解决',
};

// ─── Force-directed layout ────────────────────────────

function buildNodes(edges: GraphEdge[], nodeLabels: Record<string, string>): GraphNode[] {
  const idSet = new Set<string>();
  for (const e of edges) {
    idSet.add(e.fromId);
    idSet.add(e.toId);
  }
  const nodes: GraphNode[] = [];
  const cx = 400, cy = 300;
  let i = 0;
  for (const id of idSet) {
    const angle = (i / idSet.size) * 2 * Math.PI;
    const r = 150 + Math.random() * 100;
    nodes.push({
      id,
      label: nodeLabels[id] || id.substring(0, 12),
      type: 'recipe',
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      vx: 0,
      vy: 0,
    });
    i++;
  }
  return nodes;
}

/** 简单力导向布局：repulsion + spring + centering + damping */
function forceLayout(nodesIn: GraphNode[], edges: GraphEdge[], iterations = 120): GraphNode[] {
  const nodes = nodesIn.map(n => ({ ...n }));
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const cx = 400, cy = 300;

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations; // cooling
    const repK = 8000 * alpha;
    const springK = 0.02;
    const centerK = 0.005;
    const damping = 0.85;

    // Repulsion (all pairs)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = repK / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }

    // Spring (edges)
    for (const e of edges) {
      const a = nodeMap.get(e.fromId);
      const b = nodeMap.get(e.toId);
      if (!a || !b) continue;
      let dx = b.x - a.x, dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const ideal = 120;
      const force = springK * (dist - ideal);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }

    // Centering
    for (const n of nodes) {
      n.vx += (cx - n.x) * centerK;
      n.vy += (cy - n.y) * centerK;
    }

    // Apply velocity + damping
    for (const n of nodes) {
      n.vx *= damping;
      n.vy *= damping;
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  return nodes;
}

// ─── Component ────────────────────────────────────────

const KnowledgeGraphView: React.FC = () => {
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [nodeLabels, setNodeLabels] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<{ totalEdges: number; byRelation: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const fetchGraph = async () => {
    setLoading(true);
    setError(null);
    try {
      const [graphData, statsData] = await Promise.all([
        api.getKnowledgeGraph(),
        api.getGraphStats(),
      ]);
      setEdges(graphData.edges || []);
      setNodeLabels(graphData.nodeLabels || {});
      setStats(statsData);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || '加载知识图谱失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchGraph(); }, []);

  // Force-directed layout
  const nodes = useMemo(() => {
    if (edges.length === 0) return [];
    const raw = buildNodes(edges, nodeLabels);
    return forceLayout(raw, edges);
  }, [edges, nodeLabels]);

  // Compute SVG viewBox
  const viewBox = useMemo(() => {
    if (nodes.length === 0) return { x: 0, y: 0, w: 800, h: 600 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x);
      maxY = Math.max(maxY, n.y);
    }
    return {
      x: minX - PADDING * 2,
      y: minY - PADDING * 2,
      w: maxX - minX + PADDING * 4,
      h: maxY - minY + PADDING * 4,
    };
  }, [nodes]);

  // Node map for edge rendering
  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  // Connected edges for selected node
  const connectedEdgeIds = useMemo(() => {
    if (!selectedNode) return new Set<number>();
    return new Set(edges.filter(e => e.fromId === selectedNode || e.toId === selectedNode).map(e => e.id));
  }, [selectedNode, edges]);

  // Relation type filter
  const [activeRelations, setActiveRelations] = useState<Set<string>>(new Set());
  useEffect(() => {
    const allRels = new Set(edges.map(e => e.relation));
    setActiveRelations(allRels);
  }, [edges]);

  const filteredEdges = useMemo(() => {
    return edges.filter(e => activeRelations.has(e.relation));
  }, [edges, activeRelations]);

  const toggleRelation = (rel: string) => {
    setActiveRelations(prev => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
  };

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isPanning.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setPan(p => ({ x: p.x + dx, y: p.y + dy }));
  }, []);

  const handleMouseUp = useCallback(() => { isPanning.current = false; }, []);

  // Arrow marker id
  const arrowId = (rel: string) => `arrow-${rel.replace(/[^a-z_]/g, '')}`;

  // ─── Render ──────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-red-500">{error}</p>
        <button onClick={fetchGraph} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">重试</button>
      </div>
    );
  }

  if (edges.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-500">
        <Share2 size={48} className="text-slate-300" />
        <p className="text-lg font-medium">知识图谱为空</p>
        <p className="text-sm">请先通过 Bootstrap 初始化知识库，然后审核候选为 Recipe，关系将自动同步到图谱。</p>
        <button onClick={fetchGraph} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2">
          <RefreshCw size={ICON_SIZES.sm} /> 刷新
        </button>
      </div>
    );
  }

  const uniqueRelations = [...new Set(edges.map(e => e.relation))].sort();

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Share2 size={ICON_SIZES.lg} className="text-blue-600" />
          <h2 className="text-lg font-bold text-slate-800">知识图谱</h2>
          {stats && (
            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
              {nodes.length} 节点 · {stats.totalEdges} 条关系
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setZoom(z => Math.min(z + 0.2, 3))} className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors" title="放大">
            <ZoomIn size={ICON_SIZES.sm} />
          </button>
          <button onClick={() => setZoom(z => Math.max(z - 0.2, 0.3))} className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors" title="缩小">
            <ZoomOut size={ICON_SIZES.sm} />
          </button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors" title="重置视图">
            <Maximize2 size={ICON_SIZES.sm} />
          </button>
          <button onClick={fetchGraph} className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors" title="刷新">
            <RefreshCw size={ICON_SIZES.sm} />
          </button>
        </div>
      </div>

      {/* Relation filter legend */}
      <div className="flex flex-wrap gap-2 mb-3">
        {uniqueRelations.map(rel => (
          <button
            key={rel}
            onClick={() => toggleRelation(rel)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-all border ${
              activeRelations.has(rel)
                ? 'border-transparent shadow-sm'
                : 'border-slate-200 bg-white text-slate-400 opacity-50'
            }`}
            style={activeRelations.has(rel) ? {
              backgroundColor: (RELATION_COLORS[rel] || '#6b7280') + '18',
              color: RELATION_COLORS[rel] || '#6b7280',
            } : {}}
          >
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: RELATION_COLORS[rel] || '#6b7280' }} />
            {RELATION_LABELS[rel] || rel}
            {stats?.byRelation?.[rel] && <span className="opacity-60">({stats.byRelation[rel]})</span>}
          </button>
        ))}
      </div>

      {/* SVG Canvas */}
      <div
        className="flex-1 rounded-xl border border-slate-200 bg-white overflow-hidden relative"
        style={{ cursor: isPanning.current ? 'grabbing' : 'grab' }}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)` }}
        >
          {/* Arrow markers */}
          <defs>
            {uniqueRelations.map(rel => (
              <marker
                key={rel}
                id={arrowId(rel)}
                viewBox="0 0 10 8"
                refX="10"
                refY="4"
                markerWidth="8"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,4 L0,8 Z" fill={RELATION_COLORS[rel] || '#6b7280'} />
              </marker>
            ))}
          </defs>

          {/* Edges */}
          {filteredEdges.map(e => {
            const from = nodeMap.get(e.fromId);
            const to = nodeMap.get(e.toId);
            if (!from || !to) return null;

            const isHighlighted = selectedNode ? connectedEdgeIds.has(e.id) : true;
            const isHovered = hoveredEdge === e.id;
            const opacity = selectedNode ? (isHighlighted ? 1 : 0.1) : (isHovered ? 1 : 0.6);

            // Offset line to end at node border
            const dx = to.x - from.x, dy = to.y - from.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const offsetX = (dx / dist) * NODE_R;
            const offsetY = (dy / dist) * NODE_R;

            return (
              <g key={e.id}>
                <line
                  x1={from.x + offsetX}
                  y1={from.y + offsetY}
                  x2={to.x - offsetX}
                  y2={to.y - offsetY}
                  stroke={RELATION_COLORS[e.relation] || '#6b7280'}
                  strokeWidth={isHovered ? 2.5 : 1.5}
                  opacity={opacity}
                  markerEnd={`url(#${arrowId(e.relation)})`}
                  onMouseEnter={() => setHoveredEdge(e.id)}
                  onMouseLeave={() => setHoveredEdge(null)}
                  style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                />
                {isHovered && (
                  <text
                    x={(from.x + to.x) / 2}
                    y={(from.y + to.y) / 2 - 8}
                    textAnchor="middle"
                    fontSize={10}
                    fill={RELATION_COLORS[e.relation] || '#6b7280'}
                    fontWeight={600}
                  >
                    {RELATION_LABELS[e.relation] || e.relation}
                  </text>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {nodes.map(n => {
            const isSelected = selectedNode === n.id;
            const isConnected = selectedNode ? connectedEdgeIds.size > 0 && edges.some(
              e => (e.fromId === selectedNode && e.toId === n.id) || (e.toId === selectedNode && e.fromId === n.id)
            ) : false;
            const opacity = selectedNode ? (isSelected || isConnected ? 1 : 0.15) : 1;

            return (
              <g
                key={n.id}
                onClick={(e) => { e.stopPropagation(); setSelectedNode(isSelected ? null : n.id); }}
                style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                opacity={opacity}
              >
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={NODE_R}
                  fill={isSelected ? '#3b82f6' : '#f8fafc'}
                  stroke={isSelected ? '#2563eb' : '#cbd5e1'}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                />
                <text
                  x={n.x}
                  y={n.y + NODE_R + 14}
                  textAnchor="middle"
                  fontSize={FONT_SIZE}
                  fill={isSelected ? '#1e40af' : '#475569'}
                  fontWeight={isSelected ? 600 : 400}
                >
                  {n.label.length > 20 ? n.label.substring(0, 18) + '…' : n.label}
                </text>
                {/* Abbreviation inside circle */}
                <text
                  x={n.x}
                  y={n.y + 4}
                  textAnchor="middle"
                  fontSize={9}
                  fill={isSelected ? '#ffffff' : '#64748b'}
                  fontWeight={600}
                >
                  {n.label.split('/').pop()?.substring(0, 4).toUpperCase() || '?'}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Click away to deselect */}
        {selectedNode && (
          <button
            className="absolute top-2 right-2 text-xs text-slate-400 hover:text-slate-600 bg-white/80 px-2 py-1 rounded"
            onClick={() => setSelectedNode(null)}
          >
            取消选中
          </button>
        )}
      </div>

      {/* Selected node detail panel */}
      {selectedNode && (
        <div className="mt-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
          <h3 className="font-semibold text-sm text-slate-700 mb-2">
            {nodeLabels[selectedNode] || selectedNode}
          </h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-500">出边（依赖）:</span>
              <ul className="mt-1 space-y-0.5">
                {edges
                  .filter(e => e.fromId === selectedNode && activeRelations.has(e.relation))
                  .map(e => (
                    <li key={e.id} className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: RELATION_COLORS[e.relation] || '#6b7280' }} />
                      <span className="text-slate-600">{RELATION_LABELS[e.relation] || e.relation}</span>
                      <span className="text-slate-400">→</span>
                      <button className="text-blue-600 hover:underline" onClick={() => setSelectedNode(e.toId)}>
                        {nodeLabels[e.toId] || e.toId.substring(0, 12)}
                      </button>
                    </li>
                  ))}
                {edges.filter(e => e.fromId === selectedNode && activeRelations.has(e.relation)).length === 0 && (
                  <li className="text-slate-400">无</li>
                )}
              </ul>
            </div>
            <div>
              <span className="text-slate-500">入边（被依赖）:</span>
              <ul className="mt-1 space-y-0.5">
                {edges
                  .filter(e => e.toId === selectedNode && activeRelations.has(e.relation))
                  .map(e => (
                    <li key={e.id} className="flex items-center gap-1.5">
                      <button className="text-blue-600 hover:underline" onClick={() => setSelectedNode(e.fromId)}>
                        {nodeLabels[e.fromId] || e.fromId.substring(0, 12)}
                      </button>
                      <span className="text-slate-400">→</span>
                      <span className="text-slate-600">{RELATION_LABELS[e.relation] || e.relation}</span>
                    </li>
                  ))}
                {edges.filter(e => e.toId === selectedNode && activeRelations.has(e.relation)).length === 0 && (
                  <li className="text-slate-400">无</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KnowledgeGraphView;
