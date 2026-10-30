const $ = id => document.getElementById(id), esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let reference, recording = {runs: []}, views = [], playing = false, cursor = 6, axis = 'story', selected = null, lastLive = false, liveId = null, liveMode = null, recordingVersion = null;
const T = window.THREE, canvas = $('world'); let renderer;
try { renderer = new T.WebGLRenderer({canvas, antialias: true, alpha: false, powerPreference: 'low-power'}); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setScissorTest(true); renderer.outputColorSpace = T.SRGBColorSpace; }
catch { $('empty').textContent = 'This browser could not create a WebGL view. The measured results and live controls still work.'; }
const material = color => new T.MeshStandardMaterial({color, roughness: .9, flatShading: true});
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); return m; };
const mats = {ground: material('#b9cb9e'), wood: material('#8d7255'), leaf: material('#6c9360'), wall: material('#e9d8b6'), roof: material('#a76d50'), skin: material('#dbaf83')};
function makeView(run, slot) {
  const scene = new T.Scene(); scene.background = new T.Color('#dfe8d2'); scene.fog = new T.Fog('#dfe8d2', 17, 30);
  const hemi = new T.HemisphereLight('#fff5d9', '#778e67', 2.5); scene.add(hemi);
  const light = new T.DirectionalLight('#fff0ce', 2.8); light.position.set(-5, 8, 4); scene.add(light);
  const world = run.world, terrain = new T.BufferGeometry(), vertices = [], colors = [], indices = [];
  const n = world.n, h = (x, z) => world.cells[Math.max(0, Math.min(n, Math.round((z + 8) / 16 * n))) * (n + 1) + Math.max(0, Math.min(n, Math.round((x + 8) / 16 * n)))][0];
  for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) {
    const [height, water] = world.cells[z * (n + 1) + x]; vertices.push(-8 + x * 16 / n, height, -8 + z * 16 / n);
    const c = new T.Color(water ? '#82b9bb' : ((x * 7 + z * 11) % 5 === 0 ? '#c4d3a8' : '#b6c99a')); colors.push(c.r, c.g, c.b);
    if (x < n && z < n) { const a = z * (n + 1) + x, b = a + n + 1; indices.push(a, b, a + 1, b, b + 1, a + 1); }
  }
  terrain.setAttribute('position', new T.Float32BufferAttribute(vertices, 3)); terrain.setAttribute('color', new T.Float32BufferAttribute(colors, 3)); terrain.setIndex(indices); terrain.computeVertexNormals();
  scene.add(new T.Mesh(terrain, new T.MeshStandardMaterial({vertexColors: true, roughness: 1, flatShading: true})));
  const trees = world.trees, trunks = new T.InstancedMesh(new T.CylinderGeometry(.016, .026, .2, 5), mats.wood, trees.length), leaves = new T.InstancedMesh(new T.ConeGeometry(.13, .35, 6), mats.leaf, trees.length), dummy = new T.Object3D();
  trees.forEach((t, i) => { const y = h(t.x, t.z); dummy.position.set(t.x, y + .1 * t.s, t.z); dummy.scale.setScalar(t.s); dummy.rotation.set(0, i, 0); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.y = y + .32 * t.s; dummy.updateMatrix(); leaves.setMatrixAt(i, dummy.matrix); }); scene.add(trunks, leaves);
  world.homes.forEach((home, i) => { const y = h(home.x, home.z), group = new T.Group(); group.position.set(home.x, y, home.z);
    group.add(mesh(new T.BoxGeometry(.29, .24, .22), mats.wall, 0, .12)); const roof = mesh(new T.ConeGeometry(.25, .2, 4), i % 2 ? mats.roof : material('#8a7258'), 0, .33); roof.rotation.y = Math.PI / 4; group.add(roof);
    group.add(mesh(new T.BoxGeometry(.065, .14, .008), mats.wood, 0, .07, .115)); group.add(mesh(new T.BoxGeometry(.06, .065, .009), material('#f1d898'), .10, .15, .115)); scene.add(group); });
  const actors = new Map();
  world.cast.forEach((person, i) => {
    const root = new T.Group(), coat = material(person.color), dark = material('#5c6653');
    root.add(mesh(new T.CylinderGeometry(.043, .052, .12, 7), coat, 0, .125)); root.add(mesh(new T.SphereGeometry(.039, 9, 7), mats.skin, 0, .22));
    root.add(mesh(new T.SphereGeometry(.041, 8, 5), material(i % 2 ? '#64503b' : '#5b4636'), 0, .24, -.008));
    const legs = [-1, 1].map(sign => mesh(new T.CylinderGeometry(.016, .015, .075, 5), dark, sign * .021, .039)); legs.forEach(l => root.add(l));
    const halo = mesh(new T.RingGeometry(.075, .088, 24), new T.MeshBasicMaterial({color: slot ? '#287b56' : '#c16c43', side: T.DoubleSide}), 0, .004); halo.rotation.x = -Math.PI / 2; root.add(halo);
    const thought = mesh(new T.SphereGeometry(.022, 7, 5), material('#f1c971'), 0, .31); root.add(thought);
    const labelCanvas = document.createElement('canvas'); labelCanvas.width = 256; labelCanvas.height = 64; const ctx = labelCanvas.getContext('2d');
    ctx.font = '500 30px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#f8f5ed'; ctx.strokeStyle = '#f8f5ed'; ctx.lineWidth = 8; ctx.strokeText(person.name, 128, 42); ctx.fillStyle = '#344536'; ctx.fillText(person.name, 128, 42);
    const sprite = new T.Sprite(new T.SpriteMaterial({map: new T.CanvasTexture(labelCanvas), depthTest: false})); sprite.position.y = .42; sprite.scale.set(.58, .145, 1); root.add(sprite);
    scene.add(root); actors.set(person.id, {root, legs, thought, halo, last: null});
  });
  const camera = new T.PerspectiveCamera(38, 1, .02, 70), fires = new Map();
  return {scene, camera, actors, fires, h, run, light, hemi, angle: .15, zoom: run.world.cast.length > 16 ? 1.35 : 1, target: new T.Vector3(-.2, 0, 2), slot};
}
function setRecording(data) {
  if (!data?.runs?.length) return;
  recording = data;
  // Recreate only when a run changes; a completed first run can be previewed
  // while the second policy is still being measured.
  for (const view of views.filter(Boolean)) { view.scene.traverse(o => { o.geometry?.dispose(); if (o.material?.map) o.material.map.dispose(); o.material?.dispose(); }); }
  views = ['baseline', 'runtime'].map((mode, i) => { const run = data.runs.find(r => r.mode === mode); return run ? makeView(run, i) : null; });
  $('empty').style.display = 'none'; cursor = axis === 'story' ? 6 : 0;
  const scripted = data.runs.some(r => r.adapter.includes('SCRIPTED'));
  $('provenance').textContent = scripted ? 'Scripted pipeline · zero model calls' : `Recorded local models · seed ${data.runs[0].seed} · ${data.runs[0].world.cast.length} people${data.budget_ms ? ` · equal ${fmtDur(data.budget_ms / 1000)} budget` : ''}`;
  ['left', 'right'].forEach(side => { $('spent-' + side).hidden = true; });
  $('people').classList.toggle('compact', data.runs[0].world.cast.length > 16);
  const queueCap = data.runs.find(r => r.mode === 'baseline')?.baseline_in_flight;
  $('baseline-sub').textContent = queueCap ? `FIFO client, at most ${queueCap} in flight · four backend slots` : 'FIFO client submissions · four backend slots';
  $('people').innerHTML = data.runs[0].world.cast.map(p => `<button data-person="${esc(p.id)}"><i style="background:${esc(p.color)}"></i>${esc(p.name)} <small>${esc(p.role)}</small></button>`).join('');
  $('people').querySelectorAll('button').forEach(b => b.onclick = () => { selected = selected === b.dataset.person ? null : b.dataset.person; $('people').querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset.person === selected)); });
  if (data.runs.length === 2) { const [a, b] = ['baseline', 'runtime'].map(m => data.runs.find(r => r.mode === m));
        const fmt = (v, d) => v == null ? '—' : (+v).toFixed(d), row = (label, x, y, d, lower) => { const better = x == null || y == null || +x === +y ? '' : (lower ? +y < +x : +y > +x) ? 'b' : 'a';
      return `<tr><td>${label}</td><td class="${better === 'a' ? 'better' : ''}">${fmt(x, d)}</td><td class="${better === 'b' ? 'better' : ''}">${fmt(y, d)}</td></tr>`; };
    const partial = data.runs.some(r => r.completed === false), reached = r => r.completed === false ? 'stopped ' + hourText(r.story_hour_reached) : 'full day';
    $('run-summary').innerHTML = `<table class="otable"><thead><tr><th>${scripted ? 'Scripted check' : `Recorded day · seed ${esc(a.seed)} · ${a.world.cast.length} people`}</th><th>All-Gemma FIFO</th><th>Adaptive</th></tr></thead><tbody>${[
      ...(partial ? [`<tr><td>Day reached</td><td class="${a.completed === false ? '' : 'better'}">${reached(a)}</td><td class="${b.completed === false ? '' : 'better'}">${reached(b)}</td></tr>`] : []),
      row('Wall time (s)', a.wall_ms / 1000, b.wall_ms / 1000, 1, true), row('Gemma requests', a.summary.gemma_requests, b.summary.gemma_requests, 0, true),
      row('Coalition requests', a.summary.coalition_requests, b.summary.coalition_requests, 0), row('Mean native reward', a.summary.mean_native_reward, b.summary.mean_native_reward, 3),
      row('Household damage', a.summary.damage, b.summary.damage, 2, true)].join('')}</tbody></table><p class="otable-note">Both runs used the same memory backend${data.budget_ms ? ` and the same ${fmtDur(data.budget_ms / 1000)} wall-clock budget; a stopped run's totals cover only the hours it reached` : ''}. This is one seed, not a universal quality result.</p>`;
  } else $('run-summary').textContent = 'The first real policy run is available; the second recording has not completed yet.';
}
const time = f => axis === 'story' ? f.hour : f.wall_ms / 1000;
function sample(run) {
  const frames = run.frames; let lo = 0, hi = frames.length - 1;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (time(frames[mid]) <= cursor) lo = mid; else hi = mid - 1; }
  const a = frames[lo], b = frames[Math.min(lo + 1, frames.length - 1)], span = time(b) - time(a), t = span > 0 ? Math.max(0, Math.min(1, (cursor - time(a)) / span)) : 0;
  return {a, b, t};
}
const fmtDur = sec => { sec = Math.round(sec); return sec < 60 ? `${sec} s` : sec % 60 ? `${Math.floor(sec / 60)} min ${sec % 60} s` : `${sec / 60} min`; };
const hourText = h => { const minute = Math.min(22 * 60, Math.floor(h * 60 + 1e-6)); return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`; };
function draw(view, now) {
  const {a, b, t} = sample(view.run), daylight = Math.max(.25, Math.sin((a.hour - 5) / 17 * Math.PI)); view.hemi.intensity = 1.2 + daylight * 1.3; view.light.intensity = daylight * 2.8;
  a.people.forEach((person, i) => { const actor = view.actors.get(person.id), next = b.people[i];
    actor.root.position.set(T.MathUtils.lerp(person.x, next.x, t), view.h(person.x, person.z), T.MathUtils.lerp(person.z, next.z, t)); actor.root.rotation.y = -person.face + Math.PI / 2;
    const moving = Math.hypot(person.x - next.x, person.z - next.z) > .002; actor.legs.forEach((leg, k) => leg.rotation.x = moving ? Math.sin(now * 8 + k * Math.PI) * .35 : 0);
    actor.thought.visible = person.thinking; actor.thought.position.y = .32 + Math.sin(now * 3) * .008; actor.halo.visible = person.id === selected; actor.last = person;
  });
  view.fires.forEach(flame => { flame.visible = false; });
  a.fires.forEach((fire, i) => { let flame = view.fires.get(i);
    if (!flame) { flame = new T.Group(); for (let k = 0; k < 5; k++) { const f = mesh(new T.ConeGeometry(.055, .46, 5), material(k % 2 ? '#f3c05c' : '#d56733'), Math.sin(k * 4) * .08, .51, Math.cos(k * 4) * .08); flame.add(f); } view.scene.add(flame); view.fires.set(i, flame); }
    flame.visible = !fire.over; flame.position.set(fire.x, view.h(fire.x, fire.z), fire.z); flame.children.forEach((f, k) => { f.scale.y = 1 + .2 * Math.sin(now * 6 + k); f.rotation.y = now + k; });
  });
  if (selected && view.actors.has(selected)) { const p = view.actors.get(selected).root.position; view.target.lerp(new T.Vector3(p.x, 0, p.z), .03); }
  else view.target.lerp(new T.Vector3(-.2, 0, 2), .02);
  const radius = 5.4 * view.zoom; view.camera.position.set(view.target.x + Math.sin(view.angle + .55) * radius, radius * .85, view.target.z + Math.cos(view.angle + .55) * radius); view.camera.lookAt(view.target);
  const width = canvas.clientWidth / 2, height = canvas.clientHeight; view.camera.aspect = width / height; view.camera.updateProjectionMatrix();
  renderer.setViewport(width * view.slot, 0, width, height); renderer.setScissor(width * view.slot, 0, width, height); renderer.render(view.scene, view.camera);
  const side = view.slot ? 'right' : 'left', spent = view.run.completed === false && a === view.run.frames.at(-1);
  const clock = `${hourText(a.hour)} · ${spent ? 'compute budget spent' : a.waiting ? 'waiting for models' : a.hour >= 22 ? 'day complete' : 'living'}`;
  $('label-' + side).textContent = clock; $('label-' + side).classList.toggle('spent-label', spent);
  if (spent !== !$('spent-' + side).hidden) { $('spent-' + side).hidden = !spent;
    $('spent-' + side).innerHTML = `<b>Stopped at ${hourText(view.run.story_hour_reached ?? a.hour)}</b>This village used its ${fmtDur((recording.budget_ms ?? view.run.budget_ms) / 1000)} of compute before the day was done.`; }
  const s = a.stats, metrics = [['Choices', s.decisions], ['Gemma calls', s.gemma_requests], ['Pending', s.in_flight], [view.slot ? 'Banked credits' : 'Native learning', view.slot ? (s.rolling?.credits ?? 0).toFixed(1) : a.people.reduce((n, p) => n + p.learned, 0)]];
  $(view.slot ? 'runtime-metrics' : 'baseline-metrics').innerHTML = metrics.map(([label, value]) => `<span class="metric"><b>${value}</b><small>${label}</small></span>`).join('');
}
let prev = performance.now();
function animate(now) {
  const dt = Math.min(.1, (now - prev) / 1000); prev = now;
  const limit = axis === 'story' ? 22 : Math.max(1, ...recording.runs.map(r => r.wall_ms / 1000));
  if (playing) { cursor = Math.min(limit, cursor + dt * +$('speed').value * (axis === 'story' ? .16 : 4)); if (cursor === limit) { playing = false; $('play').textContent = 'Replay recorded day'; $('play').classList.remove('is-playing'); } }
  if (renderer && views.some(Boolean)) { const w = canvas.clientWidth, h = canvas.clientHeight; if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) renderer.setSize(w, h, false);
    renderer.setScissorTest(false); renderer.setClearColor('#dfe8d2'); renderer.clear(); renderer.setScissorTest(true); views.filter(Boolean).forEach(v => draw(v, now / 1000)); }
  $('timeline-wrap').classList.toggle('wall', axis !== 'story'); $('timeline').min = axis === 'story' ? 6 : 0; $('timeline').max = limit; $('timeline').value = cursor;
  $('clock').textContent = axis === 'story' ? hourText(cursor) : `${cursor.toFixed(0)} s wall time`;
  if (selected) { const notes = views.filter(Boolean).map(v => { const p = v.actors.get(selected)?.last; return p ? `${v.slot ? 'Adaptive' : 'FIFO'}: ${p.doing} · ${p.learned} learned outcomes · health ${(100 * p.health).toFixed(0)}%` : ''; }); $('person-note').textContent = notes.join('  /  '); }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
$('play').onclick = () => { if (!recording.runs.length) return; const end = axis === 'story' ? 22 : Math.max(...recording.runs.map(r => r.wall_ms / 1000)); if (cursor >= end) cursor = axis === 'story' ? 6 : 0; playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play recorded day'; $('play').classList.toggle('is-playing', playing); };
$('fire').onclick = () => { if (!recording.runs.length) return; const frames = recording.runs.map(r => r.frames.find(f => f.fires.some(e => !e.over))).filter(Boolean); cursor = frames.length ? Math.min(...frames.map(f => axis === 'story' ? f.hour : f.wall_ms / 1000)) : axis === 'story' ? 12 : 0; };
$('axis').onchange = () => { axis = $('axis').value; cursor = axis === 'story' ? 6 : 0; };
$('timeline').oninput = () => { cursor = +$('timeline').value; };
let drag = null; canvas.onpointerdown = e => { drag = e.clientX; canvas.setPointerCapture(e.pointerId); }; canvas.onpointermove = e => { if (drag != null) { views.filter(Boolean).forEach(v => v.angle -= (e.clientX - drag) * .006); drag = e.clientX; } }; canvas.onpointerup = () => { drag = null; };
canvas.addEventListener('wheel', e => { e.preventDefault(); views.filter(Boolean).forEach(v => v.zoom = Math.max(.45, Math.min(2.2, v.zoom + e.deltaY * .0008))); }, {passive: false});
async function loadRecording() { try { let r = await fetch('/api/recording'); if (!r.ok) r = await fetch('./recording.json'); if (r.ok) setRecording(await r.json()); } catch {} }
async function poll() {
  try {
    const r = await fetch('/api/state'); if (!r.ok) throw new Error('Static replay'); const data = await r.json(), s = data.health?.scheduling?.system2;
    $('backend').textContent = data.health ? `Live brain: ${data.health.system1.backend} + ${data.health.memory.backend} + ${data.health.system2.model ?? 'loading'}` : 'Local brain disconnected · recorded replay remains available';
    $('queue').textContent = s ? `Gemma active ${s.active}/${s.concurrency} · queued ${s.queued} · peak ${s.peakActive}` : 'Scheduling: unavailable';
    $('gpu').textContent = data.gpu ? `GPU ${data.gpu.used} / ${data.gpu.total} MiB · ${data.gpu.utilization}%` : 'GPU telemetry unavailable';
    $('run').disabled = !!data.job?.running;
    ['play', 'fire', 'axis', 'timeline'].forEach(id => { $(id).disabled = !!data.job?.running; });
    if (data.job?.running) {
      lastLive = true; const f = data.job.latest;
      if (liveId !== data.job.started) {
        for (const v of views.filter(Boolean)) v.scene.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
        views = []; recording = {runs: []}; liveId = data.job.started; liveMode = null;
        $('label-left').textContent = 'Baseline starting'; $('label-right').textContent = 'Adaptive run follows';
        $('baseline-metrics').textContent = 'Waiting for the first measured frame'; $('runtime-metrics').textContent = 'Runs after the baseline';
        $('run-summary').textContent = 'A new real-model comparison is running. Its outcomes are not known yet.';
      }
      if (liveMode !== data.job.mode) { if (data.job.completed.length) await loadRecording(); liveMode = data.job.mode; }
      if (f && data.job.world && renderer) {
        const slot = data.job.mode === 'runtime' ? 1 : 0;
        if (!views[slot]?.live) { const run = {mode: data.job.mode, world: data.job.world, frames: [f], wall_ms: f.wall_ms}; views[slot] = makeView(run, slot); views[slot].live = true; }
        views[slot].run.frames = [f]; views[slot].run.wall_ms = f.wall_ms; recording.runs = views.filter(Boolean).map(v => v.run);
        playing = false; axis = 'story'; $('axis').value = axis; cursor = f.hour; $('empty').style.display = 'none';
      }
      $('provenance').textContent = data.job.mode === 'baseline' ? 'LIVE baseline · adaptive run follows' : 'Baseline recorded · LIVE adaptive run';
      $('live-note').textContent = `LIVE ${data.job.mode}: ${f ? hourText(f.hour) + ' · ' + f.stats.decisions + ' decisions · ' + f.stats.gemma_requests + ' Gemma requests' : 'starting'}. The comparison can take several minutes.`;
    }
    else if (lastLive) { lastLive = false; if (data.job.error) { $('live-note').textContent = 'Run stopped: ' + data.job.error; await loadRecording(); $('provenance').textContent = 'Run stopped · partial real recording'; }
      else { $('live-note').textContent = 'The real-model comparison is complete. Replay the recorded day above.'; await loadRecording(); } }
    else if (recordingVersion != null && recordingVersion !== data.recording_version) await loadRecording();
    recordingVersion = data.recording_version;
  } catch { document.querySelector('.console').style.display = 'none'; } // static hosting: recorded replay only, no local controls to offer
}
$('run').onclick = async () => { $('run').disabled = true; try { const r = await fetch('/api/run', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({seed: +$('seed').value, fireHour: 12})}); const j = await r.json(); if (!r.ok) throw new Error(j.error); $('live-note').textContent = 'Starting real models. Baseline and adaptive runs use the GPU sequentially.'; await poll(); } catch (e) { $('live-note').textContent = e.message; $('run').disabled = false; } };
try {
  reference = await (await fetch('./reference.json')).json();
  const y = q => (q - .9) / .2 * 100, kind = n => /julia/i.test(n) ? 'julia' : /regret/i.test(n) ? 'regret' : 'gemma';
  $('chart').innerHTML = '<div class="zone"><span>BETTER AND CHEAPER</span></div>' + [.95, 1, 1.05, 1.1].map(q => `<div class="grid${q === 1 ? ' ref' : ''}" style="bottom:${y(q)}%"><span>${Math.round(q * 100)}%</span></div>`).join('')
    + reference.policies.map(p => { const k = kind(p.name), x = p.calls / p.n * 100, side = x > 60 ? 'left' : 'right';
      return `<span class="pt ${k}" style="left:${x}%;bottom:${y(p.quality_relative_to_gemma)}%"></span><div class="pt-label ${k} ${side}" style="left:${x}%;bottom:${y(p.quality_relative_to_gemma)}%"><b>${(p.quality_relative_to_gemma * 100).toFixed(k === 'regret' ? 2 : 1)}%</b>${esc(p.name)} <small>· ${p.calls} calls</small></div>`; }).join('');
  const best = reference.policies.find(p => /regret/i.test(p.name));
  if (best) { $('stat-quality').textContent = `${(best.quality_relative_to_gemma * 100).toFixed(2)}%`; $('stat-calls').textContent = `${best.calls} / ${best.n}`; }
  const e = reference.example, top = Math.max(e.julia.reward, e.gemma.reward, 1e-9), win = e.julia.reward >= e.gemma.reward ? 'julia' : 'gemma';
  const choice = (who, c, note) => `<div class="choice${win === who ? ' win' : ''}"><div class="who">${who === 'julia' ? 'JULIA-1 · HABIT' : 'GEMMA · DELIBERATION'}</div><div class="act">“${esc(c.action)}”</div><div class="reward"><i style="--w:${Math.max(2, c.reward / top * 100)}%"></i>${c.reward.toFixed(3)} reward</div><p>${note}</p></div>`;
  $('example').innerHTML = `<blockquote><b>${esc(e.who)} · ${esc(e.key)}</b>${esc(e.situation)}</blockquote>${choice('julia', e.julia, 'The router kept this choice.')}${choice('gemma', e.gemma, esc(e.gemma.reason))}`;
  $('score-rows').innerHTML = reference.scorecard.map(r => `<div class="score-row"><b>${esc(r.idea)}</b><span class="verdict ${/Pursue/.test(r.result) ? 'pursue' : /Keep/.test(r.result) ? 'keep' : /Reject/.test(r.result) ? 'reject' : ''}">${esc(r.result)}</span><p>${esc(r.detail)}</p></div>`).join('');
} catch (e) { $('chart').textContent = 'Run npm run demo:pack to load the recorded evidence.'; }
let capacity = null;
const capRun = (n, mode) => capacity.runs.find(r => r.people === n && r.mode === mode);
// Story hour a run had reached after `sec` wall seconds, read from its measured progress; never past where it really got.
const hourAt = (run, sec) => { const p = run.progress; if (!p?.length) return 6; if (sec >= p.at(-1)[1] || sec >= capacity.budget_ms / 1000) return run.completed ? 22 : run.story_hour_reached;
  let i = 0; while (i + 1 < p.length && p[i + 1][1] <= sec) i++; const [h0, w0] = p[i], [h1, w1] = p[i + 1]; return w1 > w0 ? h0 + (h1 - h0) * (sec - w0) / (w1 - w0) : h0; };
const finished = (run, sec) => run && run.completed && run.wall_ms / 1000 <= sec;
const policyName = mode => mode === 'baseline' ? 'Ask every time' : 'Learned regret';
function renderCapacity() {
  const sec = +$('budget').value, sizes = [...new Set(capacity.runs.map(r => r.people))].sort((a, b) => a - b); $('budget-label').textContent = fmtDur(sec);
  const most = mode => Math.max(0, ...sizes.filter(n => finished(capRun(n, mode), sec))), base = most('baseline'), adapt = most('runtime');
  const big = sizes.at(-1), bb = capRun(big, 'baseline'), ba = capRun(big, 'runtime');
  const tail = bb && ba && !finished(bb, sec) && finished(ba, sec) ? ` At ${big} villagers, the ask-every-time village stops at <b class="base">${hourText(hourAt(bb, sec))}</b>; the adaptive one lives to 22:00.` : '';
  $('cap-headline').innerHTML = `With ${fmtDur(sec)} of GPU per story day, asking Gemma every time carries <b class="base">${base ? base + ' villagers' : 'no village'}</b> through the whole day. Learned regret carries <b>${adapt ? adapt + ' villagers' : 'none'}</b>.${tail}`;
  const bar = (run, mode) => { const cls = mode === 'baseline' ? 'base' : 'adapt';
    if (!run) return `<div class="bar-row ${cls}"><span class="who">${policyName(mode)}</span><span class="track"></span><span class="end missing">not measured yet</span></div>`;
    const h = hourAt(run, sec), done = finished(run, sec);
    return `<div class="bar-row ${cls}"><span class="who">${policyName(mode)}</span><span class="track"><span class="fill" style="width:${(h - 6) / 16 * 100}%"></span></span><span class="end ${done ? '' : 'cut'}">${done ? 'full day · ' + fmtDur(run.wall_ms / 1000) : 'stopped at ' + hourText(h)}</span></div>`; };
  const showing = recording.budget_ms ? recording.runs[0]?.world.cast.length : null;
  $('lanes').innerHTML = sizes.map(n => `<button class="lane${n === showing ? ' active' : ''}" data-size="${n}"><span class="lane-name">${n}<small>villagers · watch ↑</small></span><span class="lane-bars">${bar(capRun(n, 'baseline'), 'baseline')}${bar(capRun(n, 'runtime'), 'runtime')}</span></button>`).join('');
  $('lanes').querySelectorAll('.lane').forEach(b => b.onclick = async () => { await loadSize(+b.dataset.size); $('village').scrollIntoView({behavior: 'smooth'}); });
}
async function loadSize(n) {
  try { const r = await fetch(`./capacity/${n}.json`); if (!r.ok) return false; setRecording(await r.json()); } catch { return false; }
  selected = null; $('sizes').querySelectorAll('button').forEach(b => b.classList.toggle('active', +b.dataset.size === n)); if (capacity) renderCapacity(); return true;
}
async function loadCapacity() {
  try { const r = await fetch('./capacity/summary.json'); if (!r.ok) return null; capacity = await r.json(); } catch { return null; }
  if (!capacity.runs?.length) return null;
  const sizes = [...new Set(capacity.runs.map(r => r.people))].sort((a, b) => a - b), cap = capacity.budget_ms / 1000;
  $('budget').max = cap; $('budget').value = cap; $('budget').oninput = renderCapacity;
  $('sizes').innerHTML = '<span>Villagers</span>' + sizes.map(n => `<button data-size="${n}">${n}</button>`).join(''); $('sizes').hidden = false;
  $('sizes').querySelectorAll('button').forEach(b => b.onclick = () => loadSize(+b.dataset.size));
  const fmt = (v, d) => v == null || !Number.isFinite(+v) ? '—' : (+v).toFixed(d);
  $('cap-table').innerHTML = `<thead><tr><th>Villagers</th><th>Policy</th><th>Day reached</th><th>Wall time</th><th>Choices</th><th>Gemma requests</th><th>Mean native reward</th><th>Hungry at 22:00</th><th>Peak GPU memory</th></tr></thead><tbody>${
    sizes.flatMap(n => ['baseline', 'runtime'].map(m => capRun(n, m)).filter(Boolean).map((r, i) => `<tr class="${i ? '' : 'group'}"><td>${i ? '' : n}</td><td class="${r.mode === 'baseline' ? 'pol-base' : 'pol-adapt'}">${policyName(r.mode)}</td>
      <td>${r.completed ? '22:00 · full day' : hourText(r.story_hour_reached) + ' · budget spent'}</td><td>${fmtDur(r.wall_ms / 1000)}</td><td>${r.summary.decisions}</td><td>${r.summary.gemma_requests}</td>
      <td>${fmt(r.summary.mean_native_reward, 3)}${r.completed ? '' : '*'}</td><td>${r.completed ? r.summary.hungry_people + ' / ' + n : '—'}</td><td>${r.gpu ? `${r.gpu.peak_used_mib.toLocaleString()} / ${r.gpu.total_mib.toLocaleString()} MiB` : '—'}</td></tr>`)).join('')}</tbody>`;
  $('cap-note').textContent = `${capacity.adapter}, seed ${capacity.seed}, one run per cell, run one at a time. ${capacity.scope} * A stopped run's reward covers only the hours it reached. Compare policies within a size, not reward across sizes.`;
  const failed = (capacity.failures ?? []).filter(f => f.mode === 'baseline' && f.baseline_in_flight == null), limit = capacity.baseline_in_flight;
  if (failed.length) { const first = Math.min(...failed.map(f => f.people)), loose = sizes.filter(n => n < first);
    $('cap-failure').innerHTML = `<b>Unbounded, asking every time did not run at all at ${first} villagers.</b> At the ${hourText(failed[0].story_hour ?? 6)} wake-up the client sent more Gemma requests at once than the brain admits (4 running, 16 waiting), and the brain refused them: “${esc(failed[0].error)}”.${limit ? ` The bars above give that policy a client queue: at most ${limit} requests in flight, the most the brain admits. At ${loose.join(' and ')} villagers that limit never binds, so those runs are the same with or without it.` : ''}`;
    $('cap-failure').hidden = false; }
  // Capacity is not quality: say plainly, per size, whose full day earned more.
  const both = sizes.map(n => [n, capRun(n, 'baseline'), capRun(n, 'runtime')]).filter(([, b, a]) => b?.completed && a?.completed);
  const higher = both.filter(([, b, a]) => a.summary.mean_native_reward > b.summary.mean_native_reward).map(([n]) => n), lower = both.filter(([, b, a]) => a.summary.mean_native_reward < b.summary.mean_native_reward).map(([n]) => n);
  const list = ns => ns.length > 1 ? ns.slice(0, -1).join(', ') + ' and ' + ns.at(-1) : String(ns[0]);
  if (both.length) { $('cap-quality').innerHTML = `<b>More lives is not the same as better lives.</b> Where both policies finished the day, learned regret's mean native reward was ${[higher.length ? `higher at ${list(higher)} villagers` : '', lower.length ? `lower at ${list(lower)}` : ''].filter(Boolean).join(' and ')}${both.length - higher.length - lower.length ? '; equal elsewhere' : ''}. ${(() => { const odd = sizes.filter(n => { const b = capRun(n, 'baseline'), a = capRun(n, 'runtime'); return b && a && !b.completed && a.completed && a.summary.mean_native_reward < b.summary.mean_native_reward; });
      return odd.length ? ` At ${list(odd)} villagers, the stopped ask-every-time village's partial day scored higher than learned regret's full day; a morning and a fire are not a whole day, so that is not like for like, but it is what was measured.` : ''; })()} One seed per size; the table has the numbers.`; $('cap-quality').hidden = false; }
  $('capacity').hidden = false; renderCapacity(); return sizes;
}
const sizes = await loadCapacity();
if (!(sizes && await loadSize(sizes[0]))) await loadRecording();
await poll(); setInterval(poll, 2000);
