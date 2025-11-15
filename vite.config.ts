import glslify from 'rollup-plugin-glslify';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, ViteDevServer } from 'vite';
import express from './server.mjs';

import { PluginOption } from 'vite';

// Custom plugin to start Express server
const expressPlugin: PluginOption = {
  name: 'express-plugin',
  configureServer: async (server: ViteDevServer) => {
    server.middlewares.use(express as any);
  }
};

export default defineConfig(({ mode }) => {
  const plugins = [
    glslify({ compress: false }), // for debugging
    ...svelte(),  // Always include Svelte plugin, not just in development
    expressPlugin,
  ];

  // Use PORT environment variable if set (for Cloud Run), otherwise default to 3347
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3347;

  return {
    server: {
      host: true,
      port: port,
    },
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
         main: __dirname + '/index.html'
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
