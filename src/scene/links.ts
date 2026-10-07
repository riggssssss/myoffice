import * as THREE from 'three';

const SEGMENTS = 40;
const DOTS = 3;

/** Animated arc between two collaborating workers. */
class Link {
  readonly group = new THREE.Group();
  private curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3());
  private line: THREE.Line;
  private dots: THREE.Mesh[] = [];
  private lineMat: THREE.LineBasicMaterial;
  private dotMat: THREE.MeshBasicMaterial;
  opacity = 0;

  constructor(color: string) {
    this.lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
    this.line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(new Array(SEGMENTS + 1).fill(0).map(() => new THREE.Vector3())),
      this.lineMat,
    );
    this.line.frustumCulled = false;
    this.dotMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
    const geo = new THREE.SphereGeometry(0.06, 10, 8);
    for (let i = 0; i < DOTS; i++) {
      const d = new THREE.Mesh(geo, this.dotMat);
      this.dots.push(d);
      this.group.add(d);
    }
    this.group.add(this.line);
  }

  update(a: THREE.Vector3, b: THREE.Vector3, time: number, visible: boolean, animate: boolean, dt: number, color: string): void {
    this.opacity += ((visible ? 1 : 0) - this.opacity) * (1 - Math.exp(-8 * dt));
    this.lineMat.opacity = this.opacity * 0.75;
    this.dotMat.opacity = this.opacity;
    this.lineMat.color.set(color);
    this.dotMat.color.set(color);
    this.group.visible = this.opacity > 0.01;
    if (!this.group.visible) return;

    const lift = 0.5 + a.distanceTo(b) * 0.25;
    this.curve.v0.copy(a);
    this.curve.v2.copy(b);
    this.curve.v1.copy(a).add(b).multiplyScalar(0.5).setY(Math.max(a.y, b.y) + lift);
    const pos = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const p = new THREE.Vector3();
    for (let i = 0; i <= SEGMENTS; i++) {
      this.curve.getPoint(i / SEGMENTS, p);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;

    this.dots.forEach((d, i) => {
      const u = animate ? (time * 0.35 + i / DOTS) % 1 : (i + 1) / (DOTS + 1);
      this.curve.getPoint(u, d.position);
    });
  }
}

export class Links {
  readonly group = new THREE.Group();
  private links = new Map<string, Link>();

  /** pairs: helper id → [from, to, color]. */
  update(
    pairs: Map<string, { a: THREE.Vector3; b: THREE.Vector3; color: string; visible: boolean }>,
    time: number,
    dt: number,
    animate: boolean,
  ): void {
    for (const [id, p] of pairs) {
      let link = this.links.get(id);
      if (!link) {
        link = new Link(p.color);
        this.links.set(id, link);
        this.group.add(link.group);
      }
      link.update(p.a, p.b, time, p.visible, animate, dt, p.color);
    }
  }
}
