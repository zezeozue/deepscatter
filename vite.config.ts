import glslify from 'rollup-plugin-glslify';
import { svelte } from '@sveltejs/vite-plugin-svelte';

import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const plugins = [
    glslify({ compress: false }), // for debugging
    ...svelte(),  // Always include Svelte plugin, not just in development
  ];

  return {
    build: {
      target: 'es2019',
      minify: 'terser',
      lib: {
        entry: __dirname + '/src/deepscatter.ts',
        name: 'Deepscatter',
        formats: ['es', 'umd'],
        
      },
      rollupOptions: {
       input: {
         main: __dirname + '/index.html',
         refactored: __dirname + '/dev/refactored/index.html'
       },
        // make sure to externalize deps that shouldn't be bundled
        // into your library
        external: ['svelte', 'apache-arrow'],
        output: {
          // Provide global variables to use in the UMD build
          // for externalized deps
          globals: {
            svelte: 'Svelte',
            'apache-arrow': 'Arrow'
          },
        },
      },
    },
    plugins
  }
})