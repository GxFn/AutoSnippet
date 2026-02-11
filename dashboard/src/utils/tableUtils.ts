/**
 * 表格操作工具库 - 排序、筛选、导出
 */

// 排序类型定义
export type SortOrder = 'asc' | 'desc' | null;

export interface SortConfig {
  key: string;
  order: SortOrder;
}

// 排序函数
export function sortData<T>(data: T[], sortConfig: SortConfig | null): T[] {
  if (!sortConfig || !sortConfig.order) {
    return data;
  }

  const sorted = [...data].sort((a: any, b: any) => {
    const aVal = a[sortConfig.key];
    const bVal = b[sortConfig.key];

    // 处理 null/undefined
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;

    // 字符串比较
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortConfig.order === 'asc'
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    }

    // 数字比较
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return sortConfig.order === 'asc' ? aVal - bVal : bVal - aVal;
    }

    // 日期比较
    if (aVal instanceof Date && bVal instanceof Date) {
      return sortConfig.order === 'asc'
        ? aVal.getTime() - bVal.getTime()
        : bVal.getTime() - aVal.getTime();
    }

    // 默认字符串比较
    const aStr = String(aVal);
    const bStr = String(bVal);
    return sortConfig.order === 'asc'
      ? aStr.localeCompare(bStr)
      : bStr.localeCompare(aStr);
  });

  return sorted;
}

// 筛选函数
export function filterData<T>(
  data: T[],
  searchTerm: string,
  searchKeys: (keyof T)[]
): T[] {
  if (!searchTerm.trim()) {
    return data;
  }

  const term = searchTerm.toLowerCase();
  return data.filter(item =>
    searchKeys.some(key => {
      const val = item[key];
      return String(val).toLowerCase().includes(term);
    })
  );
}

// CSV 导出
export function exportToCSV<T>(
  data: T[],
  fileName: string,
  columns: { key: keyof T; label: string }[]
) {
  // 生成 CSV 内容
  const headers = columns.map(col => col.label).join(',');
  const rows = data.map(item =>
    columns
      .map(col => {
        const val = item[col.key];
        // 处理包含逗号或引号的值
        const str = String(val ?? '');
        return str.includes(',') || str.includes('"')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      })
      .join(',')
  );

  const csv = [headers, ...rows].join('\n');

  // 创建 Blob 并下载
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `${fileName}.csv`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 状态筛选
export function filterByStatus<T extends { status?: string }>(
  data: T[],
  status: string | null
): T[] {
  if (!status) return data;
  return data.filter(item => item.status === status);
}

// 日期范围筛选
export function filterByDateRange<T extends { createdAt?: string | Date }>(
  data: T[],
  startDate: Date | null,
  endDate: Date | null
): T[] {
  if (!startDate && !endDate) return data;

  return data.filter(item => {
    if (!item.createdAt) return false;

    const itemDate = new Date(item.createdAt);
    if (startDate && itemDate < startDate) return false;
    if (endDate && itemDate > endDate) return false;

    return true;
  });
}

// 分页函数
export interface PaginationConfig {
  currentPage: number;
  pageSize: number;
  total: number;
}

export function paginate<T>(
  data: T[],
  currentPage: number,
  pageSize: number
): T[] {
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  return data.slice(startIndex, endIndex);
}

// 获取分页信息
export function getPaginationInfo(
  total: number,
  currentPage: number,
  pageSize: number
) {
  const totalPages = Math.ceil(total / pageSize);
  const hasNextPage = currentPage < totalPages;
  const hasPrevPage = currentPage > 1;

  return {
    totalPages,
    hasNextPage,
    hasPrevPage,
    startIndex: (currentPage - 1) * pageSize + 1,
    endIndex: Math.min(currentPage * pageSize, total),
  };
}
