import React from 'react';
import { ChartDataPoint, TrendDataPoint, CHART_COLORS } from '../utils/chartData';

interface SimpleBarChartProps {
  data: ChartDataPoint[];
  title: string;
  height?: number;
}

/**
 * 简易柱状图 - 不依赖第三方图表库
 */
export const SimpleBarChart: React.FC<SimpleBarChartProps> = ({
  data,
  title,
  height = 300,
}) => {
  if (!data || data.length === 0) {
    return <div className="text-slate-400 text-center py-8">No data available</div>;
  }

  const maxValue = Math.max(...data.map(d => d.value), 1);
  const barWidth = 100 / data.length;
  const padding = 40;
  const chartHeight = height - padding * 2;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
      <h3 className="text-lg font-bold text-white mb-4">{title}</h3>
      <svg width="100%" height={height} style={{ minHeight: height }}>
        {/* Y轴 */}
        <line
          x1={padding}
          y1={padding}
          x2={padding}
          y2={height - padding}
          stroke="#475569"
          strokeWidth="1"
        />
        {/* X轴 */}
        <line
          x1={padding}
          y1={height - padding}
          x2="100%"
          y2={height - padding}
          stroke="#475569"
          strokeWidth="1"
        />

        {/* 柱子和标签 */}
        {data.map((item, index) => {
          const barHeight = (item.value / maxValue) * chartHeight;
          const x = padding + (index + 0.2) * barWidth;
          const y = height - padding - barHeight;
          const color = CHART_COLORS[index % CHART_COLORS.length];

          return (
            <g key={item.name}>
              {/* 柱子 */}
              <rect
                x={`${padding + index * barWidth + 2}%`}
                y={y}
                width={`${barWidth - 4}%`}
                height={barHeight}
                fill={color}
                opacity="0.8"
              />
              {/* 值标签 */}
              <text
                x={`${padding + (index + 0.5) * barWidth}%`}
                y={y - 5}
                textAnchor="middle"
                fill="#E2E8F0"
                fontSize="12"
                fontWeight="bold"
              >
                {item.value}
              </text>
              {/* X轴标签 */}
              <text
                x={`${padding + (index + 0.5) * barWidth}%`}
                y={height - padding + 20}
                textAnchor="middle"
                fill="#94A3B8"
                fontSize="12"
              >
                {item.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

interface SimplePieChartProps {
  data: ChartDataPoint[];
  title: string;
  size?: number;
}

/**
 * 简易饼图
 */
export const SimplePieChart: React.FC<SimplePieChartProps> = ({
  data,
  title,
  size = 300,
}) => {
  if (!data || data.length === 0) {
    return <div className="text-slate-400 text-center py-8">No data available</div>;
  }

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = size / 3;

  let currentAngle = -Math.PI / 2;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
      <h3 className="text-lg font-bold text-white mb-4">{title}</h3>
      <div className="flex items-center justify-center">
        <div className="relative">
          <svg width={size} height={size}>
            {data.map((item, index) => {
              const sliceAngle = (item.value / total) * Math.PI * 2;
              const endAngle = currentAngle + sliceAngle;

              const startX =
                centerX + radius * Math.cos(currentAngle);
              const startY =
                centerY + radius * Math.sin(currentAngle);
              const endX = centerX + radius * Math.cos(endAngle);
              const endY = centerY + radius * Math.sin(endAngle);

              const largeArc = sliceAngle > Math.PI ? 1 : 0;

              const pathData = [
                `M ${centerX} ${centerY}`,
                `L ${startX} ${startY}`,
                `A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY}`,
                'Z',
              ].join(' ');

              const color = CHART_COLORS[index % CHART_COLORS.length];

              // 计算标签位置
              const labelAngle = currentAngle + sliceAngle / 2;
              const labelRadius = radius * 0.65;
              const labelX = centerX + labelRadius * Math.cos(labelAngle);
              const labelY = centerY + labelRadius * Math.sin(labelAngle);
              const percentage = ((item.value / total) * 100).toFixed(1);

              currentAngle = endAngle;

              return (
                <g key={item.name}>
                  <path d={pathData} fill={color} opacity="0.8" stroke="#1E293B" strokeWidth="2" />
                  <text
                    x={labelX}
                    y={labelY}
                    textAnchor="middle"
                    dy="0.3em"
                    fill="white"
                    fontSize="12"
                    fontWeight="bold"
                  >
                    {percentage}%
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      {/* 图例 */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        {data.map((item, index) => (
          <div key={item.name} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
            />
            <span className="text-sm text-slate-300">
              {item.name} ({item.value})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

interface SimpleLineChartProps {
  data: TrendDataPoint[];
  title: string;
  dataKey: 'candidates' | 'recipes' | 'rules';
  height?: number;
}

/**
 * 简易折线图
 */
export const SimpleLineChart: React.FC<SimpleLineChartProps> = ({
  data,
  title,
  dataKey,
  height = 300,
}) => {
  if (!data || data.length === 0) {
    return <div className="text-slate-400 text-center py-8">No data available</div>;
  }

  const values = data.map(d => d[dataKey]);
  const maxValue = Math.max(...values, 1);
  const minValue = 0;
  const padding = 50;
  const chartHeight = height - padding * 2;
  const chartWidth = 100;

  const points = data.map((item, index) => {
    const x = padding + (index / (data.length - 1)) * (chartWidth - padding * 2);
    const y =
      height -
      padding -
      ((item[dataKey] - minValue) / (maxValue - minValue)) * chartHeight;
    return { x, y, value: item[dataKey], date: item.date };
  });

  const pathD = points
    .map((p, i) =>
      i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
    )
    .join(' ');

  const color = dataKey === 'candidates' ? '#3B82F6' : dataKey === 'recipes' ? '#10B981' : '#F59E0B';

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
      <h3 className="text-lg font-bold text-white mb-4">{title}</h3>
      <svg width="100%" height={height} style={{ minHeight: height }}>
        {/* Y轴 */}
        <line
          x1={padding}
          y1={padding}
          x2={padding}
          y2={height - padding}
          stroke="#475569"
          strokeWidth="1"
        />
        {/* X轴 */}
        <line
          x1={padding}
          y1={height - padding}
          x2="100%"
          y2={height - padding}
          stroke="#475569"
          strokeWidth="1"
        />

        {/* 折线 */}
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* 数据点 */}
        {points.map((p, index) => (
          <g key={index}>
            <circle cx={p.x} cy={p.y} r="4" fill={color} opacity="0.8" />
            <text
              x={p.x}
              y={height - padding + 20}
              textAnchor="middle"
              fill="#94A3B8"
              fontSize="11"
            >
              {p.date}
            </text>
            <text
              x={p.x}
              y={p.y - 10}
              textAnchor="middle"
              fill="#CBD5E1"
              fontSize="11"
            >
              {p.value}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
};
