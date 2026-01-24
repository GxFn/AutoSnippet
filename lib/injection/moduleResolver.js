#!/usr/bin/env node

/**
 * 职责：
 * - 推断当前文件所属 target/module（基于 Package.swift 解析结果）
 * - 推断头文件所属 module（基于 headRelativePath + 向上查找 Package.swift）
 */

const fs = require('fs');
const path = require('path');
const packageParser = require('../spm/packageParser.js');

function determineCurrentModuleName(filePath, packageInfo) {
	const relativePath = path.relative(packageInfo.path, filePath);
	const segments = relativePath.split(path.sep);

	for (let i = segments.length - 1; i >= 0; i--) {
		const segment = segments[i];
		if (packageInfo.targets.includes(segment)) {
			return segment;
		}
	}

	return packageInfo.targets[0] || packageInfo.name;
}

async function determineHeaderInfo(specFile, header, headRelativePath) {
	let moduleName = header.moduleName;

	if (!headRelativePath) {
		return { moduleName, headRelativePath: null, relativePathToCurrentFile: null };
	}

	const rootSpecDir = path.dirname(specFile);
	let headPath = path.join(rootSpecDir, headRelativePath);

	if (!fs.existsSync(headPath)) {
		const headerPackagePath = await packageParser.findPackageSwiftPath(headPath);
		if (headerPackagePath) {
			const headerPackageInfo = await packageParser.parsePackageSwift(headerPackagePath);
			if (headerPackageInfo) {
				const headerModuleRootDir = path.dirname(headerPackagePath);
				headPath = path.join(headerModuleRootDir, headRelativePath);
			}
		}
	}

	const headerPackagePath = await packageParser.findPackageSwiftPath(headPath);
	if (!headerPackagePath) {
		return { moduleName, headRelativePath, relativePathToCurrentFile: null };
	}

	const headerPackageInfo = await packageParser.parsePackageSwift(headerPackagePath);
	if (!headerPackageInfo) {
		return { moduleName, headRelativePath, relativePathToCurrentFile: null };
	}

	moduleName = determineCurrentModuleName(headPath, headerPackageInfo);
  return { moduleName, headRelativePath, relativePathToCurrentFile: null };
}

module.exports = {
	determineCurrentModuleName,
	determineHeaderInfo,
};

