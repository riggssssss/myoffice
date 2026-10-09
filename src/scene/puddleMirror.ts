import * as THREE from 'three';

/**
 * What the puddles mirror: the office seen upside down from under the ground, rendered at
 * half the screen's resolution (water ripples and blurs it anyway) and only while there
 * are puddles to show it (or the plain table's sheen). The ground samples it where it lies under water (see ground.ts), so
 * the lit rooms, the walls in the way and the people all show in the water as they really are.
 * The camera is mirrored the way three's Reflector does it, with an oblique near plane so
 * nothing below the water line gets in.
 */
const SCALE = 0.5;
/** The heights only drive the blur: a quarter of that is plenty. */
const HEIGHT_SCALE = 0.25;
/** Heights are kept up to this many metres above the water. */
const MAX_HEIGHT = 4;

/**
 * Draws how high above the water each surface is (r), and that something is there (g), so
 * both can be filtered and blurred like the image itself (a depth buffer can't be).
 */
function heightMaterial(y: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>
      varying float vHeight;
      void main() {
        #include <skinbase_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        #include <project_vertex>
        vec4 world = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          world = instanceMatrix * world;
        #endif
        vHeight = ( modelMatrix * world ).y - ${y.toFixed(3)};
      }`,
    fragmentShader: /* glsl */ `
      varying float vHeight;
      void main() {
        gl_FragColor = vec4( clamp( vHeight, 0.0, ${MAX_HEIGHT.toFixed(1)} ), 1.0, 0.0, 1.0 );
      }`,
  });
}

export const mirrorUniforms = {
  uMirror: { value: null as THREE.Texture | null },
  /** How far above the water each mirrored thing is (r, times coverage g): near the water sharp, higher up blurred. */
  uMirrorHeight: { value: null as THREE.Texture | null },
  uMirrorMatrix: { value: new THREE.Matrix4() },
  /** 0 when there's nothing to mirror (dry ground): the texture is then stale. */
  uMirrorOn: { value: 0 },
};

const normal = new THREE.Vector3(0, 1, 0);
const plane = new THREE.Plane();
const clip = new THREE.Vector4();
const q = new THREE.Vector4();
const camPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const rotation = new THREE.Matrix4();
const onPlane = new THREE.Vector3();
const size = new THREE.Vector2();
const clearColor = new THREE.Color();

export class PuddleMirror {
  // Mipmapped, so the water can blur what's higher above it by reading a coarser level;
  // multisampled, so thin edges don't come out as steps.
  private target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: 4,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  private heights = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  private heightMat: THREE.ShaderMaterial;
  private camera = new THREE.PerspectiveCamera();

  constructor(private y: number) {
    this.heightMat = heightMaterial(y);
    mirrorUniforms.uMirror.value = this.target.texture;
    mirrorUniforms.uMirrorHeight.value = this.heights.texture;
  }

  /**
   * Render the mirror image for this frame, with `hide` (the ground itself, the garden, the
   * rain) left out. `on` false skips it entirely. `outside` switches the scene to how it looks
   * from out there and back (true before, false after).
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hide: THREE.Object3D[], on: boolean, outside: (yes: boolean) => void): void {
    mirrorUniforms.uMirrorOn.value = on ? 1 : 0;
    if (!on) return;
    renderer.getDrawingBufferSize(size);
    const w = Math.max(1, Math.round(size.x * SCALE));
    const h = Math.max(1, Math.round(size.y * SCALE));
    if (this.target.width !== w || this.target.height !== h) {
      this.target.setSize(w, h);
      this.heights.setSize(Math.max(1, Math.round(w * (HEIGHT_SCALE / SCALE))), Math.max(1, Math.round(h * (HEIGHT_SCALE / SCALE))));
    }

    // The camera's mirror image under the water's surface, looking at the mirror image of what it looks at.
    onPlane.set(0, this.y, 0);
    camPos.setFromMatrixPosition(camera.matrixWorld);
    rotation.extractRotation(camera.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rotation).add(camPos);
    const mirror = this.camera;
    mirror.position.set(camPos.x, 2 * this.y - camPos.y, camPos.z);
    lookAt.y = 2 * this.y - lookAt.y;
    mirror.up.set(0, 1, 0).applyMatrix4(rotation).reflect(normal);
    mirror.lookAt(lookAt);
    mirror.far = camera.far;
    mirror.updateMatrixWorld();
    mirror.projectionMatrix.copy(camera.projectionMatrix);

    mirrorUniforms.uMirrorMatrix.value
      .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(mirror.projectionMatrix)
      .multiply(mirror.matrixWorldInverse);

    // Oblique near plane on the water's surface (Lengyel): only what's above it is drawn.
    plane.setFromNormalAndCoplanarPoint(normal, onPlane).applyMatrix4(mirror.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const p = mirror.projectionMatrix.elements;
    q.set((Math.sign(clip.x) + p[8]) / p[0], (Math.sign(clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    p[2] = clip.x;
    p[6] = clip.y;
    p[10] = clip.z + 1;
    p[14] = clip.w;

    const shown = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const background = scene.background;
    // Nothing drawn: transparent, so the sky's own sheen stays there.
    scene.background = null;
    renderer.getClearColor(clearColor);
    const clearAlpha = renderer.getClearAlpha();
    const shadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    const before = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.state.buffers.depth.setMask(true);
    renderer.clear();
    outside(true);
    renderer.render(scene, mirror);
    // The same view again, as heights only (no lights, no textures: cheap at this size).
    renderer.setRenderTarget(this.heights);
    renderer.clear();
    scene.overrideMaterial = this.heightMat;
    renderer.render(scene, mirror);
    scene.overrideMaterial = null;
    outside(false);
    renderer.setRenderTarget(before);
    renderer.setClearColor(clearColor, clearAlpha);
    renderer.shadowMap.autoUpdate = shadows;
    scene.background = background;
    hide.forEach((o, i) => (o.visible = shown[i]));
  }
}
