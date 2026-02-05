const fs = require('fs');
const path = require('path');

const SKIP = ['node_modules', 'AutoSnippet', '.git', 'dist', 'build', 'tools', 'dashboard/dist', 'dashboard/node_modules'];
let modified = 0;

function process(dir) {
  fs.readdirSync(dir).forEach(f => {
  if (f.startsWith('.')) return;
  const p = path.join(dir, f);
  if (SKIP.some(s => p.includes(s))) return;
  
  const stat = fs.statSync(p);
  if (stat.isDirectory()) {
    process(p);
  } else if (/\.(js|ts|tsx|jsx|json|mdc|md|css)$/.test(f)) {
    try {
    let c = fs.readFileSync(p, 'utf8');
    const orig = c;
    c = c.replace(/\t/g, '  ').replace(/^(    )+/gm, m => '  '.repeat(m.length / 4));
    if (c !== orig) {
      fs.writeFileSync(p, c, 'utf8');
      modified++;
    }
    } catch (e) {}
  }
  });
}

process('.');
console.log(`✓ 共修改 ${modified} 个文件`);
