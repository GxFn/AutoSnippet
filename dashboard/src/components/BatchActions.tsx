import React from 'react';
import { Trash2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

export interface BatchActionOptions {
  label: string;
  color: 'blue' | 'green' | 'red' | 'yellow';
  icon: React.ReactNode;
  onClick: () => void | Promise<void>;
  confirmMessage?: string;
}

interface BatchActionToolbarProps {
  selectedCount: number;
  onClear: () => void;
  actions: BatchActionOptions[];
  isLoading?: boolean;
}

/**
 * 批量操作工具栏组件
 * 显示已选中项数量和批量操作按钮
 */
export const BatchActionToolbar: React.FC<BatchActionToolbarProps> = ({
  selectedCount,
  onClear,
  actions,
  isLoading = false,
}) => {
  if (selectedCount === 0) {
    return null;
  }

  const handleAction = (action: BatchActionOptions) => {
    if (action.confirmMessage) {
      const confirmed = window.confirm(action.confirmMessage);
      if (!confirmed) return;
    }
    action.onClick();
  };

  const colorMap: Record<string, string> = {
    blue: 'bg-blue-600 hover:bg-blue-700',
    green: 'bg-green-600 hover:bg-green-700',
    red: 'bg-red-600 hover:bg-red-700',
    yellow: 'bg-yellow-600 hover:bg-yellow-700',
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700 p-4 shadow-lg">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          {/* 左侧 - 选中信息 */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-blue-400" />
              <span className="text-white font-medium">
                已选中 {selectedCount} 项
              </span>
            </div>
            <button
              onClick={onClear}
              className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition"
            >
              清空选择
            </button>
          </div>

          {/* 右侧 - 操作按钮 */}
          <div className="flex items-center gap-3">
            {actions.map((action, index) => (
              <button
                key={index}
                onClick={() => handleAction(action)}
                disabled={isLoading}
                className={`${colorMap[action.color]} text-white px-4 py-2 rounded flex items-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {action.icon}
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * 可选行组件
 * 与表格行一起使用，提供选择功能
 */
interface SelectableRowProps {
  id: string;
  isSelected: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}

export const SelectableRow: React.FC<SelectableRowProps> = ({
  id,
  isSelected,
  onToggle,
  children,
}) => {
  return (
    <tr
      className={`transition ${isSelected ? 'bg-blue-900/30' : 'hover:bg-slate-700'}`}
    >
      <td className="px-6 py-4">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(id)}
          className="w-4 h-4 rounded border-slate-600 cursor-pointer"
        />
      </td>
      {children}
    </tr>
  );
};

/**
 * 群选支持函数
 */
export function useSelection<T extends { id: string }>() {
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  const toggleSelection = (id: string) => {
    const newIds = new Set(selectedIds);
    if (newIds.has(id)) {
      newIds.delete(id);
    } else {
      newIds.add(id);
    }
    setSelectedIds(newIds);
  };

  const selectAll = (items: T[]) => {
    setSelectedIds(new Set(items.map(item => item.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const toggleSelectAll = (items: T[]) => {
    if (selectedIds.size === items.length) {
      clearSelection();
    } else {
      selectAll(items);
    }
  };

  const isSelected = (id: string) => selectedIds.has(id);

  const getSelectedItems = (items: T[]) => {
    return items.filter(item => isSelected(item.id));
  };

  return {
    selectedIds: Array.from(selectedIds),
    selectedCount: selectedIds.size,
    toggleSelection,
    selectAll,
    clearSelection,
    toggleSelectAll,
    isSelected,
    getSelectedItems,
  };
}
