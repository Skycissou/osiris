# Security Policy

## Responsible Usage
The OSIRIS Project provides powerful Open Source Intelligence (OSINT) and cybersecurity monitoring tools designed to visualize and analyze global threat landscapes. 

**By using this software, you agree to the following:**
1. **Defensive Use Only:** The tools, scripts, and intelligence capabilities provided in this repository must be used strictly for defensive, educational, and authorized monitoring purposes.
2. **Authorized Targets:** Do not use OSIRIS to scan, probe, or interact with infrastructure, networks, or systems that you do not own or have explicit authorization to monitor.
3. **Compliance with Laws:** You are responsible for ensuring that your use of OSIRIS complies with all applicable local, state, national, and international laws and regulations.
4. **No Malicious Intent:** Any use of OSIRIS for malicious activities, offensive cyber operations, or unauthorized data harvesting is strictly prohibited.

The creators and contributors of OSIRIS are not responsible for any misuse or damage caused by this software. Use it responsibly and ethically.

## Reporting a Vulnerability

We take the security of our project seriously. If you discover a security vulnerability within the OSIRIS codebase itself, please do not disclose it publicly.

**To report a vulnerability:**
1. Please open an issue in the GitHub repository and label it appropriately, or contact the repository maintainers directly if a private channel is available.
2. Provide a detailed description of the vulnerability, including steps to reproduce it and the potential impact.
3. Our team will acknowledge the receipt of your report and provide an estimated timeline for resolution.

We appreciate your efforts in keeping OSIRIS secure for everyone!

---

## Télémétrie UI (dispositif interne — V4.035+)

OSIRIS V4 trace **de façon anonyme** les actions dans l'application (cockpit) pour
diagnostiquer les bugs et vérifier que chaque couche/appel fonctionne. Ce dispositif
est conçu **minimisation-first** (posture ARPD / RGPD).

### Ce qui est collecté
- Un identifiant de **session anonyme** (`sid`), aléatoire, stocké dans `sessionStorage` :
  il **meurt avec l'onglet**, n'identifie pas la personne, n'est jamais corrélé à un
  compte.
- Des **événements d'usage** typés (whitelist stricte) : bascule de couche, recherche,
  lookup OSINT, clic actu, ouverture d'entité, action graphe, application de preset,
  raccourci, création de partage, **enregistrement de clé** (voir ci-dessous),
  déplacement de carte (zoom, throttlé 5 s).
- Des **captures automatiques** : chargement de page, `fetch` applicatif (chemin, statut
  HTTP, latence, succès/échec), erreurs JS et rejets de promesse (dédupliqués 30 s).

### Ce qui n'est JAMAIS collecté
- ❌ **Aucune valeur de clé API, mot de passe, cookie ou token** — pour `apikey_save`,
  seul le **nom du service** est enregistré (jamais la valeur saisie).
- ❌ **Aucune adresse IP**, **aucun user-agent**, aucune donnée de géolocalisation
  personnelle.
- ❌ Aucune donnée nominative. Les chaînes (requêtes, messages d'erreur) sont **tronquées**
  côté serveur (bornes dans `lib/uiTelemetryTypes.ts`).

### Garanties techniques
- **Ingest** `POST /cockpit/telemetry/ui` : **same-origin obligatoire** (403 sinon),
  payload **≤ 32 Ko**, **rate-limit 120 req/min/session** (429 au-delà), validation
  stricte des types (tout type inconnu est rejeté silencieusement), re-troncature serveur.
- **Stockage** : fichiers **JSONL** locaux (`data/ui-telemetry/AAAA-MM-JJ.jsonl`, hors
  Git), **purgés automatiquement au-delà de 7 jours** (au démarrage + toutes les 24 h).
- **Kill-switch** : variable d'environnement **`OSIRIS_UI_TELEMETRY=off`** → l'ingest
  répond 204 et ne stocke plus rien (aucun rebuild nécessaire).
- **Fail-safe** : tout le tracker client est enveloppé de `try/catch` — une panne de
  télémétrie **ne casse jamais** l'interface.

### Accès en lecture (diag)
- La page **`/cockpit/diag`** et les routes `/cockpit/live-feed/diag/sessions` et
  `/cockpit/live-feed/diag/session` sont **protégées par un token** :
  variable **`OSIRIS_DIAG_TOKEN`** (comparée à l'en-tête `x-diag-token` ou au paramètre
  `?token=`).
- **Sécurisé par défaut** : si `OSIRIS_DIAG_TOKEN` n'est **pas** défini, ces routes
  répondent **403 en production** (ouvertes uniquement en `NODE_ENV=development`).
- La lecture est **locale au serveur** (aucune exfiltration), en lecture seule.
