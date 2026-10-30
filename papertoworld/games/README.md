# Writing a PaperToWorld game

A game is one classic script in this folder that registers itself with the host (`PWHost`, defined at the end of `index.html`), plus one line in `registry.js`:

```js
{id:'mygame', name:'My Game', icon:'🎯', blurb:'One line for the menu', src:'games/mygame.js'}
```

The Play button (overview mode, after Grow) lists `registry.js`. Picking an entry loads `src` once, then starts the game. The file must call `PWGames.register(...)` when it loads:

```js
PWGames.register({
  id:'mygame',
  async start(host){ /* build everything; own the camera */ },
  update(dt,et){ /* every frame while playing */ },
  stop(){ /* remove everything you added */ },
  pointerDown(e){}, pointerMove(e,dx,dy){}, pointerUp(e,tap){}, wheel(e){}, key(e,down){},   // all optional
});
```

`start`, `update` and `stop` are required. The other hooks are optional. `register` merges into the registry entry with the same `id` (so the menu name and blurb come from `registry.js`, and your object may add its own fields). Methods are called with `this` set to that merged entry, so you may keep state on it.

## Lifecycle

1. The user taps the entry. The host sets `mode='game'`, hides the viewbar and the other tools (only Sound, Sky and **Leave** remain), then awaits `start(host)`. `update` is not called until `start` has resolved.
2. Every frame while `mode==='game'`, after the world (sky, fauna, water, wind and sound keep running) and before render, the host calls `update(dt,et)`. `dt` is seconds (capped at 0.05), `et` is elapsed seconds.
3. The game owns the camera. While `host.tweening` is true a `host.flyTo(...)` tween drives it, so do not set the camera then. Otherwise set `camera.position` and call `camera.lookAt(...)` yourself each frame. The host derives the near plane from where the camera looks.
4. Leave (or `host.exit()`) calls `stop()`, empties `host.hud`, then flies the camera back to the overview and restores the normal UI. If a game throws in `update` or `start`, the host logs it and leaves for you.
5. `stop()` may be called while `start` is still running, and again after it: make it idempotent and safe on half-built state.

## Host API (`PWHost`)

| Member | |
|---|---|
| `THREE, scene, camera, renderer, canvas` | the app's objects |
| `C` | `{PW:16, HW:8, G:96, CELL, WATER_Y}`. The paper spans x,z in [-HW, HW] |
| `world, rise, season, night, mode` | live getters (`world` is null on blank paper, `rise` is 0 to 1 while growing) |
| `hAt(x,z)` | terrain height (already scaled by `rise`) |
| `waterAt(x,z)`, `typeAt(x,z)`, `hitObst(x,z,pad)` | water density (above .45 is water), ink type, tree/house/prop collision test |
| `isWater(x,z)`, `surfaceY(x,z)` | water above .45 and not winter (winter water is ice); `max(terrain, water surface)` |
| `heights()` | `{grid:Float32Array(n*n), n:G+1, size:PW}`. Scaled heights; `grid[iz*n+ix]` sits at `x=-HW+ix*CELL, z=-HW+iz*CELL`. Allocates a copy, so call it once |
| `wind()` | `{x,z}` vector, magnitude about 0.45 to 1.05 (more in rain and winter). The grass leans toward +x |
| `sunDir` | unit Vector3 toward the sun |
| `toast(t)`, `setHint(t,ms)` | messages |
| `audio` | `{ensure(), burst(kind,vol,pan), pluck(freq,pan,vol), ctx, out, muted}`. `burst` kinds: grass paper sand stone swim splash. `ctx` and `out` are null until `ensure()` has run (the Play click already did). Respect `muted` |
| `flyTo(pos,look,fov,dur,done)`, `tweening` | camera tween |
| `pointers` | the live Map of down pointers (`{x,y,x0,y0,t0}`), handy for pinch |
| `hud` | the `#gameHud` overlay div: empty, `pointer-events:none`, and `position:fixed; inset:0`. Children that need clicks or touches need `pointer-events:auto` (this is automatic for `button` elements and for anything with a `data-ui` attribute). Style it with the CSS vars `--panel --line --brass --ink --muted --onbrass --serif --sans` |
| `load(src)`, `loadModule(path)` | load a script once; dynamic `import()` relative to `index.html` (for example `loadModule('vendor/cannon-es.0.20.0.js')`) |
| `start(game)`, `exit()` | used by the menu and the Leave button |
| `sky` | `{hour, rain, set(hour,rain)}`: drive the time of day and the rain from a game clock. The light, season and weather the player had are put back on exit |
| `skyWalk` | set to `true` while your camera is close and low: the sky, fog, sun, moon and stars are drawn as in walk mode instead of the dark desk |
| `fauna` | the stock animals (`{kind, g}`; kinds deer fox rabbit fish fly bird boat). You may hide some (`g.visible=false`) while you run, and must show them again in `stop()` |
| `figure(look,{pack})` | a person in the wanderer's style (`look` as in the Your wanderer panel: `{jacket, scarf, hat}`; `pack:false` leaves the backpack off). Returns `{g, update(dt, speed, pose), lantern, dispose()}`; `pose` is `idle walk jog sit torch dance`, or `null` to choose by speed |
| `walker` | the player's own wanderer inside a game: `start(x,z)`, `stop()`, `step(dt,{f,s,run})` (camera-relative input), `cam(dt)` (the chase camera), `look(dx,dy)`, `zoom(k)`, `goTo(x,z)` (route-finding), `active`, `state` |
| `attach(key,json)`, `attached(key)`, `attachedFromLink` | small notes a game keeps with the current world (a few KB at most). The share link carries them; opening the link brings them back and sets `attachedFromLink` until a game attaches something new |
| `addObst(x,z,r)`, `removeObst(o)` | extra things the wanderer bumps into; all are removed on exit |

Input: `pointerDown/Move/Up` get mouse and touch already unified (`e.clientX/Y`, `e.pointerId`). `tap` is true for a short press that moved under 10 px. `wheel(e)` is already `preventDefault`-ed. `key(e,down)` gets every key while playing, so call `e.preventDefault()` yourself for Space and arrows if you use them.

## Rules

- **No new lights.** Changing the light count recompiles every shader and stalls the frame. Fake flashes with additive sprites or meshes.
- **Compile materials up front.** Create your materials in `start` and warm them (`await renderer.compileAsync(scene,camera)` or draw each once while hidden) so the first shot or effect never hitches.
- **Clean up in `stop()`.** Remove every object you added, dispose the geometries, materials and textures you made, clear timers and listeners, destroy physics worlds. The world must look exactly as before.
- Use instancing for many identical pieces. Cap particle counts and throttle sounds. Meshes may `castShadow` (the shadow map refreshes every other frame).
- Do not delete or move the painted world's content.
- Keep to the look: warm paper, card, brass and ink. No neon.
- Register debug-only games behind `?debug` (see `id:'spin'` in `index.html`, the plumbing test that orbits the camera).
