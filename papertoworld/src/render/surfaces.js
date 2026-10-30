import { dot, materialColor, min, positionGeometry, positionWorld, vec3 } from 'three/tsl';

/** World-locked pigment variation: it stays on the surface as the camera moves. */
export function pigmentSurface(material, strength = 0.06) {
  const a = dot(positionWorld, vec3(79.3, 97.7, 63.1)).sin();
  const b = dot(positionWorld, vec3(137, 67, 117)).sin();
  material.colorNode = materialColor.rgb.mul(a.mul(b).mul(strength).add(1));
  return material;
}

/** Subtle staggered tiles follow each roof's local geometry and instance colour. */
export function tiledRoof(material) {
  const row = positionGeometry.y.mul(28);
  const column = positionGeometry.x.mul(14).add(row.floor().mod(2).mul(0.5));
  const joint = min(row.fract(), column.fract()).smoothstep(0.015, 0.085);
  material.colorNode = materialColor.rgb.mul(joint.mul(0.15).add(0.85));
  return material;
}
