import React, { useState, useEffect } from 'react';
import { Edit3, Trash2, AlertTriangle } from 'lucide-react';
import { Recipe } from '../../types';
import { categoryConfigs } from '../../constants';
import Pagination from '../Shared/Pagination';
import { ICON_SIZES } from '../../constants/icons';

interface RecipesViewProps {
	recipes: Recipe[];
	openRecipeEdit: (recipe: Recipe) => void;
	handleDeleteRecipe: (name: string) => void;
	handleDeleteAllRecipes?: () => void;
	onRefresh?: () => void;
	/** 分页由父组件控制，刷新数据后保持当前页 */
	currentPage?: number;
	onPageChange?: (page: number) => void;
	pageSize?: number;
	onPageSizeChange?: (size: number) => void;
}

const RecipesView: React.FC<RecipesViewProps> = ({
	recipes,
	openRecipeEdit,
	handleDeleteRecipe,
	handleDeleteAllRecipes,
	currentPage: controlledPage,
	onPageChange: controlledOnPageChange,
	pageSize: controlledPageSize,
	onPageSizeChange: controlledOnPageSizeChange
}) => {
	const [internalPage, setInternalPage] = useState(1);
	const [internalPageSize, setInternalPageSize] = useState(12);
	const currentPage = controlledPage ?? internalPage;
	const pageSize = controlledPageSize ?? internalPageSize;
	const setCurrentPage = controlledOnPageChange ?? setInternalPage;
	const handlePageSizeChange = controlledOnPageSizeChange
		? (size: number) => controlledOnPageSizeChange(size)
		: (size: number) => { setInternalPageSize(size); setInternalPage(1); };

	// 仅在使用内部状态时：列表长度变化（如搜索/过滤）重置到第一页
	useEffect(() => {
		if (controlledPage == null) setInternalPage(1);
	}, [recipes.length, controlledPage]);

	const totalPages = Math.ceil(recipes.length / pageSize);
	const startIndex = (currentPage - 1) * pageSize;
	const paginatedRecipes = recipes.slice(startIndex, startIndex + pageSize);

	const handlePageChange = (page: number) => {
		setCurrentPage(page);
		window.scrollTo({ top: 0, behavior: 'smooth' });
	};

	return (
		<div>
			{handleDeleteAllRecipes && recipes.length > 0 && (
				<div className="mb-4 flex justify-end">
					<button
						onClick={handleDeleteAllRecipes}
						className="px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium border border-red-200"
					>
						<AlertTriangle size={ICON_SIZES.sm} />
						删除所有 Recipes ({recipes.length})
					</button>
				</div>
			)}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				{paginatedRecipes.map((recipe) => (
				<div key={recipe.name} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all group relative">
					<div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
						<button onClick={(e) => { e.stopPropagation(); openRecipeEdit(recipe); }} className="p-1.5 bg-slate-50 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"><Edit3 size={ICON_SIZES.sm} /></button>
						<button onClick={(e) => { e.stopPropagation(); handleDeleteRecipe(recipe.name); }} className="p-1.5 bg-slate-50 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"><Trash2 size={ICON_SIZES.sm} /></button>
					</div>
					<div onClick={() => openRecipeEdit(recipe)} className="cursor-pointer">
						<div className="flex justify-between items-center mb-2 pr-12">
							<h3 className="font-bold text-slate-900">{recipe.name}</h3>
							<div className="flex items-center gap-2">
								{(() => {
									const category = recipe.content.match(/category:\s*(.*)/)?.[1]?.trim() || 'Utility';
									const config = categoryConfigs[category] || categoryConfigs.Utility;
									const Icon = config.icon;
									return (
										<span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase flex items-center gap-1 border ${config.bg} ${config.color} ${config.border}`}>
											<Icon size={ICON_SIZES.xs} />
											{category}
										</span>
									);
								})()}
								{recipe.content.includes('type: preview') && (
									<span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-bold uppercase">Preview Only</span>
								)}
							</div>
						</div>
						<div className="flex flex-wrap items-center gap-2 mb-2 text-[10px] text-slate-500">
							<span>权威 {recipe.stats != null ? recipe.stats.authority : '—'}</span>
							<span>·</span>
							<span>
								{recipe.stats != null
									? `g:${recipe.stats.guardUsageCount} h:${recipe.stats.humanUsageCount} a:${recipe.stats.aiUsageCount}`
									: 'g:0 h:0 a:0'}
							</span>
							<span>·</span>
							<span>综合分 {recipe.stats?.authorityScore != null ? recipe.stats.authorityScore.toFixed(2) : '—'}</span>
							{recipe.stats?.lastUsedAt && (
								<>
									<span>·</span>
									<span>最近 {new Date(recipe.stats.lastUsedAt).toLocaleDateString()}</span>
								</>
							)}
							<span className="text-slate-400">（编辑时可设置权威分）</span>
						</div>
						<div className="text-xs text-slate-500 bg-slate-50 p-4 rounded-lg overflow-hidden line-clamp-6 font-mono whitespace-pre-wrap">{recipe.content}</div>
					</div>
				</div>
			))}
			</div>

			<Pagination
				currentPage={currentPage}
				totalPages={totalPages}
				totalItems={recipes.length}
				pageSize={pageSize}
				onPageChange={handlePageChange}
				onPageSizeChange={handlePageSizeChange}
			/>
		</div>
	);
};

export default RecipesView;
