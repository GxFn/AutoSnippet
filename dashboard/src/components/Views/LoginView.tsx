/**
 * LoginView — V1 风格登录页
 *
 * 居中卡片设计，配色与 Dashboard 主体（slate + blue accent）保持一致。
 * 支持用户名/密码表单、错误提示、加载状态。
 */

import React, { useState, type FormEvent } from 'react';
import { Code, LogIn, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { ICON_SIZES } from '../../constants/icons';

interface LoginViewProps {
  onLogin: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  isLoading: boolean;
}

const LoginView: React.FC<LoginViewProps> = ({ onLogin, isLoading }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim()) {
      setError('请输入用户名');
      return;
    }
    if (!password) {
      setError('请输入密码');
      return;
    }

    const result = await onLogin(username.trim(), password);
    if (!result.success) {
      setError(result.error || '登录失败，请重试');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
      {/* 背景装饰 */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-100 rounded-full opacity-40 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-indigo-100 rounded-full opacity-40 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo + 标题 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl shadow-lg shadow-blue-600/20 mb-4">
            <Code size={ICON_SIZES.xxl} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">AutoSnippet</h1>
          <p className="text-sm text-slate-500 mt-1">连接开发者、AI 与项目知识库</p>
        </div>

        {/* 登录卡片 */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8">
          <h2 className="text-lg font-bold text-slate-800 mb-6">登录 Dashboard</h2>

          {/* 错误提示 */}
          {error && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-100 rounded-lg text-red-700 text-sm">
              <AlertCircle size={ICON_SIZES.md} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 用户名 */}
            <div>
              <label htmlFor="username" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                用户名
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="输入用户名"
                disabled={isLoading}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 disabled:opacity-60"
              />
            </div>

            {/* 密码 */}
            <div>
              <label htmlFor="password" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                密码
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="输入密码"
                  disabled={isLoading}
                  className="w-full px-3 py-2.5 pr-10 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 disabled:opacity-60"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword
                    ? <EyeOff size={ICON_SIZES.md} />
                    : <Eye size={ICON_SIZES.md} />
                  }
                </button>
              </div>
            </div>

            {/* 登录按钮 */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>登录中...</span>
                </>
              ) : (
                <>
                  <LogIn size={ICON_SIZES.md} />
                  <span>登录</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* 底部提示 */}
        <p className="text-center text-xs text-slate-400 mt-6">
          登录功能由 <code className="text-slate-500">VITE_AUTH_ENABLED</code> 环境变量控制
        </p>
      </div>
    </div>
  );
};

export default LoginView;
