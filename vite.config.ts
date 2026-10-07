import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    // Pre-bundle every three.js add-on up front. Otherwise Vite finds the model loaders
    // only once a model loads, re-bundles mid-session and answers 504 "Outdated Optimize Dep".
    include: [
      'three',
      'three/addons/controls/OrbitControls.js',
      'three/addons/geometries/RoundedBoxGeometry.js',
      'three/addons/libs/meshopt_decoder.module.js',
      'three/addons/loaders/GLTFLoader.js',
      'three/addons/renderers/CSS2DRenderer.js',
      'three/addons/utils/BufferGeometryUtils.js',
      'lucide',
    ],
  },
});
