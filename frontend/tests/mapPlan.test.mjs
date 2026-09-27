// Check day-separated routes, stable colors, shared-place pins, and behavior after itinerary edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';
const { buildMapPlan, mapRouteData, mapDayInfo, SAVED_COLOR, HOTEL_COLOR } = await loadTs(new URL('../src/mapPlan.ts', import.meta.url));
const first = '2026-09-23', second = '2026-09-24';
const place = (id, lon, lat) => ({ id, title: id, lon, lat });
const activity = (id, day, start, place_id) => ({ id, day, start, place_id });
const trip = {
  start_date: first,
  places: [place('a', -74, 40), place('b', -73, 41), place('c', -72, 42), place('d', -71, 43), place('saved', -70, 44)],
  activities: [activity('d2b',second,'11:00','d'), activity('d1b',first,'11:00','b'), activity('d2a',second,'09:00','c'), activity('d1a',first,'09:00','a')],
  hotels: [{ id: 'hotel', name: 'Hotel', lon: -69, lat: 45 }],
};

test('routes are time ordered, separated by day and never bridged across dates', () => {
  const plan = buildMapPlan(trip, first);
  const features = mapRouteData(plan).features;
  assert.equal(features.length, 2);
  assert.deepEqual(features.find(f => f.properties.day === first).geometry.coordinates, [[-74,40],[-73,41]]);
  assert.deepEqual(features.find(f => f.properties.day === second).geometry.coordinates, [[-72,42],[-71,43]]);
  assert.equal(features.reduce((n, f) => n + f.geometry.coordinates.length - 1, 0), 2);
  assert.notEqual(features[0].properties.color, features[1].properties.color);
  assert.equal(features.at(-1).properties.day, first);
});

test('changing selected day keeps day colors stable and numbers only its activities', () => {
  const one = buildMapPlan(trip, first), two = buildMapPlan(trip, second);
  assert.deepEqual(one.days.map(d=>d.color), two.days.map(d=>d.color));
  assert.equal(two.points.find(p=>p.id==='a').text, 'D1');
  assert.equal(two.points.find(p=>p.id==='c').text, '1');
  assert.equal(two.points.find(p=>p.id==='d').text, '2');
  assert.equal(two.points.find(p=>p.id==='a').active, false);
  assert.equal(two.points.find(p=>p.id==='c').active, true);
});

test('saved places, hotels and search results are not added to daily routes', () => {
  const plan = buildMapPlan(trip, first, { id:'preview',name:'Preview',lat:55,lon:-60 });
  assert.equal(plan.points.find(p=>p.id==='saved').color, SAVED_COLOR);
  assert.equal(plan.points.find(p=>p.id==='hotel').color, HOTEL_COLOR);
  assert(plan.points.some(p=>p.kind==='search'));
  assert.equal(plan.routes.flatMap(r=>r.coordinates).length, 4);
});

test('empty day shows other days as reference without creating a route for it', () => {
  const day = '2026-09-25';
  const plan = buildMapPlan(trip, day);
  assert.equal(plan.hasSelectedActivities,false);
  assert(plan.days.some(d=>d.day===day));
  assert(plan.points.every(p=>!p.active));
  assert(plan.routes.every(r=>r.day!==day));
});

test('repeated place across days has one pin with both day colors and labels', () => {
  const shared = {...trip, activities:[...trip.activities, activity('shared',second,'13:00','a')]};
  const plan=buildMapPlan(shared, second);
  const pin=plan.points.find(p=>p.id==='a');
  assert.equal(plan.points.filter(p=>p.id==='a').length,1);
  assert.equal(pin.colors.length,2);
  assert.equal(pin.color,mapDayInfo(second, first).color);
  assert.equal(pin.text,'3');
  assert.match(pin.description,/Day 1/);
  assert.match(pin.description,/Day 2/);
  assert.equal(plan.hasShared,true);
});

test('moving or removing an activity removes its former day connection', () => {
  const moved={...trip,activities:trip.activities.map(a=>a.id==='d1b'?{...a,day:second,start:'12:00'}:a)};
  const plan=buildMapPlan(moved,first);
  assert.equal(plan.routes.length,1);
  assert.equal(plan.routes[0].day,second);
  assert.equal(plan.points.find(p=>p.id==='b').color,mapDayInfo(second,first).color);
  const removed=buildMapPlan({...trip,activities:[]},second);
  assert.deepEqual(mapRouteData(removed).features,[]);
});

test('unmapped activities preserve itinerary numbering and do not join other dates', () => {
  const plan=buildMapPlan({...trip,activities:[activity('unmapped',first,'08:00',null),...trip.activities]},first);
  assert.equal(plan.points.find(p=>p.id==='a').text,'2');
  assert.equal(plan.points.find(p=>p.id==='b').text,'3');
  assert.equal(plan.routes.length,2);
});
