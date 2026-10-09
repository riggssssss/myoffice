import * as THREE from 'three';
import { WALL_T } from '../sim/layout';
import { noiseTexture } from './clouds';
import { mirrorUniforms } from './puddleMirror';

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
  plain: { tile: 4, normal: 0, roughness: 1, patches: 0, soak: 0.3, relief: 0 },
};

/** The table's colour follows the backdrop (day, dusk, night), a little darker as it's lit. */
const plainColor = new THREE.Color('#d8d8d8');
const PLAIN_SHADE = 0.55;
/** Lowest reflectance of the plain table (linear): a mid-dark grey, like real ground. */
const PLAIN_MIN = 0.16;
export function setPlainColor(backdrop: THREE.Color): void {
  // Mostly grey, only a hint of the backdrop's hue: the night's blue comes from the light on it,
  // so the rooms' warm light falling out of the windows shows warm, as it would on real ground.
  // Never darker than a real grey surface (about 16 % reflectance): at night it looks dark because
  // little light reaches it, not because it's black, so the rooms' light falling out shows on it.
  const l = backdrop.r * 0.2126 + backdrop.g * 0.7152 + backdrop.b * 0.0722;
  const k = Math.max(l * PLAIN_SHADE, PLAIN_MIN);
  plainColor.setRGB(1, 1, 1).lerp(l > 0 ? backdrop.clone().multiplyScalar(1 / Math.max(l, 1e-4)) : plainColor, 0.15).multiplyScalar(k);
}
/** Metres out from the walls that stay solid, then a long, gentle fade until FADE. */
const SOLID = 12;
export const FADE = 44;

const box = new THREE.Vector4();
/** x: how wet (0–1); y: how far puddles have spread (0–1); z: time (s); w: rain falling now (0–1). */
const wet = { value: new THREE.Vector4() };

/**
 * The rooms' own light getting out: rgb its colour, w how strong (0 with the lights off). It
 * leaves only through openings (windows, and walls dropped out of the view's way), each a lit
 * upright rectangle; see setRoomOpenings.
 */
const glow = { value: new THREE.Vector4(1, 0.85, 0.65, 0) };
export function setGroundGlow(color: THREE.Color, k: number): void {
  glow.value.set(color.r, color.g, color.b, k);
}

/** A lit opening in an outside wall: from (x0, z0) to (x1, z1) along it, y0 up to y1, `out` the way it faces. */
export interface Opening {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  y1: number;
  out: { x: number; z: number };
}
const MAX_OPENINGS = 24;
const openA = { value: Array.from({ length: MAX_OPENINGS }, () => new THREE.Vector4()) };
const openB = { value: Array.from({ length: MAX_OPENINGS }, () => new THREE.Vector4()) };
const openN = { value: 0 };
export function setRoomOpenings(list: readonly Opening[]): void {
  const n = Math.min(list.length, MAX_OPENINGS);
  for (let i = 0; i < n; i++) {
    const o = list[i];
    openA.value[i].set(o.x0, o.z0, o.x1, o.z1);
    // Which side of the run (its left, seen from x0 → x1) is outside.
    const left = -(o.z1 - o.z0) * o.out.x + (o.x1 - o.x0) * o.out.z;
    openB.value[i].set(o.y0, o.y1, 0, Math.sign(left) || 1);
  }
  openN.value = n;
}

/** Height of the ground plane: just under the level people walk on outside (the slab's underside), below the painted shadow. */
export const GROUND_Y = -WALL_T - 0.012;

/** How strong the plain table's dry sheen is (0–1): faint under a bright sun, full under grey skies and at night. */
const sheenK = { value: 1 };
export function setGroundSheen(k: number): void {
  sheenK.value = k;
}

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

/**
 * Rings spreading from raindrops landing in a puddle: the slope they give the water (xz). Each
 * ring is one smooth swell (the slope of a soft bump), a few centimetres wide: finer ripples are
 * smaller than a pixel from up here and only sparkle. Zoomed far out they fade away for the same reason.
 */
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
    float x = ( r - life * 0.45 ) * 12.0;
    float ring = -x * exp( -x * x ) * ( 1.0 - life );
    g += d / max( r, 1e-3 ) * ring;
  }
  return g * ( 1.0 - smoothstep( 0.012, 0.03, length( fwidth( p ) ) ) );
}
`;
/**
 * The ceiling lights are inside, behind walls (point lights cast no shadows here): outdoors they
 * would only shine through the walls, as hot spots mirrored in the puddles. Outside materials
 * skip them, which also spares every leaf and blade of the garden their cost. (A macro, not the
 * light count: three writes the counts into the source after this.)
 */
const NO_ROOM_LIGHTS = `#define getPointLightInfo( l, p, d ) d.color = vec3( 0.0 ); d.direction = vec3( 0.0, 1.0, 0.0 ); d.visible = false
#include <lights_fragment_begin>
#undef getPointLightInfo`;

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
    sh.uniforms.uGlow = glow;
    sh.uniforms.uOpenA = openA;
    sh.uniforms.uOpenB = openB;
    sh.uniforms.uOpenN = openN;
    sh.uniforms.uSheen = sheenK;
    Object.assign(sh.uniforms, mirrorUniforms);
    sh.uniforms.uNoise = { value: noiseTexture };
    sh.vertexShader = `varying vec2 vGround;\n${sh.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n vGround = (modelMatrix * vec4(transformed, 1.0)).xz;',
    )}`;
    sh.fragmentShader = `uniform vec4 uBox;\nuniform vec4 uWet;\nuniform vec4 uGlow;\nuniform vec4 uOpenA[${MAX_OPENINGS}];\nuniform vec4 uOpenB[${MAX_OPENINGS}];\nuniform int uOpenN;\nuniform float uSheen;\nuniform sampler2D uMirror;\nuniform sampler2D uMirrorHeight;\nuniform mat4 uMirrorMatrix;\nuniform float uMirrorOn;\nuniform sampler2D uNoise;\nvarying vec2 vGround;\n${LOW}\n${RIPPLES}\n${sh.fragmentShader
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
         roughnessFactor = mix( roughnessFactor, 0.07, puddle );`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
         // What a puddle mirrors is the sky's brightness, not its blue: a grey sheen over the ground you see through it.
         float skyLum = dot( reflectedLight.indirectSpecular, vec3( 0.2126, 0.7152, 0.0722 ) );
         reflectedLight.indirectSpecular = mix( reflectedLight.indirectSpecular, vec3( skyLum ), puddle * 0.8 ) * ( 1.0 + 0.6 * puddle );
         // The puddles mirror the office (see puddleMirror.ts), broken up by the rings; nothing
         // where there's no water.
         // The plain table has a faint satin sheen of its own, wet or dry.
         float sheen = ${kind === 'plain' ? '1.0' : '0.0'} * ( 1.0 - puddle ) * uSheen;
         // Mirror texels per metre of ground here (more zoomed in, fewer zoomed out), so the blur
         // is a real size on the ground and the image keeps its detail at any zoom. Worked out
         // before the branch: derivatives need every pixel around to run them.
         vec4 mp = uMirrorMatrix * vec4( vGround.x, ${GROUND_Y.toFixed(3)}, vGround.y, 1.0 );
         vec2 muv0 = mp.xy / mp.w;
         float texPerM = length( fwidth( muv0 ) ) / max( length( fwidth( vGround ) ), 1e-4 ) * float( textureSize( uMirror, 0 ).x );
         if ( uMirrorOn > 0.5 && puddle + sheen > 0.01 ) {
           vec2 muv = muv0 + rip * 0.05;
           // How high above the water the mirrored point is: right at the water it's sharp, the
           // higher up the blurrier (the ripples and the water's own murk spread it out more).
           // How wide the blur is on the ground, in metres: still water keeps what stands in it
           // nearly sharp, the satin table a little softer, and both spread it more the higher up.
           float blurBase = mix( 0.05, 0.004, puddle );
           float blurPerM = mix( 0.18, 0.07, puddle );
           // The height is the average over the area this pixel will blur, not just under it, so
           // a pixel just outside an object still knows to blur by that object's height and the
           // blur spreads out past the outline. First a rough guess at that area (a wide average),
           // then the average over it. Empty ground in it doesn't count.
           vec2 hc = textureLod( uMirrorHeight, muv, 4.0 ).rg;
           float above = hc.g > 0.001 ? hc.r / hc.g : 0.0;
           float guess = max( ( blurBase + above * blurPerM ) * texPerM, 0.5 );
           // (The heights are at half the image's resolution: half as many texels across.)
           hc = textureLod( uMirrorHeight, muv, clamp( log2( guess * 0.5 ), 0.0, 6.0 ) ).rg;
           above = hc.g > 0.001 ? hc.r / hc.g : 0.0;
           float blurM = blurBase + above * blurPerM;
           // A real blur, not one coarse mip level (magnified, that shows as squares): eight
           // taps over a disc that wide, each reading a level only a fraction of it, the disc
           // turned per pixel so no pattern shows. Stretched downwards as reflections on wet
           // ground are, more on the satin table than in still water.
           float rTex = max( blurM * texPerM, 0.5 );
           float tapLod = clamp( log2( rTex / 2.5 ), 0.0, 6.0 );
           vec2 texel = 1.0 / vec2( textureSize( uMirror, 0 ) );
           vec2 stretch = vec2( 1.0, mix( 1.8, 1.35, puddle ) );
           float spin = 6.2831853 * fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
           vec4 mirrored = vec4( 0.0 );
           float wsum = 0.0;
           for ( int i = 0; i < 8; i ++ ) {
             float fi = float( i );
             float r = sqrt( ( fi + 0.5 ) / 8.0 );
             float a = spin + fi * 2.3999632;
             float wt = 1.0 - 0.6 * r;
             mirrored += textureLod( uMirror, muv + vec2( cos( a ), sin( a ) ) * stretch * r * rTex * texel, tapLod ) * wt;
             wsum += wt;
           }
           mirrored /= wsum;
           // Strongest at a slant (Fresnel) and for what's close to the surface: things standing on
           // it mirror clearly, what's higher up fades out as well as blurring.
           float facing = saturate( dot( normal, normalize( vViewPosition ) ) );
           float fres = pow( 1.0 - facing, 5.0 );
           float near = exp( -above * 0.5 );
           // The plain table is matte: only a faint hint of what stands on it.
           float k = puddle * ( 0.6 + 3.0 * fres ) + sheen * ( 0.015 + 0.06 * fres );
           // What it mirrors takes the place of the sheen there, and of some of the ground seen
           // through it, as on real water (adding it on top would only wash the ground out).
           float w = clamp( k * near, 0.0, 0.9 ) * mirrored.a;
           reflectedLight.indirectSpecular = mix( reflectedLight.indirectSpecular, mirrored.rgb / max( mirrored.a, 1e-3 ), w );
           reflectedLight.indirectDiffuse *= 1.0 - 0.5 * w;
           reflectedLight.directDiffuse *= 1.0 - 0.5 * w;
         }`,
      )
      .replace('#include <lights_fragment_begin>', NO_ROOM_LIGHTS)
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         // Water lies flat over the bumps, and rings spread where the drops land.
         // The roll of the land (hollows are where it's low), then water lying flat over it all.
         normal = normalize( normal + mat3( viewMatrix ) * vec3( lowSlope.x, 0.0, lowSlope.y ) * ${(2.2 * d.relief).toFixed(2)} );
         normal = normalize( mix( normal, nonPerturbedNormal, puddle * 0.92 ) );
         vec2 rip = ripples( vGround, uWet.z ) * uWet.w * puddle;
         normal = normalize( normal + mat3( viewMatrix ) * vec3( rip.x, 0.0, rip.y ) * 0.9 );`,
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
      )
      .replace('#include <lights_fragment_begin>', NO_ROOM_LIGHTS)}`;
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
  mesh.position.y = GROUND_Y;
  mesh.renderOrder = -3;
  mesh.receiveShadow = true;
  return mesh;
}
