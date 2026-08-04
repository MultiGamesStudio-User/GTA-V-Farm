# Auto Bouffe BETA : bascule Moondream Cloud → Photon (inférence locale GPU)

## Problème

La page Auto Bouffe BETA (`page-autobouffe-beta.js`, clone sandbox isolé de la page
Auto Bouffe production) appelle aujourd'hui `vlm_ask`/`vlm_warmup`/`vlm_unload` qui,
côté Python, pointent tous sur `modules/engine/vlm_engine.py` — HTTP vers
Moondream Cloud (`api.moondream.ai`). Objectif : sur la page BETA uniquement,
faire tourner ces mêmes questions via **Photon**, le moteur d'inférence GPU
local de Moondream (`pip install moondream`, `md.vl(api_key, local=True)`,
GPU NVIDIA requis), sans toucher au chemin Cloud utilisé par la page production.

## Décision

- Page BETA passe en **local uniquement** (pas de sélecteur Cloud/Local — un seul
  mode, plus simple, la comparaison se fait en gardant la page production sur Cloud).
- Nouveau module Python dédié plutôt que d'étendre `vlm_engine.py` : ce fichier
  documente aujourd'hui explicitement "Cloud only" et sert la page production —
  le garder intact évite tout risque de régression sur le chemin utilisé en vrai.
- Réutilisation du mécanisme d'installation à la demande déjà en place pour
  EasyOCR/WinRT (`ensureOcrDeps()` dans `electron-app/main.js`) plutôt qu'une
  installation manuelle documentée : le package `moondream` (lourd, GPU-only)
  s'installe en tâche de fond, déclenché à la première entrée sur la page BETA
  (pas au démarrage de l'app comme l'OCR, qui lui sert à tout le monde).
- Cycle warmup/unload réel (charge/libère le modèle en VRAM) plutôt que "charger
  une fois et garder en VRAM" : réutilise la logique déjà présente dans le clone
  JS (`_ABFB_VLM_WARMUP_LEAD_MS` — recharge ~10s avant chaque scan, décharge juste
  après), aujourd'hui no-op côté Python. Limite l'occupation VRAM pendant les
  longs intervalles entre cycles (potentiellement des heures), au prix d'un
  rechargement à chaque cycle.

## Design

### Flux de données
```
page-autobouffe-beta.js (_abfbAskTitle / _abfbVlmWarmup / _abfbVlmUnload)
  → window.api.vlmAsk({x,y,w,h,question,api_key,local:true})   (idem warmup/unload)
  → preload.js (passthrough générique, params spread tel quel)
  → main.js ipcMain.handle('engine:vlm_ask', ...) → engineCmd({cmd, ...params}, 300000)
  → main.py _cmd_vlm_ask → cmd.get('local') → modules/engine/vlm_engine_local.py
  → moondream package (md.vl(api_key, local=True)) → GPU NVIDIA
```
La page production n'envoie jamais `local:true` → branch existante `vlm_engine.py`
(Cloud) inchangée, zéro régression.

### Composants

**`modules/engine/vlm_engine_local.py`** (nouveau)
- Import `moondream` en lazy (à l'intérieur des fonctions, pas au niveau module) —
  package non présent dans `requirements.txt`/python-embed, cohérent avec le
  pattern déjà suivi par `ocr_engine.py` pour easyocr/winrt.
- Cache module-level (`_model = None`) du modèle chargé — un seul processus
  Python (`main.py`), pas de souci de concurrence multi-process à gérer.
- `warmup_local(api_key) -> None` : si `_model is None`, `md.vl(api_key=api_key, local=True)`,
  stocke dans le cache. No-op si déjà chargé.
- `unload_local() -> None` : `del _model` (remis à `None`), `torch.cuda.empty_cache()`
  si torch importable (le package moondream l'embarque de toute façon comme dépendance).
- `ask_image_local(pil_image, question, api_key) -> str` : lazy-load via
  `warmup_local` si le cache est vide (couvre le bouton "Tester" utilisé isolément,
  sans cycle de warmup préalable), puis `model.query(pil_image, question)['answer']`.
- Même contrat d'erreurs que `vlm_engine.py` : lève `RuntimeError` avec message
  clair (clé API manquante, import échoué → GPU/driver absent, etc.) — remonte
  tel quel via le `try/except` déjà présent dans `_cmd_vlm_ask`.

**`main.py`** (modifié)
- `_cmd_vlm_ask`, `_cmd_vlm_warmup`, `_cmd_vlm_unload` : branch sur `cmd.get('local')`.
  Si vrai → import et appel de `vlm_engine_local`, sinon comportement actuel
  (`vlm_engine`, Cloud) inchangé.
- `_cmd_vlm_warmup`/`_cmd_vlm_unload` deviennent réels (au lieu de no-op) *seulement*
  quand `local:true` — le commentaire actuel ("no-op: Cloud n'a pas de VRAM à libérer")
  reste vrai pour la branche Cloud.

**`electron-app/main.js`** (modifié)
- Nouvelle fonction `ensureMoondreamLocalDeps()`, calquée sur `ensureOcrDeps()` :
  marker file séparé (`.moondream_local_deps_installed`, même `AI_DEPS_DIR`),
  `pip install --target AI_DEPS_DIR moondream`, mêmes 3 tentatives/retry-delay.
  `AI_DEPS_DIR` est déjà sur le `sys.path` de `main.py` au démarrage
  (`MACROENGINE_AI_DEPS_DIR`, voir `main.py:29-31`) — aucun ajout de path côté
  Python nécessaire, `import moondream` marche directement une fois installé.
- Nouveau handler `ipcMain.handle('deps:ensure-moondream-local', ...)` qui appelle
  cette fonction (fire-and-forget côté renderer, comme `setup:progress` pour l'OCR).

**`electron-app/preload.js`** (modifié)
- Ajoute `ensureMoondreamLocalDeps: () => ipcRenderer.invoke('deps:ensure-moondream-local')`.
  `vlmAsk`/`vlmWarmup`/`vlmUnload` restent inchangés (passthrough générique déjà
  suffisant pour transporter `local:true`).

**`electron-app/renderer/js/page-autobouffe-beta.js`** (modifié)
- `initAutoBouffeBeta()` appelle `window.api.ensureMoondreamLocalDeps()` (fire-and-forget,
  ne bloque pas l'affichage de la page).
- `_abfbAskTitle`, `_abfbVlmWarmup`, `_abfbVlmUnload` : ajoutent `local: true` au
  payload envoyé.
- Libellés UI ("Moondream Cloud" → "Photon (GPU local NVIDIA)") dans les logs et
  le texte d'aide de la section détection IA.

**`electron-app/renderer/index.html`** (modifié)
- Section `#page-autobouffe-beta` : texte d'aide sous "Détection IA (état inventaire)"
  mis à jour (mention GPU NVIDIA requis + install auto en tâche de fond au lieu de
  "IA en ligne, pas de téléchargement local").

### Gestion des erreurs
- `moondream` non installé / import échoué / pas de GPU NVIDIA → exception capturée
  par le `try/except` déjà présent dans `_cmd_vlm_ask` (thread `_run`) →
  `_reply(rid, False, error=str(e))` → `appendLog('WARNING', ...)` côté JS, chemin
  déjà exercé aujourd'hui pour les erreurs Cloud (clé invalide, etc.), aucune
  branche d'erreur nouvelle à écrire côté JS.
- Échec d'installation du package (pas d'accès pip, GPU absent) → non-fatal,
  logué en `WARNING`/`ERROR` dans `app.log` comme pour l'OCR ; la page BETA reste
  utilisable pour tout le reste (calibration fenêtre/zone), seule la détection
  IA échouera au moment du test.

## Changement de comportement

Page production Auto Bouffe : aucun. Page BETA : la détection IA passe de Cloud
(réseau, clé API partagée) à Photon local (GPU NVIDIA obligatoire, premier appel
plus lent le temps du `pip install` en tâche de fond puis du chargement modèle
en VRAM). Sans GPU NVIDIA compatible, la détection IA de la page BETA restera en
échec permanent (erreur loguée) — attendu, pas un bug à corriger ici.

## Statut

Non implémenté — ce document sert de base au plan d'implémentation.
