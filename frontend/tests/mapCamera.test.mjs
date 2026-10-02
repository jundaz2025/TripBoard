// Simulate renders, collaboration polls, delayed lookups and gestures without a map API key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';
const { cameraRequest, CameraController } = await loadTs(new URL('../src/mapCamera.ts', import.meta.url));
const scheduled={id:'scheduled',kind:'place',lat:40,lon:-74,colors:['red'],active:true};
const saved={id:'saved',kind:'place',lat:43,lon:-72,colors:[],active:false};
const input={tripId:'trip',city:'New York',selected:null,plan:{selectedDay:'2026-10-01',points:[scheduled,saved]}, destination:{lat:40.7,lon:-74}};
test('day focus excludes unscheduled pins; all-places overview includes both',()=>{
  assert.deepEqual(cameraRequest(input).target.coordinates,[[-74,40]]);
  assert.deepEqual(cameraRequest({...input,overview:1}).target.coordinates,[[-74,40],[-72,43]]);
});
test('an empty itinerary centers on the city rather than isolated saved places',()=>{
  assert.equal(cameraRequest({...input,plan:{...input.plan,points:[saved]}}).target.lat,40.7);
});
test('Saved focus fits only unscheduled places and excludes activities, hotels and search pins',()=>{
  const other={...saved,id:'other',lat:42,lon:-71};
  const plan={...input.plan,points:[scheduled,saved,other,
    {...saved,id:'hotel',kind:'hotel',lat:45}, {...saved,id:'search',kind:'search',lat:46},
  ]};
  assert.deepEqual(cameraRequest({...input,plan,savedOverview:1}).target.coordinates,[[-72,43],[-71,42]]);
  assert.deepEqual(cameraRequest({...input,plan:{...plan,points:[saved]},savedOverview:1}).target.coordinates,[[-72,43]]);
});
test('Saved supports repeat clicks, preserves manual panning during sync, and yields to a day selection',()=>{
  const c=new CameraController();
  const focused={...input,savedOverview:1};
  assert.deepEqual(c.next(cameraRequest(focused)).coordinates,[[-72,43]]);
  c.interact();
  const refreshed=structuredClone(focused);
  refreshed.plan.points[1].lat=44;
  assert.equal(c.next(cameraRequest(refreshed)),null);
  assert.deepEqual(c.next(cameraRequest({...refreshed,savedOverview:2})).coordinates,[[-72,44]]);
  assert.deepEqual(c.next(cameraRequest({...refreshed,savedOverview:0,focusRevision:1})).coordinates,[[-74,40]]);
});
test('fresh objects, polling, translating and background edits do not undo a manual pan',()=>{
  const c=new CameraController();
  assert(c.next(cameraRequest(input)));
  c.interact();
  const updated=structuredClone(input);
  updated.plan.points[1].lat=44;
  assert.equal(c.next(cameraRequest(updated)),null);
  assert(c.next(cameraRequest({...updated,selected:'saved'})));
  assert.equal(c.next(cameraRequest({...updated,selected:'saved'})),null);
  assert(c.next(cameraRequest({...updated,plan:{...updated.plan,selectedDay:'2026-10-02'}})));
});
test('late destination data cannot override a gesture, but a new search can',()=>{
  const c=new CameraController();
  const initial={...input,plan:{...input.plan,points:[]},destination:null};
  assert.equal(c.next(cameraRequest(initial)),null);
  c.interact();
  assert.equal(c.next(cameraRequest({...initial,destination:input.destination})),null);
  assert(c.next(cameraRequest({...initial,preview:{lat:41,lon:-73}})));
});
test('destination can finish initial positioning without a user gesture',()=>{
  const c=new CameraController();
  const initial={...input,plan:{...input.plan,points:[]},destination:null};
  assert.equal(c.next(cameraRequest(initial)),null);
  assert(c.next(cameraRequest({...initial,destination:input.destination})));
});

test('clicking the selected day restores its view once, without reintroducing polling snap-back',()=>{
  const c=new CameraController();
  assert(c.next(cameraRequest(input)));
  c.interact();
  assert.equal(c.next(cameraRequest(structuredClone(input))),null);
  const clicked={...input,focusRevision:1};
  assert.deepEqual(c.next(cameraRequest(clicked)).coordinates,[[-74,40]]);
  assert.equal(c.next(cameraRequest(structuredClone(clicked))),null);
  c.interact();
  assert(c.next(cameraRequest({...clicked,focusRevision:2})));
});

test('repeated Locate clicks restore the selected activity pin without creating a Saved place',()=>{
  const c=new CameraController();
  const activity={...scheduled,id:'activity:one',kind:'activity'};
  const located={...input,plan:{...input.plan,points:[activity]},selected:'activity:one',focusRevision:1};
  assert.deepEqual(c.next(cameraRequest(located)),{kind:'point',lat:40,lon:-74,zoom:14});
  c.interact();
  assert.equal(c.next(cameraRequest(structuredClone(located))),null);
  assert.equal(c.next(cameraRequest({...located,focusRevision:2})).kind,'point');
});
