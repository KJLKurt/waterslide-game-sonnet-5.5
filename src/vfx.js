import * as THREE from 'three';

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(1.0, aSize * uScale / max(0.1, -mv.z));
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;
const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.2, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
    #include <colorspace_fragment>
  }
`;

/** One pooled Points object used for wake, splashes, landings and sparkles (1 draw call). */
export class Particles {
  constructor(scene, max = 700) {
    this.max = max;
    this.n = 0;
    this.px = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.outSize = new Float32Array(max);
    this.outAlpha = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.outSize, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.outAlpha, 1).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.setAttribute('aColor', this.colAttr);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 600 } },
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.enabled = true;
  }

  setScale(v) { this.material.uniforms.uScale.value = v; }

  emit(x, y, z, vx, vy, vz, life, size0, size1, r, g, b, gravity = 0) {
    if (!this.enabled || this.n >= this.max) return;
    const i = this.n++;
    this.px[i * 3] = x; this.px[i * 3 + 1] = y; this.px[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life;
    this.s0[i] = size0; this.s1[i] = size1; this.grav[i] = gravity;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
  }

  burst(x, y, z, count, power, up, r, g, b, size = 0.5) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2, s = (0.3 + Math.random() * 0.7) * power;
      this.emit(x, y, z, Math.cos(a) * s, up * (0.5 + Math.random()), Math.sin(a) * s, 0.55 + Math.random() * 0.5, size, size * 0.3, r, g, b, 16);
    }
  }

  clear() { this.n = 0; }

  update(dt) {
    const P = this.px, V = this.vel;
    for (let i = 0; i < this.n; ) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        const j = --this.n;
        if (i !== j) {
          for (let k = 0; k < 3; k++) { P[i * 3 + k] = P[j * 3 + k]; V[i * 3 + k] = V[j * 3 + k]; this.col[i * 3 + k] = this.col[j * 3 + k]; }
          this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j]; this.grav[i] = this.grav[j];
        }
        continue;
      }
      V[i * 3 + 1] -= this.grav[i] * dt;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      i++;
    }
    const pa = this.posAttr.array, ca = this.colAttr.array;
    for (let i = 0; i < this.n; i++) {
      const t = this.age[i] / this.life[i];
      pa[i * 3] = P[i * 3]; pa[i * 3 + 1] = P[i * 3 + 1]; pa[i * 3 + 2] = P[i * 3 + 2];
      ca[i * 3] = this.col[i * 3]; ca[i * 3 + 1] = this.col[i * 3 + 1]; ca[i * 3 + 2] = this.col[i * 3 + 2];
      this.outSize[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.outAlpha[i] = (1 - t) * (t < 0.1 ? t * 10 : 1) * 0.85;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.posAttr.needsUpdate = this.colAttr.needsUpdate = this.sizeAttr.needsUpdate = this.alphaAttr.needsUpdate = true;
  }
}

/** Streaks that rush past the edges of the screen; drawn as one LineSegments child of the camera. */
export class SpeedLines {
  constructor(camera, count = 34) {
    this.camera = camera;
    this.count = count;
    this.dir = new Float32Array(count * 2);
    this.z = new Float32Array(count);
    this.len = new Float32Array(count);
    for (let i = 0; i < count; i++) this.reseed(i, true);
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(count * 6), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.lines = new THREE.LineSegments(geo, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 4;
    camera.add(this.lines);
    this.enabled = true;
  }

  reseed(i, initial) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.62 + Math.random() * 0.5;
    this.dir[i * 2] = Math.cos(a) * r;
    this.dir[i * 2 + 1] = Math.sin(a) * r;
    this.z[i] = initial ? -(3 + Math.random() * 30) : -32;
    this.len[i] = 0.6 + Math.random() * 1.2;
  }

  update(dt, speed01, aspect, fov) {
    const on = this.enabled && speed01 > 0.35;
    this.lines.visible = on;
    if (!on) return;
    this.material.opacity = Math.min(0.5, (speed01 - 0.35) * 1.1);
    const tanH = Math.tan((fov * Math.PI) / 360);
    const p = this.pos.array;
    for (let i = 0; i < this.count; i++) {
      this.z[i] += dt * (40 + speed01 * 60);
      if (this.z[i] > -2) this.reseed(i, false);
      const z0 = this.z[i], z1 = z0 - this.len[i] * (2 + speed01 * 6);
      const dx = this.dir[i * 2] * aspect * tanH, dy = this.dir[i * 2 + 1] * tanH;
      p[i * 6] = dx * -z0; p[i * 6 + 1] = dy * -z0; p[i * 6 + 2] = z0;
      p[i * 6 + 3] = dx * -z1; p[i * 6 + 4] = dy * -z1; p[i * 6 + 5] = z1;
    }
    this.pos.needsUpdate = true;
  }
}
