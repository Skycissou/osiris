'use client';

// ─────────────────────────────────────────────────────────────────────────
//  CockpitSidebar — barre de navigation FIGÉE du cockpit (clone de la .sidenav
//  de l'accueil). Extraite de page.tsx pour être FACILE À CORRIGER : tout se
//  règle dans les deux tableaux de config ci-dessous (NAV_LINKS + TOOLS), pas
//  besoin de fouiller le JSX.
//
//  ⚠️ Cissou : la sidebar côté cockpit n'est pas encore parfaite. Pour l'ajuster
//  → édite UNIQUEMENT `NAV_LINKS` (liens vers les onglets de l'accueil) et
//  `TOOLS` (outils qui ouvrent un panneau). Le style vit dans globals.css
//  (`.ck-sidenav`, `.ck-navlink`, etc.). Rien d'autre à toucher.
// ─────────────────────────────────────────────────────────────────────────

import { memo } from 'react';

/** Liens de navigation → onglets de l'accueil (racine du domaine, hors basePath).
 *  `active: true` = page courante (le cockpit). Édite librement cette liste. */
const NAV_LINKS: { label: string; href?: string; active?: boolean }[] = [
  { label: 'Accueil', href: '/' },
  { label: 'Chercher', href: '/#chercher' },
  { label: 'Cockpit carte', active: true },
  { label: 'Sources', href: '/#sources' },
  { label: 'Recettes', href: '/#recettes' },
  { label: 'Prototype', href: '/#prototype' },
  { label: 'Garde-fous', href: '/#rgpd' },
];

export interface CockpitSidebarProps {
  /** Version affichée dans le badge de marque (ex. 'V4.011-dev'). */
  version: string;
  /** Ouvre le module « Clés API ». */
  onOpenKeys?: () => void;
  /** Ouvre la boîte à outils OSINT. */
  onOpenOsint?: () => void;
  /** Ouvre le graphe d'entités. */
  onOpenGraph?: () => void;
  /** Ouvre le fil d'actualité (News). */
  onOpenNews?: () => void;
}

function CockpitSidebar({ version, onOpenKeys, onOpenOsint, onOpenGraph, onOpenNews }: CockpitSidebarProps) {
  /** Outils du cockpit (ouvrent un panneau). Édite librement : label + action. */
  const TOOLS: { label: string; onClick?: () => void }[] = [
    { label: '🔍 OSINT', onClick: onOpenOsint },
    { label: '🕸️ Graphe', onClick: onOpenGraph },
    { label: '📰 News', onClick: onOpenNews },
    { label: '🔑 Clés API', onClick: onOpenKeys },
  ];

  return (
    <nav className="ck-sidenav">
      <div className="ck-brand">
        <span className="ck-brand-mark">◎</span>
        <span className="ck-brand-word">OSIRIS</span>
        <span className="ck-brand-v">{version.replace('-dev', '')}</span>
      </div>

      <div className="ck-navlabel">Navigation</div>
      <div className="ck-navlinks">
        {NAV_LINKS.map((l) =>
          l.active ? (
            <span key={l.label} className="ck-navlink active" aria-current="page">{l.label}</span>
          ) : (
            <a key={l.label} className="ck-navlink" href={l.href}>{l.label}</a>
          ),
        )}
      </div>

      <div className="ck-navlabel" style={{ marginTop: 14 }}>Outils</div>
      <div className="ck-navlinks">
        {TOOLS.map((t) => (
          <button key={t.label} type="button" className="ck-navlink" onClick={t.onClick} style={{ background: 'none', textAlign: 'left', width: '100%' }}>
            {t.label}
          </button>
        ))}
      </div>

      <a className="ck-navlink" href="/" style={{ marginTop: 'auto', borderColor: 'var(--accent-line)', color: 'var(--accent-bright)' }}>💬 Feedback / Questions</a>
      <a className="ck-navlink" href="/logout" style={{ borderColor: 'var(--line-2)' }}>⏻ Se déconnecter</a>
      <div className="ck-navfoot"><span className="dot" /> Données publiques FR</div>
    </nav>
  );
}

export default memo(CockpitSidebar);
