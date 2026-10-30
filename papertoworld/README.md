# PaperToWorld

**Draw it, grow it, walk in it.**
Paint a landscape with watercolour inks on a sheet of paper. It soaks in, rises into a living 3D miniature world, and then you walk into it.

The main renderer uses Three.js r186's `WebGPURenderer` and Spark Radix 0.0.1. Painted fields generate the world locally; a worker creates Gaussian vegetation and ground detail. The deployed app is static and needs no application server or API key.

## Develop and build

Use Node.js 22 or newer. Run these commands from the repository root (`paperwood-vercel`):

```bash
npm ci
npm run dev
```

The development server builds the app, watches source files and serves `http://localhost:3000`. Refresh after a rebuild. Choose another port with `node scripts/dev.mjs 4175`.

```bash
npm run build          # static output in dist/
npm run preview        # serve dist/ locally
npm test               # deterministic templates, budgets and resource ownership
npm run test:browser   # real browser checks on WebGPU and WebGL2
```

Browser checks use Playwright Chromium, or the browser selected through `BROWSER_PATH`. Configure `BASE_URL` when the preview uses another port. The harness saves screenshots, actual postcard/video downloads and a JSON report under `artifacts/renderer/`. Portrait checks exercise layout; they are not measurements on a physical phone.

## Deploy to the existing Vercel project

For a source deployment, use the repository root as Vercel's Root Directory, Build Command `npm run build` and Output Directory `dist`. The root `vercel.json` records the build and cache configuration. Confirm the existing project's Root Directory before switching its source deployment to this build.

A prebuilt preview avoids depending on that source-root setting:

```bash
npm run package:vercel  # .vercel/output/ in Vercel Build Output API format
npx vercel login
npx vercel link         # select the existing PaperToWorld project
npx vercel deploy --prebuilt
```

Review the returned preview before production promotion. The packaging script only replaces `.vercel/output`; it preserves project association and settings beside that directory. The classic app remains available at `/classic.html`.

## What's in the folder

| File | What it is |
|---|---|
| `index.html` | HTML, controls, accessibility and application entry |
| `src/app.js` | Existing drawing, world generation, navigation, wildlife, audio and sharing, integrated with the new renderer |
| `src/render/` | TSL water, billboards, clothing, wind, pigment surfaces and generated-resource ownership |
| `src/render/splats/` | Deterministic templates, density budgets, worker generation, Radix collection and shared animation/lighting |
| `classic.html` | Original app, including the existing local fly-export research hook |
| `vendor/` | Original Three.js bundle for the classic app, integrity-verified Radix bundles, licenses and provenance |
| `models/` | Wanderer, wildlife and animation clips; see `models/CREDITS.md` |
| `vercel.json` | Static-output headers; repository-root configuration also supplies build settings |

## Features that work anywhere

Painting with 9 inks and 4 stamps; **Surprise me**, which paints one of eight themed landscapes (River valley, Archipelago, Mountain lake, Desert oasis, Seaside, Farmland, Enchanted forest, Snowy peaks), each randomised, turned and mirrored, or lets you pick a theme from the ▾ menu (some themes also bring their own season or light); growing the world; wildlife; light presets (Lamp, Dawn, Noon, Dusk, Night) with day passing on its own; rain; all four seasons; walking, swimming and fishing; tap-to-go route-finding and the map; the field journal; your wanderer's look; music; photos (postcards) and video recording, which download straight to the device.

**World detail:** Auto adapts density with a cooldown; Light, Balanced and Rich select fixed tiers. Detail changes preserve world landmarks and routes. On browsers where initialization fails, the recovery screen links to the classic edition.

**Paper bombs and castles:** walk into the same landscape and tap **Throw bomb** to throw ahead immediately. **Aim / distance** opens a trajectory, blast-area ring and distance slider; click or tap a landing spot, then Throw. Dragging still controls the camera. B and Space remain optional shortcuts, and Escape hides aiming. A visible Rain button toggles weather. Bombs carve craters, clear vegetation and structures, and topple the Paper Siege card castle in its clearing. Walking, terrain queries, collisions and navigation use the changed world. There is no separate game screen or mode. Regrow starts an intact world.

**Saved worlds** are kept in the visitor's own browser when the site runs on Vercel. Saves and share links retain up to 64 landscape impacts, replayed deterministically when opened.

**Share links:** in the overview, the share button packs the whole world (drawing, stamps, season, Regrow version, name) into a link of about 3 KB. Whoever opens it watches the same world grow. Nothing is stored on a server, because the world lives inside the link. On phones it opens the share sheet, and on desktop it copies the link.

## Features that only work inside Claude

When PaperToWorld runs as a Claude artifact, two extra features are switched on: the **shared Worlds gallery** (everyone in an organization sees each other's saved worlds) and **walking together** (live wanderers, names, waving).

These use Claude's hosting runtime, so on Vercel they switch off cleanly. Worlds falls back to saving in the browser, and the wave button still works on its own. To bring them to the public site you would add your own backend: for example Supabase, Firebase or Liveblocks for storage and live presence. The code calls them through a small interface (`collection().add / orderBy / limit / onSnapshot / doc().delete` and `join / presence / peers / emit / on`), so a replacement slots in.

## How it works (the short version)

1. **Your strokes become regions, not shapes.** Every brush stamp writes into a 96×96 grid per ink type. On Grow, the grid is blurred and thresholded. This fills gaps and smooths wobbles, so rough scribbles turn into clean forests, rivers and hills. You can't really "draw it wrong".
2. **The land is shaped from those regions.** Hills and mountains raise a heightfield: mountains use a ridged noise and get snow above a set height. Water dips below a translucent water surface. Paths flatten and get lanterns, and villages flatten and get houses.
3. **Things grow depending on what's around them.** Pines grow up on mountains and leafy trees grow near water. Sand next to water gets palms, while sand away from water gets cacti. Big meadows get rigged, animated deer (which graze, walk and gallop off when startled), foxes and rabbits, and big lakes get a paper boat. Bridges appear wherever a path crosses water.
4. **Same drawing, same world.** A seed comes from your drawing, so it grows the same way every time. **Regrow** changes the seed.
5. **Rendering.** Vegetation and soft ground detail are generated as Gaussian splats in a worker and uploaded once. Growth, wind, seasonal response and lighting run in a shared shader graph. Terrain, trunks, structures, water and skinned characters use meshes with node materials. Instanced billboards handle soft particles on both backends. Water uses wave normals, Fresnel sky reflection, glints, shoreline foam and winter ice. Roofs have staggered tile seams; pigment variation follows the terrain and walls. Masked water writes surface depth before vegetation, so above-water foliage overlaps it correctly. Underwater splat layers are intentionally occluded by that surface.
6. **Sound is synthesised live, with no audio files.** It includes wind, water that gets louder near it, birdsong, crickets, rain, footsteps that change with the ground, and campfire crackle. Growing trees play notes from their left-to-right position, so every drawing plays its own little tune.
7. **Walking.** A skinned, motion-captured-style character (Quaternius CC0) with idle, walk, jog, sprint, swim and torch clips. A small shader dresses it in a jacket in your colour, trousers and boots, and the hat, scarf, pack, lantern and rod ride on its bones. The over-the-shoulder camera doesn't clip into hills, and route-finding (A*) walks you around trees, over bridges and along paths.

## Performance

- **Adaptive resolution.** When frames run long, the pixel ratio drops step by step (never below 0.6), and it climbs back when there is headroom.
- **Shader reuse.** Node materials share their graphs across backends; idle-time warm-up and asynchronous compilation prepare common geometry. Cold startup still needs measurement on target devices.
- **Shadows.** Low-poly stand-ins cast tree shadows and the sun shadow map refreshes every other frame. Splats use an art-directed normal-aware lighting approximation.
- **Density and memory budgets.** Generated tables are capped at 250k, 750k or 1.5M samples. Automatic detail uses frame-time feedback and a 30-second cooldown. It does not change the collision world.
- **Cleanup.** Replacing a world cancels its worker, retires Radix views and releases owned GPU resources while retaining shared templates and model prototypes.
- **View selection and sorting.** Conservative spatial regions remove offscreen vegetation before projection. Intel Gen9/Gen11 uses a cached worker sort; other WebGPU adapters retain Radix's GPU sort. Bomb damage rebuilds vegetation in a worker while retaining the previous table until replacement is ready. Sleeping castle bodies skip physics steps; projectiles and debris have fixed limits.

| URL option | Effect |
|---|---|
| `?debug` | Shows frame rate, resolution, draw calls, triangles and shader programs |
| `?quality=low`, `medium`, `high` | Pin the generated-detail tier |
| `?gpu=webgpu-gl` | Exercise the WebGL2 fallback explicitly |
| `?pr=1.5` | Pins the pixel ratio and turns adaptive resolution off (useful for screenshots) |
| `?optSort=cpu` or `gpu` | Override sort selection for comparison |
| `?optCulling=0` | Disable region selection for comparison |
| `?activities=0` | Omit the castle and bomb controls for renderer-only benchmarks |

The [renderer comparison](/demos/compare/) includes recorded results and one-at-a-time original/first-Radix/optimized views of matched worlds, with a rain toggle.

## Browser support and verification

Windows Chrome has been exercised on both actual WebGPU and WebGL2 backends. The suite covers all eight themes, mouse painting and stamps, regeneration, detail changes, seasons/weather, walking, share-link reconstruction, portrait resize, postcards, recording and world teardown. Physical mobile devices, Safari and Firefox still need separate validation before making broad support or performance claims.

See `../docs/renderer-validation.md` for the build and verification record. Video capture chooses an available MP4 or WebM format through MediaRecorder. Saved-world/share payloads remain version 1; newly painted fields and stamps are canonicalized to that format's precision before generation so links recreate the same landmarks.
