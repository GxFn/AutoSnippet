/**
 * 主仪表盘页面 - 带图表可视化、实时更新
 */

import React, { useState, useEffect } from 'react';
import { apiClient, Candidate, Recipe, GuardRule } from '../services/apiClient';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Activity,
  Users2,
  BookOpen,
  Shield,
  ArrowRight,
  Loader,
  TrendingUp,
  AlertCircle,
  Code2,
  Star,
} from 'lucide-react';
import {
  SimpleBarChart,
  SimplePieChart,
  SimpleLineChart,
} from '../components/SimpleCharts';
import {
  generateTrendData,
  generateStatusDistribution,
  generateQualityDistribution,
  generateCategoryDistribution,
  generateRuleActionDistribution,
} from '../utils/chartData';
import { useCandidateEvents, useRecipeEvents, useRuleEvents, useRealtime } from '../services/realtimeService';

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    candidatesTotal: 0,
    recipesTotal: 0,
    rulesTotal: 0,
    serverStatus: 'checking',
  });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [rules, setRules] = useState<GuardRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { isConnected } = useRealtime();

  // 监听实时事件
  useCandidateEvents(
    (candidate) => {
      setCandidates((prev) => {
        const exists = prev.some((c) => c.id === candidate.id);
        if (!exists) {
          toast.success(`✓ 新候选项：${candidate.category || candidate.language || 'unknown'}`, { icon: '👤' });
          setStats((prev) => ({
            ...prev,
            candidatesTotal: prev.candidatesTotal + 1,
          }));
          return [candidate, ...prev];
        }
        return prev;
      });
    },
    (candidateId, newStatus) => {
      setCandidates((prev) =>
        prev.map((c) =>
          c.id === candidateId ? { ...c, status: newStatus as any } : c
        )
      );
    }
  );

  useRecipeEvents(
    (recipe) => {
      setRecipes((prev) => {
        const exists = prev.some((r) => r.id === recipe.id);
        if (!exists) {
          toast.success(`✓ 新食谱：${recipe.title}`, { icon: '📖' });
          setStats((prev) => ({
            ...prev,
            recipesTotal: prev.recipesTotal + 1,
          }));
          return [recipe, ...prev];
        }
        return prev;
      });
    },
    (recipe) => {
      toast.success(`✓ 食谱已发布：${recipe.title}`, { icon: '🚀' });
    }
  );

  useRuleEvents(
    (rule) => {
      setRules((prev) => {
        const exists = prev.some((r) => r.id === rule.id);
        if (!exists) {
          toast.success(`✓ 新规则：${rule.name}`, { icon: '🔒' });
          setStats((prev) => ({
            ...prev,
            rulesTotal: prev.rulesTotal + 1,
          }));
          return [rule, ...prev];
        }
        return prev;
      });
    },
    (ruleId, enabled) => {
      setRules((prev) =>
        prev.map((r) => (r.id === ruleId ? { ...r, enabled } : r))
      );
    }
  );

  // 加载统计数据
  useEffect(() => {
    const loadStats = async () => {
      try {
        // 检查服务器健康状态
        await apiClient.healthCheck();
        
        // 获取各资源数据
        const [candidatesRes, recipesRes, rulesRes] = await Promise.all([
          apiClient.getCandidates(1, 100),
          apiClient.getRecipes(1, 100),
          apiClient.getGuardRules(1, 100),
        ]);

        setCandidates(candidatesRes.items);
        setRecipes(recipesRes.items);
        setRules(rulesRes.items);

        setStats({
          candidatesTotal: candidatesRes.total,
          recipesTotal: recipesRes.total,
          rulesTotal: rulesRes.total,
          serverStatus: 'healthy',
        });
      } catch (error) {
        console.error('Failed to load stats:', error);
        setStats((prev) => ({
          ...prev,
          serverStatus: 'error',
        }));
      } finally {
        setIsLoading(false);
      }
    };

    loadStats();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-5xl font-bold text-white mb-2">
            AutoSnippet Dashboard
          </h1>
          <p className="text-xl text-slate-400">
            智能代码片段管理系统
          </p>
        </div>

        {/* Server Status */}
        <div className="mb-8 p-6 bg-slate-800 border border-slate-700 rounded-lg">
          <div className="flex items-center gap-3 mb-2">
            <Activity
              size={24}
              className={`${
                stats.serverStatus === 'healthy'
                  ? 'text-green-400'
                  : 'text-red-400'
              }`}
            />
            <h2 className="text-lg font-semibold text-white">
              Server Status
            </h2>
            {isConnected && (
              <div className="ml-auto flex items-center gap-2">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <span className="text-sm text-green-400">实时连接已启用</span>
              </div>
            )}
          </div>
          <p
            className={`text-sm ${
              stats.serverStatus === 'healthy'
                ? 'text-green-400'
                : 'text-red-400'
            }`}
          >
            {stats.serverStatus === 'healthy'
              ? '✓ 服务器运行正常'
              : stats.serverStatus === 'checking'
              ? '检查中...'
              : '✗ 服务器连接失败'}
          </p>
        </div>

        {/* Stats Grid */}
        {!isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            {/* Candidates Card */}
            <button
              onClick={() => navigate('/candidates')}
              className="group p-6 bg-slate-800 border border-slate-700 rounded-lg hover:border-blue-500 transition"
            >
              <div className="flex items-center justify-between mb-4">
                <Users2 size={32} className="text-blue-400" />
                <ArrowRight
                  size={20}
                  className="text-slate-500 group-hover:text-blue-400 transition"
                />
              </div>
              <h3 className="text-2xl font-bold text-white mb-1">
                {stats.candidatesTotal}
              </h3>
              <p className="text-slate-400">Candidates</p>
            </button>

            {/* Recipes Card */}
            <button
              onClick={() => navigate('/recipes')}
              className="group p-6 bg-slate-800 border border-slate-700 rounded-lg hover:border-green-500 transition"
            >
              <div className="flex items-center justify-between mb-4">
                <BookOpen size={32} className="text-green-400" />
                <ArrowRight
                  size={20}
                  className="text-slate-500 group-hover:text-green-400 transition"
                />
              </div>
              <h3 className="text-2xl font-bold text-white mb-1">
                {stats.recipesTotal}
              </h3>
              <p className="text-slate-400">Recipes</p>
            </button>

            {/* Rules Card */}
            <button
              onClick={() => navigate('/rules')}
              className="group p-6 bg-slate-800 border border-slate-700 rounded-lg hover:border-purple-500 transition"
            >
              <div className="flex items-center justify-between mb-4">
                <Shield size={32} className="text-purple-400" />
                <ArrowRight
                  size={20}
                  className="text-slate-500 group-hover:text-purple-400 transition"
                />
              </div>
              <h3 className="text-2xl font-bold text-white mb-1">
                {stats.rulesTotal}
              </h3>
              <p className="text-slate-400">Guard Rules</p>
            </button>

            {/* API Status Card */}
            <div className="p-6 bg-slate-800 border border-slate-700 rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <Activity size={32} className="text-yellow-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-1">API v1</h3>
              <p className="text-slate-400">REST Endpoints</p>
            </div>
          </div>
        ) : (
          <div className="flex justify-center items-center py-24">
            <Loader size={40} className="text-blue-500 animate-spin" />
          </div>
        )}

        {/* Charts Section */}
        {!isLoading && (
          <>
            {/* Top Recipes Preview */}
            {recipes.length > 0 && (
              <div className="mb-12">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <Code2 className="text-green-400" size={24} />
                    <h2 className="text-xl font-bold text-white">Top Recipes</h2>
                  </div>
                  <button
                    onClick={() => navigate('/recipes')}
                    className="text-sm text-slate-400 hover:text-green-400 transition flex items-center gap-1"
                  >
                    查看全部 <ArrowRight size={14} />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {recipes
                    .filter((r) => r.status === 'active')
                    .slice(0, 3)
                    .map((recipe) => (
                      <button
                        key={recipe.id}
                        onClick={() => navigate('/recipes')}
                        className="text-left p-5 bg-slate-800 border border-slate-700 rounded-lg hover:border-green-500/60 transition group"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-sm font-semibold text-white truncate max-w-[70%]">
                            {recipe.title}
                          </h3>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            recipe.kind === 'rule' ? 'bg-purple-500/20 text-purple-300' :
                            recipe.kind === 'pattern' ? 'bg-blue-500/20 text-blue-300' :
                            'bg-amber-500/20 text-amber-300'
                          }`}>
                            {recipe.kind || 'recipe'}
                          </span>
                        </div>
                        {recipe.content?.pattern && (
                          <pre className="text-xs text-slate-400 bg-slate-900/60 rounded p-2.5 mb-3 overflow-hidden max-h-24 font-mono leading-relaxed border border-slate-700/50">
                            {recipe.content.pattern.length > 200
                              ? recipe.content.pattern.slice(0, 200) + '…'
                              : recipe.content.pattern}
                          </pre>
                        )}
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          {recipe.quality?.overall != null && (
                            <span className="flex items-center gap-1">
                              <Star size={12} className="text-yellow-400" />
                              {typeof recipe.quality.overall === 'number'
                                ? recipe.quality.overall.toFixed(1)
                                : recipe.quality.overall}
                            </span>
                          )}
                          {recipe.tags && recipe.tags.length > 0 && (
                            <span className="text-slate-600 truncate max-w-[160px]">
                              {recipe.tags.slice(0, 3).join(' · ')}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  {recipes.filter((r) => r.status === 'active').length === 0 && (
                    <p className="text-slate-500 text-sm col-span-3">暂无 active 状态的 Recipe</p>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* Charts Section */}
        {!isLoading && (
          <div className="mt-12">
            <div className="flex items-center gap-2 mb-8">
              <TrendingUp className="text-blue-400" size={28} />
              <h2 className="text-2xl font-bold text-white">统计分析</h2>
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-12">
              {/* Trend Line Chart */}
              <SimpleLineChart
                data={generateTrendData()}
                title="7天趋势 - 候选人新增"
                dataKey="candidates"
              />

              {/* Candidate Status Pie Chart */}
              <SimplePieChart
                data={generateStatusDistribution(candidates)}
                title="候选人状态分布"
              />

              {/* Recipe Quality Bar Chart */}
              <SimpleBarChart
                data={generateQualityDistribution(recipes)}
                title="食谱质量分布"
              />

              {/* Category Distribution */}
              <SimplePieChart
                data={generateCategoryDistribution(recipes)}
                title="食谱分类分布"
              />

              {/* Rules Action Distribution */}
              <SimpleBarChart
                data={generateRuleActionDistribution(rules)}
                title="防护规则类型分布"
              />

              {/* Recipe Trends */}
              <SimpleLineChart
                data={generateTrendData()}
                title="7天趋势 - 食谱新增"
                dataKey="recipes"
              />
            </div>
          </div>
        )}

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              icon: Users2,
              title: 'Candidate Management',
              description: '创建、批准或拒绝代码候选项',
            },
            {
              icon: BookOpen,
              title: 'Recipe Management',
              description: '管理代码片段食谱和发布版本',
            },
            {
              icon: Shield,
              title: 'Security Rules',
              description: '配置和管理防护规则',
            },
          ].map((feature, index) => (
            <div
              key={index}
              className="p-6 bg-slate-800 border border-slate-700 rounded-lg hover:border-blue-500 transition"
            >
              <feature.icon size={32} className="text-blue-400 mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">
                {feature.title}
              </h3>
              <p className="text-slate-400 text-sm">{feature.description}</p>
            </div>
          ))}
        </div>

        {/* Quick Links */}
        <div className="mt-12 p-6 bg-slate-800 border border-slate-700 rounded-lg">
          <h2 className="text-lg font-bold text-white mb-4">Quick Links</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'API Docs', href: '/api-spec' },
              { label: 'Candidates', href: '/candidates' },
              { label: 'Recipes', href: '/recipes' },
              { label: 'Rules', href: '/rules' },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded transition text-center text-sm"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
