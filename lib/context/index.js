#!/usr/bin/env node

/**
 * 上下文存储模块入口
 * 对外使用: const { getInstance } = require('./lib/context');
 */

const { ContextService, getInstance, clearCache, getContextConfig } = require('./ContextService');
const persistence = require('./persistence');
const constants = require('./constants');
const chunker = require('./chunker');
const IndexingPipeline = require('./IndexingPipeline');
const JsonAdapter = require('./adapters/JsonAdapter');
const BaseAdapter = require('./adapters/BaseAdapter');

module.exports = {
	ContextService,
	getInstance,
	clearCache,
	getContextConfig,
	persistence,
	constants,
	chunker,
	IndexingPipeline,
	JsonAdapter,
	BaseAdapter
};
