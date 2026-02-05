import React from 'react';

/**
 * 动态导入各个视图组件，实现代码分割
 * 每个视图在用户导航时才加载，减小初始 bundle 大小
 */

export const SnippetsView = React.lazy(() =>
  import('./Views/SnippetsView').then(m => ({ default: m.default }))
);

export const RecipesView = React.lazy(() =>
  import('./Views/RecipesView').then(m => ({ default: m.default }))
);

export const HelpView = React.lazy(() =>
  import('./Views/HelpView').then(m => ({ default: m.default }))
);

export const CandidatesView = React.lazy(() =>
  import('./Views/CandidatesView').then(m => ({ default: m.default }))
);

export const SPMExplorerView = React.lazy(() =>
  import('./Views/SPMExplorerView').then(m => ({ default: m.default }))
);

export const DepGraphView = React.lazy(() =>
  import('./Views/DepGraphView').then(m => ({ default: m.default }))
);

export const GuardView = React.lazy(() =>
  import('./Views/GuardView').then(m => ({ default: m.default }))
);

export const AiChatView = React.lazy(() =>
  import('./Views/AiChatView').then(m => ({ default: m.default }))
);

export const SnippetEditor = React.lazy(() =>
  import('./Modals/SnippetEditor').then(m => ({ default: m.default }))
);

export const RecipeEditor = React.lazy(() =>
  import('./Modals/RecipeEditor').then(m => ({ default: m.default }))
);

export const CreateModal = React.lazy(() =>
  import('./Modals/CreateModal').then(m => ({ default: m.default }))
);

export const SearchModal = React.lazy(() =>
  import('./Modals/SearchModal').then(m => ({ default: m.default }))
);
