import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Keep the two independently cacheable Three.js modules below the
          // esbuild IPC threshold for temporary-file transforms on Windows.
          if (id.endsWith('/three/build/three.core.js')) return 'three-core';
          if (id.endsWith('/three/build/three.module.js')) return 'three-webgl';
        },
      },
    },
  },
});
