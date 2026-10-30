import {
  AdditiveBlending, NormalBlending, Color, Vector3, DynamicDrawUsage,
  InstancedBufferGeometry, InstancedBufferAttribute, Float32BufferAttribute,
  Mesh, MeshBasicNodeMaterial, MeshStandardNodeMaterial,
} from 'three/webgpu';
import {
  Fn, If, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix,
  dot, float, materialColor, materialOpacity, mix, modelViewMatrix,
  positionGeometry, positionLocal, positionWorld, reference, texture,
  screenDPR, uniform, uv, varying, vec2, vec3, vec4, viewportSize,
} from 'three/tsl';

/**
 * The app updates these uniform nodes through the same `.value` API its original
 * GLSL materials exposed. All shader logic here is shared by WebGPU and WebGL2.
 */
export function createWaterMaterial({ waterTex }) {
  const uniforms = {
    uTime: uniform(0),
    uSky: uniform(new Color('#a8c9d3')),
    uIce: uniform(0),
    uSunDir: uniform(new Vector3(0, 1, 0)),
    uSunK: uniform(1),
  };
  const { uTime, uSky, uIce, uSunDir, uSunK } = uniforms;
  const material = new MeshStandardNodeMaterial({
    color: '#2d5a73', transparent: true, opacity: 0,
    roughness: 0.12, metalness: 0.18, depthWrite: true, alphaTest: 0.015,
  });
  material.name = 'Paperworld water and ice';

  const wp = positionWorld.xz;
  const wave = (direction, velocity, amplitude, normal) =>
    dot(wp, vec2(...direction)).add(uTime.mul(velocity)).cos()
      .mul(amplitude).mul(vec2(...normal));
  const gradient = wave([11, 4], 1.9, 0.05, [0.94, 0.34])
    .add(wave([-6, 15], 2.3, 0.04, [-0.37, 0.93]))
    .add(wave([27, -19], 3.4, 0.028, [0.82, -0.58]))
    .add(wave([-41, -33], 4.1, 0.02, [-0.78, -0.63]))
    .mul(uIce.mul(0.85).oneMinus());
  const worldNormal = vec3(gradient.x.negate(), 1, gradient.y.negate()).normalize();
  material.normalNode = cameraViewMatrix.mul(vec4(worldNormal, 0)).xyz.normalize();

  const viewDirection = cameraPosition.sub(positionWorld).normalize();
  const reflection = viewDirection.negate().reflect(worldNormal);
  const fresnel = dot(worldNormal, viewDirection).clamp(0, 1).oneMinus().pow(5).mul(0.98).add(0.02);
  const mask = texture(waterTex, uv()).g;
  const foam = mask.smoothstep(0.1, 0.3)
    .mul(mask.smoothstep(0.3, 0.62).oneMinus())
    .mul(uTime.mul(1.3).add(wp.x.mul(9)).add(wp.y.mul(7)).sin().mul(0.45).add(0.55))
    .mul(uIce.oneMinus());
  const skyReflection = uSky.mul(reflection.y.clamp(0, 1).mul(0.6).add(0.7));
  const sunGlint = dot(reflection, uSunDir).max(0).pow(220)
    .mul(uSunK).mul(uIce.mul(0.7).oneMinus()).mul(1.7);
  const foamLight = dot(uSky, vec3(0.33)).mul(0.75).add(0.25);

  material.colorNode = mix(materialColor, skyReflection, fresnel.mul(0.38))
    .mul(dot(worldNormal, uSunDir).sub(uSunDir.y).mul(1.5).mul(uSunK).add(1));
  material.emissiveNode = skyReflection.mul(fresnel).mul(0.23)
    .add(vec3(1, 0.93, 0.8).mul(sunGlint))
    .add(vec3(0.92, 0.95, 1).mul(foam).mul(0.22).mul(foamLight));
  material.opacityNode = materialOpacity.mul(mask)
    .mul(mix(float(0.78), float(1.2), fresnel).add(foam.mul(0.25))).clamp(0, 1);
  material.roughnessNode = mix(float(0.12), float(0.42), uIce);
  material.userData.paperworldUniforms = uniforms;
  return { material, uniforms };
}

/**
 * Camera-facing instanced quads replace WebGL-only programmable point sizes.
 * Geometry attributes preserve the original particle update API: position,
 * color, alpha, size and setDrawRange(0, particleCount). `size` is world-space
 * diameter; uPx enforces the original 256-pixel maximum diameter.
 *
 * The index buffer always draws one quad. setDrawRange changes instanceCount,
 * not the number of quad indices. No CPU billboard updates are required.
 */
export function createPointCloud(capacity, additive = false) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Particle capacity must be positive');
  const geometry = new InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('corner', new Float32BufferAttribute([
    -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5,
  ], 2));
  geometry.setAttribute('normal', new Float32BufferAttribute([
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
  ], 3));
  geometry.setAttribute('uv', new Float32BufferAttribute([
    0, 0, 1, 0, 1, 1, 0, 1,
  ], 2));
  const put = (name, components) => {
    const attr = new InstancedBufferAttribute(new Float32Array(capacity * components), components);
    attr.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, attr);
  };
  put('position', 3);
  put('color', 3);
  put('alpha', 1);
  put('size', 1);
  geometry.instanceCount = 0;
  geometry.drawRange.start = 0;
  geometry.drawRange.count = 6;
  geometry.setDrawRange = (start, count) => {
    if (start !== 0) throw new RangeError('Particle ranges start at zero');
    geometry.instanceCount = Math.max(0, Math.min(capacity, count));
  };
  const uPx = uniform(500);
  const uOp = uniform(1);
  const material = new MeshBasicNodeMaterial({
    transparent: true, depthWrite: false,
    blending: additive ? AdditiveBlending : NormalBlending,
    alphaTest: 0.004,
  });
  material.name = additive ? 'Paperworld luminous particles' : 'Paperworld soft particles';
  material.uniforms = { uPx, uOp };
  const centerView = modelViewMatrix.mul(vec4(attribute('position', 'vec3'), 1));
  const size = attribute('size', 'float').max(0)
    .min(centerView.z.negate().max(0.001).mul(256).div(uPx.max(1)));
  const corner = attribute('corner', 'vec2');
  material.vertexNode = cameraProjectionMatrix.mul(
    centerView.add(vec4(corner.mul(size), 0, 0)),
  );
  const disk = varying(corner, 'particleDisk').length().smoothstep(0.05, 0.5).oneMinus();
  material.colorNode = attribute('color', 'vec3');
  material.opacityNode = disk.mul(attribute('alpha', 'float')).mul(uOp);
  const object = new Mesh(geometry, material);
  object.name = material.name;
  object.frustumCulled = false;
  object.userData.particleCapacity = capacity;
  return object;
}

/**
 * Replace a classic Points object while retaining its original position array
 * and mutable material.size, opacity and color properties. Point sizes follow
 * Three.js PointsMaterial's logical-pixel convention, including DPR and its
 * perspective size-attenuation rule. No frame-level sync is needed when callers
 * update the returned object's geometry attributes directly.
 *
 * The source geometry's position array is shared. If callers retain the source
 * attribute and increment its version, onBeforeRender forwards that update to
 * the instanced attribute. syncBillboards is also exposed for explicit updates.
 */
export function createBillboardPoints(sourceGeometry, sourceMaterial) {
  const sourcePosition = sourceGeometry.getAttribute('position');
  if (!sourcePosition || sourcePosition.itemSize !== 3) {
    throw new TypeError('Billboard points require a vec3 position attribute');
  }
  const capacity = sourcePosition.count;
  const object = createPointCloud(Math.max(1, capacity), sourceMaterial.blending === AdditiveBlending);
  const { geometry, material } = object;
  const position = new InstancedBufferAttribute(sourcePosition.array, 3, sourcePosition.normalized);
  position.setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', position);
  geometry.attributes.alpha.array.fill(1);
  geometry.attributes.color.array.fill(1);
  geometry.attributes.size.array.fill(1);
  const sourceColor = sourceGeometry.getAttribute('color');
  if (sourceColor) {
    geometry.setAttribute('color', new InstancedBufferAttribute(sourceColor.array, sourceColor.itemSize, sourceColor.normalized));
  }
  geometry.setDrawRange(0, Math.min(capacity, sourceGeometry.drawRange.count));
  material.copy(sourceMaterial);
  material.size = sourceMaterial.size ?? 1;
  material.sizeAttenuation = sourceMaterial.sizeAttenuation !== false;
  material.alphaTest = Math.max(0.004, sourceMaterial.alphaTest || 0);
  // Keep the source Color object by reference for callers retaining that handle.
  material.color = sourceMaterial.color || new Color(1, 1, 1);
  const centerView = modelViewMatrix.mul(vec4(attribute('position', 'vec3'), 1));
  const clip = cameraProjectionMatrix.mul(centerView);
  const materialSize = reference('size', 'float', material).max(0);
  const sizePixels = reference('sizeAttenuation', 'bool', material).select(
    materialSize.mul(viewportSize.y).mul(0.5).div(centerView.z.negate().max(0.001)),
    materialSize.mul(screenDPR),
  ).min(256);
  const offset = attribute('corner', 'vec2').mul(sizePixels)
    .mul(2).div(viewportSize).mul(clip.w);
  material.vertexNode = clip.add(vec4(offset, 0, 0));
  material.colorNode = materialColor;
  material.opacityNode = varying(attribute('corner', 'vec2'), 'billboardDisk')
    .length().smoothstep(0.05, 0.5).oneMinus().mul(materialOpacity);
  let positionVersion = sourcePosition.version;
  let colorVersion = sourceColor?.version;
  const sync = () => {
    if (sourcePosition.version !== positionVersion) {
      positionVersion = sourcePosition.version;
      position.needsUpdate = true;
    }
    if (sourceColor && sourceColor.version !== colorVersion) {
      colorVersion = sourceColor.version;
      geometry.attributes.color.needsUpdate = true;
    }
  };
  object.onBeforeRender = sync;
  object.userData.syncBillboards = sync;
  object.name = sourceMaterial.name || 'Paperworld billboard points';
  return object;
}

/** Preserve GLTF textures, side, alpha and surface parameters in a node material. */
export function asStandardNodeMaterial(source) {
  if (source.isMeshStandardNodeMaterial) return source;
  const material = new MeshStandardNodeMaterial().copy(source);
  material.onBeforeCompile = () => {};
  return material;
}

/** Return the replacement material; callers must assign it to the skinned mesh. */
export function dressMaterial(source, jacket) {
  const material = asStandardNodeMaterial(source);
  const uJacket = uniform(jacket);
  material.colorNode = Fn(() => {
    // positionGeometry is the unskinned rest pose, so clothing stays on the body
    // as the joints animate instead of being classified in world coordinates.
    const p = positionGeometry;
    const original = materialColor;
    const lum = dot(original, vec3(0.3, 0.55, 0.15));
    const fold = lum.mul(0.5).add(0.72);
    const ax = p.x.abs();
    const hand = ax.greaterThan(0.655);
    const head = p.y.greaterThan(1.515).and(ax.lessThan(0.2));
    const result = original.toVar();
    If(p.y.lessThan(0.25), () => {
      const bootShade = p.y.greaterThan(0.22).select(1.4, p.y.lessThan(0.02).select(0.6, 1));
      result.assign(vec3(0.085, 0.065, 0.05).mul(bootShade));
    }).ElseIf(p.y.lessThan(0.975), () => {
      result.assign(vec3(0.25, 0.25, 0.29).mul(lum.mul(0.08).add(0.9))
        .mul(ax.greaterThan(0.02).select(1, 0.8)));
    }).ElseIf(p.y.lessThan(1.02).and(ax.lessThan(0.24)), () => {
      result.assign(vec3(0.2, 0.14, 0.1).mul(fold));
    }).ElseIf(hand.not().and(head.not()), () => {
      const hemLight = float(1).sub(p.y.smoothstep(1.02, 1.3)).mul(0.1).oneMinus();
      result.assign(uJacket.mul(lum.mul(0.06).add(0.8)).mul(hemLight));
      If(ax.lessThan(0.013).and(p.z.greaterThan(0)).and(p.y.lessThan(1.46)), () => { result.mulAssign(0.55); });
      If(p.y.greaterThan(1.43).and(ax.lessThan(0.15)), () => { result.mulAssign(0.696); });
      If(ax.greaterThan(0.6), () => { result.mulAssign(0.6); });
      If(p.y.lessThan(1.08).and(ax.lessThan(0.24)), () => { result.mulAssign(0.8); });
      If(ax.greaterThan(0.07).and(ax.lessThan(0.115)).and(p.y.greaterThan(1.08)).and(p.y.lessThan(1.5)),
        () => { result.assign(vec3(0.24, 0.17, 0.11)); });
    });
    return result;
  })();
  material.userData.paperworldUniforms = { uJacket };
  material.needsUpdate = true;
  return material;
}

/** Return a node material with wind deformation shared across both backends. */
export function addSway(source, amplitude, minY, windUniforms) {
  const material = asStandardNodeMaterial(source);
  const time = reference('value', 'float', windUniforms.uTime);
  const wind = reference('value', 'float', windUniforms.uWind);
  // positionLocal already contains the instance placement, while the geometry
  // height keeps roots and low vertices anchored as each instance is scaled.
  const height = positionGeometry.y.sub(minY).max(0);
  const phase = time.mul(1.6).add(positionLocal.x.mul(1.7)).add(positionLocal.z.mul(1.3));
  const sway = phase.sin().add(phase.mul(2.3).add(1).sin().mul(0.45))
    .mul(wind).mul(amplitude).mul(height.pow(2));
  material.positionNode = positionLocal.add(vec3(sway, 0, sway.mul(0.55).mul(phase.mul(0.7).cos())));
  material.needsUpdate = true;
  return material;
}
