/**
 * Resource ownership for one generated world. Scene removal remains the app's
 * responsibility. This registry releases GPU allocations without disposing the
 * reusable geometry kit, shared materials, GLTF prototypes or their textures.
 */
export class WorldResources {
  #sharedGeometries = new Set();
  #sharedMaterials = new Set();
  #sharedTextures = new Set();
  #sharedInstances = new WeakSet();
  #geometries = new Set();
  #materials = new Set();
  #textures = new Set();
  #instances = new Set();

  constructor({ sharedGeometries = [], sharedMaterials = [], sharedTextures = [] } = {}) {
    for (const geometry of sharedGeometries) {
      if (geometry?.isBufferGeometry) this.#sharedGeometries.add(geometry);
    }
    for (const texture of sharedTextures) {
      if (texture?.isTexture) this.#sharedTextures.add(texture);
    }
    for (const material of sharedMaterials.flat()) this.#retainMaterial(material);
  }

  /** Protect a reusable model/prototype and all resources referenced by it. */
  retainRoot(root) {
    visitRoots([root], object => {
      if (object.geometry?.isBufferGeometry) {
        this.#sharedGeometries.add(object.geometry);
        this.#geometries.delete(object.geometry);
      }
      for (const material of materialList(object.material)) this.#retainMaterial(material);
      if (object.isInstancedMesh) {
        this.#sharedInstances.add(object);
        this.#instances.delete(object);
      }
    });
    return this;
  }

  /** Register all resources in generated roots, deduplicated across the world. */
  trackRoots(roots) {
    visitRoots(Array.isArray(roots) ? roots : [roots], object => {
      const geometry = object.geometry;
      if (geometry?.isBufferGeometry && !this.#sharedGeometries.has(geometry)) this.#geometries.add(geometry);
      for (const material of materialList(object.material)) {
        if (!this.#sharedMaterials.has(material)) this.#materials.add(material);
        for (const texture of materialTextures(material)) {
          if (!this.#sharedTextures.has(texture)) this.#textures.add(texture);
        }
      }
      // InstancedMesh owns instance-specific GPU attributes independently of its
      // geometry. Its dispose event releases those buffers in both renderers.
      if (object.isInstancedMesh && !this.#sharedInstances.has(object)) this.#instances.add(object);
    });
    return this;
  }

  /** Counts refer to unique owned resources, never the shared registries. */
  get stats() {
    const geometries = this.#geometries.size;
    const materials = this.#materials.size;
    const textures = this.#textures.size;
    const instances = this.#instances.size;
    return { geometries, materials, textures, instances, total: geometries + materials + textures + instances };
  }

  /** Release each owned resource once. Calling clear again is a no-op. */
  clear() {
    const groups = [this.#instances, this.#geometries, this.#materials, this.#textures];
    const resources = groups.flatMap(group => [...group]);
    for (const group of groups) group.clear();
    const errors = [];
    for (const resource of resources) {
      try { resource.dispose(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Failed to release generated world resources');
    return this;
  }

  #retainMaterial(material) {
    if (!material?.isMaterial) return;
    this.#sharedMaterials.add(material);
    this.#materials.delete(material);
    for (const texture of materialTextures(material)) {
      this.#sharedTextures.add(texture);
      this.#textures.delete(texture);
    }
  }
}

function materialList(value) {
  return (Array.isArray(value) ? value : [value]).filter(material => material?.isMaterial);
}

function visitRoots(roots, visit) {
  const seen = new Set();
  for (const candidate of roots) {
    const root = candidate?.isObject3D ? candidate : candidate?.scene;
    root?.traverse(object => {
      if (seen.has(object)) return;
      seen.add(object);
      visit(object);
    });
  }
}

/** Include classic texture slots, GLSL uniforms and nested TSL texture nodes. */
function materialTextures(material) {
  const textures = new Set();
  const seen = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value.isTexture) {
      textures.add(value);
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (value.isNode) {
      // Traverse node graphs only. In particular, don't follow ReferenceNode's
      // external application objects and accidentally claim unrelated textures.
      for (const child of Object.values(value)) {
        if (child?.isNode || child?.isTexture || Array.isArray(child)) visit(child);
      }
    }
  };
  for (const value of Object.values(material)) visit(value);
  for (const uniform of Object.values(material.uniforms || {})) visit(uniform?.value);
  return textures;
}
