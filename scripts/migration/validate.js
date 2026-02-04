const fs = require('fs');
const path = require('path');
const minimist = require('minimist');
const {
  SnippetV2,
  RecipeV2,
  GuardRuleV2
} = require('../../lib/domain/entities/v2');

function loadJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function saveJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function buildEntity(type, record) {
  switch (type) {
    case 'snippet':
      return new SnippetV2(record);
    case 'recipe':
      return new RecipeV2(record);
    case 'guard':
      return new GuardRuleV2(record);
    default:
      throw new Error(`Unknown type: ${type}`);
  }
}

function validateRecords(type, records) {
  const errors = [];

  records.forEach((record, index) => {
    try {
      const entity = buildEntity(type, record);
      const error = entity.validate();
      if (error) {
        errors.push({ index, error, record });
      }
    } catch (err) {
      errors.push({ index, error: err.message || String(err), record });
    }
  });

  return errors;
}

async function main() {
  const args = minimist(process.argv.slice(2));
  const type = args.type || args.t;
  const input = args.input || args.i;
  const output = args.output || args.o;

  if (!type || !input) {
    console.error('Usage: node scripts/migration/validate.js --type <snippet|recipe|guard> --input <file> [--output <file>]');
    process.exit(1);
  }

  const source = loadJson(input);
  const records = Array.isArray(source) ? source : source.items || [];

  const errors = validateRecords(type, records);

  const report = {
    total: records.length,
    invalid: errors.length,
    valid: records.length - errors.length,
    successRate: records.length === 0 ? '0.00%' : `${(((records.length - errors.length) / records.length) * 100).toFixed(2)}%`,
    timestamp: new Date().toISOString()
  };

  if (output) {
    saveJson(output, { report, errors });
  }

  console.log('Validation report:', report);
  if (errors.length > 0) {
    console.warn(`Found ${errors.length} invalid records`);
  }
}

main().catch((error) => {
  console.error('Validation failed:', error);
  process.exit(1);
});
