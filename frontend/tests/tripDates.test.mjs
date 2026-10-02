// Date previews must match backend calendar rules, including fixed reservations and overflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';
const { dayDifference, datePreview } = await loadTs(new URL('../src/tripDates.ts', import.meta.url));
test('Sep 23 to Oct 1 keeps spacing, clocks, fixed reservations and overflow visible', () => {
  const rows=[{id:'a',day:'2026-09-23',start:'09:00'}, {id:'b',day:'2026-09-24',start:'10:00'}, {id:'fixed',day:'2026-09-24',locked:true}, {id:'late',day:'2026-09-26'}];
  const before=JSON.stringify(rows);
  const preview=datePreview(rows,dayDifference('2026-09-23','2026-10-01'),'2026-10-01','2026-10-03');
  assert.deepEqual(preview.map(r=>r.nextDay),['2026-10-01','2026-10-02','2026-09-24','2026-10-04']);
  assert.deepEqual(preview.map(r=>r.outside),[false,false,true,true]);
  assert.equal(JSON.stringify(rows),before);
});
test('calendar shifts cross DST and year boundaries without time-zone drift', () => {
  assert.equal(dayDifference('2026-03-07','2026-03-09'),2);
  assert.equal(dayDifference('2026-12-31','2027-01-01'),1);
});
