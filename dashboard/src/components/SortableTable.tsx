import React from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { SortOrder } from '../utils/tableUtils';

interface SortableHeaderProps {
  label: string;
  sortKey: string;
  currentSortKey?: string;
  currentSortOrder?: SortOrder;
  onSort: (key: string) => void;
}

/**
 * 可排序的表头单元格
 * 点击切换排序顺序：null -> asc -> desc -> null
 */
export const SortableHeader: React.FC<SortableHeaderProps> = ({
  label,
  sortKey,
  currentSortKey,
  currentSortOrder,
  onSort,
}) => {
  const isActive = currentSortKey === sortKey;

  const handleClick = () => {
    onSort(sortKey);
  };

  return (
    <th
      className="px-4 py-3 bg-gray-800 text-gray-100 cursor-pointer hover:bg-gray-700 transition-colors"
      onClick={handleClick}
    >
      <div className="flex items-center gap-2">
        <span>{label}</span>
        {isActive && currentSortOrder && (
          <div className="flex-shrink-0">
            {currentSortOrder === 'asc' ? (
              <ChevronUp className="w-4 h-4 text-blue-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-blue-400" />
            )}
          </div>
        )}
        {!isActive && (
          <div className="flex-shrink-0">
            <div className="w-4 h-4 text-gray-500 opacity-0 group-hover:opacity-100" />
          </div>
        )}
      </div>
    </th>
  );
};

interface TableControlsProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onExport: () => void;
  filterElement?: React.ReactNode;
}

/**
 * 表格控制栏 - 搜索、筛选、导出
 */
export const TableControls: React.FC<TableControlsProps> = ({
  searchTerm,
  onSearchChange,
  onExport,
  filterElement,
}) => {
  return (
    <div className="mb-6 space-y-4">
      {/* 搜索栏 */}
      <div className="flex gap-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="搜索..."
            value={searchTerm}
            onChange={e => onSearchChange(e.target.value)}
            className="w-full px-4 py-2 bg-gray-700 text-gray-100 rounded-md border border-gray-600 focus:border-blue-500 focus:outline-none transition-colors"
          />
        </div>
        <button
          onClick={onExport}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center gap-2"
        >
          <span>📥 导出 CSV</span>
        </button>
      </div>

      {/* 筛选区域 */}
      {filterElement && <div className="flex gap-4">{filterElement}</div>}
    </div>
  );
};
