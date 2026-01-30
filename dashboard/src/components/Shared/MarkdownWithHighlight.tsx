import React from 'react';
import ReactMarkdown from 'react-markdown';
import CodeBlock from './CodeBlock';

interface MarkdownWithHighlightProps {
	content: string;
	className?: string;
	/** 代码块是否显示行号 */
	showLineNumbers?: boolean;
}

const MarkdownWithHighlight: React.FC<MarkdownWithHighlightProps> = ({
	content,
	className = '',
	showLineNumbers = false,
}) => {
	return (
		<div className={`markdown-body text-slate-700 ${className}`}>
			<ReactMarkdown
				components={{
					code({ node, className: codeClassName, children, ...props }) {
						const match = /language-(\w+)/.exec(codeClassName || '');
						const isBlock = String(children).includes('\n');
						if (isBlock && match) {
							return (
								<CodeBlock
									code={String(children).replace(/\n$/, '')}
									language={match[1]}
									showLineNumbers={showLineNumbers}
								/>
							);
						}
						return (
							<code className="px-1.5 py-0.5 bg-slate-100 text-slate-800 rounded text-sm font-mono" {...props}>
								{children}
							</code>
						);
					},
					p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
					h1: ({ children }) => <h1 className="text-xl font-bold mb-2 mt-4 first:mt-0">{children}</h1>,
					h2: ({ children }) => <h2 className="text-lg font-bold mb-2 mt-4">{children}</h2>,
					h3: ({ children }) => <h3 className="text-base font-bold mb-1 mt-3">{children}</h3>,
					ul: ({ children }) => <ul className="list-disc list-inside mb-3 space-y-1">{children}</ul>,
					ol: ({ children }) => <ol className="list-decimal list-inside mb-3 space-y-1">{children}</ol>,
					blockquote: ({ children }) => (
						<blockquote className="border-l-4 border-slate-200 pl-4 my-3 text-slate-600 italic">
							{children}
						</blockquote>
					),
					a: ({ href, children }) => (
						<a href={href} className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
							{children}
						</a>
					),
				}}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
};

export default MarkdownWithHighlight;
