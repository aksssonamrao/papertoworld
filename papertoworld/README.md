# PaperToWorld

**Draw it, grow it, walk in it.**
Paint a landscape with watercolour inks on a sheet of paper. It soaks in, rises into a living 3D miniature world, and then you walk into it.

Everything runs in the browser: one HTML file plus three.js. There is no build step, no server and no API key.

## Deploy to Vercel (about 2 minutes)

**Option A: drag and drop**
1. Unzip this folder.
2. Go to https://vercel.com/new and choose **Deploy** without a Git repository. You can also drag the folder onto the Vercel dashboard.
3. Framework preset: **Other**. Leave Build Command and Output Directory empty.
4. Deploy. Your site is live at `https://<project>.vercel.app`.

**Option B: command line**
```bash
npm i -g vercel
cd papertoworld
vercel          # first time: answer the prompts, pick "Other"
vercel --prod   # publish to your production URL
```

**Option C: GitHub**
Push this folder to a repo and import it at vercel.com/new. Every push then redeploys.

### After deploying
- **Social previews:** open `index.html` and change `og-image.png` in the two `og:image` / `twitter:image` tags to the full URL, for example `https://papertoworld.vercel.app/og-image.png`. Some platforms (X, LinkedIn) need an absolute URL to show the preview card.
- **Custom domain:** Vercel dashboard → Project → Settings → Domains.

## What's in the folder

| File | What it is |
|---|---|
| `index.html` | The whole app: UI, 3D world, sound engine, everything |
| `vendor/three.r186.min.js` | three.js r186 with GLTFLoader and SkeletonUtils, bundled into one minified script (MIT licence, see `THREE-LICENSE.txt`). The version is in the file name, so the year-long cache in `vercel.json` never serves a stale copy |
| `models/` | The skinned wanderer and its animation clips (Quaternius, CC0), a rigged deer (Quaternius, CC0) and a rigged fox (Khronos sample; model CC0, animation CC BY 4.0). See `models/CREDITS.md`. If they can't load, for example when opened from `file://`, the jointed wanderer walks instead |
| `og-image.png` | The preview picture when the link is shared |
| `vercel.json` | Clean URLs, long caching for the library, basic security headers |

## Features that work anywhere

Painting with 9 inks and 4 stamps; **Surprise me**, which paints one of eight themed landscapes (River valley, Archipelago, Mountain lake, Desert oasis, Seaside, Farmland, Enchanted forest, Snowy peaks), each randomised, turned and mirrored, or lets you pick a theme from the ▾ menu (some themes also bring their own season or light); growing the world; wildlife; light presets (Lamp, Dawn, Noon, Dusk, Night) with day passing on its own; rain; all four seasons; walking, swimming and fishing; tap-to-go route-finding and the map; the field journal; your wanderer's look; music; photos (postcards) and video recording, which download straight to the device.

**Saved worlds** are kept in the visitor's own browser when the site runs on Vercel.

**Share links:** in the overview, the share button packs the whole world (drawing, stamps, season, Regrow version, name) into a link of about 3 KB. Whoever opens it watches the same world grow. Nothing is stored on a server, because the world lives inside the link. On phones it opens the share sheet, and on desktop it copies the link.

## Features that only work inside Claude

When PaperToWorld runs as a Claude artifact, two extra features are switched on: the **shared Worlds gallery** (everyone in an organization sees each other's saved worlds) and **walking together** (live wanderers, names, waving).

These use Claude's hosting runtime, so on Vercel they switch off cleanly. Worlds falls back to saving in the browser, and the wave button still works on its own. To bring them to the public site you would add your own backend: for example Supabase, Firebase or Liveblocks for storage and live presence. The code calls them through a small interface (`collection().add / orderBy / limit / onSnapshot / doc().delete` and `join / presence / peers / emit / on`), so a replacement slots in.

## How it works (the short version)

1. **Your strokes become regions, not shapes.** Every brush stamp writes into a 96×96 grid per ink type. On Grow, the grid is blurred and thresholded. This fills gaps and smooths wobbles, so rough scribbles turn into clean forests, rivers and hills. You can't really "draw it wrong".
2. **The land is shaped from those regions.** Hills and mountains raise a heightfield: mountains use a ridged noise and get snow above a set height. Water dips below a translucent water surface. Paths flatten and get lanterns, and villages flatten and get houses.
3. **Things grow depending on what's around them.** Pines grow up on mountains and leafy trees grow near water. Sand next to water gets palms, while sand away from water gets cacti. Big meadows get rigged, animated deer (which graze, walk and gallop off when startled), foxes and rabbits, and big lakes get a paper boat. Bridges appear wherever a path crosses water.
4. **Same drawing, same world.** A seed comes from your drawing, so it grows the same way every time. **Regrow** changes the seed.
5. **Rendering.** Thousands of trees, grass tufts and flowers are drawn as instanced meshes, with a small shader that makes them sway in the wind. Glows, fireflies and chimney smoke use a custom point-sprite shader. Lighting blends between a desk-lamp look and a full sun/moon cycle. The water has wind-ripple normals, reflects the sky at grazing angles (Fresnel), catches a sun glint and shows a soft foam line at the shore.
6. **Sound is synthesised live, with no audio files.** It includes wind, water that gets louder near it, birdsong, crickets, rain, footsteps that change with the ground, and campfire crackle. Growing trees play notes from their left-to-right position, so every drawing plays its own little tune.
7. **Walking.** A skinned, motion-captured-style character (Quaternius CC0) with idle, walk, jog, sprint, swim and torch clips. A small shader dresses it in a jacket in your colour, trousers and boots, and the hat, scarf, pack, lantern and rod ride on its bones. The over-the-shoulder camera doesn't clip into hills, and route-finding (A*) walks you around trees, over bridges and along paths.

## Performance

- **Adaptive resolution.** When frames run long, the pixel ratio drops step by step (never below 0.6), and it climbs back when there is headroom.
- **No shader stalls.** Every material is compiled once while the blank paper sits idle, and fog and light counts stay constant. Grow, walking in and nightfall therefore never freeze while shaders compile.
- **Cheaper shadows.** The shadows use PCF with a wide radius. The shadow map refreshes every other frame, and low-poly stand-ins cast the tree shadows.

| URL option | Effect |
|---|---|
| `?debug` | Shows frame rate, resolution, draw calls, triangles and shader programs |
| `?pr=1.5` | Pins the pixel ratio and turns adaptive resolution off (useful for screenshots) |

## Browser support

Recent Chrome, Edge, Safari (iOS 15+) and Firefox. WebGL is required, and the page shows a friendly message if it's missing. Video recording uses MediaRecorder: Safari saves MP4, and Chrome and Firefox save WebM.
