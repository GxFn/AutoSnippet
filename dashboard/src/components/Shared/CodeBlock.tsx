import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

/** 支持的语法：Objective-C、Swift、Markdown */
export type CodeLanguage = 'objectivec' | 'objc' | 'swift' | 'markdown';

const LANGUAGE_MAP: Record<string, string> = {
	objectivec: 'objectivec',
	objc: 'objectivec',
	'objective-c': 'objectivec',
	'obj-c': 'objectivec',
	swift: 'swift',
	markdown: 'markdown',
	md: 'markdown',
};

interface CodeBlockProps {
	code: string;
	language?: string;
	className?: string;
	showLineNumbers?: boolean;
}

const CodeBlock: React.FC<CodeBlockProps> = ({
	code,
	language = 'text',
	className = '',
	showLineNumbers = false,
}) => {
	const lang = LANGUAGE_MAP[language?.toLowerCase()] || language?.toLowerCase() || 'text';
	return (
		<div className={`rounded-xl overflow-hidden text-sm ${className}`}>
			<SyntaxHighlighter
				language={lang}
				style={oneDark}
				showLineNumbers={showLineNumbers}
				customStyle={{
					margin: 0,
					padding: '1rem 1.25rem',
					fontSize: '0.8125rem',
					lineHeight: 1.5,
					borderRadius: '0.75rem',
				}}
				codeTagProps={{ style: { fontFamily: 'ui-monospace, monospace' } }}
				PreTag="div"
			>
				{code}
			</SyntaxHighlighter>
		</div>
	);
};

export default CodeBlock;
