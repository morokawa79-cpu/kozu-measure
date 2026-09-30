'use strict'
const assert = require('node:assert/strict')
global.window = globalThis
require('./v210/core.js')
require('./v210/io.js')
require('./v210/render.js')
const K = KozuV210
const polygon = [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]
const rect = (d, attrs={}) => K.addShape(d,'lot',polygon,attrs)
const roundtrip = d => K.IO.deserializeProject(K.IO.serializeProject(d)).document
let passed=0
function check(name, fn) { fn(); passed++; console.log('PASS '+name) }
function transaction(d, action, verify) {
  const store=new K.DocumentStore(d), before=K.clone(store.document)
  store.commit('regression', action)
  verify(store.document)
  verify(roundtrip(store.document))
  const after=K.clone(store.document)
  store.undo(); assert.deepEqual(store.document,before)
  store.redo(); assert.deepEqual(store.document,after)
}
check('segment-specific style wins over general style',()=>{
 const r=Object.create(K.Renderer.prototype); let actual
 r._drawTextBlock=(_c,_a,_t,style)=>{actual=style}
 r._drawMeasurementSegments({}, {id:'x',kind:'polyline',dimensionStyle:{color:'#172033',fontSize:12,offset:10},segments:[{style:{color:'#b91c1c',fontSize:24,offset:30}}]},[{x:0,y:0},{x:100,y:0}],{calibration:{mpp:1}}, {})
 assert.equal(actual.color,'#b91c1c'); assert.equal(actual.fontSize,24); assert.equal(actual.offset,30)
})
check('inactive kind positions move and survive conversion, save and history',()=>{
 const d=K.createDocument(),a=rect(d,{labelPosition:{x:50,y:50},areaLabel:{position:{x:50,y:70}}})
 K.convertShapeKind(d,a.id,'road')
 transaction(d,doc=>{K.translateObject(K.objectById(doc,a.id).object,200,100);K.convertShapeKind(doc,a.id,'lot')},doc=>{
   const x=K.objectById(doc,a.id).object;assert.deepEqual(x.labelPosition,{x:250,y:150});assert.deepEqual(x.areaLabel.position,{x:250,y:170})
 })
})
check('conversion allocates unused lot number',()=>{
 const d=K.createDocument(),a=rect(d);K.convertShapeKind(d,a.id,'road');rect(d)
 transaction(d,doc=>K.convertShapeKind(doc,a.id,'lot'),doc=>{const n=K.activePage(doc).shapes.map(s=>s.number);assert.equal(new Set(n).size,n.length)})
})
check('moved cutout restore stays at moved position',()=>{
 const d=K.createDocument(),a=rect(d),c=K.cutShapeCorner(d,a.id,0,10)
 for(const s of K.activePage(d).shapes)K.translateObject(s,200,100)
 transaction(d,doc=>K.restoreCutout(doc,c.cutout.id),doc=>{const p=K.objectById(doc,a.id).object.points;assert.equal(Math.min(...p.map(v=>v.x)),200);assert.equal(Math.min(...p.map(v=>v.y)),100);assert.equal(K.polygonArea(p),10000)})
})
check('cutout restore after split preserves other parcel and total area',()=>{
 const d=K.createDocument(),a=rect(d),c=K.cutShapeCorner(d,a.id,0,10),parts=K.splitShape(d,a.id,{x:50,y:-10},{x:50,y:110});const other=K.clone(parts[1])
 transaction(d,doc=>K.restoreCutout(doc,c.cutout.id),doc=>{
  assert.deepEqual(K.objectById(doc,other.id).object,other)
  const lots=K.activePage(doc).shapes;assert.equal(lots.reduce((n,s)=>n+K.polygonArea(s.points),0),10000)
  assert.equal(K.polygonPairRelation(lots[0].points,lots[1].points).type,'shared-edge')
 })
})
check('cutout copied alone cannot restore its original parent',()=>{
 const d=K.createDocument(),a=rect(d),c=K.cutShapeCorner(d,a.id,0,10),copy=K.copyObjectToActivePage(d,c.cutout,{x:200,y:0}),before=K.clone(a)
 assert.equal(K.restoreCutout(d,copy.id),null);assert.deepEqual(a,before)
})
check('separated cutout restore refuses instead of overwriting geometry',()=>{
 const d=K.createDocument(),a=rect(d),c=K.cutShapeCorner(d,a.id,0,10);K.translateObject(c.cutout,500,0)
 const before=K.clone(d);assert.equal(K.restoreCutout(d,c.cutout.id),null);assert.deepEqual(d,before)
})
check('group copy preserves parent link through save and history',()=>{
 const d=K.createDocument(),a=rect(d),c=K.cutShapeCorner(d,a.id,0,10)
 transaction(d,doc=>{const copies=K.duplicateObjects(doc,[a.id,c.cutout.id],{x:200,y:0});K.restoreCutout(doc,copies.find(s=>s.kind==='cutout').id)},doc=>{
  assert.equal(K.polygonArea(K.objectById(doc,a.id).object.points),9950)
  const copy=K.activePage(doc).shapes.find(s=>s.kind==='lot'&&s.id!==a.id);assert.equal(K.polygonArea(copy.points),10000);assert.equal(Math.min(...copy.points.map(p=>p.x)),200)
 })
})
check('copied dynamic and fixed tables follow copied lots across pages and history',()=>{
 for (const crossPage of [false,true]) {
  const d=K.createDocument(),a=rect(d,{price:900}),dynamic=K.addEntity(d,'lot-table',{position:{x:200,y:0},dynamic:true,lotIds:[a.id]}),fixed=K.addEntity(d,'lot-table',{position:{x:200,y:200},snapshot:true,dynamic:false,lotIds:[a.id],rows:[{lotId:a.id,number:1,price:800,area:10000,tsubo:3025}]})
  transaction(d,doc=>{
   const sources=[a,dynamic,fixed].map(x=>K.clone(K.objectById(doc,x.id).object))
   if(crossPage)K.setActivePage(doc,2)
   const copies=K.copyObjectsToActivePage(doc,sources,{x:400,y:0})
   copies.find(x=>x.kind==='lot').price=1200
  },doc=>{
   const active=K.activePage(doc),lot=active.shapes.find(x=>x.id!==a.id),tables=active.entities.filter(x=>x.id!==dynamic.id&&x.id!==fixed.id)
   assert.equal(tables.length,2)
   tables.forEach(t=>assert.deepEqual(t.lotIds,[lot.id]))
   const row=tables.find(t=>t.snapshot).rows[0];assert.equal(row.lotId,lot.id);assert.equal(row.price,800)
   assert.equal(lot.price,1200);assert.equal(K.objectById(doc,a.id).object.price,900)
  })
 }
})
check('copying only a table retains its existing references',()=>{
 const d=K.createDocument(),a=rect(d),t=K.addEntity(d,'lot-table',{position:{x:200,y:0},lotIds:[a.id]})
 const copy=K.copyObjectsToActivePage(d,[t])[0]
 assert.deepEqual(copy.lotIds,[a.id]);assert.deepEqual(roundtrip(d).pages[0].entities.find(x=>x.id===copy.id).lotIds,[a.id])
})
console.log(`workflow core regressions: ${passed}/${passed} PASS`)
