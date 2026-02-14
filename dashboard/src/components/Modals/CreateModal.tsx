import React from 'react';
import { Plus, X, FileSearch, Clipboard, Zap, Cpu } from 'lucide-react';
import { ICON_SIZES } from '../../constants/icons';
import PageOverlay from '../Shared/PageOverlay';

interface CreateModalProps {
  setShowCreateModal: (show: boolean) => void;
  createPath: string;
  setCreatePath: (path: string) => void;
  handleCreateFromPath: () => void;
  handleCreateFromClipboard: () => void;
  isExtracting: boolean;
}

const CreateModal: React.FC<CreateModalProps> = ({ 
  setShowCreateModal, 
  createPath, 
  setCreatePath, 
  handleCreateFromPath, 
  handleCreateFromClipboard, 
  isExtracting 
}) => {
  return (
  <PageOverlay className="z-40 flex items-center justify-center p-4">
    <PageOverlay.Backdrop className="bg-slate-900/50 backdrop-blur-sm" />
    <div className="relative bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden">
     <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
      <h2 className="text-xl font-bold flex items-center gap-2 text-slate-800"><Plus size={ICON_SIZES.xl} className="text-blue-600" /> New Recipe</h2>
      <button onClick={() => setShowCreateModal(false)} className="p-2 hover:bg-white rounded-full transition-colors"><X size={ICON_SIZES.lg} /></button>
     </div>
     <div className="p-8 space-y-6">
      <div className="space-y-3">
         <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest"><FileSearch size={ICON_SIZES.sm} /> Import from Project Path</label>
         <div className="flex gap-2">
          <input className="flex-1 p-3 bg-slate-100 border-none rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. Sources/MyModule/Auth.swift" value={createPath} onChange={e => setCreatePath(e.target.value)} />
          <button onClick={handleCreateFromPath} disabled={!createPath || isExtracting} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-slate-800 disabled:opacity-50">Scan File</button>
         </div>
      </div>
      <div className="relative"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-100"></div></div><div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-slate-300 font-bold">Or</span></div></div>
      <div className="space-y-3">
         <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest"><Clipboard size={ICON_SIZES.sm} /> Import from Clipboard</label>
         <button onClick={() => handleCreateFromClipboard()} disabled={isExtracting} className="w-full flex items-center justify-center gap-3 p-4 bg-blue-50 text-blue-700 rounded-xl font-bold hover:bg-blue-100 transition-all border border-blue-100">
          <Zap size={ICON_SIZES.lg} /> Use Copied Code
         </button>
      </div>
     </div>
     {isExtracting && (
       <div className="bg-blue-600 text-white p-4 flex items-center justify-center gap-3 animate-pulse">
       <Cpu size={ICON_SIZES.lg} className="animate-spin" />
       <span className="font-bold text-sm">AI is thinking...</span>
       </div>
     )}
    </div>
  </PageOverlay>
  );
};

export default CreateModal;
