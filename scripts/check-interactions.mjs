import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';

// Every generated object is usable: climb a tree (down and jump), sit by the fire, rest in the tent, climb the
// lighthouse (lamp) and the windmill, light a lantern, sit on a rock and a bridge edge, enter a house (cutaway,
// stool, bed), talk to a villager and finish an errand, tap-to-use from afar, the cannon through the shared prompt,
// a bomb under a perched wanderer, villagers going home at night. Desktop and a phone viewport.
// Serve dist first (node serve.mjs 4175). Screenshots, timings and checks go to artifacts/interactions/.
const base=new URL(process.env.BASE_URL||'http://127.0.0.1:4175');
const output=resolve(process.env.INTERACT_TEST_OUTPUT||'artifacts/interactions');
await mkdir(output,{recursive:true});
const report={startedAt:new Date().toISOString(),base:base.href,runs:[]};
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||undefined,headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const devices={desktop:{viewport:{width:1280,height:800},deviceScaleFactor:1},phone:{viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true}};
const only=process.env.DEVICES?process.env.DEVICES.split(','):Object.keys(devices);
const frames=(page,ms)=>page.evaluate(ms=>new Promise(done=>{const t=[];let last=performance.now();const end=last+ms;
  (function f(now){t.push(now-last);last=now;if(now<end)requestAnimationFrame(f);else{t.sort((a,b)=>a-b);done({fps:+(1000*t.length/ms).toFixed(1),median:+t[t.length>>1].toFixed(1),p95:+t[Math.floor(t.length*.95)].toFixed(1)})}})(last)}),ms);

for(const name of only){const device=devices[name];
  const run={device:name,checks:[],errors:[],perf:{}};report.runs.push(run);
  const context=await browser.newContext(device);await context.addInitScript(()=>{localStorage.setItem('pw-intro','1');for(const k of Object.keys(localStorage))if(k.startsWith('pw-w-')||k==='pw-journal')localStorage.removeItem(k)});
  const page=await context.newPage();page.setDefaultTimeout(120000);
  page.on('pageerror',e=>run.errors.push(String(e.stack||e)));
  page.on('console',m=>{if(m.type()==='error'&&!/favicon|vercel|insights|analytics/i.test(m.text()))run.errors.push(m.text())});
  const shot=n=>page.screenshot({path:resolve(output,`${name}-${n}.png`)});
  const ev=(f,a)=>page.evaluate(f,a);
  const state=()=>ev(()=>{const p=window.__pw,I=p.interact;return{mode:p.mode,busy:I.busy,holding:I.holding,act:I.actions.name,y:+p.heroS.y.toFixed(3),ground:+p.hAt(p.heroS.x,p.heroS.z).toFixed(3),buttons:I.debug.buttons(),inHouse:!!I.debug.inHouse}});
  const waitFor=(f,a,t=30000)=>page.waitForFunction(f,a,{timeout:t});
  // stand somewhere free near a point, then use it the way a tap or E does (walks there if needed)
  const goUse=id=>ev(id=>{const p=window.__pw,I=p.interact,P=I.points.byId.get(id)||I.villagers.points().find(q=>q.id===id);
    for(let r=.25;r<1.2;r+=.05)for(let k=0;k<12;k++){const a=k/12*6.283,x=P.x+Math.cos(a)*r,z=P.z+Math.sin(a)*r;if(!p.hitObst(x,z,.05)&&p.W&&p.hAt(x,z)>.09&&!p.W.houses.some(h=>Math.hypot(h.x-x,h.z-z)<.36*h.s)){p.teleport(x,z);return I.debug.use(id)}}return I.debug.use(id)},id);
  const exitAndWait=async(i=0)=>{await ev(i=>window.__pw.interact.debug.press(i),i);await waitFor(()=>!window.__pw.interact.busy,null,40000)};
  const check=(k,o)=>run.checks.push({check:k,...o});
  try{
    await page.goto(new URL('/?debug&pr=1'+(process.env.GPU_BACKEND?'&gpu='+process.env.GPU_BACKEND:''),base).href,{waitUntil:'domcontentloaded'});
    await waitFor(()=>window.__pw?.interact&&typeof window.__pw.generate==='function');
    await ev(async()=>{const p=window.__pw;await p.generate('valley',7151);p.grow();await p.finishGrowth();p.setSkyPreset('12');p.settleEnvironment()});
    await waitFor(()=>window.__pw.play?.debug.ready&&window.__pw.splats?.ready&&!window.__pw.splats.pending);
    await ev(()=>window.__pw.enterWalk());await waitFor(()=>window.__pw.mode==='walk');
    await waitFor(()=>(window.__pw.interact.villagers?.list.length||0)>0,null,20000);
    const kinds=await ev(()=>{const c={};for(const x of window.__pw.interact.points.all)c[x.kind]=(c[x.kind]||0)+1;return c});
    for(const k of ['tree','campfire','tent','lighthouse','windmill','lantern','rock','bridge','house'])assert(kinds[k]>0,`world has ${k}`);
    check('every kind has interaction points',{kinds,villagers:await ev(()=>window.__pw.interact.villagers.list.length)});
    run.perf.walk=await frames(page,2500);

    // tree: climb, perch, climb down; then jump
    const tree=await ev(()=>{const I=window.__pw.interact,p=window.__pw;return I.points.all.filter(q=>q.kind==='tree'&&q.perch>.45&&q.obj.kind!==2).map(q=>{let free=0;for(let k=0;k<8;k++){const a=k/8*6.283;if(!p.hitObst(q.x+Math.cos(a)*.3,q.z+Math.sin(a)*.3,.05))free++}return[free,q.id]}).sort((a,b)=>b[0]-a[0])[0][1]});
    assert(await goUse(tree));await waitFor(()=>window.__pw.interact.holding&&window.__pw.interact.debug.buttons().length>0,null,40000);
    let st=await state();assert(st.y>st.ground+.3,'perched up the tree');assert.deepEqual(st.buttons,['Climb down','Jump down']);await page.waitForTimeout(500);await shot('01-tree-perch');
    run.perf.perch=await frames(page,1500);
    await exitAndWait(0);st=await state();assert(Math.abs(st.y-st.ground)<.05,'back on the ground');
    assert(await goUse(tree));await waitFor(()=>window.__pw.interact.holding&&window.__pw.interact.debug.buttons().length>0,null,40000);await exitAndWait(1);st=await state();assert(Math.abs(st.y-st.ground)<.06,'jumped down');
    check('tree: climb, perch, climb down, jump',{tree});

    // campfire seat + stoke
    assert(await goUse('prop:0'));await waitFor(()=>window.__pw.interact.holding&&window.__pw.interact.debug.buttons().length>0,null,40000);st=await state();assert.deepEqual(st.buttons,['Stand up','Stoke the fire']);
    await ev(()=>window.__pw.interact.debug.press(1));await page.waitForTimeout(600);await shot('02-campfire');await exitAndWait(0);check('campfire: sit, stoke, stand',{});

    // tent: rest until morning moves the clock and makes it home
    const tent=await ev(()=>window.__pw.interact.points.all.find(q=>q.kind==='tent').id);
    await ev(()=>window.__pw.setHour(15));assert(await goUse(tent));await waitFor(()=>window.__pw.interact.holding&&window.__pw.interact.debug.buttons().length>0,null,40000);
    st=await state();assert.equal(st.buttons[0],'Rest until morning');await ev(()=>window.__pw.interact.debug.press(0));
    await waitFor(()=>!window.__pw.interact.busy,null,20000);const home=await ev(()=>window.__pw.interact.homeSpot());assert(home,'tent became home');
    check('tent: rest until morning, home',{home});await ev(()=>window.__pw.setHour(12));

    // lighthouse: stairs, gallery, lamp, down
    const lh=await ev(()=>window.__pw.interact.points.all.find(q=>q.kind==='lighthouse').id);
    assert(await goUse(lh));await waitFor(()=>window.__pw.interact.holding&&window.__pw.interact.debug.buttons().length>0,null,60000);st=await state();assert(st.y>st.ground+1,'on the gallery');
    await ev(()=>window.__pw.interact.debug.press(1));assert.equal(await ev(()=>window.__pw.interact.debug.lampOn),true);await page.waitForTimeout(800);await shot('03-lighthouse-gallery');
    await exitAndWait(0);check('lighthouse: stairs, lamp, gallery, down',{y:st.y});

    // windmill ladder
    const wm=await ev(()=>window.__pw.interact.points.all.find(q=>q.kind==='windmill').id);
    assert(await goUse(wm));await waitFor(()=>window.__pw.interact.holding&&window.__pw.interact.debug.buttons().length>0,null,60000);st=await state();assert(st.y>st.ground+.45,'on the balcony');await page.waitForTimeout(500);await shot('04-windmill');
    await exitAndWait(0);check('windmill: ladder up and down',{y:st.y});

    // lantern toggle, rock seat, bridge seat
    const ln=await ev(()=>window.__pw.interact.points.all.find(q=>q.kind==='lantern'));const before=await ev(i=>window.__pw.interact.debug.lit[i],ln.index);
    await goUse(ln.id);await waitFor(([i,b])=>window.__pw.interact.debug.lit[i]!==b,[ln.index,before],20000);await waitFor(()=>!window.__pw.interact.busy,null,10000);check('lantern toggles',{was:before});
    for(const k of ['rock','bridge']){const id=await ev(k=>window.__pw.interact.points.all.find(q=>q.kind===k).id,k);assert(await goUse(id));await waitFor(()=>window.__pw.interact.holding&&window.__pw.interact.debug.buttons().length>0,null,40000);if(k==='bridge')await shot('05-bridge');await exitAndWait(0);check(k+': sit and stand',{id})}

    // house: walk in (cutaway), stool, bed, leave
    const house=await ev(()=>{const I=window.__pw.interact;const h=I.points.all.find(q=>q.kind==='house'&&!I.villagers.list.some(v=>v.house===q.obj&&v.state==='home'));return h&&h.id});
    if(house){assert(await goUse(house));await waitFor(()=>window.__pw.interact.debug.inHouse&&!window.__pw.interact.busy,null,40000);await page.waitForTimeout(700);await shot('06-house-cutaway');
      const hid=house.split(':')[1];for(const [k,btn] of [['stool','Stand up'],['bed','Get up']]){assert(await ev(id=>window.__pw.interact.debug.use(id),`house:${hid}:${k}`));await waitFor(()=>window.__pw.interact.holding&&window.__pw.interact.debug.buttons().length>0,null,20000);
        st=await state();const i=st.buttons.indexOf(btn);assert(i>=0,`${k} offers ${btn}`);if(k==='bed')await shot('07-bed');await exitAndWait(i)}
      assert(await ev(id=>window.__pw.interact.debug.use(id),`house:${hid}:leave`));await waitFor(()=>!window.__pw.interact.debug.inHouse&&!window.__pw.interact.busy,null,20000);check('house: enter, cutaway, stool, bed, leave',{house})}

    // villager: talk, errand, finish it
    await waitFor(()=>window.__pw.interact.villagers.list.some(v=>v.body.g.visible),null,30000);
    const vi=await ev(()=>window.__pw.interact.villagers.list.findIndex(v=>v.body.g.visible));
    await ev(i=>{const v=window.__pw.interact.villagers.list[i];window.__pw.teleport(v.x+.18,v.z);window.__pw.interact.debug.talk(i)},vi);await page.waitForTimeout(400);await shot('08-talk');
    const talkB=(await state()).buttons;
    if(talkB[0]==='Sure!'){await ev(()=>window.__pw.interact.debug.press(0));const e=await ev(()=>window.__pw.interact.debug.errand?.e.k);
      const evt={fish:'catch',treetop:'perch',lamp:'lamp',fireside:'fireside',mill:'mill'}[e];
      if(e==='lanterns'){const ids=await ev(()=>window.__pw.interact.debug.errand.ids);for(const i of ids){await goUse(`lantern:${i}`);await waitFor(i=>window.__pw.interact.debug.lit[i],i,20000)}}
      else await ev(k=>window.__pw.interact.debug.event(k),evt);
      assert.equal(await ev(()=>window.__pw.interact.debug.errand),null,'errand done');check('villager: talk, errand, thanks',{errand:e})}
    else{await ev(()=>window.__pw.interact.debug.press(0));check('villager: talk',{buttons:talkB})}

    // tap-to-use from afar: click the lighthouse from a few steps away
    const tapRes=await ev(()=>{const p=window.__pw,I=p.interact,L=I.points.all.find(q=>q.kind==='lighthouse');for(let r=.9;r<2;r+=.1)for(let k=0;k<16;k++){const a=k/16*6.283,x=L.x+Math.cos(a)*r,z=L.z+Math.sin(a)*r;if(!p.hitObst(x,z,.06)&&p.hAt(x,z)>.09){p.teleport(x,z);p.heroS.camYaw=Math.atan2(-(L.x-x),-(L.z-z));p.heroS.camPitch=.2;return{x,z}}}return null});
    if(tapRes){await page.waitForTimeout(1500);const scr=await ev(()=>{const p=window.__pw,L=p.interact.points.all.find(q=>q.kind==='lighthouse'),v=new p.camera.position.constructor(L.x,L.obj.y+.5,L.z).project(p.camera);return{x:(v.x+1)/2*innerWidth,y:(1-v.y)/2*innerHeight}});
      if(device.hasTouch)await page.touchscreen.tap(scr.x,scr.y);else await page.mouse.click(scr.x,scr.y);
      await waitFor(()=>window.__pw.interact.holding&&window.__pw.interact.debug.buttons().length>0,null,60000);check('tap the lighthouse from afar → walk + climb',{scr});await exitAndWait(0)}

    // shared prompt: the cannon
    await ev(()=>{const p=window.__pw,c=p.W.activitySite.cannon,k=p.W.activitySite.castle,l=Math.hypot(k.x-c.x,k.z-c.z);p.teleport(c.x-(k.x-c.x)/l*.55,c.z-(k.z-c.z)/l*.55)});
    await waitFor(()=>window.__pw.interact.debug.buttons()[0]==='Man the cannon',null,10000);
    if(device.hasTouch)await page.locator('.pw-act button.main').tap();else await page.keyboard.press('e');
    await waitFor(()=>window.__pw.mode==='siege',null,10000);await page.keyboard.press('Escape');await waitFor(()=>window.__pw.mode==='walk',null,15000);check('cannon via the shared prompt',{});

    // bomb under a perched wanderer
    assert(await goUse(tree));await waitFor(()=>window.__pw.interact.holding&&window.__pw.interact.debug.buttons().length>0,null,40000);
    await ev(id=>{const t=window.__pw.interact.points.byId.get(id);window.__pw.impact({x:t.x,z:t.z,radius:.4,power:1})},tree);
    await waitFor(()=>!window.__pw.interact.busy,null,15000);st=await state();assert(Math.abs(st.y-st.ground)<.06,'dropped safely');check('bomb under a perched wanderer drops them safely',{});

    // night: villagers head home
    await ev(()=>window.__pw.setHour(23));await page.waitForTimeout(device.hasTouch?40000:45000);
    const homeN=await ev(()=>{const L=window.__pw.interact.villagers.list;return{home:L.filter(v=>v.state==='home').length,n:L.length,walking:L.filter(v=>v.state==='walk').length}});
    assert(homeN.home+homeN.walking>=Math.ceil(homeN.n*.6),'villagers go home at night');check('villagers go home at night',homeN);await ev(()=>window.__pw.setHour(12));
    run.perf.villagers=await frames(page,2500);
    run.ok=run.errors.length===0;
  }catch(e){run.ok=false;run.failure=String(e.stack||e);await shot('zz-failure').catch(()=>{});run.state=await state().catch(()=>null)}
  await context.close();
}
await browser.close();report.finishedAt=new Date().toISOString();
await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
for(const r of report.runs)console.log(r.device,r.ok?'OK':'FAILED',JSON.stringify(r.perf),r.failure?'\n'+r.failure+'\n'+JSON.stringify(r.state):'',r.errors.length?'\nerrors: '+r.errors.slice(0,5).join('\n'):'');
process.exit(report.runs.every(r=>r.ok)?0:1);
