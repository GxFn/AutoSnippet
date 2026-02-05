import React from 'react';

/**
 * 动态组件加载时的占位符
 */
export const ComponentLoader: React.FC = () => {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-gray-500 text-center">
        <div className="mb-4">加载中...</div>
        <div className="animate-pulse w-8 h-8 border-4 border-gray-300 border-t-blue-500 rounded-full mx-auto"></div>
      </div>
    </div>
  );
};
