/**
 * 统计数据和图表数据生成
 */

export interface ChartDataPoint {
  name: string;
  value: number;
  percentage?: number;
}

export interface TrendDataPoint {
  date: string;
  candidates: number;
  recipes: number;
  rules: number;
}

/**
 * 生成模拟的趋势数据（用于演示）
 * 实际应用中应该从 API 获取真实数据
 */
export function generateTrendData(): TrendDataPoint[] {
  const data: TrendDataPoint[] = [];
  const today = new Date();

  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });

    data.push({
      date: dateStr,
      candidates: Math.floor(Math.random() * 50) + 10,
      recipes: Math.floor(Math.random() * 40) + 5,
      rules: Math.floor(Math.random() * 30) + 5,
    });
  }

  return data;
}

/**
 * 生成状态分布数据
 */
export function generateStatusDistribution(candidates: any[] = []): ChartDataPoint[] {
  if (candidates.length === 0) {
    return [
      { name: 'Pending', value: 12, percentage: 40 },
      { name: 'Approved', value: 14, percentage: 47 },
      { name: 'Rejected', value: 4, percentage: 13 },
    ];
  }

  const pending = candidates.filter((c: any) => c.status === 'pending').length;
  const approved = candidates.filter((c: any) => c.status === 'approved').length;
  const rejected = candidates.filter((c: any) => c.status === 'rejected').length;
  const total = candidates.length;

  return [
    {
      name: 'Pending',
      value: pending,
      percentage: total > 0 ? (pending / total) * 100 : 0,
    },
    {
      name: 'Approved',
      value: approved,
      percentage: total > 0 ? (approved / total) * 100 : 0,
    },
    {
      name: 'Rejected',
      value: rejected,
      percentage: total > 0 ? (rejected / total) * 100 : 0,
    },
  ];
}

/**
 * 生成质量分布数据
 */
export function generateQualityDistribution(recipes: any[] = []): ChartDataPoint[] {
  if (recipes.length === 0) {
    return [
      { name: 'Excellent', value: 8 },
      { name: 'Good', value: 15 },
      { name: 'Average', value: 10 },
      { name: 'Poor', value: 5 },
    ];
  }

  const bins = { excellent: 0, good: 0, average: 0, poor: 0 };

  recipes.forEach((r: any) => {
    const score = r.quality?.overall ?? r.qualityScore ?? 0;
    if (score >= 0.8) bins.excellent++;
    else if (score >= 0.6) bins.good++;
    else if (score >= 0.4) bins.average++;
    else bins.poor++;
  });

  return [
    { name: 'Excellent', value: bins.excellent },
    { name: 'Good', value: bins.good },
    { name: 'Average', value: bins.average },
    { name: 'Poor', value: bins.poor },
  ];
}

/**
 * 生成分类分布数据
 */
export function generateCategoryDistribution(recipes: any[] = []): ChartDataPoint[] {
  if (recipes.length === 0) {
    return [
      { name: 'Frontend', value: 20 },
      { name: 'Backend', value: 15 },
      { name: 'DevOps', value: 10 },
      { name: 'Database', value: 12 },
    ];
  }

  const categories: { [key: string]: number } = {};

  recipes.forEach((r: any) => {
    const cat = r.category || 'Other';
    categories[cat] = (categories[cat] || 0) + 1;
  });

  return Object.entries(categories).map(([name, value]) => ({
    name,
    value,
  }));
}

/**
 * 生成规则操作分布数据
 */
export function generateRuleActionDistribution(rules: any[] = []): ChartDataPoint[] {
  if (rules.length === 0) {
    return [
      { name: 'Block', value: 15 },
      { name: 'Warn', value: 8 },
      { name: 'Allow', value: 6 },
    ];
  }

  const actions: { [key: string]: number } = {};

  rules.forEach((r: any) => {
    const action = r.action || 'unknown';
    actions[action] = (actions[action] || 0) + 1;
  });

  return Object.entries(actions).map(([name, value]) => ({
    name,
    value,
  }));
}

/**
 * 获取增长率
 */
export function calculateGrowthRate(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

/**
 * 获取COLORS数组用于图表
 */
export const CHART_COLORS = [
  '#3B82F6', // Blue
  '#10B981', // Green
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#F97316', // Orange
];
