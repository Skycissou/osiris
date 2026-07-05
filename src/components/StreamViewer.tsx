'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  StreamViewer.tsx — Lecteur de flux embarqué (OSIRIS V4 · cockpit)
//  Agent « Lecteur de flux » · V4
//
//  RÔLE
//  ────
//  Affiche EN DIRECT, à l'intérieur du cockpit, un flux vidéo public (webcam,
//  caméra de trafic, CCTV ouverte) sélectionné sur la carte — « tout à portée
//  dans l'app ». On ne se contente PAS d'un marqueur : on lit la vidéo ici.
//
//  Toutes les sources visées sont PUBLIQUES et l'affichage est soumis, en amont,
//  à un gating consentement / opt-in (usage défensif ARPD, données publiques).
//  Ce composant NE GÈRE PAS ce gating : il reçoit une `source` déjà autorisée.
//
//  CLEAN-ROOM : aucune ligne dérivée de la référence OSINT externe (AGPL). Écrit à partir de
//  la charte graphique OSIRIS V3/V4 et de la doc publique de hls.js.
//
//  TYPES DE FLUX SUPPORTÉS
//  ───────────────────────
//    • hls    — playlist `.m3u8` (le plus courant pour webcams/CCTV publiques).
//               Lecture native si le navigateur sait (Safari/iOS), sinon hls.js.
//    • video  — fichier progressif `.mp4` / `.webm` lu par <video src>.
//    • mjpeg  — Motion-JPEG (`.mjpg`/`.jpg`, flux de nombreuses IP-cams) : simple
//               balise <img> dont le src « stream » se rafraîchit tout seul.
//    • iframe — page d'embed tierce (fallback quand ce n'est pas un flux direct).
//  Détection AUTO du type à partir de l'URL quand `source.type` est absent.
//
//  DÉGRADATION DOUCE (obligation) : timeout de connexion (~10 s), capture de
//  toutes les erreurs (onError <video>/<img>/<iframe> + Hls.Events.ERROR) →
//  état FR « Flux indisponible » + bouton « Réessayer ». JAMAIS de crash de l'app.
//
//  NOTE CSP (IMPORTANT — à traiter côté configuration, hors de ce composant)
//  ────────────────────────────────────────────────────────────────────────
//  Les flux publics viennent de domaines TRÈS variés et imprévisibles. Si une
//  Content-Security-Policy stricte est en place (next.config / middleware /
//  en-tête serveur), elle BLOQUERA la lecture tant que les hôtes ne sont pas
//  autorisés. Il faut, selon le `type` :
//    • hls / video / mjpeg → `media-src` ET `connect-src` (hls.js télécharge les
//      segments via fetch/XHR ; le <img> mjpeg relève aussi de `img-src`).
//    • iframe               → `frame-src` (et éventuellement `child-src`).
//  En pratique, pour un cockpit qui agrège des sources inconnues, prévoir une
//  allowlist maintenable ou un proxy de flux côté serveur. À arbitrer par
//  l'équipe infra — ce composant ne peut pas relâcher la CSP tout seul.
//
//  INTÉGRATION (dans src/app/page.tsx)
//  ───────────────────────────────────
//    const [activeStream, setActiveStream] = useState<StreamSource | null>(null);
//    // Au clic sur une entité de couche `cctv` / webcam qui porte un `streamUrl` :
//    //   onEntityClick={(e) => {
//    //     if (e.streamUrl) setActiveStream({
//    //       label: e.name, streamUrl: e.streamUrl, lat: e.lat, lng: e.lng,
//    //     });
//    //   }}
//    // ... puis, à côté de <RegionDossierPanel> :
//    <AnimatePresence>
//      {activeStream && (
//        <StreamViewer
//          source={activeStream}
//          onClose={() => setActiveStream(null)}
//          onFlyTo={(lat, lng) => mapRef.current?.flyTo(lat, lng)}
//        />
//      )}
//    </AnimatePresence>
//  (AnimatePresence côté parent pour jouer l'animation `exit` au démontage.)
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  X,
  RefreshCw,
  Maximize2,
  Crosshair,
  Radio,
  Loader2,
  VideoOff,
} from 'lucide-react';
import Hls from 'hls.js';

// ── Types publics ────────────────────────────────────────────────────────────

/** Nature technique du flux. Absente → déduite de l'URL (voir `detecterType`). */
export type StreamType = 'hls' | 'video' | 'mjpeg' | 'iframe';

/** Source de flux passée au lecteur (déjà autorisée par le gating amont). */
export interface StreamSource {
  /** Libellé humain affiché en titre (nom de la caméra / du lieu). */
  label: string;
  /** URL du flux ou de la page d'embed. */
  streamUrl: string;
  /** Type explicite ; si omis, détection auto depuis l'URL. */
  type?: StreamType;
  /** Latitude (optionnelle) → active le bouton « centrer ». */
  lat?: number;
  /** Longitude (optionnelle) → active le bouton « centrer ». */
  lng?: number;
}

export interface StreamViewerProps {
  /** Flux à lire. */
  source: StreamSource;
  /** Ferme le lecteur (démonte le composant côté parent). */
  onClose: () => void;
  /** Optionnel : recentre la carte sur les coordonnées du flux. */
  onFlyTo?: (lat: number, lng: number) => void;
  isMobile?: boolean;
}

// ── Détection automatique du type de flux depuis l'URL ───────────────────────
//  Heuristique volontairement simple et défensive : on isole le chemin (sans
//  query-string ni ancre) pour ne pas se faire piéger par des `?token=...jpg`.
function detecterType(url: string): StreamType {
  let chemin = url;
  try {
    // `URL` peut échouer sur une URL relative/mal formée → on retombe sur la brute.
    chemin = new URL(url, 'http://x').pathname;
  } catch {
    chemin = url.split('?')[0].split('#')[0];
  }
  const bas = chemin.toLowerCase();

  if (bas.endsWith('.m3u8')) return 'hls';
  if (bas.endsWith('.mp4') || bas.endsWith('.webm') || bas.endsWith('.ogg')) return 'video';
  // Motion-JPEG : extensions image OU marqueurs classiques d'endpoint MJPEG.
  if (
    bas.endsWith('.mjpg') ||
    bas.endsWith('.mjpeg') ||
    bas.endsWith('.jpg') ||
    bas.endsWith('.jpeg') ||
    bas.includes('mjpg') ||
    bas.includes('mjpeg') ||
    bas.includes('cgi-bin') // ex. axis-cgi/mjpg/video.cgi (IP-cams courantes)
  ) {
    return 'mjpeg';
  }
  // Par défaut : on suppose une page d'embed → iframe.
  return 'iframe';
}

// Délai maximum d'attente avant de déclarer le flux indisponible (ms).
const TIMEOUT_CONNEXION_MS = 10_000;

// ── Composant ────────────────────────────────────────────────────────────────
function StreamViewer({ source, onClose, onFlyTo, isMobile }: StreamViewerProps) {
  const { label, streamUrl, lat, lng } = source;

  // Type effectif : explicite si fourni, sinon détecté depuis l'URL.
  const type = useMemo<StreamType>(
    () => source.type ?? detecterType(streamUrl),
    [source.type, streamUrl],
  );

  // Phase de lecture : chargement → prêt → erreur.
  const [phase, setPhase] = useState<'chargement' | 'pret' | 'erreur'>('chargement');
  // Compteur d'essais : incrémenté par « Réessayer » pour re-déclencher l'effet.
  const [essai, setEssai] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const conteneurRef = useRef<HTMLDivElement | null>(null);

  // Coordonnées formatées + disponibilité (pour le bouton « centrer »).
  const aCoords = typeof lat === 'number' && typeof lng === 'number';
  const coordsFmt = aCoords ? `${lat!.toFixed(4)}, ${lng!.toFixed(4)}` : null;

  // ── Réessayer : repasse en chargement et relance l'effet de setup. ──────────
  const reessayer = useCallback(() => {
    setPhase('chargement');
    setEssai((n) => n + 1);
  }, []);

  // ── Plein écran (API Fullscreen native, sur le conteneur vidéo). ────────────
  const pleinEcran = useCallback(() => {
    const el = conteneurRef.current;
    if (!el) return;
    // `requestFullscreen` peut ne pas exister / échouer → on ignore proprement.
    el.requestFullscreen?.().catch(() => {
      /* dégradation douce : pas de plein écran, on ne casse rien */
    });
  }, []);

  // ── Centrer la carte sur le flux (callback optionnel). ──────────────────────
  const centrer = useCallback(() => {
    if (aCoords && onFlyTo) onFlyTo(lat!, lng!);
  }, [aCoords, onFlyTo, lat, lng]);

  // ── Setup HLS / video (types basés sur <video>) ─────────────────────────────
  //  Les types `mjpeg` (<img>) et `iframe` gèrent leur chargement via leurs
  //  propres handlers onLoad/onError plus bas — cet effet ne les concerne pas.
  useEffect(() => {
    if (type !== 'hls' && type !== 'video') return;

    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | null = null;
    let annule = false;

    // Timeout global : si rien n'est prêt à temps → état « indisponible ».
    const minuteur = window.setTimeout(() => {
      if (!annule) setPhase('erreur');
    }, TIMEOUT_CONNEXION_MS);

    // Quand assez de données sont là pour lire → on passe en « prêt ».
    const onPret = () => {
      if (annule) return;
      window.clearTimeout(minuteur);
      setPhase('pret');
      // Lecture auto (muet pour respecter les politiques autoplay des navigateurs).
      video.play().catch(() => {
        /* autoplay refusé : la vidéo reste prête, l'utilisateur clique play */
      });
    };
    const onErreurVideo = () => {
      if (annule) return;
      window.clearTimeout(minuteur);
      setPhase('erreur');
    };

    video.addEventListener('loadeddata', onPret);
    video.addEventListener('error', onErreurVideo);

    if (type === 'video') {
      // Fichier progressif : lecture directe.
      video.src = streamUrl;
      video.load();
    } else {
      // type === 'hls'
      const supportNatif = video.canPlayType('application/vnd.apple.mpegurl');
      if (supportNatif) {
        // Safari / iOS : HLS natif, pas besoin de hls.js.
        video.src = streamUrl;
        video.load();
      } else if (Hls.isSupported()) {
        // Autres navigateurs : Media Source Extensions via hls.js.
        hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          // On ne réagit qu'aux erreurs FATALES (les non-fatales sont récupérées
          // en interne par hls.js — inutile d'afficher un état d'échec).
          if (data.fatal) {
            window.clearTimeout(minuteur);
            if (!annule) setPhase('erreur');
          }
        });
      } else {
        // Ni HLS natif, ni MSE (très rare) → on ne peut pas lire.
        window.clearTimeout(minuteur);
        setPhase('erreur');
      }
    }

    // ── Nettoyage : au démontage OU changement de source/type/essai. ──────────
    return () => {
      annule = true;
      window.clearTimeout(minuteur);
      video.removeEventListener('loadeddata', onPret);
      video.removeEventListener('error', onErreurVideo);
      if (hls) {
        hls.destroy(); // libère les buffers MSE + écouteurs internes
        hls = null;
      }
      // Réinitialise l'élément <video> pour couper tout téléchargement en cours.
      video.removeAttribute('src');
      try {
        video.load();
      } catch {
        /* ignore */
      }
    };
    // `essai` force la ré-exécution complète du setup lors d'un « Réessayer ».
  }, [type, streamUrl, essai]);

  // Handlers de chargement pour <img> (mjpeg) et <iframe>.
  const onChargeSimple = useCallback(() => setPhase('pret'), []);
  const onErreurSimple = useCallback(() => setPhase('erreur'), []);

  // Timeout pour les types non-<video> (mjpeg / iframe) : mêmes garanties.
  useEffect(() => {
    if (type !== 'mjpeg' && type !== 'iframe') return;
    const minuteur = window.setTimeout(() => {
      setPhase((p) => (p === 'chargement' ? 'erreur' : p));
    }, TIMEOUT_CONNEXION_MS);
    return () => window.clearTimeout(minuteur);
  }, [type, streamUrl, essai]);

  // ── Rendu de la zone média selon le type ────────────────────────────────────
  function zoneMedia() {
    // <video> partagé par hls + video.
    if (type === 'hls' || type === 'video') {
      return (
        <video
          ref={videoRef}
          className="w-full h-full object-contain bg-black"
          muted
          playsInline
          controls
          autoPlay
        />
      );
    }
    if (type === 'mjpeg') {
      return (
        // Motion-JPEG : le navigateur maintient le flux ouvert dans le <img>.
        // `key={essai}` force un rechargement réel du flux au « Réessayer ».
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={essai}
          src={streamUrl}
          alt={label}
          className="w-full h-full object-contain bg-black"
          onLoad={onChargeSimple}
          onError={onErreurSimple}
        />
      );
    }
    // iframe (page d'embed tierce).
    return (
      <iframe
        key={essai}
        src={streamUrl}
        title={label}
        className="w-full h-full bg-black"
        // Permissions minimales utiles à un lecteur vidéo embarqué.
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        // Bac à sable : on autorise scripts + same-origin (nécessaire à beaucoup
        // de players) mais rien d'autre (pas de popups, top-navigation, etc.).
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        onLoad={onChargeSimple}
        onError={onErreurSimple}
      />
    );
  }

  return (
    <motion.div
      // Apparition douce depuis la droite (charte V3, cf. RegionDossierPanel).
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 32 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="absolute z-[207] pointer-events-auto glass-panel border border-[var(--border-primary)] flex flex-col overflow-hidden"
      style={{
        top: isMobile ? 'auto' : '112px',
        bottom: isMobile ? '90px' : 'auto',
        right: isMobile ? '12px' : '16px',
        left: isMobile ? '12px' : 'auto',
        width: isMobile ? 'auto' : '420px',
      }}
    >
      {/* ── En-tête : label + badge DIRECT pulsant + fermer ── */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-[var(--border-primary)]">
        <div className="flex items-center gap-2 min-w-0">
          {/* Badge « DIRECT » pulsant (rouge = signal live). */}
          <span className="flex items-center gap-1 flex-shrink-0 text-[9px] font-mono font-bold uppercase tracking-widest text-[#e0736f]">
            <Radio className="w-3 h-3 animate-pulse" />
            Direct
          </span>
          <span
            className="text-[11px] font-mono uppercase tracking-wide text-[var(--accent)] truncate"
            title={label}
          >
            {label}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white transition-colors flex-shrink-0"
          title="Fermer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Zone vidéo 16:9 ── */}
      <div ref={conteneurRef} className="relative w-full bg-black" style={{ aspectRatio: '16 / 9' }}>
        {zoneMedia()}

        {/* État : chargement (placeholder + spinner par-dessus la zone média) */}
        {phase === 'chargement' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 backdrop-blur-sm">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--accent)]" />
            <span className="text-[11px] font-mono text-[var(--muted)]">Connexion au flux…</span>
          </div>
        )}

        {/* État : erreur (dégradation douce, jamais de crash) */}
        {phase === 'erreur' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 backdrop-blur-sm px-4 text-center">
            <VideoOff className="w-7 h-7 text-[#e0736f]" />
            <span className="text-[12px] font-mono text-[#e0736f]">Flux indisponible</span>
            <span className="text-[10px] font-mono text-[var(--faint)] max-w-[280px]">
              La source n&apos;a pas répondu ou n&apos;est pas lisible. Elle peut être hors ligne,
              protégée, ou bloquée par la politique de sécurité (CSP).
            </span>
            <button
              onClick={reessayer}
              className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] bg-[var(--accent-soft)] border border-[var(--accent-line)] rounded-md px-3 py-1.5 hover:brightness-110 transition"
            >
              <RefreshCw className="w-3 h-3" />
              Réessayer
            </button>
          </div>
        )}
      </div>

      {/* ── Barre de contrôles ── */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-[var(--border-primary)]">
        {/* Coordonnées (si dispo) → cliquables pour recentrer la carte. */}
        {coordsFmt ? (
          <button
            onClick={centrer}
            disabled={!onFlyTo}
            className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--accent-bright)] tabular-nums hover:text-white transition disabled:opacity-50 disabled:cursor-default"
            title={onFlyTo ? 'Centrer la carte sur ce flux' : 'Coordonnées du flux'}
          >
            <Crosshair className="w-3.5 h-3.5" />
            {coordsFmt}
          </button>
        ) : (
          <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--faint)]">
            {type}
          </span>
        )}

        {/* Actions : recharger + plein écran. */}
        <div className="flex items-center gap-1">
          <button
            onClick={reessayer}
            className="p-1.5 text-white/50 hover:text-[var(--accent)] transition"
            title="Recharger le flux"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={pleinEcran}
            className="p-1.5 text-white/50 hover:text-[var(--accent)] transition"
            title="Plein écran"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default memo(StreamViewer);
