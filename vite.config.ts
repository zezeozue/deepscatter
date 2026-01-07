import glslify from 'rollup-plugin-glslify';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, ViteDevServer } from 'vite';
import { PluginOption } from 'vite';
import express from './server.mjs';

// Plugin to serve tiles directory in dev mode using Express
const expressPlugin: PluginOption = {
  name: 'express-plugin',
  configureServer: async (server: ViteDevServer) => {
    server.middlewares.use(express as any);
  },
};

export default defineConfig(({ mode }) => ({
  plugins: [glslify({ compress: false }), ...svelte(), expressPlugin],
  server: {
    host: '0.0.0.0', // Listen on all interfaces
    port: 3345,
    // Enable HMR in dev mode for faster development
    hmr: mode === 'development',
    watch: mode === 'development' ? {} : null,
  },
  // Serve tiles directory as static assets
  publicDir: false, // Don't use default public dir
  build: {
    target: 'es2019',
    minify: 'terser',
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: __dirname + '/index.html',
        worker: __dirname + '/parser_worker.ts',
      },
      output: {
        entryFileNames: (chunkInfo) => {
          return chunkInfo.name === 'worker'
            ? 'parser_worker.js'
            : 'assets/[name]-[hash].js';
        },
      },
    },
  },
}));
