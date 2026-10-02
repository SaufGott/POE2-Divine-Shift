import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

const code = fs.readFileSync('src/main.js', 'utf8') + fs.readFileSync('src/ui.js', 'utf8');
const used = new Set([...code.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));

const missing = [...used].filter((id) => !ids.has(id));
console.log('ids in index.html:', ids.size);
console.log('ids referenced by code:', used.size);
console.log('missing:', missing.length ? missing : 'none');
