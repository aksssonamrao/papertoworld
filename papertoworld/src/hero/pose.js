/* Procedural pose layer on top of the clip mixer (ozz-animation ideas on three.js): analytic two-bone IK for hands
   and feet, a climbing cycle that puts the hands and feet on a trunk or ladder, and a little breathing. Runs after
   mixer.update, the same way the head glance already overrides the Head bone. */

/**
 * Two-bone IK (after Daniel Holden's analytic solver). a/b/c are the root, middle and end bones (e.g. upper arm,
 * forearm, hand); `target` is a world-space Vector3; `pole` is a world-space point the middle joint should bend
 * toward. Rotates a and b in place. Unreachable targets stretch the chain straight toward them.
 */
export function twoBoneIK(THREE, a, b, c, target, pole, weight = 1) {
  const V = THREE.Vector3, Q = THREE.Quaternion, eps = 1e-6;
  const wp = o => o.getWorldPosition(new V());
  // apply a world-space rotation to a bone (and so its children): local' = local * (inv(global) * r * global)
  const rotate = (bone, r) => { const g = bone.getWorldQuaternion(new Q()); bone.quaternion.multiply(g.clone().invert().multiply(r).multiply(g)); bone.updateWorldMatrix(false, true); };
  const ang = (u, v) => Math.acos(Math.max(-1, Math.min(1, u.dot(v))));
  let pa = wp(a), pb = wp(b), pc = wp(c);
  const lab = pb.distanceTo(pa), lcb = pb.distanceTo(pc);
  const lat = Math.min(Math.max(target.distanceTo(pa), 1e-4), lab + lcb - 1e-4);
  // 1. bend in the limb's own plane so |a→c| becomes the target distance (keeps the a→c direction)
  const ca = pc.clone().sub(pa).normalize(), ba = pb.clone().sub(pa).normalize();
  let axis = new V().crossVectors(ca, ba);
  if (axis.lengthSq() < eps) axis.crossVectors(ca, (pole ? pole.clone().sub(pa) : new V(0, 0, 1)).normalize());
  if (axis.lengthSq() < eps) axis.set(1, 0, 0);
  axis.normalize();
  const cl = x => Math.max(-1, Math.min(1, x));
  const acab0 = ang(ca, ba), babc0 = ang(pa.clone().sub(pb).normalize(), pc.clone().sub(pb).normalize());
  const acab1 = Math.acos(cl((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat)));
  const babc1 = Math.acos(cl((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb)));
  rotate(a, new Q().setFromAxisAngle(axis, (acab1 - acab0) * weight));
  rotate(b, new Q().setFromAxisAngle(axis, (babc1 - babc0) * weight));
  // 2. swing the whole chain so the end lands on the target (from where the joints actually are now)
  pa = wp(a); pc = wp(c);
  const cur = pc.clone().sub(pa).normalize(), want = target.clone().sub(pa).normalize();
  rotate(a, new Q().setFromUnitVectors(cur, want).slerp(new Q(), 1 - weight));
  // 3. twist about the a→target line so the middle joint (elbow/knee) faces the pole
  if (pole) {
    pa = wp(a); pb = wp(b);
    const n = want, proj = v => v.sub(n.clone().multiplyScalar(v.dot(n)));
    const m = proj(pb.clone().sub(pa)), q = proj(pole.clone().sub(pa));
    if (m.lengthSq() > eps && q.lengthSq() > eps) {
      m.normalize(); q.normalize();
      const sgn = Math.sign(new V().crossVectors(m, q).dot(n)) || 1;
      rotate(a, new Q().setFromAxisAngle(n, ang(m, q) * sgn * weight));
    }
  }
}

const LIMBS = {
  handL: ['upperarm_l', 'lowerarm_l', 'hand_l'], handR: ['upperarm_r', 'lowerarm_r', 'hand_r'],
  footL: ['thigh_l', 'calf_l', 'foot_l'], footR: ['thigh_r', 'calf_r', 'foot_r'],
};

/**
 * Hands and feet on a vertical support (tree trunk, ladder). `c` = {x,y,z: hero base, ax,az: support axis point at
 * the hero's height, ox,oz: unit vector from the support toward the hero, r: support radius, phase: climb cycle}.
 */
export function climbTargets(c) {
  const rx = -c.oz, rz = c.ox, side = .016;           // right of the hero as they face the support
  const s = Math.sin(c.phase), s2 = Math.sin(c.phase + Math.PI);
  const at = (lat, up, out) => ({ x: c.ax + c.ox * (c.r + out) + rx * lat, y: c.y + up, z: c.az + c.oz * (c.r + out) + rz * lat });
  return {
    handL: at(-side, .1 + .022 * s, .004), handR: at(side, .1 + .022 * s2, .004),
    footL: at(-side * .8, .014 + .02 * s2, .012), footR: at(side * .8, .014 + .02 * s, .012),
    // knees bend outward/backward, elbows out to the sides
    poles: { handL: at(-.08, .06, .05), handR: at(.08, .06, .05), footL: at(-.03, .04, .08), footR: at(.03, .04, .08) },
  };
}

/** Apply the active action's pose to a skinned body S ({bones}). act = actions.pose() result. */
export function applyPose(THREE, S, act, dt, et) {
  if (!S || !S.bones || !act) return;
  const B = S.bones;
  if (act.climb) {
    const t = climbTargets(act.climb), v = new THREE.Vector3(), p = new THREE.Vector3();
    for (const k of ['handL', 'handR', 'footL', 'footR']) {
      const [a, b, c] = LIMBS[k].map(n => B[n]); if (!a || !b || !c) continue;
      v.set(t[k].x, t[k].y, t[k].z); p.set(t.poles[k].x, t.poles[k].y, t.poles[k].z);
      twoBoneIK(THREE, a, b, c, v, p, 1);
    }
  }
  if (act.reach) { // one hand out to a point (lighting a lantern, stoking a fire, knocking)
    const [a, b, c] = LIMBS.handR.map(n => B[n]);
    if (a && b && c) twoBoneIK(THREE, a, b, c, new THREE.Vector3(act.reach.x, act.reach.y, act.reach.z), new THREE.Vector3(act.reach.x, act.reach.y - .1, act.reach.z), act.reach.w ?? 1);
  }
  if (act.breathe && B.spine_02) B.spine_02.rotateX(Math.sin(et * 1.7) * .025 * act.breathe);
}
