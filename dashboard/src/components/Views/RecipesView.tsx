import React, { useState, useEffect } from 'react';
import { Edit3, Trash2 } from 'lucide-react';
import { Recipe } from '../../types';
import { categoryConfigs } from '../../constants';
import Pagination from '../Shared/Pagination';

interface RecipesViewProps {
	recipes: Recipe[];
	openRecipeEdit: (recipe: Recipe) => void;
	handleDeleteRecipe: (name: string) => void;
}

const RecipesView: React.FC<RecipesViewProps> = ({ recipes, openRecipeEdit, handleDeleteRecipe }) => {
	const [currentPage, setCurrentPage] = useState(1);
	const [pageSize, setPageSize] = useState(12);

	// 当 recipes 数据变化时（如搜索/过滤），重置到第一页
	useEffect(() => {
		setCurrentPage(1);
	}, [recipes.length]);

	const totalPages = Math.ceil(recipes.length / pageSize);
	const startIndex = (currentPage - 1) * pageSize;
	const paginatedRecipes = recipes.slice(startIndex, startIndex + pageSize);

	const handlePageChange = (page: number) => {
		setCurrentPage(page);
		// 滚动到顶部
		window.scrollTo({ top: 0, behavior: 'smooth' });
	};

	const handlePageSizeChange = (size: number) => {
		setPageSize(size);
		setCurrentPage(1);
	};

	return (
		<div>
			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				{paginatedRecipes.map((recipe) => (
				<div key={recipe.name} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all group relative">
					<div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
						<button onClick={(e) => { e.stopPropagation(); openRecipeEdit(recipe); }} className="p-1.5 bg-slate-50 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"><Edit3 size={14} /></button>
						<button onClick={(e) => { e.stopPropagation(); handleDeleteRecipe(recipe.name); }} className="p-1.5 bg-slate-50 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"><Trash2 size={14} /></button>
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
											<Icon size={10} />
											{category}
										</span>
									);
								})()}
								{recipe.content.includes('type: preview') && (
									<span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-bold uppercase">Preview Only</span>
								)}
							</div>
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
