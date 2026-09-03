import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
/*
 * Where the API lives.
 *
 * Defaults to this machine. Point it at somebody else's with
 * `VITE_API_TARGET=http://192.168.1.42:4000 npm run dev:client` — that is how a
 * second person joins a real room rather than a private copy of the database.
 */
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:4000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Hero models in src/assets/models/ are emitted as hashed asset URLs.
  assetsInclude: ['**/*.glb'],
  server: {
    /*
     * Reachable from other machines, not just this one.
     *
     * Two people on one room means two browsers pointed at ONE server. The
     * other machine loads the app from here, so this has to answer on the LAN
     * rather than only on the loopback address.
     */
    host: true,
    /*
     * Hosts allowed to reach the dev server.
     *
     * Vite rejects unknown Host headers as DNS-rebinding protection, which is
     * what makes a tunnel URL return "Blocked request" instead of the app.
     * These are the tunnel providers; a named domain can be added the same way.
     */
    allowedHosts: [
      '.ngrok-free.app',
      '.ngrok-free.dev',
      '.ngrok.app',
      '.ngrok.io',
      '.trycloudflare.com',
      '.loca.lt',
    ],
    /*
     * The API and the socket are served same-origin through this proxy, which
     * is what lets the session cookie work without any CORS config.
     * `ws: true` is required — without it the Socket.IO upgrade never lands.
     */
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/socket.io': { target: apiTarget, ws: true, changeOrigin: true },
      /* Uploaded room videos are served by the API, not by Vite. */
      '/uploads': { target: apiTarget, changeOrigin: true },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
