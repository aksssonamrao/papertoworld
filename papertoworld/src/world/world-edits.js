import { applyTerrainImpact, normalizeImpact, impactContainsObject } from './impacts.js';

export function choosePaperSite(world, {waterAt,hAt,stamps}) {
  let best=null, score=Infinity;
  for(let z=-4;z<=5;z+=1.25)for(let x=-5;x<=5;x+=1.25){
    if(waterAt(x,z)>.25||hAt(x,z)>1.2)continue;
    for(const [dx,dz]of[[0,-1],[1,0],[-1,0],[0,1]]){
      const castle={x:x+dx*3.8,z:z+dz*3.8};
      if(Math.abs(castle.x)>5.9||Math.abs(castle.z)>5.9)continue;
      if(stamps.some(o=>Math.hypot(o.x-castle.x,o.z-castle.z)<2||Math.hypot(o.x-x,o.z-z)<.7))continue;
      const trees=world.trees.filter(o=>Math.hypot(o.x-castle.x,o.z-castle.z)<1.65).length;
      const houses=world.houses.filter(o=>Math.hypot(o.x-castle.x,o.z-castle.z)<1.65).length;
      const cost=Math.hypot(x,z-2)*.2+trees*.4+houses*4+waterAt(castle.x,castle.z)*20+Math.abs(hAt(castle.x,castle.z)-hAt(x,z))*3;
      if(cost<score){score=cost;best={castle,cannon:{x,z}}}
    }
  }
  return best;
}

/** Terrain, visible meshes, collision and navigation share one deterministic edit. */
export function createWorldEdits(host) {
  const {THREE,heights,grid:G,size:PW,hAt,addObstacle,obstacles}=host;
  const half=PW/2,cell=PW/G,waterY=host.waterY,dummy=new THREE.Object3D();
  function place(mesh,index,o,x,y=x,z=x){
    dummy.position.set(o.x,o.y,o.z);dummy.rotation.set(o.lx||0,o.rot||0,o.lz||0);
    dummy.scale.set(x,y,z);dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);mesh.instanceMatrix.needsUpdate=true;
  }
  return function changeLandscape(input){
    const W=host.getWorld();if(!W||host.getGrowth()<6.2||(W.impacts?.length||0)>=64)return false;
    const event=normalizeImpact(input),change=applyTerrainImpact({heights,grid:G,size:PW},event);
    if(!event.power||!change.bounds)return false;
    (W.impacts||=[]).push(event);W.nav=null;host.cancelPath();
    const damaged=o=>{if(impactContainsObject(event,o))o.destroyed=true;return !!o.destroyed};
    for(const o of W.trees){const gone=damaged(o);o.y=hAt(o.x,o.z)-.01;
      place(W.inst.poles,o.pi,o,gone?.00001:o.s,gone?.00001:o.tall?o.s*o.tall:.00001,gone?.00001:o.s);
      place(o.fm,o.fi,o,gone?.00001:o.s);}
    W.houses.forEach((o,i)=>{const gone=damaged(o);o.y=hAt(o.x,o.z);for(const m of[W.inst.walls,W.inst.roofs,W.inst.wins])place(m,i,o,gone?.00001:.2*o.s);if(gone)host.glows.geometry.attributes.alpha.setX(o.glow,0);else host.glows.geometry.attributes.position.setY(o.glow,o.y+.08*o.s)});
    W.lanterns.forEach((o,i)=>{const gone=damaged(o);o.y=hAt(o.x,o.z);for(const m of[W.inst.posts,W.inst.heads])place(m,i,o,gone?.00001:1);if(gone)host.glows.geometry.attributes.alpha.setX(o.glow,0);else host.glows.geometry.attributes.position.setY(o.glow,o.y+.18)});
    for(const [group,[m,arr,,ys]]of W.grass.entries())arr.forEach((o,i)=>{const gone=damaged(o);o.y=group===3?waterY+.012:hAt(o.x,o.z);place(m,i,o,gone?.00001:o.s,gone?.00001:o.s*ys,gone?.00001:o.s)});
    for(const o of W.props){damaged(o);o.y=hAt(o.x,o.z);o.g.position.y=o.y;o.g.visible=!o.destroyed;if(o.glow!==undefined){if(o.destroyed)host.glows.geometry.attributes.alpha.setX(o.glow,0);else host.glows.geometry.attributes.position.setY(o.glow,o.y+(o.glowY||0))}}
    host.glows.geometry.attributes.alpha.needsUpdate=true;host.glows.geometry.attributes.position.needsUpdate=true;
    if(W.smoke)W.smoke=W.smoke.filter(o=>o.h?!o.h.destroyed:!impactContainsObject(event,o));host.smoke?.geometry.setDrawRange(0,W.smoke?.length||0);
    for(let z=0;z<G;z++)for(let x=0;x<G;x++){
      const i=z*G+x,cx=-half+(x+.5)*cell,cz=-half+(z+.5)*cell;
      W.cellH[i]=hAt(cx,cz);if(impactContainsObject(event,{x:cx,z:cz}))W.bridge[i]=0;
    }
    // Flood only crater cells connected to existing water, preserving dry inland bowls.
    const queue=[],seen=new Uint8Array(G*G);
    for(let z=1;z<G-1;z++)for(let x=1;x<G-1;x++){const i=z*G+x;if(W.B[3][i]>.5){queue.push(i);seen[i]=1}}
    for(let q=0;q<queue.length;q++)for(const n of[queue[q]-1,queue[q]+1,queue[q]-G,queue[q]+G]){
      if(n<0||n>=G*G||seen[n])continue;seen[n]=1;
      const x=n%G,z=Math.floor(n/G),cx=-half+(x+.5)*cell,cz=-half+(z+.5)*cell;
      if(x===0||x===G-1||z===0||z===G-1||W.cellH[n]>=waterY-.005||Math.hypot(cx-event.x,cz-event.z)>change.affectedRadius)continue;
      W.B[3][n]=1;W.type[n]=3;queue.push(n);
    }
    obstacles.clear();
    for(const o of W.trees)if(!o.destroyed)addObstacle(o.x,o.z,.02+o.s*.02);
    for(const o of W.houses)if(!o.destroyed)addObstacle(o.x,o.z,.13*o.s);
    for(const o of W.lanterns)if(!o.destroyed)addObstacle(o.x,o.z,.02);
    for(const o of W.props)if(!o.destroyed)addObstacle(o.x,o.z,o.r);
    host.changed();return true;
  };
}
