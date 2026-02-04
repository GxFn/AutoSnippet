#!/usr/bin/env node

/**
 * 上下文存储模块入口
 * 对外使用: const { getInstance } = require('./lib/context');
 */

// 导入兼容性适配层
const {
	getContextServiceInstance,
	clearAllInstances,
	...otherServices
} = require('../application/services/ContextServiceCompat');

// 别名以保持向后兼容
const getInstance = getContextServiceInstance;
const clearCache = clearAllInstances;
const getContextConfig = () => {
	// 返回默认的上下文配置
	return require('../infrastructure/config/Defaults').DEFAULT_CONTEXT_CONFIG || {};
};

// 导入其他模块
const persistence = require('./persistence');
const constants = require('./constants');
const chunker = require('./chunker');
const IndexingPipeline = require('./IndexingPipeline');
const JsonAdapter = require('./adapters/JsonAdapter');
const BaseAdapter = require('./adapters/BaseAdapter');

module.exports = {
	ContextService: otherServices.ContextServiceV2,
	getInstance,
	clearCache,
	getContextConfig,
	persistence,
	IndexingPipeline,
	JsonAdapter,
	BaseAdapter
};
