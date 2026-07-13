// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — OSINT / WHOIS (RDAP) : lookup domaine ou IP.
//
//  RÔLE : renvoyer les informations d'enregistrement publiques d'un DOMAINE
//  ou d'une ADRESSE IP via le protocole RDAP (successeur structuré du WHOIS).
//
//  SOURCE PUBLIQUE GRATUITE (sans clé) :
//    • domaine → https://rdap.org/domain/{q}
//    • IP      → https://rdap.org/ip/{q}
//  rdap.org agit en routeur : il redirige vers le serveur RDAP autoritaire du
//  registre/RIR concerné. On ne fait AUCUNE requête vers la cible utilisateur :
//  on interroge un FOURNISSEUR fixe (rdap.org), la cible n'est qu'un paramètre.
//
//  CADRE DÉFENSIF ARPD : données d'enregistrement PUBLIQUES, déjà diffusées par
//  les registres. Usage strictement veille / enquête légale. Aucun ciblage
//  abusif, aucune donnée n'est collectée sur une personne au-delà de ce que le
//  registre publie déjà librement.
//
//  CONTRAT :
//    GET /osint/whois?q=<domaine|ip>
//    → 200 { type, registrar?, created?, expires?, nameservers?, statuses?, raw? }
//    → 200 { error: 'message FR', type } en cas d'échec (dégradation douce, jamais 500)
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { isIP } from 'node:net';
import { safeFetch } from '@/lib/ssrf-guard';

// Toujours dynamique : lookup à la demande, jamais de pré-rendu / cache statique.
export const dynamic = 'force-dynamic';

/** Timeout réseau vers rdap.org (ms). */
const FETCH_TIMEOUT_MS = 8_000;
/** Longueur max acceptée pour la cible (garde-fou anti-abus). */
const MAX_Q_LEN = 253; // limite d'un FQDN
/** User-Agent identifiant l'appelant (étiquette). */
const USER_AGENT = 'Osiris-Cockpit/4.0 (ARPD veille; +https://osiris.cissouhub.cloud)';

/** Réponse normalisée renvoyée au client. */
interface WhoisResult {
  type: 'domaine' | 'ip' | 'inconnu';
  registrar?: string;
  created?: string;
  expires?: string;
  nameservers?: string[];
  statuses?: string[];
  raw?: unknown;
  error?: string;
}

/**
 * Valide/sanitize la cible. Autorise un FQDN (lettres, chiffres, tirets, points)
 * ou une IP littérale. Renvoie null si invalide → le handler dégradera en douceur.
 */
function sanitizeTarget(raw: string | null): string | null {
  if (!raw) return null;
  const q = raw.trim().toLowerCase();
  if (!q || q.length > MAX_Q_LEN) return null;
  // IP littérale (v4/v6) acceptée telle quelle.
  if (isIP(q) !== 0) return q;
  // Sinon : nom de domaine — caractères stricts, pas de schéma ni de chemin.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(q)) return null;
  return q;
}

/** Extrait la première date d'un type d'événement RDAP (registration/expiration). */
function findEventDate(events: unknown, action: string): string | undefined {
  if (!Array.isArray(events)) return undefined;
  for (const e of events) {
    if (e && typeof e === 'object') {
      const o = e as Record<string, unknown>;
      if (o.eventAction === action && typeof o.eventDate === 'string') return o.eventDate;
    }
  }
  return undefined;
}

/**
 * Cherche le registrar dans les entités RDAP : entité portant le rôle
 * « registrar », dont on lit le nom via le vCard (fn) si présent.
 */
function findRegistrar(entities: unknown): string | undefined {
  if (!Array.isArray(entities)) return undefined;
  for (const e of entities) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const roles = Array.isArray(o.roles) ? (o.roles as unknown[]) : [];
    if (!roles.includes('registrar')) continue;
    // vcardArray : ['vcard', [ [...], ['fn', {}, 'text', 'Nom Registrar'], ... ]]
    const vcard = o.vcardArray;
    if (Array.isArray(vcard) && Array.isArray(vcard[1])) {
      for (const field of vcard[1] as unknown[]) {
        if (Array.isArray(field) && field[0] === 'fn' && typeof field[3] === 'string') {
          return field[3];
        }
      }
    }
    if (typeof o.handle === 'string') return o.handle; // repli
  }
  return undefined;
}

export async function GET(request: NextRequest) {
  const q = sanitizeTarget(request.nextUrl.searchParams.get('q'));
  if (!q) {
    return NextResponse.json(
      { type: 'inconnu', error: 'cible invalide (domaine ou IP attendu)' } satisfies WhoisResult,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const isIpTarget = isIP(q) !== 0;
  const type: WhoisResult['type'] = isIpTarget ? 'ip' : 'domaine';
  const path = isIpTarget ? 'ip' : 'domain';
  const upstream = `https://rdap.org/${path}/${encodeURIComponent(q)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(upstream, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/rdap+json, application/json', 'User-Agent': USER_AGENT },
      maxRedirects: 3, // rdap.org redirige vers le serveur autoritaire
    });
    if (!res.ok) {
      const msg = res.status === 404 ? 'objet introuvable dans RDAP' : `amont RDAP ${res.status}`;
      return NextResponse.json(
        { type, error: msg } satisfies WhoisResult,
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const data = (await res.json()) as Record<string, unknown>;

    const nsList = Array.isArray(data.nameservers)
      ? (data.nameservers as unknown[])
          .map((n) => (n && typeof n === 'object' ? (n as Record<string, unknown>).ldhName : undefined))
          .filter((v): v is string => typeof v === 'string')
      : undefined;

    const result: WhoisResult = {
      type,
      registrar: findRegistrar(data.entities),
      created: findEventDate(data.events, 'registration'),
      expires: findEventDate(data.events, 'expiration'),
      nameservers: nsList && nsList.length ? nsList : undefined,
      statuses: Array.isArray(data.status)
        ? (data.status as unknown[]).filter((s): s is string => typeof s === 'string')
        : undefined,
      raw: data,
    };
    return NextResponse.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return NextResponse.json(
      { type, error: aborted ? 'timeout RDAP' : 'échec réseau RDAP' } satisfies WhoisResult,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } finally {
    clearTimeout(timeout);
  }
}
