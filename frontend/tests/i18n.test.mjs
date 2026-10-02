// Check locale persistence, placeholder safety, unchanged domain data, and translation catalog coverage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { loadTs } from './load-ts.mjs';
const stored = new Map([['tripboard.language', 'invalid']]);
globalThis.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key,value) => stored.set(key,value) };
const { getLanguage, setLanguage, tr, translateMessage } = await loadTs(new URL('../src/i18n.ts', import.meta.url));
const { zh } = await loadTs(new URL('../src/translations.ts', import.meta.url));
const { timeZoneLabel, getTimeZoneOptions } = await loadTs(new URL('../src/timeZones.ts', import.meta.url));
const { buildMapPlan } = await loadTs(new URL('../src/mapPlan.ts', import.meta.url));

test('default is English and the language choice persists without changing source strings', () => {
  assert.equal(getLanguage(), 'en');
  setLanguage('zh');
  assert.equal(stored.get('tripboard.language'), 'zh');
  assert.equal(tr('Travel & stays'), '交通与住宿');
  setLanguage('en');
  assert.equal(tr('Travel & stays'), 'Travel & stays');
});
test('interpolation preserves user-entered text literally, including markup and placeholder-like names', () => {
  setLanguage('zh');
  assert.equal(tr('Delete "{name}"?', {name:'<b>{count} New York</b>'}), '删除“<b>{count} New York</b>”？');
  assert.equal(translateMessage('An unknown provider error'), 'An unknown provider error');
  setLanguage('en');
});
test('stored notices and confirmation messages can change languages without rewriting the originals', () => {
  const notice='My hotel starts at 09:00 (America/New_York).';
  setLanguage('zh');
  assert.equal(translateMessage(notice), 'My hotel 将于 09:00 开始（America/New_York）。');
  assert.equal(translateMessage('Delete "New York"?'), '删除“New York”？');
  setLanguage('en');
  assert.equal(translateMessage(notice), notice);
});
test('time-zone labels change but option values remain the same IANA identifiers', () => {
  setLanguage('en');
  const english=timeZoneLabel('America/New_York');
  const values=getTimeZoneOptions().map(o=>o.value).sort();
  assert.equal(english,'Eastern Time');
  setLanguage('zh');
  assert.notEqual(timeZoneLabel('America/New_York'), english);
  assert.deepEqual(getTimeZoneOptions().map(o=>o.value).sort(), values);
  setLanguage('en');
});
test('language changes leave saved places, day colors and separate route coordinates unchanged', () => {
  const trip={start_date:'2026-09-23',end_date:'2026-09-25',hotels:[],places:[{id:'a',title:'New York',lon:-74,lat:40},{id:'b',title:'Central Park',lon:-73,lat:41}],activities:[{id:'one',day:'2026-09-23',start:'09:00',place_id:'a'},{id:'two',day:'2026-09-23',start:'11:00',place_id:'b'}]};
  const before=JSON.stringify(trip);
  setLanguage('en'); const en=buildMapPlan(trip,trip.start_date);
  setLanguage('zh'); const cn=buildMapPlan(trip,trip.start_date);
  assert.notEqual(en.days[0].label,cn.days[0].label);
  assert.deepEqual(en.routes[0].coordinates,cn.routes[0].coordinates);
  assert.equal(en.days[0].color,cn.days[0].color);
  assert.equal(cn.points[0].name,'New York');
  assert.equal(JSON.stringify(trip),before);
  setLanguage('en');
});
test('translation catalog preserves every interpolation placeholder', () => {
  const fields=s=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
  for(const [key,value] of Object.entries(zh)) assert.deepEqual(fields(value),fields(key),key);
});
test('all literal translation calls have a catalog entry', () => {
  const missing=new Set();
  function scan(dir) {
    for(const e of readdirSync(dir,{withFileTypes:true})) {
      const url=new URL(e.name,dir);
      if(e.isDirectory()) {scan(new URL(e.name+'/',dir));continue;}
      if(!/\.tsx?$/.test(e.name)||['translations.ts','i18n.ts'].includes(e.name)) continue;
      const ast=ts.createSourceFile(url.pathname,readFileSync(url,'utf8'),ts.ScriptTarget.Latest,true);
      function walk(n) {
        if(ts.isCallExpression(n)&&n.expression.getText(ast)==='tr'&&n.arguments.length&&ts.isStringLiteral(n.arguments[0])&&!Object.hasOwn(zh,n.arguments[0].text))missing.add(n.arguments[0].text);
        ts.forEachChild(n,walk);
      }
      walk(ast);
    }
  }
  scan(new URL('../src/',import.meta.url));
  assert.deepEqual([...missing],[]);
});
