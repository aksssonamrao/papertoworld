import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';

// Functional GPU QA. Run separately from renderer performance measurements.
const base=new URL(process.env.BASE_URL||'http://127.0.0.1:4175');
const output=resolve(process.env.LANDSCAPE_TEST_OUTPUT||'artifacts/landscape-play');
const timeout=Number(process.env.LANDSCAPE_TEST_TIMEOUT||180000);
const backend=process.env.GPU_BACKEND||'webgpu-gl';
await mkdir(output,{recursive:true});
const report={startedAt:new Date().toISOString(),base:base.href,requestedBackend:backend,checks:[],screenshots:[],diagnostics:[]};
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||undefined,headless:true,args:[
  '--no-sandbox','--disable-dev-shm-usage','--disable-gpu-watchdog','--enable-unsafe-webgpu',
  ...(process.platform==='win32'?['--ignore-gpu-blocklist']:['--enable-unsafe-swiftshader','--use-angle=swiftshader']),
  ...JSON.parse(process.env.BROWSER_ARGS||'[]'),
]});
const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1});
await context.addInitScript(()=>{localStorage.setItem('pw-intro','1')});
function diagnostics(page,label){
  const result={label,errors:[],warnings:[],assets:[]};report.diagnostics.push(result);
  page.on('pageerror',e=>result.errors.push(String(e.stack||e)));
  page.on('console',m=>{const text=m.text();if(m.type()==='error'&&!/favicon|vercel|analytics|vitals/i.test(text))result.errors.push(text);if(m.type()==='warning')result.warnings.push(text)});
  page.on('response',r=>{if(r.status()>=400&&new URL(r.url()).origin===base.origin&&!/favicon/.test(r.url()))result.assets.push({url:r.url(),status:r.status()})});
  return result;
}
function url(code){const u=new URL(base);u.search=new URLSearchParams({debug:'',gpu:backend,quality:'low',pr:'1'}).toString();if(code)u.hash=`w=${code}`;return u.href}
async function boot(page,code){
  page.setDefaultTimeout(timeout);await page.goto(url(code),{waitUntil:'domcontentloaded',timeout});
  await page.waitForFunction(()=>window.__pw?.play&&typeof window.__pw.generate==='function',null,{timeout});
}
async function settled(page){
  await page.waitForFunction(()=>{const p=window.__pw;if(p?.splats?.error)throw Error(p.splats.error);return p?.W&&p.play?.debug.ready&&p.splats?.ready&&!p.splats.pending},null,{timeout});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function shot(page,name){const file=`${name}.png`;const bytes=await page.screenshot({path:resolve(output,file),timeout:30000});assert(bytes.length>5000);report.screenshots.push({file,bytes:bytes.length})}
async function canonical(page){return page.evaluate(()=>{const p=window.__pw;return{height:p.snapshot().height,destroyed:p.W.trees.filter(o=>o.destroyed).map(o=>[o.x,o.z]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]),impacts:p.W.impacts}})}
async function finish(page){await page.evaluate(()=>window.__pw.finishGrowth());await settled(page)}
try{
  let page=await context.newPage();diagnostics(page,'original');await boot(page);
  await page.evaluate(async()=>{const p=window.__pw;await p.generate('valley',7151);p.grow();await p.finishGrowth();p.setSkyPreset('12');p.settleEnvironment()});
  await settled(page);report.actualBackend=await page.evaluate(()=>window.__pw.renderer.backend.isWebGPUBackend?'webgpu':'webgpu-gl');assert.equal(report.actualBackend,backend);await shot(page,'01-world-before');
  const initial=await canonical(page);assert.equal(initial.impacts.length,0);assert.equal(initial.destroyed.length,0);
  await page.getByRole('button',{name:'Walk in',exact:true}).click();
  await page.waitForFunction(()=>window.__pw.mode==='walk');
  const collision=await page.evaluate(()=>{
    const p=window.__pw,body=p.play.siege.debug.g.castlePlatform;
    body.updateAABB();const edge=body.aabb.upperBound.x/10,z=body.position.z/10;
    const restore={x:p.heroS.x,z:p.heroS.z,yaw:p.heroS.camYaw};
    p.teleport(edge+.12,z);p.heroS.camYaw=Math.PI/2;
    return{edge,z,restore,blocked:p.hitObst(edge-.01,z,.02)};
  });
  assert.equal(collision.blocked,true);
  await page.keyboard.down('w');await page.waitForTimeout(900);await page.keyboard.up('w');
  const stopped=await page.evaluate(()=>({x:window.__pw.heroS.x,z:window.__pw.heroS.z,mode:window.__pw.mode}));
  assert(stopped.x>=collision.edge+.018,'Ordinary walking must stop at the castle plinth');assert.equal(stopped.mode,'walk');
  await page.evaluate(({x,z,yaw})=>{window.__pw.teleport(x,z);window.__pw.heroS.camYaw=yaw},collision.restore);
  report.checks.push({check:'ordinary walking collides with the in-world castle',edge:collision.edge,...stopped});
  assert.equal(await page.evaluate(()=>window.__pw.play.equipped),false);
  await page.getByRole('button',{name:'Throw paper bomb',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__pw.mode),'walk');
  await page.waitForFunction(()=>window.__pw.play.debug.stats.projectiles===0,null,{timeout:15000});
  const realThrow=await page.evaluate(()=>({mode:window.__pw.mode,...window.__pw.play.debug.stats}));
  assert.equal(realThrow.thrown,1);assert.ok(realThrow.impacts>=1,'The actual Throw button must produce a landscape impact');
  report.checks.push({check:'one visible Throw button works without B and preserves walking',...realThrow});
  await page.getByRole('button',{name:'Aim / distance',exact:true}).click();
  await page.mouse.click(640,440);
  const picked=await page.evaluate(()=>({selected:window.__pw.play.debug.aim.selected,thrown:window.__pw.play.debug.stats.thrown}));
  assert(picked.selected,'Clicking the landscape must choose a landing point');assert.equal(picked.thrown,1,'Selecting a target must not accidentally throw');
  const range=page.getByRole('slider',{name:'Throw distance'});await range.focus();await range.press('Home');for(let i=0;i<4;i++)await range.press('ArrowRight');
  await page.getByRole('button',{name:'Aim ahead',exact:true}).click();
  const aim=await page.evaluate(()=>window.__pw.play.debug.aim);assert.equal(aim.distance,1.5);assert(aim.visible&&aim.prediction.valid&&aim.prediction.impact);
  await page.evaluate(()=>document.activeElement?.blur());
  await page.keyboard.press('Space');await page.waitForFunction(()=>window.__pw.play.debug.stats.projectiles===0);
  const landed=await page.evaluate(()=>({last:window.__pw.W.impacts.at(-1),thrown:window.__pw.play.debug.stats.thrown,mode:window.__pw.mode}));
  assert.equal(landed.thrown,2);assert.equal(landed.mode,'walk');assert(Math.hypot(landed.last.x-aim.prediction.impact.x,landed.last.z-aim.prediction.impact.z)<.12,'Throw must land near the displayed blast ring');
  report.checks.push({check:'target selection, adjustable distance, preview accuracy and Space throw',prediction:aim.prediction.impact,...landed});
  await page.getByRole('button',{name:'Rain: off',exact:true}).click();await page.getByRole('button',{name:'Rain: on',exact:true}).waitFor();
  await page.getByRole('button',{name:'Rain: on',exact:true}).click();await page.getByRole('button',{name:'Rain: off',exact:true}).waitFor();
  report.checks.push({check:'visible one-tap rain toggle',passed:true});
  // A known vertex and tree keep damage checks independent of the throw's aim.
  const damage=await page.evaluate(()=>{
    const p=window.__pw,W=p.W,s=p.snapshot(),n=Math.round(Math.sqrt(s.height.length)),grid=n-1,cell=16/grid;
    const tree=[...W.trees].filter(o=>!o.destroyed&&Math.abs(o.x)<7&&Math.abs(o.z)<7).sort((a,b)=>b.y-a.y)[0];
    if(!tree)throw Error('Valley fixture has no intact tree');
    const index=Math.round((tree.z+8)/cell)*n+Math.round((tree.x+8)/cell);
    const hillIndex=s.height.reduce((best,h,i)=>h>s.height[best]?i:best,0);
    const hill={x:(hillIndex%n)*cell-8,z:Math.floor(hillIndex/n)*cell-8};
    const before={treeHeight:s.height[index],hillHeight:s.height[hillIndex],blocked:p.hitObst?.(tree.x,tree.z,.001)};
    const position=p.camera.position.toArray(),quaternion=p.camera.quaternion.toArray(),fov=p.camera.fov;
    W.nav={testSentinel:true};p.heroS.path=[[p.heroS.x,p.heroS.z],[tree.x,tree.z]];
    p.play.debug.forceImpact({x:tree.x,y:tree.y,z:tree.z});
    const treeChanged=!!tree.destroyed,navCleared=W.nav===null,pathCleared=p.heroS.path===null;
    p.play.debug.forceImpact({x:hill.x,y:s.height[hillIndex],z:hill.z});
    return{before,after:{treeHeight:p.snapshot().height[index],hillHeight:p.snapshot().height[hillIndex],blocked:p.hitObst?.(tree.x,tree.z,.001)},treeChanged,navCleared,pathCleared,
      mode:p.mode,cameraUnchanged:JSON.stringify(position)===JSON.stringify(p.camera.position.toArray())&&JSON.stringify(quaternion)===JSON.stringify(p.camera.quaternion.toArray())&&fov===p.camera.fov,
      impactCount:W.impacts.length,destroyed:W.trees.filter(o=>o.destroyed).length};
  });
  assert.equal(damage.mode,'walk');assert.equal(damage.cameraUnchanged,true);assert.equal(damage.treeChanged,true);
  assert.equal(damage.navCleared,true);assert.equal(damage.pathCleared,true);assert(damage.after.hillHeight<damage.before.hillHeight-.05);
  if(damage.before.blocked!==undefined){assert.equal(damage.before.blocked,true);assert.equal(damage.after.blocked,false)}
  report.checks.push({check:'crater, visible tree/collider removal, navigation cancellation and no cutscene',...damage});
  const castle=await page.evaluate(()=>{
    const p=window.__pw,s=p.play.siege;s.debug.settleNow();const info=s.debug.info(),before=s.debug.knightsLeft;
    const target=s.debug.bodies().find(b=>b.k==='knight'&&!b.dead);if(!target)throw Error('No castle target');
    const camera=p.camera.position.toArray();p.play.debug.forceImpact({x:target.p[0],y:target.p[1],z:target.p[2]});
    return{before,after:s.debug.knightsLeft,mode:p.mode,site:p.play.site,cameraUnchanged:JSON.stringify(camera)===JSON.stringify(p.camera.position.toArray()),castle:info.name};
  });
  assert(castle.after<castle.before,'Free-walk bombs must topple castle targets');assert.equal(castle.mode,'walk');assert.equal(castle.cameraUnchanged,true);
  report.checks.push({check:'same-flow castle destruction',...castle});
  await page.waitForFunction(()=>!window.__pw.splats.pending,null,{timeout});await shot(page,'02-world-after');
  const damaged=await canonical(page),code=await page.evaluate(()=>window.__pw.shareCode());
  await writeFile(resolve(output,'damaged-world-url.txt'),url(code));
  // Only one active WebGL/WebGPU page at a time, including share replay.
  await page.evaluate(()=>window.__pw.goPaper());
  const cleanup=await page.evaluate(()=>({mode:window.__pw.mode,ready:window.__pw.play.debug.ready,site:window.__pw.play.site,bombs:window.__pw.play.debug.stats,resources:window.__pw.resources}));
  assert.equal(cleanup.mode,'draw');assert.equal(cleanup.ready,false);assert.equal(cleanup.site,null);assert.equal(cleanup.bombs.projectiles,0);assert.equal(cleanup.bombs.debris,0);assert.equal(cleanup.resources.total,0);
  report.checks.push({check:'return to paper cleans activity and world resources',...cleanup});await page.close();
  page=await context.newPage();diagnostics(page,'shared replay');await boot(page,code);
  await page.waitForFunction(()=>window.__pw.W,null,{timeout});await finish(page);
  await page.waitForFunction(count=>window.__pw.W.impacts.length===count,damaged.impacts.length,{timeout});
  const replay=await canonical(page);assert.deepEqual(replay,damaged,'Shared world must replay identical terrain and destroyed trees');
  report.checks.push({check:'damaged share reproduces terrain/destruction',impacts:replay.impacts.length,destroyed:replay.destroyed.length});await shot(page,'03-shared-damaged-world');
  // Exercise the actual Regrow handler; it intentionally chooses a fresh variant.
  await page.getByRole('button',{name:'Regrow',exact:true}).click();await finish(page);
  const regrown=await canonical(page);assert.equal(regrown.impacts.length,0);assert.equal(regrown.destroyed.length,0);
  report.checks.push({check:'Regrow restores intact world',impacts:0,destroyed:0});await shot(page,'04-regrown-world');
  await page.evaluate(()=>window.__pw.goPaper());await page.close();
  for(const d of report.diagnostics){assert.deepEqual(d.errors,[],`${d.label}: console/page error`);assert.deepEqual(d.assets,[],`${d.label}: failed local asset`);assert(!d.warnings.some(w=>/validation error|GL_INVALID|shader.*error|WebGPU.*error|context.*lost/i.test(w)),`${d.label}: GPU validation warning`)}
  report.passed=true;console.log(JSON.stringify({passed:true,checks:report.checks.length,output},null,2));
}catch(error){report.passed=false;report.error=String(error.stack||error);throw error}
finally{report.completedAt=new Date().toISOString();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await context.close();await browser.close()}
