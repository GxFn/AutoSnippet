import React from 'react';

interface AiChatViewProps {
	chatHistory: { role: 'user' | 'model', text: string }[];
	userInput: string;
	setUserInput: (input: string) => void;
	handleChat: (e: React.FormEvent) => void;
	isAiThinking: boolean;
}

const AiChatView: React.FC<AiChatViewProps> = ({ chatHistory, userInput, setUserInput, handleChat, isAiThinking }) => {
	return (
		<div className="max-w-3xl mx-auto flex flex-col h-full">
			<div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
				{chatHistory.map((msg, i) => (
					<div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
						<div className={`max-w-[80%] p-3 rounded-xl text-sm ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-800'}`}>
							{msg.text}
						</div>
					</div>
				))}
				{isAiThinking && <div className="text-slate-400 text-xs animate-pulse">AI is thinking...</div>}
			</div>
			<form onSubmit={handleChat} className="flex gap-2 bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
				<input 
					type="text" 
					value={userInput} 
					onChange={(e) => setUserInput(e.target.value)} 
					placeholder="Ask anything about your project..." 
					className="flex-1 px-4 py-2 outline-none text-sm" 
				/>
				<button 
					type="submit" 
					disabled={isAiThinking} 
					className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:bg-slate-300"
				>
					Ask
				</button>
			</form>
		</div>
	);
};

export default AiChatView;
