'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  KeysManager.tsx — Cœur PARTAGÉ du module « Clés API » (OSIRIS V4)
//
//  Extrait de KeysPanel.tsx le 07/07 (création de la page dédiée /cles-api, à la
//  demande de Cissou) : UNE seule source de vérité pour les cartes de services,
//  consommée par :
//    • src/app/cles-api/page.tsx  → la page dédiée (usage nominal)
//    • src/components/KeysPanel.tsx → l'ancien panneau flottant (ARCHIVÉ, dormant)
//
//  RÔLE : liste les services du registre (src/lib/apiKeys.ts) groupés par
//  catégorie, chaque carte = statut configurée/vide + champ masqué + Enregistrer/
//  Effacer + lien « Obtenir la clé » + procédure courte FR.
//
//  `onCountChange(configurees, total)` (optionnel) : notifie le parent à chaque
//  hydratation / enregistrement / effacement — sert au compteur de la page.
//
//  SÉCURITÉ : clés en clair dans localStorage (poste de confiance), envoyées
//  UNIQUEMENT à nos routes serveur (même origine). Cf. en-tête de apiKeys.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  Save,
  Trash2,
  Eye,
  EyeOff,
  Info,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import {
  API_KEY_SERVICES,
  ALL_API_KEY_SERVICES,
  getKey,
  setKey,
  clearKey,
  hasKey,
  keyHeaders,
  type ApiKeyService,
  type ApiKeyServiceMeta,
} from '@/lib/apiKeys';
import { BASE_PATH } from '@/lib/api';
import { track } from '@/lib/uiTelemetry';

// ── Catégories d'affichage ────────────────────────────────────────────────────
//  3 blocs lisibles, déduits du registre : forme 2 → « Sensibles » ; FIRMS/AIS →
//  « Couches » ; le reste → « OSINT ». Ordre stable = ordre du registre.
type Categorie = { id: string; titre: string; sous: string; couleur: string };

const CATEGORIES: Categorie[] = [
  {
    id: 'osint',
    titre: 'OSINT',
    sous: 'Boîte à outils — enrichissement de cibles',
    couleur: 'var(--accent)',
  },
  {
    id: 'couches',
    titre: 'Couches carto',
    sous: 'Sources de données géographiques',
    couleur: 'var(--green)',
  },
  {
    id: 'sensibles',
    titre: 'Sources sensibles (forme 2)',
    sous: 'Câblage variable selon le fournisseur',
    couleur: 'var(--violet)',
  },
];

/** Services rattachés aux « couches carto » (forme 1 mais non-OSINT). */
const COUCHES_SERVICES = new Set<ApiKeyService>(['firms', 'ais_url', 'ais_key', 'opensky_id', 'opensky_secret']);

/** Détermine la catégorie d'un service à partir de ses métadonnées. */
function categorieDe(meta: ApiKeyServiceMeta): string {
  if (meta.form === 2) return 'sensibles';
  if (COUCHES_SERVICES.has(meta.service)) return 'couches';
  return 'osint';
}

/** Compte les services dont une clé est réellement stockée (client only). */
export function countConfigured(): { configured: number; total: number } {
  let configured = 0;
  for (const s of ALL_API_KEY_SERVICES) if (hasKey(s)) configured += 1;
  return { configured, total: ALL_API_KEY_SERVICES.length };
}

// ── Carte d'un service (mémoïsée) ─────────────────────────────────────────────
interface ServiceRowProps {
  meta: ApiKeyServiceMeta;
  /** Notifie le parent qu'une clé a changé (enregistrée / effacée / hydratée). */
  onChanged?: () => void;
}

/**
 * Ligne éditable d'un service : label + rôle + coût + statut + champ masqué +
 * lien « Obtenir la clé » + procédure + boutons Enregistrer / Effacer.
 * Chaque carte gère son propre état de saisie (indépendant des autres).
 */
const ServiceRow = memo(function ServiceRow({ meta, onChanged }: ServiceRowProps) {
  // Valeur en cours d'édition (initialisée depuis localStorage au montage).
  const [value, setValue] = useState('');
  // Clé réellement persistée : pilote le statut « configurée / vide ».
  const [stored, setStored] = useState('');
  // Masquage du champ (type password ↔ text).
  const [reveal, setReveal] = useState(false);
  // Petit feedback visuel après enregistrement / effacement.
  const [flash, setFlash] = useState<'saved' | 'cleared' | null>(null);
  // Test de connexion : état + résultat.
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Hydratation côté client uniquement (localStorage indispo en SSR).
  useEffect(() => {
    const k = getKey(meta.service);
    setValue(k);
    setStored(k);
    onChanged?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.service]);

  // Efface le flash après un court délai.
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  const configured = stored.length > 0;
  const dirty = value.trim() !== stored;

  const enregistrer = useCallback(() => {
    const v = value.trim();
    setKey(meta.service, v);
    setStored(v);
    setValue(v);
    setFlash('saved');
    track('apikey_save', { service: meta.service }); // ⚠️ jamais la valeur, que le service
    onChanged?.();
  }, [meta.service, value, onChanged]);

  const effacer = useCallback(() => {
    clearKey(meta.service);
    setStored('');
    setValue('');
    setReveal(false);
    setFlash('cleared');
    setTestResult(null);
    onChanged?.();
  }, [meta.service, onChanged]);

  // Test de connexion réel : envoie la clé (en-tête) à /keys/test qui interroge
  // la source et renvoie ok/raison. OpenSky/AIS ont besoin des 2 champs → on
  // joint toutes les clés configurées.
  const tester = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${BASE_PATH}/keys/test?service=${encodeURIComponent(meta.service)}`, {
        headers: keyHeaders([...ALL_API_KEY_SERVICES]),
        cache: 'no-store',
      });
      const j = (await res.json()) as { ok: boolean; message: string };
      setTestResult({ ok: !!j.ok, message: j.message || (j.ok ? 'Connecté' : 'Échec') });
    } catch {
      setTestResult({ ok: false, message: 'Test injoignable' });
    } finally {
      setTesting(false);
    }
  }, [meta.service]);

  return (
    <div className="rounded-lg border border-[var(--border-primary)] bg-white/[0.015] px-3 py-2.5">
      {/* En-tête : nom du service + statut + coût */}
      <div className="flex items-center gap-2 mb-1">
        {configured ? (
          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 text-[var(--green)]" />
        ) : (
          <Circle className="w-3.5 h-3.5 flex-shrink-0 text-[var(--faint)]" />
        )}
        <span className="text-[11px] font-mono font-bold text-white/90">{meta.label}</span>
        <span className="ml-auto text-[8px] font-mono uppercase tracking-widest text-[var(--faint)] border border-[var(--line-2)] rounded px-1.5 py-0.5">
          {meta.cost}
        </span>
      </div>

      {/* Rôle FR */}
      <p className="text-[10px] font-mono text-[var(--muted)] leading-relaxed mb-2">
        {meta.purpose}
      </p>

      {/* Champ de saisie masqué + bouton œil */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className="relative flex-1 min-w-0">
          <input
            type={reveal ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={configured ? '•••••••••• (clé enregistrée)' : 'Colle ta clé ici…'}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            className="w-full bg-black/25 border border-[var(--border-primary)] rounded-md pl-2.5 pr-8 py-1.5 text-[11px] font-mono text-white placeholder:text-[var(--faint)] outline-none focus:border-[var(--accent-line)] focus:shadow-[0_0_0_3px_var(--accent-soft)] transition"
          />
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            title={reveal ? 'Masquer' : 'Afficher'}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/35 hover:text-white transition-colors"
          >
            {reveal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Boutons Enregistrer / Effacer + feedback */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={enregistrer}
          disabled={!dirty}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--accent-bright)] border border-[var(--accent-line)] bg-[var(--accent-soft)] hover:brightness-125 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          <Save className="w-3 h-3" />
          Enregistrer
        </button>
        <button
          type="button"
          onClick={effacer}
          disabled={!configured && !value}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--red)] border border-[var(--red-line)] bg-[var(--red-soft)] hover:brightness-125 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          <Trash2 className="w-3 h-3" />
          Effacer
        </button>
        {/* Tester la connexion réelle à la source */}
        <button
          type="button"
          onClick={tester}
          disabled={testing || (!configured && !value)}
          title="Vérifie que la clé est acceptée par la source"
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-white/80 border border-[var(--border-primary)] bg-white/[0.03] hover:bg-white/[0.08] disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {testing ? '…' : 'Tester'}
        </button>

        {/* Feedback discret */}
        {flash === 'saved' && (
          <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--green)]">
            enregistré
          </span>
        )}
        {flash === 'cleared' && (
          <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--faint)]">
            effacé
          </span>
        )}
      </div>

      {/* Résultat du test de connexion */}
      {testResult && (
        <div
          className={`mt-1.5 text-[10px] font-mono ${testResult.ok ? 'text-[var(--green)]' : 'text-[var(--red,#db6f78)]'}`}
        >
          {testResult.ok ? '✅ ' : '❌ '}
          {testResult.message}
        </div>
      )}

      {/* Lien « Obtenir la clé » + procédure courte */}
      <div className="mt-2 pt-2 border-t border-white/[0.06]">
        {meta.url ? (
          <a
            href={meta.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[10px] font-mono text-[var(--accent)] hover:text-[var(--accent-bright)] transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Obtenir la clé
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-[var(--faint)]">
            <Info className="w-3 h-3" />
            Source variable (voir procédure)
          </span>
        )}
        <p className="mt-1 text-[9px] font-mono text-[var(--faint)] leading-relaxed">
          {meta.howTo}
        </p>
      </div>
    </div>
  );
});

// ── Composant principal : sections groupées par catégorie ─────────────────────
export interface KeysManagerProps {
  /** Notifié à chaque changement de clé : (configurées, total). */
  onCountChange?: (configured: number, total: number) => void;
}

function KeysManager({ onCountChange }: KeysManagerProps) {
  // Regroupe le registre par catégorie une seule fois (registre figé).
  const groupes = useMemo(() => {
    return CATEGORIES.map((cat) => ({
      cat,
      services: API_KEY_SERVICES.filter((m) => categorieDe(m) === cat.id),
    })).filter((g) => g.services.length > 0);
  }, []);

  // Recompte à chaque changement d'une carte (hydratation incluse).
  const recount = useCallback(() => {
    if (!onCountChange) return;
    const { configured, total } = countConfigured();
    onCountChange(configured, total);
  }, [onCountChange]);

  // ── « Copier pour le .env » (demande Cissou : coffre serveur bug-proof) ──
  //  Construit les lignes VAR=valeur à partir des clés DÉJÀ dans le navigateur,
  //  à coller UNE fois dans /docker/osiris-v4/.env → persistance serveur qui
  //  survit à tout. Aucune clé à recréer.
  const [envCopied, setEnvCopied] = useState<string | null>(null);
  const copierPourEnv = useCallback(async () => {
    const lignes: string[] = [];
    for (const m of API_KEY_SERVICES) {
      const v = getKey(m.service);
      if (v) lignes.push(`${m.env}=${v}`);
    }
    if (lignes.length === 0) {
      setEnvCopied('Aucune clé enregistrée dans ce navigateur.');
      return;
    }
    const texte = lignes.join('\n');
    try {
      await navigator.clipboard.writeText(texte);
      setEnvCopied(`${lignes.length} ligne(s) copiée(s) → colle-les dans /docker/osiris-v4/.env sur le VPS, puis rebuild.`);
    } catch {
      // Presse-papier refusé → on affiche le texte pour copie manuelle.
      setEnvCopied(`Copie auto refusée. Contenu à coller dans le .env :\n${texte}`);
    }
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {/* Barre d'outils : export vers le .env serveur (persistance bug-proof) */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-[var(--border-primary)] bg-white/[0.02] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-mono text-[var(--muted)] leading-relaxed">
            Pour ne PLUS jamais retaper tes clés : copie-les vers le <span className="text-[var(--accent)]">.env du VPS</span> (coffre serveur, survit à tout).
          </span>
          <button
            type="button"
            onClick={copierPourEnv}
            className="flex-none rounded-md px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--accent-bright)] border border-[var(--accent-line)] bg-[var(--accent-soft)] hover:brightness-125 transition"
          >
            📋 Copier pour le .env
          </button>
        </div>
        {envCopied && (
          <pre className="mt-1 text-[9px] font-mono text-[var(--green)] whitespace-pre-wrap break-all">{envCopied}</pre>
        )}
      </div>

      {groupes.map(({ cat, services }) => (
        <section key={cat.id} className="flex flex-col gap-2">
          {/* Titre de catégorie */}
          <div className="flex items-baseline gap-2 border-b border-white/10 pb-1">
            <span
              className="text-[10px] font-mono font-bold uppercase tracking-widest"
              style={{ color: cat.couleur }}
            >
              {cat.titre}
            </span>
            <span className="text-[8px] font-mono uppercase tracking-wider text-[var(--faint)]">
              {cat.sous}
            </span>
          </div>

          {/* Cartes de services */}
          {services.map((meta) => (
            <ServiceRow key={meta.service} meta={meta} onChanged={recount} />
          ))}
        </section>
      ))}
    </div>
  );
}

export default memo(KeysManager);
