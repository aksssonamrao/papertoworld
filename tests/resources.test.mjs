import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BoxGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial,
  MeshBasicNodeMaterial, ShaderMaterial, Texture,
} from 'three/webgpu';
import { texture } from 'three/tsl';
import { WorldResources } from '../papertoworld/src/render/resources.js';

function watch(...resources) {
  const counts = new Map(resources.map(resource => [resource, 0]));
  for (const resource of resources) resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
  return resource => counts.get(resource);
}

test('shared kit resources survive world removal while unique resources are released once', () => {
  const sharedGeometry = new BoxGeometry();
  const sharedTexture = new Texture();
  const sharedMaterial = new MeshStandardMaterial({ map: sharedTexture });
  const ownGeometry = new BoxGeometry();
  const ownTexture = new Texture();
  const ownMaterial = new MeshStandardMaterial({ map: ownTexture, normalMap: sharedTexture });
  const count = watch(sharedGeometry, sharedTexture, sharedMaterial, ownGeometry, ownTexture, ownMaterial);
  const root = new Group();
  root.add(new Mesh(sharedGeometry, sharedMaterial), new Mesh(ownGeometry, ownMaterial));
  const resources = new WorldResources({ sharedGeometries: [sharedGeometry], sharedMaterials: [sharedMaterial] });
  resources.trackRoots([root]);
  assert.deepEqual(resources.stats, { geometries: 1, materials: 1, textures: 1, instances: 0, total: 3 });
  resources.clear().clear();
  for (const resource of [sharedGeometry, sharedTexture, sharedMaterial]) assert.equal(count(resource), 0);
  for (const resource of [ownGeometry, ownTexture, ownMaterial]) assert.equal(count(resource), 1);
  assert.equal(resources.stats.total, 0);
  assert.equal(root.children.length, 2, 'resource ownership does not change scene membership');
});

test('resources reused by multiple roots are disposed once, including material arrays', () => {
  const geometry = new BoxGeometry();
  const map = new Texture();
  const material = new MeshStandardMaterial({ map });
  const count = watch(geometry, map, material);
  const root = new Mesh(geometry, [material, material]);
  const other = new Mesh(geometry, material);
  const resources = new WorldResources().trackRoots([root, other, root]);
  assert.equal(resources.stats.total, 3);
  resources.clear();
  for (const resource of [geometry, map, material]) assert.equal(count(resource), 1);
});

test('retaining a GLTF prototype protects cloned geometry, materials and textures', () => {
  const geometry = new BoxGeometry();
  const map = new Texture();
  const material = new MeshStandardMaterial({ map });
  const prototype = new Group();
  prototype.add(new Mesh(geometry, material));
  const count = watch(geometry, map, material);
  const resources = new WorldResources();
  resources.retainRoot({ scene: prototype });
  resources.trackRoots([prototype.clone(true)]).clear();
  for (const resource of [geometry, map, material]) assert.equal(count(resource), 0);
  assert.equal(resources.stats.total, 0);
});

test('retaining after tracking promotes resources to shared ownership', () => {
  const geometry = new BoxGeometry();
  const material = new MeshStandardMaterial();
  const mesh = new Mesh(geometry, material);
  const count = watch(geometry, material);
  const resources = new WorldResources().trackRoots([mesh]);
  assert.equal(resources.stats.total, 2);
  resources.retainRoot(mesh);
  assert.equal(resources.stats.total, 0);
  resources.clear();
  assert.equal(count(geometry), 0);
  assert.equal(count(material), 0);
});

test('instance buffers are released even when their geometry and material are shared', () => {
  const geometry = new BoxGeometry();
  const material = new MeshStandardMaterial();
  const instance = new InstancedMesh(geometry, material, 2);
  const count = watch(geometry, material, instance);
  const resources = new WorldResources({ sharedGeometries: [geometry], sharedMaterials: [material] });
  resources.trackRoots([instance]);
  assert.equal(resources.stats.instances, 1);
  resources.clear().clear();
  assert.equal(count(instance), 1);
  assert.equal(count(geometry), 0);
  assert.equal(count(material), 0);
});

test('both GLSL uniform textures and nested TSL texture nodes are owned', () => {
  const geometry = new BoxGeometry();
  const uniformTexture = new Texture();
  const nodeTexture = new Texture();
  const glsl = new ShaderMaterial({ uniforms: { map: { value: uniformTexture } } });
  const node = new MeshBasicNodeMaterial();
  node.colorNode = texture(nodeTexture).rgb.mul(0.8);
  const count = watch(uniformTexture, nodeTexture);
  const resources = new WorldResources().trackRoots([
    new Mesh(geometry, glsl), new Mesh(geometry, node),
  ]);
  assert.equal(resources.stats.textures, 2);
  resources.clear();
  assert.equal(count(uniformTexture), 1);
  assert.equal(count(nodeTexture), 1);
});
