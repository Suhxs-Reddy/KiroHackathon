import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';

// Copy static assets to dist after build
function copyStaticAssets() {
  return {
    name: 'copy-static-assets',
    closeBundle() {
      const dist = resolve(__dirname, 'dist');

      // Copy manifest.json
      copyFileSync(resolve(__dirname, 'manifest.json'), resolve(dist, 'manifest.json'));

      // Copy popup.html and options.html  
      copyFileSync(resolve(__dirname, 'public/popup.html'), resolve(dist, 'popup.html'));
      copyFileSync(resolve(__dirname, 'public/options.html'), resolve(dist, 'options.html'));

      // Copy popup.css
      if (existsSync(resolve(__dirname, 'public/popup.css'))) {
        copyFileSync(resolve(__dirname, 'public/popup.css'), resolve(dist, 'popup.css'));
      } else if (existsSync(resolve(__dirname, 'DataGuard/popup.css'))) {
        copyFileSync(resolve(__dirname, 'DataGuard/popup.css'), resolve(dist, 'popup.css'));
      }

      // Copy icons
      const iconsDir = resolve(dist, 'icons');
      if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });
      const srcIcons = resolve(__dirname, 'DataGuard/icons');
      if (existsSync(srcIcons)) {
        for (const file of readdirSync(srcIcons)) {
          copyFileSync(resolve(srcIcons, file), resolve(iconsDir, file));
        }
      }

      // Copy data directory (opt-out database, tracker domains)
      const dataDir = resolve(dist, 'data');
      if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
      const srcData = resolve(__dirname, 'DataGuard/data');
      if (existsSync(srcData)) {
        for (const file of readdirSync(srcData)) {
          copyFileSync(resolve(srcData, file), resolve(dataDir, file));
        }
      }

      console.log('[vite] Copied static assets to dist/');
    },
  };
}

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        content_script: resolve(__dirname, 'src/content_script.ts'),
        popup: resolve(__dirname, 'src/popup.ts'),
        options: resolve(__dirname, 'src/options.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        // Use ES format. The background service worker uses "type": "module".
        // Content scripts, popup, and options have no export statements so
        // they work as plain scripts even though the format is technically ES.
        format: 'es',
      },
      external: [],
    },
    target: 'es2020',
    minify: false,
  },
  plugins: [copyStaticAssets()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
  },
});
