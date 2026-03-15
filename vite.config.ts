import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "pwa-icon-192.png", "pwa-icon-512.png"],
      workbox: {
        navigateFallbackDenylist: [/^\/~oauth/],
        // Don't precache anything — always fetch fresh from network
        globPatterns: [],
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: null,
        runtimeCaching: [
          {
            // Supabase API — always network
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: "NetworkOnly",
          },
          {
            // JS/CSS — network first, fall back to cache for offline
            urlPattern: /\.(?:js|css)$/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "static-assets-v2",
              expiration: { maxEntries: 80, maxAgeSeconds: 30 * 60 },
              networkTimeoutSeconds: 3,
            },
          },
          {
            // Images — cache first (they rarely change)
            urlPattern: /\.(?:png|jpg|jpeg|svg|webp|ico)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "images-v2",
              expiration: { maxEntries: 50, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            // Fonts
            urlPattern: /\.(?:woff2?|ttf|otf)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "fonts-v2",
              expiration: { maxEntries: 10, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
      manifest: {
        name: "أداة تعريب Fire Emblem Engage",
        short_name: "تعريب FE",
        description: "أداة لتعريب ملفات لعبة Fire Emblem Engage تلقائياً",
        theme_color: "#0f2617",
        background_color: "#0f2617",
        display: "standalone",
        dir: "rtl",
        lang: "ar",
        orientation: "portrait",
        icons: [
          {
            src: "pwa-icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
