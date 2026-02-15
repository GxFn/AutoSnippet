import React, { useState, useEffect } from 'react';
import { X, Save, Loader2, Eye, EyeOff, CheckCircle2, AlertTriangle } from 'lucide-react';
import api from '../../api';
import { ICON_SIZES } from '../../constants/icons';

interface LlmConfigModalProps {
  onClose: () => void;
  onSaved: () => void;
}

const PROVIDERS = [
  { id: 'google', label: 'Google Gemini', defaultModel: 'gemini-2.0-flash', keyEnv: 'ASD_GOOGLE_API_KEY' },
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o', keyEnv: 'ASD_OPENAI_API_KEY' },
  { id: 'deepseek', label: 'DeepSeek', defaultModel: 'deepseek-chat', keyEnv: 'ASD_DEEPSEEK_API_KEY' },
  { id: 'claude', label: 'Claude', defaultModel: 'claude-3-5-sonnet-20240620', keyEnv: 'ASD_CLAUDE_API_KEY' },
  { id: 'ollama', label: 'Ollama (本地)', defaultModel: 'llama3', keyEnv: '' },
];

const LlmConfigModal: React.FC<LlmConfigModalProps> = ({ onClose, onSaved }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasEnvFile, setHasEnvFile] = useState(false);
  const [provider, setProvider] = useState('google');
  const [model, setModel] = useState('gemini-2.0-flash');
  const [apiKey, setApiKey] = useState('');
  const [proxy, setProxy] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [existingKeys, setExistingKeys] = useState<Record<string, string>>({});
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await api.getLlmEnvConfig();
      setHasEnvFile(data.hasEnvFile);
      const vars = data.vars || {};
      if (vars.ASD_AI_PROVIDER) setProvider(vars.ASD_AI_PROVIDER);
      if (vars.ASD_AI_MODEL) setModel(vars.ASD_AI_MODEL);
      if (vars.ASD_AI_PROXY) setProxy(vars.ASD_AI_PROXY);
      setExistingKeys(vars);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const selectedProviderInfo = PROVIDERS.find(p => p.id === provider);
  const currentKeyEnv = selectedProviderInfo?.keyEnv || '';
  const hasExistingKey = currentKeyEnv ? !!existingKeys[currentKeyEnv] : true;

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    const info = PROVIDERS.find(p => p.id === newProvider);
    if (info) setModel(info.defaultModel);
    setApiKey('');
  };

  const handleSave = async () => {
    if (!provider) return;
    // 需要 API Key 的 provider 且没有旧 key 也没输入新 key
    if (currentKeyEnv && !hasExistingKey && !apiKey.trim()) {
      alert('请填写 API Key');
      return;
    }

    setSaving(true);
    setSaveSuccess(false);
    try {
      await api.saveLlmEnvConfig({
        provider,
        model: model || undefined,
        apiKey: apiKey.trim() || undefined,
        proxy: proxy.trim() || undefined,
      });
      setSaveSuccess(true);
      setTimeout(() => {
        onSaved();
        onClose();
      }, 800);
    } catch (err: any) {
      alert(err?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  /** 遮盖已有的 API Key，仅显示前后几位 */
  const maskKey = (key: string) => {
    if (!key || key.length < 10) return key ? '••••••' : '';
    return `${key.slice(0, 6)}••••${key.slice(-4)}`;
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-800">LLM 配置</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 transition-colors">
            <X size={ICON_SIZES.md} className="text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-blue-500" />
            </div>
          ) : (
            <>
              {!hasEnvFile && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>项目尚未配置 .env 文件，保存后将自动创建。</span>
                </div>
              )}

              {/* Provider */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">AI Provider</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {PROVIDERS.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleProviderChange(p.id)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                        provider === p.id
                          ? 'bg-blue-50 border-blue-300 text-blue-700 ring-1 ring-blue-200'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Model */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Model</label>
                <input
                  type="text"
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  placeholder={selectedProviderInfo?.defaultModel || ''}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                />
              </div>

              {/* API Key */}
              {currentKeyEnv && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    API Key
                    {hasExistingKey && (
                      <span className="ml-2 text-xs text-green-600 font-normal">
                        (已配置: {maskKey(existingKeys[currentKeyEnv])})
                      </span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      placeholder={hasExistingKey ? '留空保持当前 Key 不变' : '请输入 API Key'}
                      className="w-full px-3 py-2 pr-10 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                    >
                      {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              )}

              {/* Proxy */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  代理 <span className="text-xs text-slate-400 font-normal">(可选)</span>
                </label>
                <input
                  type="text"
                  value={proxy}
                  onChange={e => setProxy(e.target.value)}
                  placeholder="http://127.0.0.1:7890"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading || saveSuccess}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              saveSuccess
                ? 'bg-green-500 text-white'
                : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
            } disabled:opacity-60`}
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : saveSuccess ? (
              <CheckCircle2 size={16} />
            ) : (
              <Save size={16} />
            )}
            {saveSuccess ? '已保存' : '保存到 .env'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LlmConfigModal;
