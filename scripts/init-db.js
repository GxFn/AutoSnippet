#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import Bootstrap from '../lib/bootstrap.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 初始化 AutoSnippet 数据库
 */
async function main() {
  console.log('🚀 AutoSnippet 2.0 - Database Initialization\n');

  try {
    const bootstrap = new Bootstrap({ env: process.env.NODE_ENV || 'development' });
    const components = await bootstrap.initialize();

    console.log('✅ Database initialized successfully');
    console.log('\nComponents ready:');
    console.log('  - Database:', components.db ? '✓' : '✗');
    console.log('  - Logger:', components.logger ? '✓' : '✗');
    console.log('  - Constitution:', components.constitution ? '✓' : '✗');
    console.log('  - Gateway:', components.gateway ? '✓' : '✗');
    console.log('  - Permission Manager:', components.permissionManager ? '✓' : '✗');
    console.log('  - Audit Logger:', components.auditLogger ? '✓' : '✗');
    console.log('  - Session Manager:', components.sessionManager ? '✓' : '✗');

    // 显示宪法信息
    const constitutionInfo = components.constitution.toJSON();
    console.log('\n📜 Constitution:');
    console.log('  - Version:', constitutionInfo.version);
    console.log('  - Effective Date:', constitutionInfo.effectiveDate);
    console.log('  - Priorities:', constitutionInfo.priorities.length);
    console.log('  - Roles:', constitutionInfo.roles.length);

    await bootstrap.shutdown();
    console.log('\n✅ Initialization complete');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Initialization failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

main();
