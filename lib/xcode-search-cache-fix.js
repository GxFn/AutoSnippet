#!/usr/bin/env node

/**
 * Xcode 搜索结果去重与缓存清理工具
 * 
 * 用途：解决 Xcode 中同一位置重复搜索出现相同内容的问题
 * 原因：缓存或状态管理问题
 * 解决方案：
 *   1. 添加请求去重机制
 *   2. 清空结果缓存
 *   3. 强制刷新 UI
 */

class XcodeSearchCacheFix {
    constructor() {
        // 存储上一次搜索的参数
        this.lastSearch = {
            keyword: null,
            filePath: null,
            lineNumber: null,
            timestamp: null
        };
        
        // 缓存的结果
        this.cachedResults = new Map();
        
        // 请求去重
        this.pendingRequests = new Map();
    }

    /**
     * 生成搜索请求的唯一 ID
     */
    generateRequestId(keyword, filePath, lineNumber) {
        return `${filePath}:${lineNumber}:${keyword}`;
    }

    /**
     * 检查是否是重复的搜索（缓存问题）
     */
    isDuplicateSearch(keyword, filePath, lineNumber) {
        const lastSearch = this.lastSearch;
        
        // 如果和上一次搜索参数完全相同，说明是重复
        if (
            lastSearch.keyword === keyword &&
            lastSearch.filePath === filePath &&
            lastSearch.lineNumber === lineNumber &&
            (Date.now() - lastSearch.timestamp) < 100  // 100ms 内的相同请求视为重复
        ) {
            return true;
        }
        
        return false;
    }

    /**
     * 执行搜索 - 修复版本
     */
    async performSearch(keyword, filePath, lineNumber, projectName = 'BDNetwork') {
        console.log(`\n🔍 搜索请求: keyword="${keyword}", file="${filePath}:${lineNumber}"`);
        
        // 1. 检查是否是重复搜索
        if (this.isDuplicateSearch(keyword, filePath, lineNumber)) {
            console.warn('⚠️  检测到重复搜索（缓存问题），清空缓存并重新请求...');
            this.clearCache();
        }
        
        // 2. 生成唯一的请求 ID
        const requestId = this.generateRequestId(keyword, filePath, lineNumber);
        
        // 3. 检查是否有待处理的相同请求（去重）
        if (this.pendingRequests.has(requestId)) {
            console.log('ℹ️  相同的请求正在进行中，等待结果...');
            return this.pendingRequests.get(requestId);
        }
        
        // 4. 创建新请求
        const promise = this._makeRequest(keyword, filePath, lineNumber, projectName, requestId);
        this.pendingRequests.set(requestId, promise);
        
        try {
            const result = await promise;
            return result;
        } finally {
            // 5. 清空待处理请求
            this.pendingRequests.delete(requestId);
        }
    }

    /**
     * 实际的 HTTP 请求
     */
    async _makeRequest(keyword, filePath, lineNumber, projectName, requestId) {
        const axios = require('axios');
        
        try {
            // 添加防缓存参数
            const response = await axios.post('http://localhost:3000/api/search/trigger-from-code', {
                filePath,
                lineNumber,
                keyword: `// as:s ${keyword}`,
                projectName,
                requestId,  // 防缓存标识
                timestamp: Date.now(),
                _nocache: Math.random()  // 防浏览器缓存
            }, {
                timeout: 5000,
                // 禁用 Axios 缓存
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                }
            });
            
            const data = response.data;
            
            // 6. 记录此次搜索
            this.lastSearch = {
                keyword,
                filePath,
                lineNumber,
                timestamp: Date.now()
            };
            
            // 7. 更新缓存
            const cacheKey = this.generateRequestId(keyword, filePath, lineNumber);
            this.cachedResults.set(cacheKey, data);
            
            console.log(`✅ 搜索成功: 找到 ${data.results?.length || 0} 个结果`);
            return data;
            
        } catch (error) {
            console.error(`❌ 搜索失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 清空所有缓存
     */
    clearCache() {
        console.log('🧹 清空搜索缓存...');
        this.cachedResults.clear();
        this.lastSearch = {
            keyword: null,
            filePath: null,
            lineNumber: null,
            timestamp: null
        };
    }

    /**
     * 获取缓存中的结果
     */
    getCachedResult(keyword, filePath, lineNumber) {
        const cacheKey = this.generateRequestId(keyword, filePath, lineNumber);
        return this.cachedResults.get(cacheKey);
    }

    /**
     * 打印诊断信息
     */
    printDiagnostics() {
        console.log('\n╔════════════════════════════════════════════════╗');
        console.log('║  Xcode 搜索缓存修复工具 - 诊断信息            ║');
        console.log('╚════════════════════════════════════════════════╝\n');
        
        console.log(`📊 最后一次搜索:`);
        console.log(`   关键词: ${this.lastSearch.keyword || '(无)'}`);
        console.log(`   文件: ${this.lastSearch.filePath || '(无)'}`);
        console.log(`   行号: ${this.lastSearch.lineNumber || '(无)'}`);
        
        console.log(`\n💾 缓存中的结果数: ${this.cachedResults.size}`);
        this.cachedResults.forEach((data, key) => {
            console.log(`   ${key}: ${data.results?.length || 0} 个结果`);
        });
        
        console.log(`\n⏳ 待处理请求数: ${this.pendingRequests.size}`);
        this.pendingRequests.forEach((_, key) => {
            console.log(`   ${key}`);
        });
    }
}

// 导出用于在其他模块中使用
module.exports = XcodeSearchCacheFix;

// 如果直接运行此文件，执行演示
if (require.main === module) {
    (async () => {
        const fixer = new XcodeSearchCacheFix();
        
        console.log('\n╔════════════════════════════════════════════════╗');
        console.log('║  Xcode 搜索缓存修复 - 演示                    ║');
        console.log('╚════════════════════════════════════════════════╝\n');
        
        try {
            // 模拟用户场景：同一位置，两次不同搜索
            
            console.log('第一次搜索：viewController');
            const result1 = await fixer.performSearch(
                'viewController',
                'Sources/BDNetwork/ViewController.swift',
                100
            );
            console.log(`找到 ${result1.results?.length} 个结果`);
            console.log(`Top 2: ${result1.results?.slice(0, 2).map(r => r.name).join(', ')}\n`);
            
            // 等待 50ms
            await new Promise(r => setTimeout(r, 50));
            
            console.log('第二次搜索：color (同一位置)');
            const result2 = await fixer.performSearch(
                'color',
                'Sources/BDNetwork/ViewController.swift',
                100
            );
            console.log(`找到 ${result2.results?.length} 个结果`);
            console.log(`Top 2: ${result2.results?.slice(0, 2).map(r => r.name).join(', ')}\n`);
            
            // 诊断信息
            fixer.printDiagnostics();
            
            // 对比
            const same = result1.results?.map(r => r.name).join(',') === 
                        result2.results?.map(r => r.name).join(',');
            
            console.log(`\n${same ? '❌' : '✅'} 结果 ${same ? '相同（问题）' : '不同（正常）'}`);
            
        } catch (error) {
            console.error('演示过程中出错:', error.message);
        }
    })();
}
