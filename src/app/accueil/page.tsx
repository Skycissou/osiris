'use client';
// ─────────────────────────────────────────────────────────────────────────────
//  Accueil V4 — page d'accueil PROPRE À LA V4 (émancipation, Lot A code-only, 13/07).
//
//  Pourquoi : avant, « Accueil » et la nav du cockpit pointaient vers `/` = la
//  LANDING V3 (racine du domaine, servie par le conteneur V3) → renvoi vers le
//  login V3 / contenu périmé (retour Cissou : « tout ce qu'on a fait a été balayé »).
//  Cette page vit SOUS le basePath (`/cockpit/accueil`) → 100 % V4, jamais de saut
//  vers la V3. C'est le 1er lot de l'émancipation ; l'accueil à la RACINE + l'auth
//  autonome (Better Auth + Postgres) + le compose autonome = jalon suivant (Hermès).
// ─────────────────────────────────────────────────────────────────────────────

import type { CSSProperties, ReactNode } from 'react';
import { BASE_PATH } from '@/lib/api';
import { OSIRIS_VERSION } from '@/lib/version';

const COCKPIT = `${BASE_PATH}/`; // la carte (racine de l'app Next sous basePath)

const SOURCES: { titre: string; items: string[] }[] = [
  { titre: 'Aérien & maritime', items: ['Avions ADS-B (adsb.lol · OpenSky)', 'Navires AIS (clé)'] },
  { titre: 'Géophysique', items: ['Séismes (USGS)', 'Feux (NASA FIRMS multi-capteurs)', 'Satellites (Celestrak + SGP4)'] },
  { titre: 'Cartographie IGN', items: ['Plan IGN · SCAN25 · Ortho + Remonter le temps', 'Surcouches : cadastre, forêts, hydro, routes…'] },
  { titre: 'Monde & cyber', items: ['Géopolitique / conflits (actu + gazetteer)', 'Serveurs C2 malware (abuse.ch — défensif)'] },
  { titre: 'Alertes disparitions', items: ['Interpol Yellow · 116000 · presse locale', 'Contour du département + fiche enrichie'] },
  { titre: 'OSINT données publiques', items: ['DNS · WHOIS/RDAP · certificats · BGP/ASN', 'Sanctions · fuites · GitHub · graphe d’entités'] },
];

const RECETTES: { titre: string; desc: string }[] = [
  { titre: 'Veille ARPD', desc: 'Suivre en temps réel les avis de recherche officiels géolocalisés sur la carte.' },
  { titre: 'Cartographier une zone', desc: 'Empiler fonds IGN + surcouches (cadastre, forêts, secours forêt) pour préparer un canvassing.' },
  { titre: 'Explorer une entité', desc: 'À partir d’un domaine / IP / pseudo, dérouler le graphe d’entités publiques liées.' },
];

const GLOSSAIRE: { t: string; d: string }[] = [
  { t: 'OSINT', d: 'Renseignement en sources ouvertes — uniquement des données déjà publiques.' },
  { t: 'ADS-B / AIS', d: 'Signaux publics de position des avions / navires.' },
  { t: 'WMTS', d: 'Tuiles cartographiques IGN (Géoplateforme), gratuites sans clé.' },
  { t: 'DFCI', d: 'Défense de la Forêt Contre l’Incendie — ex. points de rencontre secours forêt.' },
];

export default function AccueilV4() {
  return (
    <main style={{ background: 'var(--bg)', color: '#e6edf3', minHeight: '100vh' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 20px 64px' }}>
        {/* ── Hero ── */}
        <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginBottom: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${BASE_PATH}/assets/logo-cut.png`} alt="OSIRIS" style={{ height: 46 }} />
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: 1, margin: 0 }}>
              OSIRIS <span style={{ color: 'var(--accent-bright)' }}>V4</span>
            </h1>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Cockpit OSINT · {OSIRIS_VERSION}</div>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--green)', border: '1px solid var(--green-line)', borderRadius: 99, padding: '4px 10px', background: 'var(--green-soft)' }}>
            ● V4 (dev)
          </span>
        </header>

        <p style={{ fontSize: 15, lineHeight: 1.6, color: '#c2cbd8', maxWidth: 720, marginTop: 12 }}>
          Cartographie <strong>temps réel</strong> de données <strong>publiques françaises</strong> — cadre
          <strong> défensif</strong>, pensé pour la veille et l’enquête légale (ARPD). On annote du public, on ne cible personne.
        </p>

        <div id="chercher" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '20px 0 8px' }}>
          <a href={COCKPIT} style={btnPrimary}>🗺️ Ouvrir le cockpit carte</a>
          <a href={COCKPIT} style={btnGhost}>🔎 Rechercher une cible</a>
        </div>

        {/* ── Sources ── */}
        <Section id="sources" titre="Sources de données">
          <div style={grid3}>
            {SOURCES.map((s) => (
              <div key={s.titre} style={card}>
                <div style={cardTitle}>{s.titre}</div>
                <ul style={{ margin: '8px 0 0', paddingLeft: 16, color: '#c2cbd8', fontSize: 13, lineHeight: 1.6 }}>
                  {s.items.map((it) => <li key={it}>{it}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Recettes ── */}
        <Section id="recettes" titre="Recettes (cas d’usage)">
          <div style={grid3}>
            {RECETTES.map((r) => (
              <div key={r.titre} style={card}>
                <div style={cardTitle}>{r.titre}</div>
                <p style={{ margin: '8px 0 0', color: '#c2cbd8', fontSize: 13, lineHeight: 1.6 }}>{r.desc}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Glossaire ── */}
        <Section id="glossaire" titre="Glossaire">
          <div style={grid2}>
            {GLOSSAIRE.map((g) => (
              <div key={g.t} style={{ ...card, display: 'flex', gap: 10 }}>
                <span style={{ color: 'var(--accent-bright)', fontWeight: 700, minWidth: 72 }}>{g.t}</span>
                <span style={{ color: '#c2cbd8', fontSize: 13, lineHeight: 1.5 }}>{g.d}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Prototype / statut ── */}
        <Section id="prototype" titre="Statut">
          <div style={card}>
            <p style={{ margin: 0, color: '#c2cbd8', fontSize: 13, lineHeight: 1.7 }}>
              <strong style={{ color: 'var(--accent-bright)' }}>V4 (dev)</strong> — seule version en développement actif (Next.js + MapLibre), en staging.<br />
              <strong>V3 (prod, gelée)</strong> — la version stable des testeurs, on n’y touche pas.
            </p>
          </div>
        </Section>

        {/* ── Garde-fous ── */}
        <Section id="rgpd" titre="Garde-fous éthiques & légaux">
          <div style={{ ...card, borderColor: 'var(--green-line)', background: 'var(--green-soft)' }}>
            <ul style={{ margin: 0, paddingLeft: 16, color: '#d7e2d9', fontSize: 13, lineHeight: 1.7 }}>
              <li><strong>Données publiques uniquement</strong> — déjà diffusées (registres, logs, signaux ouverts).</li>
              <li><strong>Aucun ciblage abusif</strong>, aucune donnée privée, cadre <strong>défensif</strong> et légal.</li>
              <li>Avis de disparition : réconciliation/levée, purge, photos non stockées (RGPD).</li>
            </ul>
          </div>
        </Section>

        <footer style={{ marginTop: 40, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', fontSize: 12, color: 'var(--muted)' }}>
          <span>Données publiques FR · veille / enquête légale · cadre ARPD</span>
          <a href={COCKPIT} style={{ ...btnGhost, marginLeft: 'auto', padding: '6px 12px' }}>Aller au cockpit →</a>
        </footer>
      </div>
    </main>
  );
}

function Section({ id, titre, children }: { id: string; titre: string; children: ReactNode }) {
  return (
    <section id={id} style={{ marginTop: 34, scrollMarginTop: 20 }}>
      <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--accent)', margin: '0 0 12px' }}>{titre}</h2>
      {children}
    </section>
  );
}

const grid3: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 };
const grid2: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 };
const card: CSSProperties = { background: 'var(--panel)', border: '1px solid var(--border-primary)', borderRadius: 12, padding: 14 };
const cardTitle: CSSProperties = { fontWeight: 700, fontSize: 14, color: '#e6edf3' };
const btnPrimary: CSSProperties = { display: 'inline-block', padding: '11px 18px', borderRadius: 10, background: 'var(--accent)', color: '#04121a', fontWeight: 700, textDecoration: 'none' };
const btnGhost: CSSProperties = { display: 'inline-block', padding: '11px 18px', borderRadius: 10, border: '1px solid var(--accent-line)', color: 'var(--accent-bright)', textDecoration: 'none', background: 'transparent' };
