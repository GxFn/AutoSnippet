export interface Snippet {
	identifier: string;
	title: string;
	completionKey: string;
	summary: string;
	category?: string;
	language: string;
	content: string[];
	body?: string[];
	headers?: string[];
	/** 每条 header 相对于 target 根目录的路径，用于 // as:include <M/H.h> [path] */
	headerPaths?: string[];
	/** target/模块名，用于角括号格式 // as:include <TargetName/Header.h> */
	moduleName?: string;
	includeHeaders?: boolean;
	link?: string;
}

export interface RecipeStats {
	authority: number;
	guardUsageCount: number;
	humanUsageCount: number;
	aiUsageCount: number;
	lastUsedAt: string | null;
	authorityScore: number;
}

export interface Recipe {
	name: string;
	content: string;
	metadata?: any;
	/** 使用统计与权威分（来自 recipe-stats.json） */
	stats?: RecipeStats | null;
}

export interface ProjectData {
	rootSpec: {
		list: Snippet[];
		recipes?: {
			dir: string;
		};
	};
	recipes: Recipe[];
	candidates: Record<string, {
		targetName: string;
		scanTime: number;
		items: (ExtractedRecipe & { id: string; status: string })[];
	}>;
	projectRoot: string;
	watcherStatus?: string;
	/** 当前使用的 AI 提供商与模型（供 UI 展示） */
	aiConfig?: { provider: string; model: string };
}

export interface SPMTarget {
	name: string;
	packageName: string;
	packagePath: string;
	targetDir: string;
	info: any;
}

export interface ExtractedRecipe {
	title: string;
	summary: string;
	summary_cn?: string;
	summary_en?: string;
	trigger: string;
	category?: string;
	language: string;
	code: string;
	usageGuide: string;
	usageGuide_cn?: string;
	usageGuide_en?: string;
	headers?: string[];
	/** 每条 header 相对于 target 根目录的路径，与 create/headName 一致，用于 // as:include <M/H.h> [path] */
	headerPaths?: string[];
	/** target/模块名，用于角括号格式 // as:include <TargetName/Header.h> */
	moduleName?: string;
	/** 是否引入头文件：true 时 snippet 内写入 // as:include 标记，watch 按标记注入依赖 */
	includeHeaders?: boolean;
	/** 难度等级：beginner / intermediate / advanced */
	difficulty?: 'beginner' | 'intermediate' | 'advanced';
	/** 权威分 1～5，审核人员可设置初始值 */
	authority?: number;
	/** 版本号 */
	version?: string;
	/** 更新时间戳（毫秒） */
	updatedAt?: number;
}

/** 候选池中的候选项（含 id）或 SPM 审核页中的项（含 candidateId/candidateTargetName） */
export type ScanResultItem = ExtractedRecipe & {
	mode: 'full' | 'preview';
	lang: 'cn' | 'en';
	includeHeaders?: boolean;
	id?: string;
	candidateId?: string;
	candidateTargetName?: string;
};
