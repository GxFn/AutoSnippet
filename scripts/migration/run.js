const fs = require('fs');
const path = require('path');
const minimist = require('minimist');
const {
  MigrationFramework,
  SnippetMigrator,
  RecipeMigrator,
  GuardRuleMigrator
} = require('./index');

function loadJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function saveJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function createMigrator(type) {
  switch (type) {
    case 'snippet':
      return new SnippetMigrator();
    case 'recipe':
      return new RecipeMigrator();
    case 'guard':
      return new GuardRuleMigrator();
    default:
      throw new Error(`Unknown type: ${type}`);
  }
}

async function main() {
  const args = minimist(process.argv.slice(2));
  const type = args.type || args.t;
  const input = args.input || args.i;
  const output = args.output || args.o;
  const reportPath = args.report || args.r;
  const checkpointPath = args.checkpoint || args.c;
  const batchSize = Number(args.batch || 100);

  if (!type || !input || !output) {
    console.error('Usage: node scripts/migration/run.js --type <snippet|recipe|guard> --input <file> --output <file> [--report <file>] [--checkpoint <file>] [--batch <size>]');
    process.exit(1);
  }

  const source = loadJson(input);
  const items = Array.isArray(source) ? source : source.items || [];

  const migrator = createMigrator(type);
  const framework = new MigrationFramework({
    checkpointPath,
    reportPath,
    logger: console
  });

  const { results, errors, report } = await framework.migrate({
    items,
    migrator,
    batchSize,
    onProgress: ({ processed, total }) => {
      if (processed % batchSize === 0 || processed === total) {
        console.log(`[${type}] ${processed}/${total} migrated`);
      }
    }
  });

  saveJson(output, results.map(record => (record.toJSON ? record.toJSON() : record)));

  if (errors.length > 0) {
    const errorPath = output.replace(/\.json$/i, '.errors.json');
    saveJson(errorPath, errors);
    console.warn(`Migration completed with ${errors.length} errors. See ${errorPath}`);
  }

  console.log('Migration report:', report);
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
