import * as THREE from 'three';
import { WALL_T } from '../sim/layout';
import { noiseTexture } from './clouds';

/**
 * The ground round the building: scanned materials (colour, relief and occlusion) so the low
 * sun picks out tufts, grains and joints, solid well past the walls (where people walk in and
 * out) and only melting into the backdrop far off, so the office still reads as a model on a
 * table. It takes real shadows: the building's, the people's and the clouds'. In the rain it
 * darkens and gets a sheen, and puddles open up in organic patches (clear water: the ground shows
 * through, with a faint grey sheen of sky, rippling while it rains), then shrink back as it dries.
 */
/** The surfaces outside: the lawn, and the stone path, the pavement and the road through it. */
export type Surface = 'grass' | 'stone' | 'brick' | 'concrete' | 'asphalt' | 'plain';

interface GroundDef {
  /** Which scanned photo set it uses (none: the plain table), and a tint over it (asphalt is darkened concrete). */
  photo?: 'grass' | 'stone' | 'brick' | 'concrete';
  tint?: string;
  /** Metres one photo covers. */
  tile: number;
  normal: number;
  roughness: number;
  /** How much the broad light/dark patches vary (hides the tiling from above). */
  patches: number;
  /** How much darker it gets soaked (sand and soil drink water; concrete less). */
  soak: number;
  /** How much the land rolls: gentle rises and hollows, shaded by the sun (a lawn, not a road). */
  relief: number;
}
const DEFS: Record<Surface, GroundDef> = {
  grass: { photo: 'grass', tile: 4, normal: 1.6, roughness: 0.97, patches: 0.2, soak: 0.32, relief: 1 },
  stone: { photo: 'stone', tile: 2.2, normal: 1.3, roughness: 0.88, patches: 0.06, soak: 0.35, relief: 0.3 },
  // The path to the door: brick pavers (normal and occlusion made from the scan's height map).
  brick: { photo: 'brick', tile: 2, normal: 1, roughness: 0.86, patches: 0.05, soak: 0.4, relief: 0.1 },
  concrete: { photo: 'concrete', tile: 3, normal: 0.8, roughness: 0.82, patches: 0.06, soak: 0.38, relief: 0.1 },
  asphalt: { photo: 'concrete', tint: '#77787a', tile: 5, normal: 1.2, roughness: 0.9, patches: 0.1, soak: 0.45, relief: 0.15 },
  // «Por defecto»: the table the model stands on, the backdrop's own colour. No grass, but the
  // weather still shows on it: the clouds' shade, the wet, the puddles.
  plain: { tile: 4, normal: 0, roughness: 0.9, patches: 0, soak: 0.3, relief: 0 },
};

/** The table's colour follows the backdrop (day, dusk, night), a little darker as it's lit. */
const plainColor = new THREE.Color('#d8d8d8');
const PLAIN_SHADE = 0.55;
export function setPlainColor(backdrop: THREE.Color): void {
  plainColor.copy(backdrop).multiplyScalar(PLAIN_SHADE);
}
/** Metres out from the walls that stay solid, then a long, gentle fade until FADE. */
const SOLID = 12;
export const FADE = 44;

const box = new THREE.Vector4();
/** x: how wet (0–1); y: how far puddles have spread (0–1); z: time (s); w: rain falling now (0–1). */
const wet = { value: new THREE.Vector4() };

export function setGroundWeather(wetness: number, puddles: number, time: number, rain: number): void {
  wet.value.set(wetness, puddles, time, rain);
}

/**
 * How low the ground lies here (0–1, about evenly spread): broad hollows, smaller dips in them,
 * and a ragged fringe. The land's relief, and where the water gathers first.
 */
const LOW = /* glsl */ `
float lowAt( vec2 p ) {
  return texture( uNoise, p / 23.0 ).r * 0.62 + texture( uNoise, p / 6.7 + 0.31 ).r * 0.26 + texture( uNoise, p / 2.3 + 0.67 ).r * 0.12;
}
`;

/** Rings spreading from raindrops landing in a puddle: the slope they give the water (xz). */
const RIPPLES = /* glsl */ `
vec2 ripples( vec2 p, float t ) {
  vec2 g = vec2( 0.0 );
  for ( int k = 0; k < 3; k ++ ) {
    float fk = float( k );
    vec2 q = p * ( 2.6 + fk * 0.9 ) + fk * 7.31;
    vec2 id = floor( q );
    vec2 h = fract( sin( vec2( dot( id, vec2( 127.1, 311.7 ) ), dot( id, vec2( 269.5, 183.3 ) ) ) ) * 43758.5453 );
    float life = fract( t * ( 0.7 + 0.25 * fk ) + h.x );
    vec2 d = fract( q ) - 0.5 - ( h - 0.5 ) * 0.5;
    float r = length( d );
    float ring = exp( -pow( ( r - life * 0.45 ) * 22.0, 2.0 ) ) * ( 1.0 - life );
    g += d / max( r, 1e-3 ) * ring * sin( ( r - life * 0.45 ) * 60.0 );
  }
  return g;
}
`;
const materials = new Map<Surface, THREE.MeshStandardMaterial>();

function map(kind: NonNullable<GroundDef['photo']>, file: string, srgb = false): THREE.Texture {
  const t = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/ground/${kind}/${file}.jpg`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** One surface's material, shared by every piece of it (fade, wet ground and puddles included). */
export function surfaceMaterial(kind: Surface): THREE.MeshStandardMaterial {
  let m = materials.get(kind);
  if (m) return m;
  const d = DEFS[kind];
  m = new THREE.MeshStandardMaterial({
    ...(d.photo && {
      map: map(d.photo, 'color', true),
      normalMap: map(d.photo, 'normal'),
      normalScale: new THREE.Vector2(d.normal, d.normal),
      aoMap: map(d.photo, 'ao'),
    }),
    color: d.tint ?? '#ffffff',
    roughness: d.roughness,
    metalness: 0,
    transparent: true,
    depthWrite: false,
  });
  // Kept across rebuilds of the rooms (only the plane under them changes).
  m.userData.shared = true;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBox = { value: box };
    sh.uniforms.uWet = wet;
    sh.uniforms.uNoise = { value: noiseTexture };
    sh.vertexShader = `varying vec2 vGround;\n${sh.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n vGround = (modelMatrix * vec4(transformed, 1.0)).xz;',
    )}`;
    sh.fragmentShader = `uniform vec4 uBox;\nuniform vec4 uWet;\nuniform sampler2D uNoise;\nvarying vec2 vGround;\n${LOW}\n${RIPPLES}\n${sh.fragmentShader
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         float low = lowAt( vGround );
         vec2 lowSlope = vec2( lowAt( vGround + vec2( 0.3, 0.0 ) ) - low, lowAt( vGround + vec2( 0.0, 0.3 ) ) - low ) / 0.3;
         // Hollows a little darker (shade, lusher grass), rises a little lighter.
         diffuseColor.rgb *= 1.0 - ${(0.3 * d.relief).toFixed(2)} * ( low - 0.5 );
         // Puddles: water fills the deepest hollows first, then spreads up their sides until they
         // run into each other; in a storm nearly everything is under water.
         float edge = 1.0 - 0.72 * pow( uWet.y, 1.25 );
         float puddle = uWet.y > 0.01 ? smoothstep( edge, edge + 0.03, low ) : 0.0;
         // A damp rim round each puddle, then the soaked ground.
         float damp = max( uWet.x, smoothstep( edge - 0.06, edge, low ) * uWet.y );
         diffuseColor.rgb *= 1.0 - damp * ${d.soak.toFixed(2)};
         // Clear water over the ground: the ground still shows through, only a little darker.
         diffuseColor.rgb *= 1.0 - 0.28 * puddle;
         // Broad patches (the same photo blown up, compared with itself so it averages out).
         #ifdef USE_MAP
           float patchy = texture(map, vGround / 53.0).g - texture(map, vGround / 19.0 + 0.37).g;
           diffuseColor.rgb *= 1.0 + clamp(patchy * 5.0, -1.0, 1.0) * ${d.patches.toFixed(2)};
         #endif`,
      )
      .replace(
        '#include <alphamap_fragment>',
        `#include <alphamap_fragment>
         // How far outside the building's footprint, round the corners.
         vec2 out2 = max(max(uBox.xz - vGround, vGround - uBox.yw), 0.0);
         float fade = smoothstep(${SOLID.toFixed(1)}, ${FADE.toFixed(1)}, length(out2));
         diffuseColor.a *= 1.0 - fade * fade;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         // Wet ground has a sheen; a puddle is a mirror.
         roughnessFactor = mix( roughnessFactor, 0.42, damp * 0.8 );
         roughnessFactor = mix( roughnessFactor, 0.03, puddle );`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
         // What a puddle mirrors is the sky's brightness, not its blue: a grey sheen over the ground you see through it.
         float skyLum = dot( reflectedLight.indirectSpecular, vec3( 0.2126, 0.7152, 0.0722 ) );
         reflectedLight.indirectSpecular = mix( reflectedLight.indirectSpecular, vec3( skyLum ), puddle * 0.8 ) * ( 1.0 + 0.6 * puddle );`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         // Water lies flat over the bumps, and rings spread where the drops land.
         // The roll of the land (hollows are where it's low), then water lying flat over it all.
         normal = normalize( normal + mat3( viewMatrix ) * vec3( lowSlope.x, 0.0, lowSlope.y ) * ${(2.2 * d.relief).toFixed(2)} );
         normal = normalize( mix( normal, nonPerturbedNormal, puddle * 0.92 ) );
         vec2 rip = ripples( vGround, uWet.z ) * uWet.w * puddle;
         normal = normalize( normal + mat3( viewMatrix ) * vec3( rip.x, 0.0, rip.y ) * 0.5 );`,
      )}`;
  };
  m.customProgramCacheKey = () => `ground-${kind}`;
  // The table takes the backdrop's colour as it changes.
  if (kind === 'plain') m.color = plainColor;
  materials.set(kind, m);
  return m;
}

/**
 * Let a material out in the weather get wet with the ground: as it rains it darkens a little and
 * takes a sheen (`gloss`: how smooth it gets when soaked; varnished wood and metal shine, leaves
 * less), mostly on the faces that look up at the sky, and dries off as slowly as the ground.
 */
export function wetten(m: THREE.Material, gloss = 0.2, darken = 0.25): THREE.Material {
  if (m.userData.wet) return m;
  m.userData.wet = true;
  const before = m.onBeforeCompile.bind(m);
  const key = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh, r) => {
    before(sh, r);
    sh.uniforms.uWet = wet;
    sh.vertexShader = `varying float vUpness;\n${sh.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
      vec3 wetN = objectNormal;
      #ifdef USE_INSTANCING
        wetN = mat3( instanceMatrix ) * wetN;
      #endif
      vUpness = normalize( mat3( modelMatrix ) * wetN ).y;`,
    )}`;
    sh.fragmentShader = `uniform vec4 uWet;\nvarying float vUpness;\n${sh.fragmentShader
      .replace(
        '#include <alphamap_fragment>',
        `// Rain lands on what faces the sky; the sides only run wet.
        float soaked = uWet.x * ( 0.45 + 0.55 * smoothstep( -0.2, 0.7, vUpness ) );
        diffuseColor.rgb *= 1.0 - ${darken.toFixed(2)} * soaked;
        #include <alphamap_fragment>`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix( roughnessFactor, ${gloss.toFixed(2)}, soaked );`,
      )}`;
  };
  m.customProgramCacheKey = () => `${key()}|wet${gloss}`;
  m.needsUpdate = true;
  return m;
}

/**
 * Make any material melt into the backdrop the way the ground does (lamps, road markings…).
 * Transparent from then on; keeps whatever else the material does to its shader.
 */
export function fadeOut(m: THREE.Material): THREE.Material {
  const before = m.onBeforeCompile.bind(m);
  const key = m.customProgramCacheKey.bind(m);
  m.transparent = true;
  m.onBeforeCompile = (sh, r) => {
    before(sh, r);
    sh.uniforms.uBox = { value: box };
    sh.vertexShader = `varying vec2 vFadeAt;\n${sh.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vec4 fadeW = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        fadeW = instanceMatrix * fadeW;
      #endif
      vFadeAt = ( modelMatrix * fadeW ).xz;`,
    )}`;
    sh.fragmentShader = `uniform vec4 uBox;\nvarying vec2 vFadeAt;\n${sh.fragmentShader.replace(
      '#include <alphamap_fragment>',
      `#include <alphamap_fragment>
      vec2 fadeOut2 = max( max( uBox.xz - vFadeAt, vFadeAt - uBox.yw ), 0.0 );
      float fadeK = smoothstep( ${SOLID.toFixed(1)}, ${FADE.toFixed(1)}, length( fadeOut2 ) );
      diffuseColor.a *= 1.0 - fadeK * fadeK;`,
    )}`;
  };
  m.customProgramCacheKey = () => `${key()}|fade`;
  return m;
}

/** Metres per photo for a surface, for meshes that lay out their own UVs. */
export const surfaceTile = (kind: Surface) => DEFS[kind].tile;

/** A plane of grass under the building's footprint, reaching out to where it has faded. */
export function groundMesh(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, surface: 'grass' | 'plain' = 'grass'): THREE.Mesh {
  box.set(bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ);
  const tile = DEFS.grass.tile;
  const x0 = bounds.minX - FADE;
  const z0 = bounds.minZ - FADE;
  const w = bounds.maxX - bounds.minX + FADE * 2;
  const d = bounds.maxZ - bounds.minZ + FADE * 2;
  const geo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x0 + w / 2, 0, z0 + d / 2);
  // UVs in world metres, one photo every `tile` metres.
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / tile, -pos.getZ(i) / tile);
  const mesh = new THREE.Mesh(geo, surfaceMaterial(surface));
  // Just under the ground level people walk on (the slab's underside), below the painted shadow.
  mesh.position.y = -WALL_T - 0.012;
  mesh.renderOrder = -3;
  mesh.receiveShadow = true;
  return mesh;
}
