import { WebGPURenderer } from 'three/webgpu';

// Limits requested by the pinned Radix 0.0.1 helper, clamped to the selected
// adapter. Keep the vendor bundle unmodified; request the high-performance
// adapter through Three's public API on machines with more than one GPU.
const RADIX_LIMITS = {
  maxTextureDimension1D: 16384, maxTextureDimension2D: 16384,
  maxTextureArrayLayers: 2048, maxBufferSize: 1 << 30,
  maxStorageBufferBindingSize: 256 << 20,
  maxComputeWorkgroupStorageSize: 32768, maxColorAttachmentBytesPerSample: 64,
  maxStorageBuffersPerShaderStage: 10,
  maxStorageBuffersInVertexStage: 10, maxStorageBuffersInFragmentStage: 10,
};

export async function createMainRenderer(canvas) {
  const backend = new URLSearchParams(location.search).get('gpu');
  let forceWebGL = backend === 'webgpu-gl' || !navigator.gpu;
  let requiredLimits;
  if (!forceWebGL) {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance', featureLevel: 'compatibility' });
    if (adapter) {
      requiredLimits = {};
      for (const [name, desired] of Object.entries(RADIX_LIMITS)) {
        if (typeof adapter.limits[name] === 'number') requiredLimits[name] = Math.min(desired, adapter.limits[name]);
      }
    } else forceWebGL = true;
  }
  const renderer = new WebGPURenderer({ canvas, antialias: true, forceWebGL,
    powerPreference: 'high-performance', requiredLimits });
  await renderer.init();
  return renderer;
}

/** Start an older integrated GPU conservatively; fixed detail remains available. */
export function preferLightDetail(renderer) {
  const info = renderer.backend.device?.adapterInfo;
  return info?.vendor === 'intel' && /gen-[9]|gen-11/i.test(info.architecture || '');
}
