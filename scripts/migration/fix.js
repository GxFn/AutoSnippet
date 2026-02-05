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

function applyAutoFix(type, record) {
  const cloned = { ...record };

  if (type === 'snippet') {
  if (!cloned.title && cloned.name) cloned.title = cloned.name;
  if (!cloned.trigger && cloned.completion) cloned.trigger = cloned.completion;
  if (!cloned.body && cloned.content) cloned.body = cloned.content;
  }

  if (type === 'recipe') {
  if (!cloned.title && cloned.name) cloned.title = cloned.name;
  if (!cloned.category) cloned.category = 'uncategorized';
  }

  if (type === 'guard') {
  if (!cloned.category) cloned.category = 'general';
  if (!cloned.severity) cloned.severity = 'warning';
  if (!cloned.languages && cloned.language) cloned.languages = [cloned.language];
  }

  return cloned;
}

async function main() {
  const args = minimist(process.argv.slice(2));
  const type = args.type || args.t;
  const input = args.input || args.i;
  const output = args.output || args.o;

  if (!type || !input || !output) {
  console.error('Usage: node scripts/migration/fix.js --type <snippet|recipe|guard> --input <file> --output <file>');
  process.exit(1);
  }

  const source = loadJson(input);
  const records = Array.isArray(source) ? source : source.items || [];

  const fixed = records.map((record) => {
  const adjusted = applyAutoFix(type, record);
  const entity = buildEntity(type, adjusted);
  return entity.toJSON();
  });

  saveJson(output, fixed);
  console.log(`Fixed ${fixed.length} records`);
}

main().catch((error) => {
  console.error('Fix failed:', error);
  process.exit(1);
});
