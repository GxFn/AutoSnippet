import { Globe, Layout, Cpu, Zap, Database, Wifi, HardDrive, Box, Layers } from 'lucide-react';

export const categoryConfigs: Record<string, { icon: any, color: string, bg: string, border: string }> = {
  All: { icon: Globe, color: 'text-slate-600', bg: 'bg-slate-100', border: 'border-slate-200' },
  View: { icon: Layout, color: 'text-pink-600', bg: 'bg-pink-50', border: 'border-pink-100' },
  Service: { icon: Cpu, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-100' },
  Tool: { icon: Zap, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100' },
  Model: { icon: Database, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' },
  Network: { icon: Wifi, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100' },
  Storage: { icon: HardDrive, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-100' },
  UI: { icon: Box, color: 'text-cyan-600', bg: 'bg-cyan-50', border: 'border-cyan-100' },
  Utility: { icon: Layers, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-100' },
};

export const categories = ['All', 'View', 'Service', 'Tool', 'Model', 'Network', 'Storage', 'UI', 'Utility'];

export const validTabs = ['snippets', 'recipes', 'ai', 'spm', 'candidates', 'depgraph', 'guard', 'editor', 'help'] as const;
export type TabType = typeof validTabs[number];

/** GitHub 提交问题入口（Guard 误报、规则建议等） */
export const GITHUB_ISSUES_URL = 'https://github.com/GxFn/AutoSnippet/issues';
export const GITHUB_ISSUES_NEW_GUARD_URL = 'https://github.com/GxFn/AutoSnippet/issues/new?title=Guard%20误报%2F建议%3A%20&body=请描述误报的规则ID、代码片段或改进建议。';
