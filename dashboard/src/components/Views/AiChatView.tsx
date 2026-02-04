import React, { useEffect, useRef } from 'react';
import MarkdownWithHighlight from '../Shared/MarkdownWithHighlight';

interface AiChatViewProps {
	chatHistory: { role: 'user' | 'model', text: string }[];
	userInput: string;
	setUserInput: (input: string) => void;
	handleChat: (e: React.FormEvent) => void;
	isAiThinking: boolean;
}

const AiChatView: React.FC<AiChatViewProps> = ({ chatHistory, userInput, setUserInput, handleChat, isAiThinking }) => {
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const messagesContainerRef = useRef<HTMLDivElement>(null);

	// 自动滚动到最新消息
	useEffect(() => {
		// 使用 requestAnimationFrame 确保 DOM 已更新
		const timer = requestAnimationFrame(() => {
			messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
		});
		return () => cancelAnimationFrame(timer);
	}, [chatHistory, isAiThinking]);

	// 格式化消息文本（模型消息支持 Markdown）
	const renderMessage = (text: string, role: 'user' | 'model') => {
		if (role === 'model') {
			return (
				<MarkdownWithHighlight
					content={text}
					className="text-slate-800"
				/>
			);
		}
		return <div className="whitespace-pre-wrap break-words">{text}</div>;
	};

	return (
		<div className="max-w-4xl mx-auto flex flex-col h-full bg-slate-50">
			{/* 消息区域 */}
			<div 
				ref={messagesContainerRef}
				className="flex-1 overflow-y-auto space-y-3 p-4"
			>
				{chatHistory.length === 0 ? (
					<div className="text-center text-slate-400 mt-8">
						<p className="text-sm">开始聊天吧，询问关于你的项目的任何问题</p>
					</div>
				) : (
					chatHistory.map((msg, i) => (
						<div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
							<div className={`max-w-[75%] p-3 rounded-lg text-sm ${
								msg.role === 'user' 
									? 'bg-blue-600 text-white rounded-br-none' 
									: 'bg-white border border-slate-200 text-slate-800 rounded-bl-none shadow-sm'
							}`}>
								{renderMessage(msg.text, msg.role)}
							</div>
						</div>
					))
				)}
				{isAiThinking && (
					<div className="flex justify-start">
						<div className="bg-white border border-slate-200 text-slate-800 p-3 rounded-lg rounded-bl-none shadow-sm">
							<div className="flex items-center gap-2">
								<div className="flex gap-1">
									<div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
									<div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
									<div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
								</div>
								<span className="text-xs text-slate-400">AI 思考中...</span>
							</div>
						</div>
					</div>
				)}
				<div ref={messagesEndRef} />
			</div>

			{/* 输入区域 */}
			<div className="border-t border-slate-200 p-4 bg-white">
				<form onSubmit={handleChat} className="flex gap-2">
					<input 
						type="text" 
						value={userInput} 
						onChange={(e) => setUserInput(e.target.value)} 
						placeholder="Ask anything about your project..." 
						disabled={isAiThinking}
						className="flex-1 px-4 py-2 outline-none text-sm border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400" 
					/>
					<button 
						type="submit" 
						disabled={isAiThinking || !userInput.trim()} 
						className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
					>
						Ask
					</button>
				</form>
			</div>
		</div>
	);
};

export default AiChatView;
