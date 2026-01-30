const fs = require('fs');
const path = require('path');

class CandidateService {
	/**
	 * 获取候选内容存储路径
	 * @param {string} projectRoot 
	 */
	getCandidatesPath(projectRoot) {
		return path.join(projectRoot, 'Knowledge', '.autosnippet', 'candidates.json');
	}

	/**
	 * 确保目录存在
	 */
	ensureDir(projectRoot) {
		const dir = path.join(projectRoot, 'Knowledge', '.autosnippet');
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
	}

	/**
	 * 保存候选内容
	 * @param {string} projectRoot 
	 * @param {string} targetName 
	 * @param {Array} results 
	 */
	async saveCandidates(projectRoot, targetName, results) {
		this.ensureDir(projectRoot);
		const filePath = this.getCandidatesPath(projectRoot);
		
		let candidates = {};
		if (fs.existsSync(filePath)) {
			try {
				candidates = JSON.parse(fs.readFileSync(filePath, 'utf8'));
			} catch (e) {
				candidates = {};
			}
		}

		// 每个 Target 覆盖旧的候选
		candidates[targetName] = {
			targetName,
			scanTime: Date.now(),
			items: results.map(r => ({
				...r,
				id: `cand_${Math.random().toString(36).substr(2, 9)}`,
				status: 'pending'
			}))
		};

		fs.writeFileSync(filePath, JSON.stringify(candidates, null, 2), 'utf8');
	}

	/**
	 * 获取所有候选
	 */
	listCandidates(projectRoot) {
		const filePath = this.getCandidatesPath(projectRoot);
		if (!fs.existsSync(filePath)) return {};
		try {
			return JSON.parse(fs.readFileSync(filePath, 'utf8'));
		} catch (e) {
			return {};
		}
	}

	/**
	 * 移除已处理的候选
	 */
	async removeCandidate(projectRoot, targetName, candidateId) {
		const filePath = this.getCandidatesPath(projectRoot);
		if (!fs.existsSync(filePath)) return;
		try {
			const candidates = JSON.parse(fs.readFileSync(filePath, 'utf8'));
			if (candidates[targetName]) {
				candidates[targetName].items = candidates[targetName].items.filter(item => item.id !== candidateId);
				if (candidates[targetName].items.length === 0) {
					delete candidates[targetName];
				}
				fs.writeFileSync(filePath, JSON.stringify(candidates, null, 2), 'utf8');
			}
		} catch (e) {}
	}
}

module.exports = new CandidateService();
