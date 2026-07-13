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

import { memo, useState } from 'react';
import Link from 'next/link';
import { BASE_PATH } from '@/lib/api';

/** Liens de navigation → accueil V4 (SOUS le basePath, `/cockpit/accueil`) — PLUS
 *  vers `/` (racine = landing V3, qui renvoyait au login V3, retour Cissou 13/07).
 *  `active: true` = page courante (le cockpit). MÊME structure que l'accueil. */
// Émancipation (13/07) : l'accueil (landing V3) est servi à la RACINE `/` (rewrite
//  next.config → /landing/index.html). Plus jamais de lien vers la V3.
const ACCUEIL = '/';
const NAV_LINKS: { label: string; href?: string; active?: boolean }[] = [
  { label: 'Accueil', href: ACCUEIL },
  { label: 'Chercher', href: `${ACCUEIL}#chercher` },
  { label: 'Cockpit carte', active: true },
];

/** Groupe « Doc » (repliable) — ancres de la landing (V3 reproduite à l'identique). */
const DOC_LINKS: { label: string; href: string }[] = [
  { label: 'Sources', href: `${ACCUEIL}#sources` },
  { label: 'Recettes', href: `${ACCUEIL}#recettes` },
  { label: 'Prototype', href: `${ACCUEIL}#prototype` },
  { label: 'Garde-fous', href: `${ACCUEIL}#rgpd` },
];

export interface CockpitSidebarProps {
  /** Version affichée dans le badge de marque (ex. 'V4.011-dev'). */
  version: string;
  /** ⏸️ Inutilisé depuis le 07/07 (Clés API = page dédiée /cles-api).
   *  Conservé pour compat — réactivable si le panneau flottant revient. */
  onOpenKeys?: () => void;
  /** Ouvre la boîte à outils OSINT. */
  onOpenOsint?: () => void;
  /** Ouvre le graphe d'entités. */
  onOpenGraph?: () => void;
  /** Ouvre le fil d'actualité (News). */
  onOpenNews?: () => void;
  /** Replie la sidebar (bouton « ). Si absent, pas de bouton replier. */
  onCollapse?: () => void;
}

function CockpitSidebar({ version, onOpenOsint, onOpenGraph, onOpenNews, onCollapse }: CockpitSidebarProps) {
  /** Outils du cockpit. `onClick` = ouvre un panneau · `page` = route dédiée.
   *  (⏸️ « Briefing IA » retiré le 05/07 à la demande de Cissou — code dormant.
   *   Emojis retirés le 07/07. « Clés API » = page dédiée /cles-api depuis le
   *   07/07 — l'ancien panneau (onOpenKeys/KeysPanel) est archivé, dormant.) */
  const TOOLS: { label: string; onClick?: () => void; page?: string }[] = [
    { label: 'OSINT', onClick: onOpenOsint },
    { label: 'Graphe', onClick: onOpenGraph },
    { label: 'News', onClick: onOpenNews },
    { label: 'Clés API', page: '/cles-api' },
  ];

  // Groupe Doc repliable (fermé par défaut, comme le <details> de l'accueil).
  const [docOpen, setDocOpen] = useState(false);

  return (
    <nav className="ck-sidenav">
      {/* Marque = MÊMES IMAGES que l'accueil (œil + mot OSIRIS métallique), servies
          par le cockpit sous BASE_PATH (/cockpit/assets/...). Version SOUS le mot
          OSIRIS (colonne) = jamais de débordement, homogène avec l'accueil.
          Bouton « = replier. */}
      <div className="ck-brand">
        <span className="ck-logo-mark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/assets/logo-cut.png`} alt="OSIRIS" />
        </span>
        <span className="ck-wordmark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="ck-wordmark-img" src={`/assets/osiris-cut.png`} alt="OSIRIS" />
          <span className="ck-wordmark-v">{version}</span>
        </span>
        {onCollapse && (
          <button type="button" className="ck-collapse" onClick={onCollapse} title="Replier le menu" aria-label="Replier le menu">«</button>
        )}
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
        {/* Groupe Doc repliable — miroir du groupe de l'accueil */}
        <button type="button" className="ck-navlink ck-group" onClick={() => setDocOpen((v) => !v)} aria-expanded={docOpen}>
          <span className={`ck-group-chev${docOpen ? ' open' : ''}`}>›</span> Doc
        </button>
        {docOpen && DOC_LINKS.map((l) => (
          <a key={l.label} className="ck-navlink ck-sub" href={l.href}>{l.label}</a>
        ))}
      </div>

      <div className="ck-navlabel">Outils</div>
      <div className="ck-navlinks">
        {TOOLS.map((t) =>
          t.page ? (
            <Link key={t.label} className="ck-navlink" href={`${BASE_PATH}${t.page}`}>
              {t.label}
            </Link>
          ) : (
            <button key={t.label} type="button" className="ck-navlink" onClick={t.onClick}>
              {t.label}
            </button>
          ),
        )}
      </div>

      {/* Feedback + Déconnexion : classes dédiées = mêmes styles que .nav-fb / .nav-logout de l'accueil.
          Feedback = mailto pré-rempli (livraison fiable, sans backend sous /cockpit). */}
      <a
        className="ck-navfb"
        href="mailto:cyril.detout@gmail.com?subject=%5BOSIRIS%20Cockpit%5D%20Feedback&body=Ton%20retour%20(bug%20%2F%20question%20%2F%20id%C3%A9e)%20%3A%0A%0A"
      >
        💬 Feedback / Questions
      </a>
      <a className="ck-navlogout" href="/login">⏻ Se déconnecter</a>
      {/* La version vit dans la marque (ck-wordmark-v) — plus de doublon ici. */}
      <div className="ck-navfoot"><span className="dot" /> Données publiques FR</div>
    </nav>
  );
}

export default memo(CockpitSidebar);
