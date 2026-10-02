// Check day-separated routes, stable colors, shared-place pins, and behavior after itinerary edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';
const { buildMapPlan, mapRouteData, mapDayInfo, SAVED_COLOR, HOTEL_COLOR } = await loadTs(new URL('../src/mapPlan.ts', import.meta.url));
const first = '2026-09-23', second = '2026-09-24';
const place = (id, lon, lat) => ({ id, title: id, lon, lat });
const activity = (id, day, start, place_id) => ({ id, day, start, place_id });
const trip = {
  start_date: first, end_date: "2026-09-25",
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

test('switching dates retains empty and unmapped days in the map navigation', () => {
  const third = '2026-09-25';
  const partial = {...trip, activities: [
    activity('unmapped', first, '09:00', null),
    activity('mapped', second, '10:00', 'c'),
  ]};
  const calendar = [first, second, third];
  for (const selected of [first, second, third, first]) {
    const plan = buildMapPlan(partial, selected);
    assert.deepEqual(plan.days.map(d => d.day), calendar);
    assert.deepEqual(plan.days.map(d => d.number), [1, 2, 3]);
    assert.equal(plan.selectedDay, selected);
    assert.equal(plan.hasSelectedActivities, selected === second);
    assert.deepEqual(plan.routes, []);
    assert.equal(plan.points.filter(p => p.colors.length).length, 1);
  }
  const empty = buildMapPlan({...partial, activities: [], places: [], hotels: []}, second);
  assert.deepEqual(empty.days.map(d => d.day), calendar);
  assert.deepEqual(empty.points, []);
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

test('old dates do not become Day 1 or remain connected after a trip moves', () => {
  const plan=buildMapPlan({...trip,start_date:'2026-10-01',end_date:'2026-10-03'},'2026-10-01');
  assert.deepEqual(plan.days.map(d=>d.day),['2026-10-01','2026-10-02','2026-10-03']);
  assert.deepEqual(plan.routes,[]);
  assert(plan.points.filter(p=>p.kind==='place').every(p=>p.color===SAVED_COLOR && p.text==='•'));
});
test('overflow after a shortened trip is excluded from routes and day labels', () => {
  const plan=buildMapPlan({...trip,end_date:first},first);
  assert.deepEqual(plan.days.map(d=>d.day),[first]);
  assert.equal(plan.routes.length,1);
  assert(plan.routes.every(r=>r.day===first));
});

test('activity-only coordinates create day-colored pins and routes without Saved places', () => {
  const independent={...trip,places:[],hotels:[],activities:[
    {...activity('one',first,'09:00',null),title:'Central Park',map_location:{lat:40.78,lon:-73.96}},
    {...activity('two',first,'11:00',null),title:'Times Square',map_location:{lat:40.75,lon:-73.98}},
    {...activity('three',second,'10:00',null),title:'Brooklyn Bridge',map_location:{lat:40.70,lon:-73.99}},
  ]};
  const plan=buildMapPlan(independent,first);
  assert.deepEqual(plan.points.map(p=>p.id),['activity:one','activity:two','activity:three']);
  assert.equal(plan.points[0].text,'1');
  assert.equal(plan.points[1].text,'2');
  assert.equal(plan.points[2].text,'D2');
  assert.notEqual(plan.points[0].color,plan.points[2].color);
  assert.equal(plan.hasUnscheduled,false);
  assert.deepEqual(plan.routes.map(r=>r.coordinates),[[[-73.96,40.78],[-73.98,40.75]]]);
  assert.deepEqual(independent.places,[]);
});

test('read-only legacy lookup pins are ignored after an address changes and do not mutate the trip', () => {
  const old={...trip,places:[],hotels:[],activities:[{...activity('old',first,'09:00',null),title:'Park',location:'Original address'}]};
  const located={old:{address:'Original address',coordinates:{lat:40.7,lon:-74}}};
  assert.equal(buildMapPlan(old,first,null,located).points[0].id,'activity:old');
  assert.equal(old.activities[0].map_location,undefined);
  const changed={...old,activities:[{...old.activities[0],location:'Different address'}]};
  assert.deepEqual(buildMapPlan(changed,first,null,located).points,[]);
});

test('linked places take precedence over stale inline coordinates and invalid pins are not drawn', () => {
  const plan=buildMapPlan({...trip,activities:[
    {...activity('linked',first,'09:00','a'),map_location:{lat:1,lon:2}},
    {...activity('bad',first,'10:00',null),map_location:{lat:NaN,lon:200}},
  ]},first);
  assert.deepEqual([plan.points.find(p=>p.id==='a').lat,plan.points.find(p=>p.id==='a').lon],[40,-74]);
  assert(!plan.points.some(p=>p.id==='activity:linked'||p.id==='activity:bad'));
});
