'use client';

// 🩺 GlobalDebugCapsule — monte la capsule debug (invention #15) sur TOUT le site
//  (accueil `/`, `/login`, `/cockpit/*` et toute route future), pas seulement le
//  cockpit. Demande Cissou 13/07 : c'est l'outil de debug du portage du moteur de
//  recherche depuis l'accueil.
//
//  ⚠️ FLAG QUI COUPE LE MONTAGE (pas juste l'affichage) : `NEXT_PUBLIC_DEBUG_CAPSULE`
//  est inliné au BUILD. À `=0`, on `return null` AVANT de rendre la capsule → aucune
//  instance montée (jamais visible sur une future prod publique / pitch national).
//  Une SEULE instance, au layout racine → zéro double-montage.

import DebugCapsule from '@/components/DebugCapsule';
import OsirisDiagView from '@/components/OsirisDiagView';
import { OSIRIS_VERSION } from '@/lib/version';
import { BASE_PATH } from '@/lib/api';

const ENABLED = process.env.NEXT_PUBLIC_DEBUG_CAPSULE !== '0';

export default function GlobalDebugCapsule() {
  if (!ENABLED) return null;
  return (
    <DebugCapsule
      appName="OSIRIS V4"
      version={OSIRIS_VERSION}
      enabled
      position="bottom-left"
      // Onglet « App » = moniteur des sources amont du cockpit (utile depuis n'importe
      // quelle page pour diagnostiquer le portage). Le diag ne se fetch QUE quand
      // l'onglet App est ouvert → aucun appel de fond sur l'accueil.
      getAppDiag={() => fetch(`${BASE_PATH}/live-feed/diag`, { cache: 'no-store', credentials: 'include' }).then((r) => r.json())}
      renderAppDiag={(d) => <OsirisDiagView diag={d} />}
    />
  );
}
