/* ==========================================================================
   OpenOS · vite.config.js

   İki sayfa var ve ikisi de aynı depodan çıkıyor:
     /        tanıtım sitesi (index.html + site/)
     /os/     sistemin kendisi (os/index.html + src/ + styles/)

   `base: './'` bilerek: GitHub Pages depoyu alt yolda yayınlıyor
   (m3sto.github.io/openos/) ve kök-mutlak yollar orada 404 veriyor. Göreli
   taban her iki durumda da çalışıyor — özel alan adı bağlansa bile.

   Simgeler ve kılavuz artık çalışma zamanında elle kurulan yollarla değil,
   Vite'ın varlık boru hattıyla çözülüyor (`import.meta.glob`, `?raw`);
   böylece taban yolu hesabı tamamen ortadan kalkıyor ve dosyalar parmak
   iziyle önbelleklenebiliyor.
   ========================================================================== */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  plugins: [react()],

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        tanitim: resolve(process.cwd(), 'index.html'),
        os: resolve(process.cwd(), 'os/index.html'),
      },
      output: {
        /* Three.js tek başına ~600 KB: kendi parçasında dursun ki sistemin
           çekirdeği onu beklemeden çalışsın. React de ayrı, çünkü uygulama
           kodundan çok daha seyrek değişiyor ve önbellekte kalmalı. */
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/react')) return 'react';
          return undefined;
        },
      },
    },
  },

  server: {
    port: 8080,
    /* Kaynak dosyalar sunucudan geldiği gibi çalışsın: tarayıcı önbelleği
       bu projede daha önce "düzelttiğim hata hâlâ duruyor" sanrısına yol
       açmıştı (bkz. gözlem 0004). */
    headers: { 'Cache-Control': 'no-store' },
  },

  preview: { port: 8080 },
});
