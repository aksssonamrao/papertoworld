/** Small paper bombs live in the shared landscape; the host owns input and edits. */
export function createWorldBombs({
  THREE, scene, camera, hAt, isWater, surfaceY, onImpact, audio,
  getOrigin, collideSegment, seed = 1729,
}) {
  const LIMIT = 6, DEBRIS = 96, STEP = 1 / 120, GRAVITY = 3, RADIUS = .028;
  const materialType = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  const ballGeometry = new THREE.IcosahedronGeometry(RADIUS, 1);
  const paper = new materialType({ color: '#f1e5ca', roughness: .95, flatShading: true });
  const chipGeometry = new THREE.BoxGeometry(.008, .004, .012);
  const chipMaterial = new materialType({ color: '#ffffff', roughness: 1, flatShading: true });
  const debris = new THREE.InstancedMesh(chipGeometry, chipMaterial, DEBRIS);
  debris.name = 'Paper bomb confetti'; debris.count = 0; debris.visible = false;
  debris.frustumCulled = false;
  if (THREE.DynamicDrawUsage) debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(debris);
  const transform = new THREE.Object3D(), color = new THREE.Color(), direction = new THREE.Vector3();
  const projectiles = [], chips = [];
  let equipped = false, disposed = false, accumulator = 0, burstSequence = 0;
  const counts = { thrown: 0, impacts: 0, retired: 0 };
  const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
  const finitePoint = p => p && [p.x, p.y, p.z].every(Number.isFinite);
  const inside = p => Math.abs(p.x) <= 8 && Math.abs(p.z) <= 8;
  const surface = (x, z) => isWater?.(x, z) ? surfaceY(x, z) : hAt(x, z);
  const randomFor = n => {
    let state = ((seed >>> 0) ^ Math.imul(n + 1, 2654435761)) >>> 0;
    return () => { state = (state + 0x6D2B79F5) >>> 0; let v = state;
      v = Math.imul(v ^ v >>> 15, v | 1); v ^= v + Math.imul(v ^ v >>> 7, v | 61);
      return ((v ^ v >>> 14) >>> 0) / 4294967296; };
  };
  function retire(index) {
    scene.remove(projectiles[index].mesh); projectiles.splice(index, 1); counts.retired++;
  }
  function burst(point) {
    const random = randomFor(burstSequence++);
    for (let i = 0; i < 24; i++) {
      if (chips.length === DEBRIS) chips.shift();
      const angle = random() * Math.PI * 2, speed = .3 + random() * .7;
      chips.push({ x: point.x, y: point.y + .03, z: point.z,
        vx: Math.cos(angle) * speed, vy: .4 + random() * .9, vz: Math.sin(angle) * speed,
        rx: random() * 6.28, ry: random() * 6.28, rz: random() * 6.28,
        spin: (random() - .5) * 12, scale: .7 + random() * 1.3,
        life: .8 + random() * .65, color: ['#f1e5ca', '#c9a063', '#e4b88a'][Math.floor(random() * 3)] });
    }
  }
  function impact(point) {
    if (disposed || !finitePoint(point) || !inside(point)) return null;
    const event = { x: point.x, y: point.y, z: point.z, radius: .65, power: 1, kind: 'paper-bomb' };
    counts.impacts++; burst(event);
    audio?.burst?.(isWater?.(event.x, event.z) ? 'splash' : 'paper', .15, 0);
    onImpact?.(event);
    return event;
  }
  function syncDebris() {
    for (let i = 0; i < chips.length; i++) {
      const chip = chips[i]; transform.position.set(chip.x, chip.y, chip.z);
      transform.rotation.set(chip.rx, chip.ry, chip.rz);
      transform.scale.setScalar(chip.scale * Math.min(1, chip.life * 3)); transform.updateMatrix();
      debris.setMatrixAt(i, transform.matrix); color.set(chip.color); debris.setColorAt(i, color);
    }
    debris.count = chips.length; debris.visible = chips.length > 0;
    if (chips.length) { debris.instanceMatrix.needsUpdate = true; debris.instanceColor.needsUpdate = true; }
  }
  function launch(target) {
    const origin = getOrigin?.(); if (!finitePoint(origin) || !inside(origin)) return false;
    camera.getWorldDirection(direction);
    const horizontal = Math.hypot(direction.x, direction.z);
    const dx = horizontal > .001 ? direction.x / horizontal : 0;
    const dz = horizontal > .001 ? direction.z / horizontal : -1;
    if (target !== undefined) {
      if (!finitePoint(target) || !inside(target)) return false;
      const distance = Math.hypot(target.x-origin.x,target.z-origin.z);
      if (distance > 6.000001 || distance < .18) return false;
      const ux=(target.x-origin.x)/distance,uz=(target.z-origin.z)/distance;
      const x=origin.x+ux*.12,y=origin.y+.16,z=origin.z+uz*.12;
      const time=Math.max(.3,(distance-.12)/3.2);
      // Match the semi-implicit fixed-step integrator, including its half-step term.
      return {x,y,z,vx:(target.x-x)/time,vy:(target.y+RADIUS-y)/time+GRAVITY*(time+STEP)/2,vz:(target.z-z)/time};
    }
    return {x:origin.x+dx*.12,y:origin.y+.16,z:origin.z+dz*.12,vx:dx*3.2,vy:clamp(1.3+direction.y*.6,.8,1.9),vz:dz*3.2};
  }
  function predict(target) {
    const shot=launch(target);
    if (!shot) return {valid:false,path:[],impact:null,reason:'Choose a nearby spot away from your feet, or move closer to the target.'};
    const p={x:shot.x,y:shot.y,z:shot.z},path=[{...p}];let vy=shot.vy,from={...p};
    // Sample castle contacts at 30 Hz; flight and ground sampling use the same
    // 120 Hz integrator as real throws. UI caches this result between changes.
    for(let i=1;i<=576;i++){
      vy-=GRAVITY*STEP;p.x+=shot.vx*STEP;p.y+=vy*STEP;p.z+=shot.vz*STEP;
      if(!inside(p))return {valid:false,path,impact:null,reason:'Aim inside the paper.'};
      if(i%4===0){const hit=collideSegment?.(from,p);if(finitePoint(hit)){path.push({...hit});return {valid:true,path,impact:{...hit}}}from={...p}}
      const ground=surface(p.x,p.z);
      if(Number.isFinite(ground)&&p.y<=ground+RADIUS){const hit={x:p.x,y:ground,z:p.z};path.push(hit);return {valid:true,path,impact:hit}}
      if(i%4===0)path.push({...p});
    }
    return {valid:false,path,impact:null,reason:'Choose a closer landing spot.'};
  }
  function throwBomb(target) {
    if (disposed || !equipped || projectiles.length >= LIMIT) return false;
    const shot=launch(target);if(!shot)return false;
    const mesh = new THREE.Mesh(ballGeometry, paper); mesh.name = 'Thrown paper bomb'; mesh.castShadow = true;
    mesh.position.set(shot.x,shot.y,shot.z);
    projectiles.push({ mesh, vx:shot.vx,vy:shot.vy,vz:shot.vz,age:0 });
    counts.thrown++; scene.add(mesh); audio?.ensure?.(); return true;
  }
  function update(dt) {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return;
    // Lifetime follows elapsed time even if a suspended tab skips physical steps.
    for (let i = projectiles.length - 1; i >= 0; i--) {
      projectiles[i].age += dt; if (projectiles[i].age >= 4.8) retire(i);
    }
    accumulator += Math.min(dt, .2);
    const impacts = [];
    while (accumulator >= STEP) {
      accumulator -= STEP;
      for (let i = projectiles.length - 1; i >= 0; i--) {
        const bomb = projectiles[i], p = bomb.mesh.position;
        const from = { x: p.x, y: p.y, z: p.z };
        bomb.vy -= GRAVITY * STEP; p.x += bomb.vx * STEP; p.y += bomb.vy * STEP; p.z += bomb.vz * STEP;
        if (!inside(p)) { retire(i); continue; }
        const hit = collideSegment?.(from, { x: p.x, y: p.y, z: p.z });
        if (finitePoint(hit) && inside(hit)) { impacts.push({x:hit.x,y:hit.y,z:hit.z}); retire(i); continue; }
        const ground = surface(p.x, p.z);
        if (Number.isFinite(ground) && p.y <= ground + RADIUS) {
          impacts.push({ x: p.x, y: ground, z: p.z }); retire(i);
        }
      }
    }
    // Contact callbacks run after all projectile iteration, so terrain changes and
    // host cleanup cannot invalidate the active fixed-step loop.
    for (const point of impacts) { impact(point); if (disposed) return; }
    const chipDt = Math.min(dt, .2);
    for (let i = chips.length - 1; i >= 0; i--) {
      const chip = chips[i]; chip.life -= dt;
      if (chip.life <= 0) { chips.splice(i, 1); continue; }
      chip.vy -= GRAVITY * chipDt; chip.x += chip.vx * chipDt; chip.y += chip.vy * chipDt; chip.z += chip.vz * chipDt;
      chip.rx += chip.spin * chipDt; chip.rz -= chip.spin * chipDt * .7;
      const ground = surface(chip.x, chip.z);
      if (Number.isFinite(ground) && chip.y < ground + .005) { chip.y = ground + .005; chip.vy = 0; chip.vx *= .7; chip.vz *= .7; }
    }
    syncDebris();
  }
  function clear() {
    for (const bomb of projectiles) scene.remove(bomb.mesh);
    projectiles.length = 0; chips.length = 0; accumulator = 0;
    debris.count = 0; debris.visible = false;
  }
  function dispose() {
    if (disposed) return; clear(); disposed = true; equipped = false; scene.remove(debris);
    ballGeometry.dispose(); paper.dispose(); chipGeometry.dispose(); chipMaterial.dispose(); debris.dispose();
  }
  return {
    get equipped() { return equipped; }, setEquipped(value) { if (!disposed) equipped = Boolean(value); },
    throwBomb, predict, update, clear, dispose,
    debug: {
      get stats() { return { ...counts, projectiles: projectiles.length, debris: chips.length, disposed }; },
      get projectiles() { return projectiles.map(b => ({ x: b.mesh.position.x, y: b.mesh.position.y, z: b.mesh.position.z, age: b.age })); },
      get debris() { return chips.map(chip => ({ ...chip })); },
      forceImpact(point) { const event = impact(point); if (!disposed) syncDebris(); return event; },
    },
  };
}
