import type { NextConfig } from "next";

// basePath sous lequel le cockpit V4 est servi (ex '/cockpit' derrière Traefik,
// tout le reste du domaine = V3 FastAPI). Vide par défaut → build standalone racine.
// Piloté par NEXT_PUBLIC_BASE_PATH pour rester une source unique (cf. src/lib/api.ts).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig: NextConfig = {
  output: 'standalone',
  // On n'injecte basePath que s'il est défini : Next refuse une chaîne vide.
  ...(basePath ? { basePath } : {}),
  transpilePackages: ['maplibre-gl'],
  typescript: {
    // Le front lean doit compiler proprement : plus d'ignore des erreurs.
    ignoreBuildErrors: false,
  },
  images: {
    // Restreint aux hôtes réellement utilisés (proxy interne + imagerie satellite).
    remotePatterns: [
      { protocol: 'https', hostname: 'server.arcgisonline.com' },
      { protocol: 'https', hostname: '*.cartocdn.com' },
    ],
  },
  async headers() {
    // CSP durcie : plus de 'unsafe-eval'. On garde 'unsafe-inline' (styles + popups
    // MapLibre injectent du HTML/style inline), et connect-src pour les appels
    // sortants (backend FastAPI FR, tuiles, reverse-geocode Nominatim).
    const csp = [
      "default-src 'self'",
      // cdn.jsdelivr.net : vis-network, utilisé par la landing V3 reproduite (graphe).
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "worker-src 'self' blob:",
      // connect-src : backend FastAPI FR (même domaine 'self' en prod via Traefik,
      // ou NEXT_PUBLIC_API_BASE en https), tuiles + reverse-geocode (https),
      // et localhost/127.0.0.1 pour le dev avec backend séparé en http.
      "connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:*",
      "frame-ancestors 'self'",
    ].join('; ');

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
        ],
      },
    ];
  },
};

export default nextConfig;
