import { createPaperSiege } from './paper-siege.js';
import { createWorldBombs } from './world-bombs.js';

/** The castle and paper bombs inhabit the existing landscape and walking flow. */
export function createLandscapePlay(host) {
  const { THREE, scene, camera } = host;
  const siege = createPaperSiege(THREE);
  let site = null, marker = null, markerResources = [], generation = 0;
  let loading = false, ready = false, disposed = false;
  const pointers = new Map();
  let selected = null, distance = 3, prediction = null, aimTarget = null, aimKey = '', aimTime = -Infinity;
  const ray = new THREE.Raycaster(), screen = new THREE.Vector2(), forward = new THREE.Vector3();
  const mode = () => host.getMode();
  const hero = () => host.getHero();
  const waterY = () => (host.C.WATER_Y ?? .085) * (host.getRise?.() ?? 1);
  const isWater = (x, z) => host.getSeason() !== 'winter' && host.waterAt(x, z) > .45 && host.hAt(x, z) < waterY() - .025;
  const surfaceY = (x, z) => Math.max(host.hAt(x, z), host.waterAt(x, z) > .45 ? waterY() : -Infinity);
  const ui = document.createElement('div'); ui.className = 'pw-landscape-play';
  ui.innerHTML = `<style>
.pw-landscape-play{position:fixed;inset:0;z-index:35;pointer-events:none;color:var(--ink,#342b28);font-family:var(--sans,system-ui)}
.pw-landscape-tools{position:absolute;right:14px;bottom:calc(env(safe-area-inset-bottom,0px) + 94px);display:flex;align-items:flex-end;flex-direction:column;gap:7px;max-width:min(290px,calc(100% - 28px))}
.pw-landscape-tools button{pointer-events:auto;appearance:none;cursor:pointer;border:1px solid var(--line,#bdac89);border-radius:12px;background:var(--panel,#f4ead8);color:inherit;font:500 13px var(--sans,system-ui);padding:10px 14px;box-shadow:0 2px 12px #0002}
.pw-landscape-tools [data-action=throw]{background:var(--brass,#c9a063);color:var(--onbrass,#2c231e);font-size:15px;min-height:48px;min-width:160px}
.pw-landscape-tools button[aria-pressed=true]{background:var(--brass,#c9a063);color:var(--onbrass,#2c231e)}
.pw-landscape-tools button:focus-visible{outline:3px solid var(--brass,#c9a063);outline-offset:3px}
.pw-landscape-tools button:disabled{opacity:.55;cursor:default}
.pw-bomb-aim{width:min(260px,calc(100vw - 28px));padding:12px;border:1px solid var(--line,#bdac89);border-radius:12px;background:var(--panel,#f4ead8);box-sizing:border-box;pointer-events:auto}
.pw-bomb-aim label{display:flex;justify-content:space-between;font-size:12px;gap:8px}
.pw-bomb-aim input{display:block;width:100%;margin:12px 0;accent-color:var(--brass,#c9a063);touch-action:pan-x}
.pw-bomb-aim [data-aim]{font-size:12px;line-height:1.4;margin:6px 0}
.pw-bomb-aim button{width:100%;min-height:44px}.pw-bomb-aim [data-action=ahead]{margin-top:6px;background:transparent;font-size:12px;padding:7px}
@media(max-width:600px){.pw-landscape-tools{bottom:calc(env(safe-area-inset-bottom,0px) + 82px);gap:5px}.pw-bomb-aim{width:216px;padding:10px}.pw-landscape-tools p{max-width:200px}}
.pw-landscape-tools p{margin:0;padding:5px 8px;border-radius:7px;background:var(--panel,#f4ead8);font-size:11px;line-height:1.4;opacity:.9}
.pw-landscape-play [hidden]{display:none!important}.pw-siege-hud{position:absolute;inset:0;pointer-events:none}
.pw-cannon{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 22px);transform:translateX(-50%);pointer-events:auto;appearance:none;cursor:pointer;min-height:52px;padding:12px 22px;border:1px solid var(--brass,#c9a063);border-radius:26px;background:var(--brass,#c9a063);color:var(--onbrass,#2c231e);font:600 15px var(--sans,system-ui);box-shadow:0 4px 18px #0004;white-space:nowrap;touch-action:manipulation}
.pw-cannon small{font-weight:500;opacity:.7;margin-left:6px}@media(pointer:coarse){.pw-cannon small{display:none}}
@media(max-width:600px){.pw-landscape-tools [data-hint]{display:none}.pw-landscape-tools [data-action=throw]{min-width:132px}}
</style><div class="pw-landscape-tools" hidden><p data-status hidden></p><button type="button" data-action="throw" aria-label="Throw paper bomb">Throw bomb</button><button type="button" data-action="bomb" aria-pressed="false" aria-expanded="false">Aim / distance</button><button type="button" data-action="rain" aria-pressed="false" hidden>Rain: off</button><div class="pw-bomb-aim" hidden><label for="pw-bomb-distance">Throw distance <output data-distance>3</output></label><input id="pw-bomb-distance" type="range" min="0.5" max="6" step="0.25" value="3" aria-label="Throw distance"><div data-aim role="status" aria-live="polite"></div><button type="button" data-action="ahead">Aim ahead</button></div><p data-hint hidden>Click or tap the landscape to choose a spot.<br>Then use Throw bomb. Drag to look.</p></div><div class="pw-siege-hud" hidden></div><button type="button" class="pw-cannon" data-action="cannon" hidden>Man the cannon<small>E</small></button>`;
  document.body.append(ui);
  const panel = ui.querySelector('.pw-landscape-tools'), siegeHud = ui.querySelector('.pw-siege-hud');
  const bombButton = ui.querySelector('[data-action="bomb"]'), throwButton = ui.querySelector('[data-action="throw"]');
  const hint = ui.querySelector('[data-hint]'), status = ui.querySelector('[data-status]'), cannonButton = ui.querySelector('[data-action="cannon"]');
  const siegePtrs = new Map(); // pointers routed to Paper Siege while the cannon is manned: dx/dy and tap detection
  panel.append(bombButton,throwButton); // Keep the primary button in a stable place as aim controls expand.
  const aimPanel=ui.querySelector('.pw-bomb-aim'),range=ui.querySelector('input'),distanceLabel=ui.querySelector('[data-distance]'),aimLabel=ui.querySelector('[data-aim]'),aheadButton=ui.querySelector('[data-action="ahead"]'),rainButton=ui.querySelector('[data-action="rain"]');
  const bombs = createWorldBombs({ THREE, scene, camera, hAt: host.hAt, isWater, surfaceY, audio: host.audio,
    collideSegment: (from, to) => siege.projectileHit(from, to),
    onImpact: event => { siege.applyExternalBlast(event); host.onImpact?.(event); siege.refreshTerrain(); },
    getOrigin: () => { const h = hero(); return h ? { x: h.x, y: h.y, z: h.z } : null; },
  });
  const LineMaterial=THREE.LineBasicNodeMaterial||THREE.LineBasicMaterial;
  const RingMaterial=THREE.MeshBasicNodeMaterial||THREE.MeshBasicMaterial;
  const arcGeometry=new THREE.BufferGeometry();arcGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(146*3),3));
  const arcMaterial=new LineMaterial({color:'#ffd38a',transparent:true,opacity:.9,depthTest:false,depthWrite:false});
  const arc=new THREE.Line(arcGeometry,arcMaterial);arc.name='Paper bomb trajectory';arc.frustumCulled=false;arc.renderOrder=8;
  const ringGeometry=new THREE.RingGeometry(.61,.65,48),ringMaterial=new RingMaterial({color:'#ffd38a',side:THREE.DoubleSide,transparent:true,opacity:.85,depthTest:false,depthWrite:false});
  const ring=new THREE.Mesh(ringGeometry,ringMaterial);ring.rotation.x=-Math.PI/2;ring.name='Paper bomb blast area';ring.renderOrder=9;
  arc.visible=ring.visible=false;scene.add(arc,ring);
  function pick(x,y){
    const rect=host.canvas.getBoundingClientRect();screen.set((x-rect.left)/rect.width*2-1,1-(y-rect.top)/rect.height*2);ray.setFromCamera(screen,camera);
    const end=ray.ray.at(50,new THREE.Vector3());
    const hit=siege.projectileHit(ray.ray.origin,end)||host.pickTarget?.({clientX:x,clientY:y});
    if(!hit)return false;selected={x:hit.x,y:Math.max(hit.y,surfaceY(hit.x,hit.z)),z:hit.z};aimKey='';return true;
  }
  function refreshAim(force=false){
    const visible=mode()==='walk'&&bombs.equipped;
    if(!visible){arc.visible=ring.visible=false;return}
    const h=hero();if(!h)return;
    camera.getWorldDirection(forward);const length=Math.hypot(forward.x,forward.z)||1;
    aimTarget=selected||{x:Math.max(-7.9,Math.min(7.9,h.x+forward.x/length*distance)),z:Math.max(-7.9,Math.min(7.9,h.z+forward.z/length*distance))};
    if(!selected)aimTarget.y=surfaceY(aimTarget.x,aimTarget.z);
    const key=[h.x,h.y,h.z,aimTarget.x,aimTarget.y,aimTarget.z,bombs.debug.stats.impacts,host.getWorld()?.impacts?.length,siege.motionRevision].map(v=>typeof v==='number'?v.toFixed(3):v).join('|');
    const now=performance.now();if(!force&&(now-aimTime<100||key===aimKey))return;aimTime=now;aimKey=key;
    prediction=bombs.predict(aimTarget);
    const positions=arcGeometry.attributes.position,n=Math.min(prediction.path.length,146);
    for(let i=0;i<n;i++){const p=prediction.path[i];positions.setXYZ(i,p.x,p.y,p.z)}positions.needsUpdate=true;arcGeometry.setDrawRange(0,n);
    arc.visible=n>1;ring.visible=!!prediction.impact;
    if(prediction.impact){const p=prediction.impact;ring.position.set(p.x,p.y+.012,p.z)}
    const text=prediction.valid?'Ring shows the blast area.':prediction.reason;
    if(aimLabel.textContent!==text)aimLabel.textContent=text;
    throwButton.disabled=!prediction.valid||bombs.debug.stats.projectiles>=6;
  }
  const gameHost = {
    THREE, scene, camera, renderer: host.renderer, canvas: host.canvas, C: host.C, hud: siegeHud, freeRoam: true,
    hAt: host.hAt, waterAt: host.waterAt, typeAt: host.typeAt, hitObst: host.hitObst, heights: host.heights,
    isWater, surfaceY, sunDir: host.sunDir, audio: host.audio || { ensure() {}, pluck() {}, muted: true },
    get world() { return host.getWorld(); }, get season() { return host.getSeason(); },
    get night() { return host.getNight(); }, get rise() { return host.getRise?.() ?? 1; },
    get activitySite() { return site; }, get tweening() { return false; },
    toast: host.toast, setHint: host.setHint, onImpact: event => host.onImpact?.(event), exit() { leaveCannon(); },
  };
  let lastUI = '';
  function updateUI() {
    if (disposed) return;
    const walking = mode() === 'walk', playing = siege.playing, targets = host.getWorld()?.impacts?.length||0,rain=!!host.getRain?.(),near=walking&&nearCannon();
    const signature = `${walking}|${playing}|${near}|${bombs.equipped}|${ready}|${targets}|${rain}`;
    if(signature === lastUI)return; lastUI = signature;
    ui.hidden = !walking&&!playing; panel.hidden = !walking; siegeHud.hidden = !playing; cannonButton.hidden = !near; if (near) document.getElementById('hint')?.classList.add('fade'); // the walk hint shares the bottom edge
    bombButton.setAttribute('aria-pressed', String(bombs.equipped));
    bombButton.setAttribute('aria-expanded',String(bombs.equipped));
    aimPanel.hidden = !walking || !bombs.equipped; hint.hidden = !walking;hint.innerHTML=bombs.equipped?'Click or tap a spot, then Throw bomb.<br>Drag to look. The ring shows the blast area.':'Throw ahead, or use Aim / distance to choose a spot.';
    bombButton.textContent=bombs.equipped?'Hide aim':'Aim / distance';
    status.hidden=!targets;status.textContent=targets>=64?'64 changes saved · Regrow for fresh terrain':`${targets} landscape change${targets===1?'':'s'}`;
    rainButton.setAttribute('aria-pressed',String(rain));rainButton.textContent=rain?'Rain: on':'Rain: off';
  }
  // the prompt shows when the wanderer is beside the cannon and the castle is ready
  function nearCannon() { const h = hero(); return !!(ready && site && h && Math.hypot(h.x - site.cannon.x, h.z - site.cannon.z) < .8); }
  function enterCannon() {
    if (disposed || !ready || siege.playing || mode() !== 'walk' || !host.enterSiege?.(site)) return false;
    bombs.setEquipped(false); selected = null; arc.visible = ring.visible = false; siegePtrs.clear();
    siege.play(); updateUI(); return true;
  }
  function leaveCannon() {
    if (!siege.playing) return false;
    siege.rest(); siegePtrs.clear(); host.leaveSiege?.(); updateUI(); return true;
  }
  function equip(value) { if (disposed || mode() !== 'walk') return false; bombs.setEquipped(value);selected=null;aimKey='';updateUI();refreshAim(true);return true; }
  function throwBomb() {
    if(disposed||mode()!=='walk')return false;
    const quick=!bombs.equipped;if(quick){bombs.setEquipped(true);selected=null;aimKey=''}
    refreshAim(true);const sent=!!prediction?.valid&&bombs.throwBomb(aimTarget);
    if(quick&&sent){bombs.setEquipped(false);arc.visible=ring.visible=false}
    updateUI();return sent;
  }
  async function startSiege() {
    if (disposed || !site || ready || loading) return false;
    const ticket = ++generation; loading = true;
    try {
      await siege.start(gameHost);
      if (disposed || ticket !== generation) return false;
      loading = false; ready = true; updateUI(); return true;
    } catch (error) {
      if (!disposed && ticket === generation) { loading = false; siege.stop(); console.error('[Paper castle]', error); }
      return false;
    }
  }
  function stopSiege() { generation++; loading = false; ready = false; siege.stop(); updateUI(); }
  function removeMarker() {
    if (marker) { scene.remove(marker); marker = null; }
    for (const resource of markerResources) resource.dispose(); markerResources = [];
  }
  function build(nextSite) {
    if (disposed) return Promise.resolve(false); clear();
    if (!nextSite || !['castle', 'cannon'].every(key => nextSite[key] && Number.isFinite(nextSite[key].x) && Number.isFinite(nextSite[key].z))) return Promise.resolve(false);
    site = { castle: { ...nextSite.castle }, cannon: { ...nextSite.cannon } };
    marker = new THREE.Group(); marker.name = 'Paper workshop flag';
    const own = resource => { markerResources.push(resource); return resource; };
    const Material = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
    const brass = own(new Material({ color: '#bb8e51', roughness: .85 }));
    const ink = own(new Material({ color: '#b5533c', roughness: 1, side: THREE.DoubleSide }));
    const add = (geometry, material, x, y, z) => {
      const mesh = new THREE.Mesh(own(geometry), material); mesh.position.set(x, y, z); mesh.castShadow = true; marker.add(mesh);
    };
    const c = site.cannon, ground = surfaceY(c.x, c.z);
    add(new THREE.CylinderGeometry(.012, .014, .62, 6), brass, c.x + .38, ground + .31, c.z);
    add(new THREE.PlaneGeometry(.22, .13), ink, c.x + .49, ground + .52, c.z);
    scene.add(marker); return startSiege();
  }
  function clear() { if (siege.playing) { siege.rest(); host.leaveSiege?.(); } stopSiege(); site = null; pointers.clear();selected=null;prediction=null;aimKey=''; bombs.clear(); bombs.setEquipped(false);arc.visible=ring.visible=false; removeMarker(); updateUI(); }
  function update(dt, et) { if (disposed) return; bombs.update(dt); if (ready) siege.update(dt, et); updateUI();refreshAim();throwButton.disabled=bombs.debug.stats.projectiles>=6||(bombs.equipped&&!prediction?.valid); }
  function pointerDown(event) {
    if (disposed) return false;
    if (siege.playing) { siegePtrs.set(event.pointerId, { x: event.clientX, y: event.clientY, x0: event.clientX, y0: event.clientY, t0: performance.now() }); siege.pointerDown(event); return true; }
    if (mode() === 'walk' && bombs.equipped&&!(event.pointerType==='touch'&&event.clientX<innerWidth*.45)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    return false; // The existing walk camera still receives its normal gestures.
  }
  function pointerMove(event) {
    if (!disposed && siege.playing) { const p = siegePtrs.get(event.pointerId); if (!p) return false; const dx = event.clientX - p.x, dy = event.clientY - p.y; p.x = event.clientX; p.y = event.clientY; siege.pointerMove(event, dx, dy); return true; }
    if(disposed||mode()!=='walk'||!bombs.equipped)return false;
    const start=pointers.get(event.pointerId);
    if(start){if(Math.hypot(event.clientX-start.x,event.clientY-start.y)>7){selected=null;aimKey=''}return false}
    return false;
  }
  function pointerUp(event, tap) {
    if (disposed) return false;
    if (siege.playing) { const p = siegePtrs.get(event.pointerId); siegePtrs.delete(event.pointerId); siege.pointerUp(event, !!p && Math.hypot(event.clientX - p.x0, event.clientY - p.y0) < 10 && performance.now() - p.t0 < 400); return true; }
    const start = pointers.get(event.pointerId); pointers.delete(event.pointerId);
    if (mode() !== 'walk' || !bombs.equipped || event.type === 'pointercancel' || (event.button != null && event.button !== 0)) return false;
    const isTap = typeof tap === 'boolean' ? tap : start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 7;
    if (!start||!isTap||pointers.size) return false;pick(event.clientX,event.clientY);refreshAim(true);return true;
  }
  function wheel(event) { if (disposed || !siege.playing) return false; siege.wheel(event); return true; }
  function key(event, down = true) {
    if (!disposed && siege.playing) { siege.key(event, down); return true; }
    if (disposed || mode() !== 'walk' || event.metaKey || event.ctrlKey || event.altKey) return false;
    const target = event.target;
    if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return false;
    const code = event.code || ({ b: 'KeyB', e: 'KeyE', Escape: 'Escape' })[event.key];
    if (code === 'KeyE' && nearCannon()) { if (down && !event.repeat) enterCannon(); event.preventDefault(); return true; }
    if (code === 'KeyB') { if (down && !event.repeat) equip(!bombs.equipped); event.preventDefault(); return true; }
    if (code === 'Escape' && bombs.equipped) { if (down) equip(false); event.preventDefault(); return true; }
    if(code==='Space'&&/^(BUTTON|A)$/.test(target?.tagName||''))return false;
    if(code==='Space'){if(down&&!event.repeat)throwBomb();event.preventDefault();return true}
    return false;
  }
  bombButton.addEventListener('click', () => equip(!bombs.equipped)); throwButton.addEventListener('click', () => throwBomb());
  rainButton.addEventListener('click',()=>{host.setRain?.(!host.getRain?.());updateUI()});
  range.addEventListener('input',()=>{distance=Number(range.value);distanceLabel.textContent=String(distance);selected=null;aimKey='';refreshAim(true)});
  aheadButton.addEventListener('click',()=>{selected=null;aimKey='';refreshAim(true)});
  cannonButton.addEventListener('click', () => enterCannon());
  for (const control of [bombButton,throwButton,rainButton,aimPanel,cannonButton]) control.addEventListener('pointerdown', event => event.stopPropagation());
  function dispose() { if (disposed) return; clear(); disposed = true; bombs.dispose();scene.remove(arc,ring);for(const resource of[arcGeometry,arcMaterial,ringGeometry,ringMaterial])resource.dispose(); ui.remove(); }
  updateUI();
  return {
    build, clear, update, enterCannon, leaveCannon, get playing() { return siege.playing; }, pointerDown, pointerMove, pointerUp, wheel, key, startSiege, stopSiege, dispose,
    hitObstacle: (x,z,pad=.02) => siege.hitObstacle(x,z,pad),
    get equipped() { return bombs.equipped; }, get bombTool() { return bombs; }, get siege() { return siege; }, get site() { return site; },
    debug: { get ready() { return ready; }, get loading() { return loading; }, get stats() { return bombs.debug.stats; },
      equip, throwBomb, forceImpact: point => bombs.debug.forceImpact(point),get aim(){return {target:aimTarget,prediction,distance,selected,visible:arc.visible}}, get marker() { return marker; }, get ui() { return ui; } },
  };
}
