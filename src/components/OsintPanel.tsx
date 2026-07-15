'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  OsintPanel.tsx — Panneau « Boîte à outils OSINT » (OSIRIS V4 · cockpit)
//  Agent PANNEAU OSINT
//
//  RÔLE
//  ────
//  Champ de saisie unique → détection du type de cible (detectTargetType) →
//  lancement EN PARALLÈLE des outils pertinents (runLookup, Promise.allSettled)
//  → fiches résultat affichées au fil de l'eau, une par outil, en rendu FR
//  lisible adapté à chaque outil.
//
//  CHARTE V3 (cohérence graphique, calque de RegionDossierPanel / ResultsPanel) :
//  panneau glassmorphism `glass-panel`, libellés techniques en `IBM Plex Mono`
//  (font-mono), accent `--accent`, apparition douce depuis la droite
//  (framer-motion), scrollbar `styled-scrollbar`, bouton fermer identique.
//  Ce panneau est VOLONTAIREMENT plus large que les autres (liste d'outils).
//
//  CADRE DÉFENSIF ARPD : uniquement des données PUBLIQUES (RDAP, BGP, DNS,
//  transparence des certificats, référentiels publics…). Veille / enquête
//  légale. Rappel affiché en pied de panneau.
//
//  INTÉGRATION (dans src/app/page.tsx) — même schéma que les autres panneaux :
//    1) État d'ouverture :
//         const [osintOpen, setOsintOpen] = useState(false);
//    2) Bouton dans la barre d'outils (ex. à côté du bouton Calques) :
//         <button onClick={() => setOsintOpen(true)} title="Boîte à outils OSINT">
//           OSINT
//         </button>
//    3) Montage du panneau (idéalement sous <AnimatePresence>, à côté de
//       <ResultsPanel> / <RegionDossierPanel>) :
//         <AnimatePresence>
//           {osintOpen && (
//             <OsintPanel onClose={() => setOsintOpen(false)} isMobile={isMobile} />
//           )}
//         </AnimatePresence>
//    Chargement paresseux possible comme ResultsPanel :
//       const OsintPanel = dynamic(() => import('@/components/OsintPanel'), { ssr: false });
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  X,
  Search,
  Loader2,
  Fingerprint,
  Network,
  Globe,
  ShieldAlert,
  ShieldCheck,
  Cpu,
  Waypoints,
  GitBranch,
  Scale,
  Phone,
  Radar,
  KeyRound,
  Info,
  Target,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import {
  detectTargetType,
  runLookup,
  OSINT_TOOL_LABELS,
  OSINT_TOOL_HINTS,
  type OsintTool,
  type OsintLookupResult,
  type TargetDetection,
} from '@/lib/osintClient';
import { track } from '@/lib/uiTelemetry';
import type { OsintIpPin } from '@/components/OsirisMap';

// ── Props ─────────────────────────────────────────────────────────────────────
interface OsintPanelProps {
  /** Ferme le panneau (branché sur setOsintOpen(false)). */
  onClose: () => void;
  /** Layout compact mobile (mêmes règles que les autres panneaux). */
  isMobile?: boolean;
  /** Cible IP localisée (Géo-IP) → pose/actualise un pin OSINT sur la carte monde.
   *  Appelé UNIQUEMENT si la cible est une IP ET que ipwho.is renvoie lat/lng. */
  onIpPin?: (pin: OsintIpPin) => void;
  /** Nombre de pins IP actuellement sur la carte (pour le bouton « vider »). */
  ipPinCount?: number;
  /** Vide tous les pins IP OSINT de la carte. */
  onClearIpPins?: () => void;
}

// ── Icône par outil (lucide, charte V3) ───────────────────────────────────────
const TOOL_ICONS: Record<OsintTool, LucideIcon> = {
  whois: Fingerprint,
  dns: Network,
  ip: Globe,
  cve: ShieldAlert,
  mac: Cpu,
  certs: ShieldCheck,
  bgp: Waypoints,
  github: GitBranch,
  sanctions: Scale,
  phone: Phone,
  shodan: Radar,
  leaks: KeyRound,
  threats: AlertTriangle,
};

// ── État interne d'une fiche outil ────────────────────────────────────────────
type ToolState =
  | { status: 'loading'; tool: OsintTool }
  | { status: 'done'; tool: OsintTool; result: OsintLookupResult };

// ── Helpers de lecture tolérante du JSON (formes variables selon l'outil) ─────
function str(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

/** Premier champ string non vide parmi une liste de clés candidates. */
function pick(data: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!data) return undefined;
  for (const k of keys) {
    const s = str(data[k]);
    if (s) return s;
  }
  return undefined;
}

/** Tableau de strings à partir d'un champ (accepte string[] ou objets à { name/value }). */
function pickList(data: Record<string, unknown> | undefined, ...keys: string[]): string[] {
  if (!data) return [];
  for (const k of keys) {
    const v = data[k];
    if (Array.isArray(v)) {
      const out = v
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') {
            const o = item as Record<string, unknown>;
            return str(o.name) ?? str(o.value) ?? str(o.prefix) ?? str(o.domain) ?? str(o.port) ?? str(o.type);
          }
          return undefined;
        })
        .filter((x): x is string => !!x);
      if (out.length) return out;
    }
  }
  return [];
}

// ── Sous-composants de présentation (charte V3) ───────────────────────────────
/** Ligne label (mono, gauche) → valeur (droite). Masquée si valeur absente. */
function Ligne({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--faint)] flex-shrink-0">
        {label}
      </span>
      <span className="text-[12px] font-mono text-white/90 text-right break-words">{value}</span>
    </div>
  );
}

/** Liste de valeurs sous forme de chips (sous-domaines, préfixes, ports…). */
function Chips({ label, items, max = 24 }: { label: string; items: string[]; max?: number }) {
  if (!items.length) return null;
  const shown = items.slice(0, max);
  const extra = items.length - shown.length;
  return (
    <div className="py-0.5">
      <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--faint)] mb-1">{label}</div>
      <div className="flex flex-wrap gap-1">
        {shown.map((s, i) => (
          <span
            key={`${s}-${i}`}
            className="text-[9px] font-mono text-[var(--accent)] bg-[var(--accent-soft)] border border-[var(--accent-line)] rounded-md px-2 py-0.5 break-all"
          >
            {s}
          </span>
        ))}
        {extra > 0 && (
          <span className="text-[9px] font-mono text-[var(--faint)] px-1 py-0.5">+{extra}…</span>
        )}
      </div>
    </div>
  );
}

// ── Rendu spécifique par outil (best-effort, tolérant aux formes) ─────────────
/**
 * Transforme le JSON d'une route en JSX lisible FR. Chaque branche lit des clés
 * candidates (les routes n'étant pas toutes finalisées, on reste tolérant) et
 * retombe sur un rendu générique clé→valeur si rien de connu n'est trouvé.
 */
function renderData(tool: OsintTool, data: Record<string, unknown>): React.ReactNode {
  switch (tool) {
    case 'whois':
      return (
        <>
          <Ligne label="Type" value={pick(data, 'type')} />
          <Ligne label="Registrar" value={pick(data, 'registrar')} />
          <Ligne label="Créé le" value={pick(data, 'created')} />
          <Ligne label="Expire le" value={pick(data, 'expires')} />
          <Chips label="Serveurs de noms" items={pickList(data, 'nameservers')} />
          <Chips label="Statuts" items={pickList(data, 'statuses', 'status')} />
        </>
      );

    case 'bgp':
      return (
        <>
          <Ligne label="IP" value={pick(data, 'ip')} />
          <Ligne label="ASN" value={pick(data, 'asn')} />
          <Ligne label="Détenteur" value={pick(data, 'holder')} />
          <Ligne label="RIR" value={pick(data, 'rir')} />
          <Chips label="Préfixes annoncés" items={pickList(data, 'prefixes')} />
        </>
      );

    case 'ip':
      return (
        <>
          <Ligne label="IP" value={pick(data, 'ip', 'query')} />
          <Ligne label="Pays" value={pick(data, 'country', 'pays', 'country_name')} />
          <Ligne label="Région/Ville" value={pick(data, 'city', 'ville', 'region', 'regionName')} />
          <Ligne label="ASN" value={pick(data, 'asn', 'as')} />
          <Ligne label="Organisation" value={pick(data, 'org', 'organisation', 'isp', 'operateur')} />
          <Ligne label="Coordonnées" value={pick(data, 'loc', 'coords', 'location')} />
        </>
      );

    case 'dns':
      return (
        <>
          <Chips label="A" items={pickList(data, 'a', 'A')} />
          <Chips label="AAAA" items={pickList(data, 'aaaa', 'AAAA')} />
          <Chips label="MX" items={pickList(data, 'mx', 'MX')} />
          <Chips label="NS" items={pickList(data, 'ns', 'NS')} />
          <Chips label="TXT" items={pickList(data, 'txt', 'TXT')} />
          <Chips label="CNAME" items={pickList(data, 'cname', 'CNAME')} />
        </>
      );

    case 'certs':
      return (
        <>
          <Ligne label="Sous-domaines" value={pick(data, 'count', 'total')} />
          <Chips label="Sous-domaines" items={pickList(data, 'subdomains', 'domains', 'names', 'results')} />
        </>
      );

    case 'cve':
      return (
        <>
          <Ligne label="Identifiant" value={pick(data, 'id', 'cve', 'cveId')} />
          <Ligne label="Score CVSS" value={pick(data, 'cvss', 'score', 'baseScore')} />
          <Ligne label="Sévérité" value={pick(data, 'severity', 'severite', 'baseSeverity')} />
          <Ligne label="Publiée le" value={pick(data, 'published', 'publishedDate')} />
          <Description value={pick(data, 'description', 'summary')} />
        </>
      );

    case 'mac':
      return (
        <>
          <Ligne label="Fabricant" value={pick(data, 'vendor', 'company', 'manufacturer', 'fabricant')} />
          <Ligne label="Préfixe OUI" value={pick(data, 'oui', 'prefix', 'block')} />
          <Ligne label="Adresse" value={pick(data, 'mac', 'address')} />
        </>
      );

    case 'phone':
      return (
        <>
          <Ligne label="Numéro" value={pick(data, 'number', 'numero', 'international')} />
          <Ligne label="Valide" value={pick(data, 'valid', 'valide')} />
          <Ligne label="Pays" value={pick(data, 'country', 'pays', 'country_name')} />
          <Ligne label="Indicatif" value={pick(data, 'country_code', 'indicatif', 'prefix')} />
          <Ligne label="Opérateur" value={pick(data, 'carrier', 'operateur', 'operator')} />
          <Ligne label="Type de ligne" value={pick(data, 'line_type', 'type')} />
        </>
      );

    case 'github':
      return (
        <>
          <Ligne label="Login" value={pick(data, 'login', 'username', 'pseudo')} />
          <Ligne label="Nom" value={pick(data, 'name', 'nom')} />
          <Ligne label="E-mail public" value={pick(data, 'email')} />
          <Ligne label="Site / blog" value={pick(data, 'blog', 'website')} />
          <Ligne label="X (Twitter)" value={pick(data, 'twitter_username')} />
          <Ligne label="Dépôts publics" value={pick(data, 'public_repos', 'repos')} />
          <Ligne label="Abonnés" value={pick(data, 'followers')} />
          <Ligne label="Inscrit le" value={pick(data, 'created_at', 'created')} />
          <Ligne label="Dernière activité" value={pick(data, 'updated_at')} />
          <Ligne label="Bio" value={pick(data, 'bio')} />
          <Ligne label="Profil" value={pick(data, 'html_url', 'url', 'profile')} />
        </>
      );

    case 'sanctions': {
      const hits = pickList(data, 'matches', 'results', 'hits', 'entries');
      const count = pick(data, 'count', 'total') ?? (hits.length ? String(hits.length) : '0');
      return (
        <>
          <Ligne label="Correspondances" value={count} />
          <Chips label="Motifs (pourquoi ça ressort)" items={pickList(data, 'topics')} />
          {hits.length > 0 ? (
            <Chips label="Listes / entités" items={hits} />
          ) : (
            <div className="text-[11px] font-mono text-[var(--muted)] py-1">
              Aucune correspondance sur les listes publiques.
            </div>
          )}
        </>
      );
    }

    case 'shodan':
      return (
        <>
          <Ligne label="IP" value={pick(data, 'ip', 'ip_str')} />
          <Ligne label="Organisation" value={pick(data, 'org', 'organisation', 'isp')} />
          <Ligne label="Système" value={pick(data, 'os')} />
          <Chips label="Ports ouverts" items={pickList(data, 'ports', 'services')} />
          <Chips label="Vulnérabilités" items={pickList(data, 'vulns', 'cves')} />
          <Chips label="Hostnames" items={pickList(data, 'hostnames')} />
          <Chips label="Étiquettes" items={pickList(data, 'tags')} />
        </>
      );

    case 'leaks': {
      const breaches = pickList(data, 'breaches', 'leaks', 'fuites', 'results', 'sources');
      const count = pick(data, 'count', 'total') ?? (breaches.length ? String(breaches.length) : '0');
      return (
        <>
          <Ligne label="Fuites connues" value={count} />
          <Ligne label="Comptes exposés (total)" value={pick(data, 'pwnTotal')} />
          <Chips label="Données fuitées" items={pickList(data, 'dataClasses')} />
          {breaches.length > 0 ? (
            <Chips label="Sources compromises" items={breaches} />
          ) : (
            <div className="text-[11px] font-mono text-[var(--muted)] py-1">
              Aucune fuite connue pour cette adresse.
            </div>
          )}
        </>
      );
    }

    case 'threats':
      return (
        <>
          <Ligne label="Cible" value={pick(data, 'target', 'ip', 'domain', 'cible')} />
          <Ligne label="Score de risque" value={pick(data, 'abuseScore', 'score', 'risk', 'abuse_score', 'reputation')} />
          <Ligne label="Type d'usage" value={pick(data, 'usageType')} />
          <Ligne label="Opérateur (ISP)" value={pick(data, 'isp')} />
          <Ligne label="Domaine" value={pick(data, 'domain')} />
          <Ligne label="Nœud Tor" value={data.isTor === true ? 'oui' : undefined} />
          <Ligne label="Signalements" value={pick(data, 'totalReports', 'reports', 'total_reports', 'signalements')} />
          <Ligne label="Signalants distincts" value={pick(data, 'distinctUsers')} />
          <Ligne label="Dernier signalement" value={pick(data, 'lastReported')} />
          <Chips label="Catégories" items={pickList(data, 'categories', 'tags', 'threats')} />
        </>
      );

    default:
      return <GenericData data={data} />;
  }
}

/** Bloc description longue (CVE…) : texte lisible, tronqué en hauteur scrollable. */
function Description({ value }: { value?: string }) {
  if (!value) return null;
  return (
    <div className="mt-1 text-[11px] font-mono leading-relaxed text-white/80 break-words">{value}</div>
  );
}

/**
 * Rendu générique de secours : liste les champs primitifs et tableaux du JSON
 * (hors `raw` volumineux et clés techniques). Garantit qu'une réponse d'une
 * route non encore « stylée » reste lisible plutôt que vide.
 */
function GenericData({ data }: { data: Record<string, unknown> }) {
  const IGNORED = new Set(['raw', 'ok', 'tool', 'error']);
  const rows: Array<{ k: string; v: string }> = [];
  const lists: Array<{ k: string; items: string[] }> = [];

  for (const [k, v] of Object.entries(data)) {
    if (IGNORED.has(k)) continue;
    if (Array.isArray(v)) {
      const items = pickList(data, k);
      if (items.length) lists.push({ k, items });
    } else {
      const s = str(v);
      if (s) rows.push({ k, v: s });
    }
  }

  if (!rows.length && !lists.length) {
    return <div className="text-[11px] font-mono text-[var(--muted)] py-1">Aucune donnée exploitable.</div>;
  }

  return (
    <>
      {rows.map((r) => (
        <Ligne key={r.k} label={r.k} value={r.v} />
      ))}
      {lists.map((l) => (
        <Chips key={l.k} label={l.k} items={l.items} />
      ))}
    </>
  );
}

// ── Fiche résultat d'un outil ─────────────────────────────────────────────────
function ToolCard({ state }: { state: ToolState }) {
  const { tool } = state;
  const Icon = TOOL_ICONS[tool];
  const label = OSINT_TOOL_LABELS[tool];

  // État visuel : chargement / clé requise (ambre) / erreur (rouge) / ok.
  const loading = state.status === 'loading';
  const result = state.status === 'done' ? state.result : undefined;
  const authRequired = result && !result.ok && result.authRequired;
  const errored = result && !result.ok && !result.authRequired;

  // Couleur d'accent de l'en-tête selon l'état.
  const headColor = loading
    ? 'var(--muted)'
    : authRequired
      ? '#e0b45f' // ambre : clé requise, pas alarmant
      : errored
        ? '#e0736f' // rouge doux : échec
        : 'var(--accent-bright)'; // ok

  return (
    <div className="rounded-lg border border-[var(--border-primary)] bg-white/[0.015] px-3 py-2.5">
      {/* En-tête de fiche : icône + nom outil + pastille d'état */}
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: headColor }} />
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest" style={{ color: headColor }}>
          {label}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />}
          {authRequired && (
            <span className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-[#e0b45f]">
              <KeyRound className="w-3 h-3" /> clé requise
            </span>
          )}
          {errored && (
            <span className="text-[9px] font-mono uppercase tracking-wider text-[#e0736f]">échec</span>
          )}
          {result?.ok && (
            <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--accent)]">ok</span>
          )}
        </span>
      </div>

      {/* Corps de fiche */}
      {loading && (
        <div className="text-[10px] font-mono text-[var(--faint)]">{OSINT_TOOL_HINTS[tool]}</div>
      )}

      {authRequired && (
        <div className="text-[10px] font-mono text-[#e0b45f]/90 leading-relaxed">
          Clé API non configurée côté serveur. Renseigner la clé pour activer cet outil.
        </div>
      )}

      {errored && (
        <div className="text-[10px] font-mono text-[#e0736f] bg-[#e0736f]/10 border border-[#e0736f]/25 rounded px-2 py-1">
          {result?.error ?? 'échec'}
        </div>
      )}

      {result?.ok && result.data && (
        <div className="flex flex-col gap-0.5">{renderData(tool, result.data)}</div>
      )}
    </div>
  );
}

// ── Panneau principal ─────────────────────────────────────────────────────────
function OsintPanel({ onClose, isMobile, onIpPin, ipPinCount = 0, onClearIpPins }: OsintPanelProps) {
  const [query, setQuery] = useState('');
  const [detection, setDetection] = useState<TargetDetection | null>(null);
  const [states, setStates] = useState<ToolState[]>([]);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // AbortController de la campagne en cours : annulé si nouvelle recherche/démontage.
  const abortRef = useRef<AbortController | null>(null);

  // Focus auto du champ à l'ouverture.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Annulation propre au démontage (évite les setState sur composant démonté).
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  /**
   * Lance l'analyse : détecte la cible, prépare les fiches en « chargement »,
   * puis lance chaque outil en parallèle et met à jour au fil de l'eau.
   */
  const analyser = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    // Annule une campagne précédente encore en vol.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const det = detectTargetType(q);
    setDetection(det);

    // Repli : si aucune détection (ne devrait pas arriver, pseudo par défaut).
    const tools = det.tools.length ? det.tools : (['whois', 'dns'] as OsintTool[]);
    track('osint_lookup', { tool: det.kind || 'auto', q }); // q tronqué serveur-side

    // Toutes les fiches démarrent en chargement.
    setStates(tools.map((tool) => ({ status: 'loading', tool })));
    setRunning(true);

    // Cible normalisée si dispo (MAC/CVE/ASN…), sinon saisie brute.
    const target = det.normalized || q;

    // Lancement PARALLÈLE : chaque promesse met à jour SA fiche à sa résolution.
    // On COLLECTE aussi les résultats pour agréger la fiche « pin carte » (IP).
    const collected: Partial<Record<OsintTool, OsintLookupResult>> = {};
    await Promise.allSettled(
      tools.map(async (tool) => {
        const result = await runLookup(tool, target, controller.signal);
        if (controller.signal.aborted) return;
        collected[tool] = result;
        setStates((prev) =>
          prev.map((s) => (s.tool === tool ? { status: 'done', tool, result } : s)),
        );
      }),
    );

    if (controller.signal.aborted) return;
    setRunning(false);

    // ── Pin carte monde : UNIQUEMENT si cible = IP ET Géo-IP a des coordonnées.
    // Coords absentes → PAS de pin (jamais de faux point, cf. géocodage alertes).
    if (det.kind === 'ip' && onIpPin) {
      const ipData = collected.ip?.ok ? collected.ip.data : undefined;
      const lat = typeof ipData?.lat === 'number' ? ipData.lat : undefined;
      const lng = typeof ipData?.lng === 'number' ? ipData.lng : undefined;
      if (ipData && typeof lat === 'number' && typeof lng === 'number') {
        const shodan = collected.shodan?.ok ? collected.shodan.data : undefined;
        const threats = collected.threats?.ok ? collected.threats.data : undefined;
        const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
        const numArr = (v: unknown) =>
          Array.isArray(v) ? v.filter((x) => typeof x === 'number' || typeof x === 'string') as (number | string)[] : undefined;
        const strArr = (v: unknown) =>
          Array.isArray(v) ? (v.filter((x) => typeof x === 'string' && x) as string[]) : undefined;
        onIpPin({
          id: target,
          ip: str(ipData.ip) ?? target,
          lat,
          lng,
          country: str(ipData.country),
          city: str(ipData.city),
          org: str(ipData.org) ?? str(threats?.isp),
          isp: str(ipData.isp) ?? str(threats?.isp),
          asn: str(ipData.asn),
          ports: numArr(shodan?.ports),
          vulns: strArr(shodan?.vulns),
          abuseScore: typeof threats?.abuseScore === 'number' ? threats.abuseScore : undefined,
          abuseReports: typeof threats?.totalReports === 'number' ? threats.totalReports : undefined,
        });
      }
    }
  }, [query, onIpPin]);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void analyser();
    },
    [analyser],
  );

  return (
    <motion.div
      // Apparition douce depuis la droite (charte V3).
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 32 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="absolute z-[207] pointer-events-auto glass-panel border border-[var(--border-primary)] flex flex-col"
      style={{
        top: isMobile ? 'auto' : '112px',
        bottom: isMobile ? '90px' : '120px',
        right: isMobile ? '12px' : '16px',
        left: isMobile ? '12px' : 'auto',
        // Volontairement plus large que les autres panneaux (liste d'outils).
        width: isMobile ? 'auto' : '420px',
        maxHeight: isMobile ? '62vh' : 'calc(100vh - 240px)',
      }}
    >
      {/* ── En-tête ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)]">
        <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
          <Search className="w-3.5 h-3.5" />
          Boîte à outils OSINT
        </span>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white transition-colors"
          title="Fermer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Barre de saisie ── */}
      <form onSubmit={onSubmit} className="px-3 py-2.5 border-b border-[var(--border-primary)]">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cible : IP, domaine, email, CVE, pseudo, MAC, tél…"
            spellCheck={false}
            autoComplete="off"
            className="flex-1 min-w-0 bg-black/25 border border-[var(--border-primary)] rounded-md px-2.5 py-1.5 text-[12px] font-mono text-white placeholder:text-[var(--faint)] outline-none focus:border-[var(--accent-line)] focus:shadow-[0_0_0_3px_var(--accent-soft)] transition"
          />
          <button
            type="submit"
            disabled={!query.trim() || running}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-[var(--accent-bright)] border border-[var(--accent-line)] bg-[var(--accent-soft)] hover:brightness-125 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            Analyser
          </button>
        </div>

        {/* Type détecté + outils lancés */}
        {detection && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest text-[var(--faint)]">
              <Target className="w-3 h-3" />
              Détecté :
            </span>
            <span className="text-[10px] font-mono text-[var(--accent-bright)]">{detection.label}</span>
            <span className="text-[9px] font-mono text-[var(--faint)]">·</span>
            <span className="text-[9px] font-mono text-[var(--faint)]">
              {states.length} outil{states.length > 1 ? 's' : ''} lancé{states.length > 1 ? 's' : ''}
            </span>
          </div>
        )}
      </form>

      {/* ── Corps : fiches résultat au fil de l'eau ── */}
      <div className="overflow-y-auto styled-scrollbar flex-1 px-3 py-3 flex flex-col gap-2.5">
        {states.length === 0 && (
          <div className="flex flex-col items-center gap-2 text-center py-6 px-4">
            <Info className="w-5 h-5 text-[var(--faint)]" />
            <p className="text-[11px] font-mono text-[var(--muted)] leading-relaxed">
              Saisis une cible puis « Analyser ». Le type est détecté
              automatiquement et les outils pertinents sont lancés en parallèle.
            </p>
          </div>
        )}

        {states.map((s) => (
          <ToolCard key={s.tool} state={s} />
        ))}
      </div>

      {/* ── Barre pins IP sur la carte (empilables, retirables) ── */}
      {ipPinCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-[var(--border-primary)]">
          <span className="flex items-center gap-1.5 text-[10px] font-mono text-[#22d3ee]">
            <span style={{ display: 'inline-block', width: 9, height: 9, background: '#22d3ee', border: '1.5px solid #f2fbff', borderRadius: 2, transform: 'rotate(45deg)' }} />
            {ipPinCount} IP sur la carte
          </span>
          <button
            onClick={() => onClearIpPins?.()}
            className="ml-auto text-[10px] font-mono uppercase tracking-wider text-[#ff9b9f] hover:text-[#ff6b74] border border-[#ff6b74]/30 hover:border-[#ff6b74]/60 rounded px-2 py-0.5 transition-colors"
            title="Retirer tous les pins IP de la carte"
          >
            ✕ Vider les IP
          </button>
        </div>
      )}

      {/* ── Pied : rappel du cadre ARPD ── */}
      <div className="px-3 py-2 border-t border-[var(--border-primary)]">
        <p className="text-[8px] font-mono uppercase tracking-widest text-[var(--faint)] leading-relaxed">
          Données publiques uniquement · veille / enquête légale · cadre ARPD
        </p>
      </div>
    </motion.div>
  );
}

export default memo(OsintPanel);
