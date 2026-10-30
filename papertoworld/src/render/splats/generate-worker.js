import { Splats, defineBundle } from '../../../vendor/radix-core-0.0.1.module.js';
import { buildSplatDataset } from './dataset.js';
import { partitionRegions } from './regions.js';

const MOTION = defineBundle({ anchor: 'float32x4', traits: 'float32x2' });
self.onmessage = ({ data: { world, quality } }) => {
  try {
    const started = performance.now();
    const { records: r, counts, bounds } = buildSplatDataset(world, { quality });
    const {order,regions}=partitionRegions(r,world.size||16);
    const data = Splats.make(r.count).addBundle('motion', MOTION);
    const write = Splats.encoder(data.bundles.extSplats);
    const splat = Splats.makeExtSplat();
    const anchors = data.bundles.motion.channels.anchor.data;
    const traits = data.bundles.motion.channels.traits.data;
    for (let i = 0; i < r.count; i++) {
      const source=order[i],j = source * 3, q = source * 4;
      splat.center.x = r.centers[j]; splat.center.y = r.centers[j + 1]; splat.center.z = r.centers[j + 2];
      splat.scales.x = r.scales[j]; splat.scales.y = r.scales[j + 1]; splat.scales.z = r.scales[j + 2];
      splat.quaternion.x = r.quaternions[q]; splat.quaternion.y = r.quaternions[q + 1];
      splat.quaternion.z = r.quaternions[q + 2]; splat.quaternion.w = r.quaternions[q + 3];
      splat.rgb.r = r.colors[j]; splat.rgb.g = r.colors[j + 1]; splat.rgb.b = r.colors[j + 2];
      splat.normal.x = r.normals[j]; splat.normal.y = r.normals[j + 1]; splat.normal.z = r.normals[j + 2];
      splat.opacity = r.opacities[source]; splat.roughness = 0.9; splat.metallic = 0;
      write(i, splat);
      anchors[i*4] = r.anchors[j]; anchors[i*4 + 1] = r.anchors[j + 1]; anchors[i*4 + 2] = r.anchors[j + 2]; anchors[i*4 + 3] = r.delays[source];
      traits[i * 2] = r.kinds[source]; traits[i * 2 + 1] = r.phases[source];
    }
    const arrays = data.toTransferable();
    const transfer = Object.values(arrays.bundles).flatMap(bundle => Object.values(bundle.channels).map(array => array.buffer));
    self.postMessage({ arrays, counts, bounds, regions, generationMs: performance.now() - started }, transfer);
  } catch (error) { self.postMessage({ error: String(error?.stack || error) }); }
};
