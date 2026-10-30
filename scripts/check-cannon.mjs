import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';

// Walk to the cannon, man it, play Paper Siege in place, and walk away again, on a desktop and a phone viewport.
// Serve dist first (node serve.mjs 4175). Writes screenshots, frame timings and checks to artifacts/cannon/.
const base=new URL(process.env.BASE_URL||'http://127.0.0.1:4175');
const output=resolve(process.env.CANNON_TEST_OUTPUT||'artifacts/cannon');
const timeout=180000;
await mkdir(output,{recursive:true});
const report={startedAt:new Date().toISOString(),base:base.href,runs:[]};
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||undefined,headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const devices={
  desktop:{viewport:{width:1280,height:800},deviceScaleFactor:1},
  phone:{viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true},
};
const url=()=>{const u=new URL(base);u.search=new URLSearchParams({debug:'',...(process.env.GPU_BACKEND?{gpu:process.env.GPU_BACKEND}:{})}).toString();return u.href};
const frames=(page,ms)=>page.evaluate(ms=>new Promise(done=>{const t=[];let last=performance.now();const end=last+ms;
  (function f(now){t.push(now-last);last=now;if(now<end)requestAnimationFrame(f);else{t.sort((a,b)=>a-b);done({fps:+(1000*t.length/ms).toFixed(1),median:+t[t.length>>1].toFixed(1),p95:+t[Math.floor(t.length*.95)].toFixed(1)})}})(last)}),ms);
const siege=page=>page.evaluate(()=>{const d=window.__pw.play.siege.debug;return d&&{state:d.state,level:d.level,knights:d.knightsLeft,ammo:d.ammo,score:d.score}});
const box=(page,sel)=>page.locator(sel).first().boundingBox();
const within=(b,vp)=>b&&b.x>=0&&b.y>=0&&b.x+b.width<=vp.width+.5&&b.y+b.height<=vp.height+.5;
const overlap=(a,b)=>a&&b&&a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;

for(const [name,device] of Object.entries(devices)){
  const run={device:name,checks:[],errors:[],perf:{}};report.runs.push(run);
  const context=await browser.newContext(device);await context.addInitScript(()=>{localStorage.setItem('pw-intro','1');localStorage.removeItem('pw-siege')});
  const page=await context.newPage();page.setDefaultTimeout(timeout);
  page.on('pageerror',e=>run.errors.push(String(e.stack||e)));
  page.on('console',m=>{if(m.type()==='error'&&!/favicon|vercel|insights|analytics/i.test(m.text()))run.errors.push(m.text())});
  const shot=async n=>{await page.screenshot({path:resolve(output,`${name}-${n}.png`)})};
  const tap=async sel=>{if(device.hasTouch)await page.locator(sel).first().tap();else await page.locator(sel).first().click()};
  try{
    await page.goto(url(),{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__pw?.play&&typeof window.__pw.generate==='function');
    await page.evaluate(async()=>{const p=window.__pw;await p.generate('valley',7151);p.grow();await p.finishGrowth();p.setSkyPreset('12');p.settleEnvironment()});
    await page.waitForFunction(()=>{const p=window.__pw;return p.W&&p.play?.debug.ready&&p.splats?.ready&&!p.splats.pending});
    run.backend=await page.evaluate(()=>window.__pw.renderer.backend.isWebGPUBackend?'webgpu':'webgl2');
    await page.evaluate(()=>window.__pw.enterWalk());await page.waitForFunction(()=>window.__pw.mode==='walk');
    run.perf.walk=await frames(page,3000);
    // far from the cannon: no prompt
    assert.equal(await page.locator('.pw-cannon').isVisible(),false);
    await page.evaluate(()=>{const p=window.__pw,c=p.W.activitySite.cannon,k=p.W.activitySite.castle,l=Math.hypot(k.x-c.x,k.z-c.z);p.teleport(c.x-(k.x-c.x)/l*.55,c.z-(k.z-c.z)/l*.55)});
    await page.locator('.pw-cannon').waitFor({state:'visible'});await page.waitForTimeout(600);await shot('01-walk-near-cannon');
    const vp=device.viewport,prompt=await box(page,'.pw-cannon'),throwB=await box(page,'[data-action="throw"]');
    assert(within(prompt,vp),'cannon prompt fits on screen');assert(!overlap(prompt,throwB),'cannon prompt clear of Throw bomb');
    assert(prompt.height>=44,'cannon prompt is a comfortable touch target');
    run.checks.push({check:'prompt appears beside the cannon',prompt,throwB});
    await tap('.pw-cannon');
    await page.waitForFunction(()=>window.__pw.mode==='siege'&&window.__pw.play.siege.debug?.state==='intro');
    await page.waitForTimeout(1200);await shot('02-intro');
    await page.waitForFunction(()=>window.__pw.play.siege.debug.state==='aim');await page.waitForTimeout(700);await shot('03-aim');
    const hud={};for(const [k,s] of Object.entries({fire:'.sg-fire',exit:'.sg-exit',chips:'.sg-ammo',stats:'.sg-stat'}))hud[k]=await box(page,s);
    for(const [k,b] of Object.entries(hud))assert(within(b,vp),`${k} fits on screen`);
    assert(!overlap(hud.fire,hud.chips)&&!overlap(hud.exit,hud.stats)&&!overlap(hud.fire,hud.exit),'HUD controls do not overlap');
    assert.equal(await page.locator('.pw-landscape-tools').isVisible(),false,'walk tools hide while playing');
    run.checks.push({check:'siege HUD fits and is clear',hud});
    run.perf.aim=await frames(page,3000);
    // a real press on FIRE (touch tap or mouse click) fires the default shot
    const before=await siege(page);await tap('.sg-fire');
    await page.waitForFunction(()=>window.__pw.play.siege.debug.state!=='aim');
    run.checks.push({check:'FIRE button shoots',before,after:await siege(page)});
    await page.waitForFunction(()=>window.__pw.play.siege.debug.state==='aim'||window.__pw.play.siege.debug.state==='won'||window.__pw.play.siege.debug.state==='lost',null,{timeout:30000});
    // aimed ink bomb at the castle: record the flight and blast
    const solved=await page.evaluate(()=>{const d=window.__pw.play.siege.debug;return d.aimHit(.55)});
    await page.evaluate(({yo,pd})=>window.__pw.play.siege.debug.fire(yo,pd,.55,'bomb'),solved);
    const blastPerf=frames(page,2500);await page.waitForTimeout(900);await shot('04-flight');
    await page.waitForTimeout(700);await shot('05-blast');run.perf.blast=await blastPerf;
    await page.waitForFunction(()=>['aim','won','lost'].includes(window.__pw.play.siege.debug.state),null,{timeout:30000});
    for(let i=0;i<12;i++){const s=await siege(page);if(s.state!=='aim')break;const t=s.ammo.bomb?'bomb':s.ammo.stone?'stone':'scatter';
      const a=await page.evaluate(()=>window.__pw.play.siege.debug.aimHit(.55));await page.evaluate(([a,t])=>window.__pw.play.siege.debug.fire(a.yo,a.pd,.55,t),[a,t]);
      await page.waitForFunction(()=>['aim','won','lost'].includes(window.__pw.play.siege.debug.state),null,{timeout:30000})}
    const end=await siege(page);run.checks.push({check:'level played to a result',end});
    if(end.state==='won'||end.state==='lost'){await page.waitForTimeout(1600);await shot('06-result');const card=await box(page,'.sg-card');assert(within(card,vp),'result card fits')}
    const terrainEdits=await page.evaluate(()=>window.__pw.W.impacts.length);run.checks.push({check:'cannon shots change the landscape',terrainEdits});
    // leave: Back to walk returns the camera and controls to the wanderer
    await tap('.sg-exit');await page.waitForFunction(()=>window.__pw.mode==='walk',null,{timeout:15000});
    await page.waitForTimeout(500);await shot('07-back-to-walk');
    assert.equal(await page.locator('.sg').first().isVisible(),false,'siege HUD hidden after leaving');
    assert.equal(await page.locator('.pw-landscape-tools').isVisible(),true,'walk tools back');
    const after=await page.evaluate(()=>({ready:window.__pw.play.debug.ready,state:window.__pw.play.siege.debug?.state,level:window.__pw.play.siege.debug?.level}));
    assert.equal(after.state,'free-roam');run.checks.push({check:'back to walking, castle stays',after});
    // man it again: the next castle to beat comes up
    await page.evaluate(()=>window.__pw.play.enterCannon());await page.waitForFunction(()=>window.__pw.mode==='siege');
    run.checks.push({check:'re-enter',level:(await siege(page)).level});
    await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__pw.mode==='walk',null,{timeout:15000});
    run.ok=run.errors.length===0;
  }catch(e){run.ok=false;run.failure=String(e.stack||e);await shot('zz-failure').catch(()=>{})}
  await context.close();
}
await browser.close();
report.finishedAt=new Date().toISOString();
await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
for(const r of report.runs)console.log(r.device,r.ok?'OK':'FAILED',r.backend,JSON.stringify(r.perf),r.failure?'\n'+r.failure:'',r.errors.length?'\nerrors: '+r.errors.slice(0,5).join('\n'):'');
process.exit(report.runs.every(r=>r.ok)?0:1);
