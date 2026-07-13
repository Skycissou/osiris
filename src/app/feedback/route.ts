// POST /feedback — réception d'un retour utilisateur (bug/question/idée).
// Ouvert (pas de gate) : c'est une soumission utilisateur. Stockage JSONL + webhook.
import { recordFeedback } from '@/lib/search/feedback';

export const dynamic = 'force-dynamic';

const clip = (v: unknown, n: number) => String(v ?? '').slice(0, n);

export async function POST(request: Request): Promise<Response> {
  let payload: Record<string, unknown> = {};
  try { payload = await request.json(); } catch { payload = {}; }
  const entry = {
    type: clip(payload.type || 'feedback', 40),
    name: clip(payload.name, 120),
    email: clip(payload.email, 160),
    message: clip(payload.message, 4000),
    url: clip(payload.url, 300),
    ua: clip(payload.ua, 300),
  };
  if (!entry.message.trim()) return Response.json({ ok: false, error: 'message vide' });
  try {
    const status = await recordFeedback(entry);
    return Response.json({ ok: true, ...status });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
