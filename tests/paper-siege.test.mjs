import test from 'node:test';
import assert from 'node:assert/strict';
import * as Three from 'three/webgpu';
import {createPaperSiege} from '../papertoworld/src/activities/paper-siege.js';

// DOM/canvas are inert here; actual Three transforms and Cannon contacts run on CPU.
class Element {
  children=[];style={};dataset={};nodes=new Map();listeners=new Map();
  classList={add(){},remove(){},toggle(){}};
  append(child){this.children.push(child);child.parent=this}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this)}
  querySelector(selector){if(!this.nodes.has(selector))this.nodes.set(selector,new Element());return this.nodes.get(selector)}
  querySelectorAll(){return ['stone','bomb','scatter'].map(k=>{const node=new Element();node.dataset.k=k;return node})}
  addEventListener(type,fn){this.listeners.set(type,fn)}
  setAttribute(){}
  getContext(){return new Proxy({},{get:()=>()=>{}})}
}
const THREE={...Three,MeshStandardMaterial:Three.MeshStandardNodeMaterial,MeshBasicMaterial:Three.MeshBasicNodeMaterial};
function fixture(){
  globalThis.document={head:new Element(),createElement:()=>new Element(),getElementById:()=>null,hasFocus:()=>true};
  globalThis.localStorage={getItem:()=>null,setItem(){}};
  const grid=new Float32Array(17*17);const impacts=[];
  const scene=new Three.Scene(),hud=new Element(),camera=new Three.PerspectiveCamera(40,1.5,.01,100);camera.position.set(0,4,7);
  const original=new Three.Group();original.name='existing landscape';scene.add(original);
  const host={THREE,scene,camera,hud,C:{PW:16,HW:8},heights:()=>({grid,n:17,size:16}),
    activitySite:{castle:{x:0,z:-1.9},cannon:{x:0,z:1.9}},
    hAt:()=>0,surfaceY:()=>0,isWater:()=>false,waterAt:()=>0,hitObst:()=>false,
    season:'summer',night:0,rise:1,tweening:false,
    audio:{ensure(){},pluck(){},burst(){},ctx:null,muted:true},
    renderer:{async compileAsync(){},getDrawingBufferSize:v=>v.set(960,640)},
    onImpact:event=>impacts.push(event),exit(){activity.stop()}};
  const activity=createPaperSiege(THREE);return {activity,host,grid,impacts,original};
}

test('Paper Siege retains its clearing across levels, destroys physics targets and cleans up',async()=>{
  const {activity,host,original}=fixture();await activity.start(host);
  const first=activity.debug.info();assert.deepEqual(first.K,host.activitySite.castle);assert.deepEqual(first.CP,host.activitySite.cannon);
  assert.ok(first.blocks>0);assert.ok(first.knights>0);
  activity.debug.settleNow();activity.debug.next();const second=activity.debug.info();
  assert.equal(second.n,2);assert.deepEqual(second.K,first.K);assert.deepEqual(second.CP,first.CP);
  const before=activity.debug.knightsLeft;
  activity.debug.teleport(0,0,-1,-1.9);activity.update(1/60);
  assert.ok(activity.debug.knightsLeft<before,'knight below its plinth should be defeated');
  assert.ok(host.scene.children.includes(original));
  activity.stop();activity.stop();assert.equal(activity.debug,null);
  assert.deepEqual(host.scene.children,[original]);assert.equal(host.hud.children.length,0);assert.equal(document.head.children.length,0);
});

test('Paper projectile reports a bounded landscape impact once, then refreshes the heightfield',async()=>{
  const {activity,host,grid,impacts}=fixture();await activity.start(host);activity.debug.settleNow();
  activity.debug.drop(3,.7,3);for(let i=0;i<180;i++)activity.update(1/60);
  assert.equal(impacts.length,1,'bounces must not repeatedly carve the terrain');
  assert.ok(impacts[0].radius>0&&impacts[0].radius<=.6);assert.ok(impacts[0].power<=1);
  grid.fill(-.1);activity.refreshTerrain();const shape=activity.debug.g.hfShape;
  assert.equal(shape.minValue,grid[0]*10);assert.equal(shape.maxValue,grid[0]*10);
  activity.stop();
});

test('Leaving while Cannon is loading does not leave an activity root or HUD',async()=>{
  const {activity,host,original}=fixture();const start=activity.start(host);
  activity.key({code:'Escape',preventDefault(){}},true);await start;
  assert.equal(activity.debug,null);assert.deepEqual(host.scene.children,[original]);assert.equal(host.hud.children.length,0);
});

test('free-roam castle takes external paper blasts without changing the shared camera',async()=>{
  const {activity,host}=fixture();host.freeRoam=true;
  const position=host.camera.position.clone(),quaternion=host.camera.quaternion.clone(),fov=host.camera.fov;
  await activity.start(host);activity.debug.settleNow();
  const info=activity.debug.info(),before=activity.debug.knightsLeft;
  activity.applyExternalBlast({x:info.K.x,y:info.top+.3,z:info.K.z,radius:.65,power:1});
  for(let i=0;i<180;i++)activity.update(1/60);
  assert.ok(activity.debug.knightsLeft<before,'a shared landscape blast should topple castle targets');
  assert.deepEqual(host.camera.position,position);assert.deepEqual(host.camera.quaternion.toArray(),quaternion.toArray());assert.equal(host.camera.fov,fov);
  assert.equal(activity.debug.g.hud.r.style.display,'none');assert.equal(activity.debug.state,'free-roam');activity.stop();
});

test('a thrown landscape bomb contacts the Cannon castle before the ground exactly once',async()=>{
  const {createWorldBombs}=await import('../papertoworld/src/activities/world-bombs.js');
  const {activity,host}=fixture();host.freeRoam=true;await activity.start(host);activity.debug.settleNow();
  activity.debug.next();activity.debug.settleNow();
  const target=activity.debug.bodies().filter(b=>b.k==='block'&&Math.abs(b.p[0])>.1).sort((a,b)=>b.p[1]-a.p[1])[0];
  host.camera.position.set(0,0,0);host.camera.lookAt(0,-10,-1);const impacts=[];
  const bombs=createWorldBombs({THREE,scene:host.scene,camera:host.camera,hAt:()=>0,isWater:()=>false,surfaceY:()=>0,
    getOrigin:()=>({x:target.p[0],y:.118,z:target.p[2]+2}),collideSegment:(from,to)=>activity.projectileHit(from,to),
    onImpact:event=>impacts.push(event)});
  bombs.setEquipped(true);assert.equal(bombs.throwBomb(),true);
  for(let i=0;i<240;i++)bombs.update(1/120);
  assert.equal(impacts.length,1);assert.ok(impacts[0].y>.05,'first contact must be castle geometry above the terrain');
  assert.ok(Math.abs(impacts[0].z-target.p[2])<.8);assert.equal(bombs.debug.stats.projectiles,0);
  const miss=activity.projectileHit({x:7,y:2,z:7},{x:7,y:1,z:7});assert.equal(miss,null);
  bombs.dispose();activity.stop();
});

test('walking collision blocks castle and cannon plinths, and clears with the activity',async()=>{
  const {activity,host}=fixture();host.freeRoam=true;
  assert.equal(activity.hitObstacle(0,-1.9),false);await activity.start(host);activity.debug.settleNow();
  const info=activity.debug.info();assert.equal(activity.hitObstacle(info.K.x,info.K.z),true,'retained castle platform blocks its footprint');
  assert.equal(activity.hitObstacle(info.CP.x,info.CP.z),true,'cannon base blocks its footprint');
  assert.equal(activity.hitObstacle(6,6),false);assert.equal(activity.hitObstacle(NaN,0),false);
  activity.stop();assert.equal(activity.hitObstacle(info.K.x,info.K.z),false);
});
