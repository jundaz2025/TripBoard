// Load pure TypeScript modules in Node tests using one cached module instance per source URL.
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Transpile small pure modules using the installed compiler; no test bundler or
// live API is needed. Cache URLs so every importer shares the same locale store.
const cache = new Map();
export function moduleUrl(url) {
  const key = url.href;
  if (cache.has(key)) return cache.get(key);
  let js = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
  }).outputText;
  js = js.replace(/from ["'](\.\.?\/[^"']+)["']/g, (_, path) =>
    'from ' + JSON.stringify(moduleUrl(new URL(path + '.ts', url))),
  );
  const result = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64');
  cache.set(key, result);
  return result;
}
export const loadTs = url => import(moduleUrl(url));
