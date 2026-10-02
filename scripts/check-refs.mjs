/**
 * Small lint: every identifier called in src/*.js must be defined or imported in
 * that file. This is what catches the class of bug where a function is removed
 * during a refactor but one call site is left behind — the live loop swallowed the
 * error, so it only surfaced on Snapshot.
 *
 *   node scripts/check-refs.mjs
 */

import fs from 'node:fs';

const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'new', 'typeof',
  'delete', 'void', 'in', 'of', 'do', 'else', 'throw', 'case', 'await', 'yield',
  'try', 'finally', 'super', 'import', 'from', 'async',
]);

const GLOBALS = new Set([
  'console', 'document', 'window', 'fetch', 'localStorage', 'structuredClone',
  'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout',
  'addEventListener', 'Math', 'Number', 'String', 'Boolean', 'BigInt', 'JSON',
  'Array', 'Object', 'Set', 'Map', 'Date', 'Error', 'URL', 'Image', 'Blob',
  'Symbol', 'parseInt', 'parseFloat', 'isNaN', 'encodeURIComponent',
  'decodeURIComponent', 'Tesseract', 'navigator', 'process', 'globalThis',
  'Promise', 'RegExp', 'createImageBitmap',
]);

function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\\])\/\/.*$/gm, '$1')
    .replace(/`(?:[^`\\]|\\.)*`/g, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '');
}

const files = fs.readdirSync('src').filter((name) => name.endsWith('.js'));
const problems = [];

for (const file of files) {
  const source = stripCommentsAndStrings(fs.readFileSync(`src/${file}`, 'utf8'));

  const defined = new Set();

  for (const match of source.matchAll(/(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    defined.add(match[1]);
  }

  // Class methods, by indentation.
  for (const match of source.matchAll(/^\s{2,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm)) {
    defined.add(match[1]);
  }

  for (const match of source.matchAll(/import\s+\{([^}]*)\}\s+from/g)) {
    for (const name of match[1].split(',')) {
      defined.add(name.trim().split(' as ').pop());
    }
  }

  // Parameters and destructured names are in scope.
  for (const match of source.matchAll(/\(([^)]*)\)\s*(?:=>|\{)/g)) {
    for (const name of match[1].split(',')) {
      const clean = name.trim().split('=')[0].trim();
      if (clean) defined.add(clean);
    }
  }

  for (const match of source.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[2];
    if (KEYWORDS.has(name) || GLOBALS.has(name) || defined.has(name)) continue;
    problems.push(`${file}: ${name}(...)`);
  }
}

console.log('files checked:', files.length);
console.log('undefined calls:', problems.length ? problems : 'none');
if (problems.length) process.exitCode = 1;
