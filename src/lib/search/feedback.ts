// ─────────────────────────────────────────────────────────────────────────
//  Feedback — PORTAGE de open_radar/feedback.py (version au plus simple, plan
//  Phase 4) : stockage append-only JSONL sur le volume + webhook best-effort.
//  (SMTP direct du Python = OMIS : optionnel, env-gaté, pas de dépendance mail
//  ajoutée ; le webhook n8n couvre la notification.) Rien ne fait échouer la requête.
// ─────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.OSIRIS_DATA || process.env.OSIRIS_ALERTS_DIR || '/app/data';

export interface FeedbackEntry {
  type: string;
  name: string;
  email: string;
  message: string;
  url: string;
  ua: string;
}

export interface FeedbackStatus {
  stored: boolean;
  webhook: boolean;
  email: boolean;
}

export async function recordFeedback(entry: FeedbackEntry): Promise<FeedbackStatus> {
  const withTs = { ...entry, received_at: new Date().toISOString() };
  const status: FeedbackStatus = { stored: false, webhook: false, email: false };

  // 1) stockage local (filet de sécurité)
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.appendFile(path.join(DATA_DIR, 'feedback.jsonl'), JSON.stringify(withTs) + '\n', 'utf-8');
    status.stored = true;
  } catch {
    // best effort
  }

  // 2) webhook (ex : workflow n8n qui envoie le mail)
  const hook = process.env.OSIRIS_FEEDBACK_WEBHOOK;
  if (hook) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withTs), signal: ctrl.signal });
      clearTimeout(timer);
      status.webhook = true;
    } catch {
      // best effort
    }
  }
  return status;
}

/** Lit les feedbacks stockés (pour /feedback/list admin). Plus récents d'abord. */
export async function listFeedback(): Promise<Array<Record<string, unknown>>> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, 'feedback.jsonl'), 'utf-8');
    const rows = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return (rows as Array<Record<string, unknown>>).reverse();
  } catch {
    return [];
  }
}
