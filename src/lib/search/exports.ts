// ─────────────────────────────────────────────────────────────────────────
//  Exports — PORTAGE de open_radar/exports.py : rapport markdown + bundle CSV
//  (metadata + résultats) à partir d'une réponse `SearchResponse`.
// ─────────────────────────────────────────────────────────────────────────

import type { SearchResponse, RadarCard } from '@/lib/api';

type AnyResp = SearchResponse;

export function renderMarkdownReport(response: AnyResp): string {
  const lines: string[] = [
    `# Rapport Open Radar FR — ${response.query_type ?? 'recherche'} — ${response.timestamp ?? ''}`,
    '',
    '## Requête',
    `- Terme : ${response.query ?? ''}`,
    `- Type : ${response.query_type ?? 'inconnu'}`,
    `- Date : ${response.timestamp ?? ''}`,
    '',
    '## Sources consultées',
  ];
  const sources = response.sources_consulted ?? [];
  if (sources.length) {
    for (const s of sources) {
      const marker = s.status === 'ok' ? '✅' : s.status === 'partial' ? '⚠️' : '❌';
      lines.push(`- ${marker} ${s.name ?? 'Source'} — ${s.status ?? 'inconnu'} — ${s.url ?? ''}`);
    }
  } else {
    lines.push('- Aucune source consultée dans ce rapport.');
  }

  lines.push('', '## Résultats');
  const rawCards: RadarCard[] = (response.results as SearchResponse['results'])?.raw_cards ?? [];
  if (rawCards.length) {
    for (const c of rawCards) {
      lines.push(
        `### ${c.title ?? 'Résultat'}`,
        `- Source : ${c.source_label ?? ''}`,
        `- Statut : ${c.status ?? ''}`,
        `- Résumé : ${c.summary ?? ''}`,
        `- URL : ${c.raw_ref?.url ?? ''}`,
        '',
      );
    }
  } else {
    lines.push('Aucun résultat exploitable dans les sources consultées.');
  }

  lines.push('', '## ⚠️ Ce que ces données NE permettent PAS de conclure');
  for (const item of response.cannot_conclude ?? []) lines.push(`- ${item}`);

  lines.push('', '## Références officielles');
  for (const s of sources) if (s.url) lines.push(`- ${s.name ?? 'Source'} : ${s.url}`);

  lines.push(
    '', '---',
    `⚠️ Ce document a été généré automatiquement par Open Radar FR le ${response.timestamp ?? ''}.`,
    "Il ne constitue pas un document officiel et ne peut pas remplacer une consultation du Registre du Commerce, du BODACC officiel ou d'un professionnel qualifié.",
  );
  return lines.join('\n') + '\n';
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvText(rows: Record<string, unknown>[], fieldnames: string[]): string {
  const out: string[] = [
    '# DONNÉES PUBLIQUES BRUTES — OPEN RADAR FR — Sources officielles uniquement',
    '# Ce fichier ne constitue pas un document officiel.',
    fieldnames.join(','),
  ];
  for (const row of rows) out.push(fieldnames.map((f) => csvCell(row[f])).join(','));
  return out.join('\r\n') + '\r\n';
}

export function renderCsvBundle(response: AnyResp): Record<string, string> {
  const ts = response.timestamp ?? '';
  const metadataRows = (response.sources_consulted ?? []).map((s) => ({
    source_officielle: s.name ?? '', url: s.url ?? '', status: s.status ?? '', date_extraction: ts,
  }));
  if (metadataRows.length === 0) {
    metadataRows.push({ source_officielle: 'Aucune source consultée', url: '', status: 'empty', date_extraction: ts });
  }
  const rawCards: RadarCard[] = (response.results as SearchResponse['results'])?.raw_cards ?? [];
  const cardsRows = rawCards.map((c) => ({
    source_officielle: c.source_label ?? '', status: c.status ?? '', title: c.title ?? '',
    subtitle: c.subtitle ?? '', summary: c.summary ?? '', url: c.raw_ref?.url ?? '', date_extraction: ts,
  }));
  return {
    'metadata.csv': csvText(metadataRows, ['source_officielle', 'url', 'status', 'date_extraction']),
    'results.csv': csvText(cardsRows, ['source_officielle', 'status', 'title', 'subtitle', 'summary', 'url', 'date_extraction']),
  };
}
