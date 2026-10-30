import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import {createWorldBombs} from '../papertoworld/src/activities/world-bombs.js';
function fixture(options={}) {
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();camera.lookAt(0,0,-1);
  const original=new THREE.Group();scene.add(original);const impacts=[];
  const bombs=createWorldBombs({THREE,scene,camera,hAt:()=>0,isWater:()=>false,surfaceY:()=>.1,
    onImpact:event=>impacts.push(event),getOrigin:()=>({x:0,y:.118,z:0}),...options});
  return {bombs,scene,original,impacts};
}
test('paper bomb follows its arc to one ground impact at landscape scale',()=>{
  const {bombs,impacts}=fixture();assert.equal(bombs.throwBomb(),false);bombs.setEquipped(true);
  assert.equal(bombs.throwBomb(),true);for(let i=0;i<300;i++)bombs.update(1/120);
  assert.equal(impacts.length,1);assert.equal(impacts[0].y,0);assert.equal(impacts[0].radius,.65);
  assert.equal(impacts[0].kind,'paper-bomb');assert.ok(Math.abs(impacts[0].z)>3&&Math.abs(impacts[0].z)<5);
  assert.equal(bombs.debug.stats.projectiles,0);bombs.dispose();
});
test('selected landing points and preview agree with actual throws at near and far distances',()=>{
  for(const target of [{x:.5,y:0,z:-.5},{x:3,y:0,z:-3},{x:0,y:.7,z:-5.5}]){
    const {bombs,impacts}=fixture({hAt:(_x,z)=>z< -4.5?target.y:0});bombs.setEquipped(true);
    const preview=bombs.predict(target);assert(preview.valid);assert.equal(impacts.length,0,'preview must not mutate the world');
    assert(bombs.throwBomb(target));for(let i=0;i<576;i++)bombs.update(1/120);
    assert.equal(impacts.length,1);assert(Math.hypot(preview.impact.x-impacts[0].x,preview.impact.z-impacts[0].z)<.04);
    if(target.y===0)assert(Math.hypot(target.x-impacts[0].x,target.z-impacts[0].z)<.06);
    bombs.dispose();
  }
  const {bombs}=fixture();bombs.setEquipped(true);assert.equal(bombs.predict({x:7,y:0,z:0}).valid,false);assert.equal(bombs.throwBomb({x:7,y:0,z:0}),false);bombs.dispose();
});
test('six projectile cap, bounded deterministic confetti and suspended-tab lifetime',()=>{
  const a=fixture({hAt:()=>-100}),b=fixture();a.bombs.setEquipped(true);
  for(let i=0;i<6;i++)assert.equal(a.bombs.throwBomb(),true);assert.equal(a.bombs.throwBomb(),false);
  a.bombs.update(5);assert.equal(a.bombs.debug.stats.projectiles,0);assert.equal(a.impacts.length,0);
  for(let i=0;i<6;i++)a.bombs.debug.forceImpact({x:0,y:0,z:0});
  assert.equal(a.bombs.debug.stats.debris,96);
  b.bombs.debug.forceImpact({x:0,y:0,z:0});const c=fixture();c.bombs.debug.forceImpact({x:0,y:0,z:0});
  assert.deepEqual(b.bombs.debug.debris,c.bombs.debug.debris);
  a.bombs.update(2);assert.equal(a.bombs.debug.stats.debris,0);
  for(const f of [a,b,c])f.bombs.dispose();
});
test('water surface collision, boundary retirement and invalid impacts',()=>{
  const {bombs,impacts}=fixture({isWater:()=>true,surfaceY:()=>.1});bombs.setEquipped(true);bombs.throwBomb();
  for(let i=0;i<250;i++)bombs.update(1/120);assert.equal(impacts.length,1);assert.equal(impacts[0].y,.1);
  assert.equal(bombs.debug.forceImpact({x:9,y:0,z:0}),null);assert.equal(bombs.debug.forceImpact({x:NaN,y:0,z:0}),null);
  const outside=fixture({hAt:()=>-100,getOrigin:()=>({x:0,y:1,z:-7.8})});outside.bombs.setEquipped(true);outside.bombs.throwBomb();
  outside.bombs.update(.2);assert.equal(outside.impacts.length,0);assert.equal(outside.bombs.debug.stats.projectiles,0);
  bombs.dispose();outside.bombs.dispose();
});
test('clear preserves equipment and world; disposal releases only owned resources once',()=>{
  const {bombs,scene,original}=fixture();bombs.setEquipped(true);bombs.throwBomb();bombs.debug.forceImpact({x:0,y:0,z:0});
  const resources=new Set();scene.traverse(o=>{if(o.geometry)resources.add(o.geometry);if(o.material)resources.add(o.material)});
  const disposed=new Map();for(const resource of resources)resource.addEventListener('dispose',()=>disposed.set(resource,(disposed.get(resource)||0)+1));
  bombs.clear();assert.equal(bombs.equipped,true);assert.equal(bombs.debug.stats.projectiles,0);assert.equal(bombs.debug.stats.debris,0);
  bombs.dispose();bombs.dispose();assert.deepEqual(scene.children,[original]);assert.equal(bombs.throwBomb(),false);
  for(const resource of resources)assert.equal(disposed.get(resource),1);
});
