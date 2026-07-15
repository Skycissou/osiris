import type { NextConfig } from "next";

// ── Émancipation V4 (13/07) ────────────────────────────────────────────────
// On N'UTILISE PLUS le `basePath` natif de Next : il préfixait TOUT (assets _next,
// racine incluse), ce qui empêchait de servir l'accueil à la racine `/`. À la place,
// les routes du cockpit vivent physiquement sous `src/app/cockpit/*` → servies à
// `/cockpit/*` par le routage de fichiers, SANS toucher aux assets ni à la racine.
//
// NEXT_PUBLIC_BASE_PATH (= '/cockpit') reste défini : il sert UNIQUEMENT à préfixer
// les fetch API côté client (cf. src/lib/api.ts → BASE_PATH). Les URLs `/cockpit/*`
// restent donc INCHANGÉES (n8n, liens externes intacts). Ne PAS le confondre avec le
// basePath natif : ici il ne pilote plus la config Next.

const nextConfig: NextConfig = {
  output: 'standalone',
  // Racine `/` = accueil V4 : on sert la landing (statics V3 reproduits à l'identique,
  // public/landing/) via un rewrite interne (URL reste `/`, pas de redirection visible).
  async rewrites() {
    return [{ source: '/', destination: '/landing/index.html' }];
  },
  // Anciennes URLs du temps du basePath (`/cockpit/landing/...`) → racine `/` (301).
  async redirects() {
    return [{ source: '/cockpit/landing/:path*', destination: '/', permanent: true }];
  },
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
      // cdn.jsdelivr.net : vis-network (graphe) · unpkg.com : maplibre-gl (carte IGN
      // intégrée à l'accueil « Chercher », version riche restaurée V4.087).
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "worker-src 'self' blob:",
      // connect-src : backend FastAPI FR (même domaine 'self' en prod via Traefik,
      // ou NEXT_PUBLIC_API_BASE en https), tuiles + reverse-geocode (https),
      // et localhost/127.0.0.1 pour le dev avec backend séparé en http.
      "connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:*",
      // frame-src : lecteur de webcams PUBLIQUES Windy (couche cctv forme 2, embed
      //  iframe du lecteur in-app). Domaines d'embed officiels Windy uniquement.
      "frame-src 'self' https://webcams.windy.com https://www.windy.com",
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
