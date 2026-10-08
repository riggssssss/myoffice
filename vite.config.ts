import { defineConfig } from 'vite';

/** The local server (server/index.ts). It accepts this dev server's port as a trusted origin. */
const API = `http://127.0.0.1:${process.env.OFICINA_PORT ?? 8787}`;

export default defineConfig({
  server: {
    host: 'localhost',
    port: Number(process.env.OFICINA_DEV_PORT ?? 5173),
    // A different port would no longer be a trusted origin for the server.
    strictPort: true,
    proxy: {
      '/api': { target: API },
      '/ws': { target: API, ws: true },
    },
  },
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
