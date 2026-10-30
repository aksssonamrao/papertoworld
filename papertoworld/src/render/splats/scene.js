import { Color, Vector3, Matrix4, Box3, Frustum } from 'three/webgpu';
import { float, vec3, uniform, mix, dot, sRGBTransferEOTF, sRGBTransferOETF } from 'three/tsl';
import { ArrayData, defineBundle, GpuArrays, GpuArrayReader, GpuSplats,
  SplatGenerator, SplatCollection, SplatRenderer } from '../../../vendor/radix-0.0.1.module.js';

import { regionIndices } from './regions.js';

const MOTION = defineBundle({ anchor: 'float32x4', traits: 'float32x2' });
const QUALITY = ['low', 'medium', 'high'];

/** One scene collection and shared shader graph; static tables are uploaded once. */
export class LivingWorldSplats {
  constructor(renderer, scene, { quality = 'auto', mobile = false } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.quality = QUALITY.includes(quality) ? quality : mobile ? 'low' : 'high';
    this.autoQuality = !QUALITY.includes(quality);
    this.defaultQuality = mobile ? 'low' : 'high';
    this.frameAverage = 16.7;
    this.steadyFrames = 0;
    this.lastQualityChange = performance.now();
    this.generation = 0;
    this.worker = null;
    this.regions=[];this.indexSets=new Set();this.selectionKey='';this.frustum=new Frustum();this.viewMatrix=new Matrix4();
    this.culling=new URLSearchParams(location.search).get('optCulling')!=='0';
    this.arrays = null;
    this.world = null;
    this.meshFallbacks = [];
    this.stats = { ready: false, pending: false, error: null, count: 0, quality: this.quality, generationMs: 0, tableBytes: 0 };
    this.u = {
      time: uniform(0), growth: uniform(0), rise: uniform(0), wind: uniform(0.8),
      sun: uniform(new Vector3(-0.4, 0.8, -0.3).normalize()),
      sunColor: uniform(new Color('#fff1cb')), ambient: uniform(new Color('#718c73')),
      night: uniform(0), season: uniform(1),
      lampPosition: uniform(new Vector3()), lampStrength: uniform(0),
      campPosition: uniform(new Vector3()), campStrength: uniform(0),
      fogColor: uniform(new Color()), fogDensity: uniform(0), camera: uniform(new Vector3()),
    };
    const motion = new GpuArrayReader(MOTION);
    const u = this.u;
    const modify = (splat) => {
      const s = splat.toVar();
      const center = s.get('center');
      const index = s.get('index');
      const anchor = motion.load('anchor', index);
      const traits = motion.load('traits', index);
      const kind = traits.x;
      const phase = traits.y;
      // A leaf's birth is offset within its parent's established growth delay.
      const born = u.growth.sub(anchor.w).sub(phase.mul(0.22)).div(0.95).clamp(0, 1);
      const bloom = float(1).sub(float(1).sub(born).pow(3));
      const relative = center.sub(anchor.xyz).toVar();
      center.assign(anchor.xyz.mul(vec3(1, u.rise, 1)).add(relative.mul(bloom)));
      s.get('scales').mulAssign(bloom.max(0.001));
      s.get('opacity').mulAssign(born.smoothstep(0, 0.22));
      const tree = kind.lessThan(4);
      const height = relative.y.max(0);
      const sway = u.time.mul(1.6).add(anchor.x.mul(1.7)).add(anchor.z.mul(1.3)).sin()
        .mul(u.wind).mul(tree.select(0.025, 0.04)).mul(height);
      center.addAssign(vec3(sway, 0, sway.mul(0.57)));
      const normal = GpuSplats.normalOf(s).normalize();
      const diffuse = dot(normal, u.sun).mul(0.45).add(0.55).clamp(0.18, 1);
      const light = u.ambient.add(u.sunColor.mul(diffuse).mul(u.night.mul(0.88).oneMinus()));
      const original = s.get('rgb');
      const autumn = vec3(1.5, 0.73, 0.25);
      const spring = vec3(1.12, 1.18, 0.9);
      const tint = u.season.lessThan(0.5).select(spring,
        u.season.greaterThan(1.5).and(u.season.lessThan(2.5)).and(kind.equal(0)).select(autumn, vec3(1)));
      const winter = u.season.greaterThan(2.5);
      const snow = normal.y.max(0).mul(0.7).add(0.18).mul(winter.select(1, 0));
      const surface = mix(original.mul(tint), vec3(0.78, 0.86, 0.9), snow);
      const lampDistance = center.distance(u.lampPosition);
      const campDistance = center.distance(u.campPosition);
      const warmLight = u.lampStrength.div(lampDistance.mul(lampDistance).mul(20).add(1))
        .add(u.campStrength.div(campDistance.mul(campDistance).mul(8).add(1)));
      const shaded = sRGBTransferEOTF(surface).mul(light.add(vec3(1, 0.45, 0.12).mul(warmLight)));
      const fog = center.distance(u.camera).mul(u.fogDensity).pow(2).negate().exp().oneMinus();
      original.assign(sRGBTransferOETF(mix(shaded, u.fogColor, fog)));
      return s;
    };
    const makeGenerator=remap=>{
      const base=SplatGenerator.fromSplats({remap,modifiers:[modify]});
      return {generateSplat:base.generateSplat,bind(data,context){base.bind(data,context);motion.bind(data.splats,'motion')}};
    };
    this.generator=makeGenerator(undefined);this.indexedGenerator=makeGenerator('indices');
    this.splats = new SplatRenderer({ renderer, collection: SplatCollection.EMPTY,
      sortMode:new URLSearchParams(location.search).get('optSort')==='gpu'?'gpu':new URLSearchParams(location.search).get('optSort')==='cpu'||(renderer.backend.device?.adapterInfo?.vendor==='intel'&&/gen-9|gen-11/.test(renderer.backend.device?.adapterInfo?.architecture||''))?'cpu':undefined,
      params: { minAlpha: 0.015, maxStdDev: 2.5 },
      objectParams: { minPixelRadius: 0.15, maxPixelRadius: 120 },
    });
    this.splats.name = 'Living watercolour vegetation';
    this.splats.renderOrder = 1;
    this.splats.frustumCulled = false;
    scene.add(this.splats);
  }

  clear() {
    this.generation++;
    this.worker?.terminate(); this.worker = null;
    this.splats.collection = SplatCollection.EMPTY;
    for (const view of [...this.splats.views.values()]) view.dispose();
    for(const indices of this.indexSets)indices.dispose();this.indexSets.clear();
    this.arrays?.dispose(); this.arrays = null;
    this.regions=[];this.selectionKey='';
    for (const object of this.meshFallbacks) object.visible = true;
    this.meshFallbacks = [];
    this.world = null;
    Object.assign(this.stats, { ready: false, pending: false, error: null, count: 0, submitted:0,tableBytes: 0 });
  }

  build(world, fallbackMeshes, {retain=false}={}) {
    if(retain&&this.arrays){this.generation++;this.worker?.terminate();this.worker=null}
    else this.clear();
    const generation = this.generation;
    this.world = world;
    this.meshFallbacks = fallbackMeshes;
    Object.assign(this.stats, { pending: true, quality: this.quality });
    const worker = this.worker = new Worker(__WORLD_WORKER_URL__, { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (generation !== this.generation) return;
      worker.terminate(); this.worker = null;
      if (data.error) { this.fail(data.error); return; }
      try {
        const arrays = GpuArrays.fromData(this.renderer, ArrayData.fromTransferable(data.arrays));
        this.splats.collection=SplatCollection.EMPTY;
        for(const view of [...this.splats.views.values()])view.dispose();
        for(const indices of this.indexSets)indices.dispose();this.indexSets.clear();
        this.arrays?.dispose();this.arrays = arrays;
        this.regions=(data.regions||[]).map(r=>({...r,box:new Box3(new Vector3(...r.min),new Vector3(...r.max))}));
        this.selectionKey='';
        this.setSelection(this.regions);
        for (const object of this.meshFallbacks) object.visible = false;
        Object.assign(this.stats, { ready: true, pending: false, count: arrays.count,
          generationMs: data.generationMs, tableBytes: arrays.count * 56, counts: data.counts });
      } catch (error) { this.fail(error); }
    };
    worker.onerror = event => { if (generation === this.generation) this.fail(event.message); };
    worker.postMessage({ world, quality: this.quality });
  }

  fail(error) {
    this.worker?.terminate(); this.worker = null;
    this.splats.collection = SplatCollection.EMPTY;
    for (const view of [...this.splats.views.values()]) view.dispose();
    this.arrays?.dispose(); this.arrays = null;
    for (const object of this.meshFallbacks) object.visible = true;
    Object.assign(this.stats, { pending: false, ready: false, error: String(error) });
    console.error('World detail generation failed:', error);
  }

  setQuality(quality, automatic = false) {
    if (quality === 'auto') {
      this.autoQuality = true;
      quality = this.defaultQuality;
    } else if (!automatic) this.autoQuality = false;
    if (!QUALITY.includes(quality) || quality === this.quality) return;
    this.quality = quality;
    this.lastQualityChange = performance.now();
    this.steadyFrames = 0;
    if (this.world) this.build(this.world, [...this.meshFallbacks]);
  }

  adapt(frameMs, steady) {
    if (!this.autoQuality || !steady || !this.stats.ready || !Number.isFinite(frameMs) || frameMs > 250) {
      this.steadyFrames = 0;
      return;
    }
    this.frameAverage = this.frameAverage * 0.98 + frameMs * 0.02;
    this.steadyFrames++;
    if (this.steadyFrames < 180 || performance.now() - this.lastQualityChange < 30000) return;
    const tier = QUALITY.indexOf(this.quality);
    if (this.frameAverage > 32 && tier > 0) this.setQuality(QUALITY[tier - 1], true);
    else if (this.frameAverage < 15.5 && tier < QUALITY.indexOf(this.defaultQuality)) this.setQuality(QUALITY[tier + 1], true);
  }

  update({ time, growth, rise, wind, season, sky, sunDirection, sunColor, camera, fog, lamp, camp }) {
    const u = this.u;
    u.time.value = time; u.growth.value = growth; u.rise.value = rise; u.wind.value = wind;
    u.season.value = ['spring', 'summer', 'autumn', 'winter'].indexOf(season);
    u.night.value = sky.night * (1 - sky.lampK);
    u.sun.value.copy(sunDirection);
    u.sunColor.value.copy(sunColor).multiplyScalar((sky.lampK > 0.5 ? 0.85 : 0.95)*(1-sky.rain*0.55));
    u.ambient.value.setRGB(0.24 + (1 - u.night.value) * 0.2, 0.3 + (1 - u.night.value) * 0.19, 0.4 + (1 - u.night.value) * 0.1).multiplyScalar(1-sky.rain*0.15);
    u.camera.value.copy(camera.position);
    u.fogColor.value.copy(fog.color); u.fogDensity.value = fog.density;
    u.lampPosition.value.copy(lamp.position); u.lampStrength.value = lamp.visible ? Math.min(2, lamp.intensity / 0.23) : 0;
    u.campPosition.value.copy(camp.position); u.campStrength.value = camp.visible ? Math.min(2, camp.intensity / 0.23) : 0;
    // Worker sorting needs an explicit refresh while centers are moving.
    this.updateSelection(camera,growth);
    if (this.splats.sortMode==='cpu' && this.stats.ready && (growth < 6.5 || time-(this.lastWindSort||0)>0.15)) { this.splats.requestSort(); this.lastWindSort=time; }
  }


  setSelection(regions){
    if(!this.arrays)return;
    const key=regions.map(r=>r.id).join(',');if(key===this.selectionKey)return;
    this.selectionKey=key;
    const count=regions.reduce((n,r)=>n+r.count,0);
    this.stats.submitted=count;this.stats.visibleRegions=regions.length;this.stats.regions=this.regions.length;
    if(!count){this.splats.collection=SplatCollection.EMPTY;for(const view of [...this.splats.views.values()])view.dispose();return}
    if(count===this.arrays.count){
      this.splats.collection=new SplatCollection([{generator:this.generator,data:{splats:this.arrays},count,matrixWorld:new Matrix4()}]);
    }else{
      const indices=SplatGenerator.indices(this.renderer,regionIndices(regions));this.indexSets.add(indices);
      const release=()=>{if(this.indexSets.delete(indices))indices.dispose()};
      this.splats.collection=new SplatCollection([{generator:this.indexedGenerator,data:{splats:this.arrays,indices},count,matrixWorld:new Matrix4(),release}]);
    }
  }
  updateSelection(camera,growth){
    if(!this.arrays)return;
    if(!this.culling||growth<6.5){this.setSelection(this.regions);return}
    camera.updateMatrixWorld();this.viewMatrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewMatrix,this.renderer.coordinateSystem);
    this.setSelection(this.regions.filter(r=>this.frustum.intersectsBox(r.box)));
  }

  dispose() { this.clear(); this.scene.remove(this.splats); this.splats.dispose(); }
}
