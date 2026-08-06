# Auto Bouffe BETA → Photon local (Moondream GPU) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every AI call on the Auto Bouffe BETA sandbox page (`page-autobouffe-beta.js`) run through Moondream Photon (local GPU inference, `pip install moondream`, `local=True`) instead of Moondream Cloud, while leaving the production Auto Bouffe page's Cloud path completely untouched.

**Architecture:** New Python module `modules/engine/vlm_engine_local.py` mirrors `vlm_engine.py`'s public surface (`ask_image`/`ask_region`/`warmup`/`unload`) but backs it with the local `moondream` package instead of an HTTP call. `main.py`'s three `vlm_*` IPC handlers branch on a new `cmd['local']` boolean to pick which module to call — the production page never sends that flag, so its behavior is unchanged. `electron-app/main.js` gets an on-demand installer for the `moondream` package (same pattern as the existing EasyOCR/WinRT installer), triggered once when the BETA page is opened. `page-autobouffe-beta.js` is updated to always send `local: true`.

**Tech Stack:** Python 3 (stdlib only for the new module + lazy `moondream` import), Electron/Node (`child_process`, existing `_runChildStreaming` helper), vanilla JS renderer (no framework).

## Global Constraints

- Production Auto Bouffe page (`page-autobouffe.js`, `vlm_engine.py`) must not change behavior — verified by never sending `cmd['local']` from that file.
- No test framework exists in this repo (see `CLAUDE.md`: "no lint script and no project-level automated test suite") — verification steps below use direct `python -c`/`node --check` smoke checks and manual app testing, matching the project's existing debug convention (`python -m pdb main.py`).
- `moondream` is a GPU-only, heavy dependency — never add it to `requirements.txt`/bundle; install on demand into `AI_DEPS_DIR` only, exactly like `easyocr`/`winsdk` (`electron-app/main.js`'s `ensureOcrDeps()`).
- Every new/changed log message user-facing in French, matching the rest of the codebase.

---

### Task 1: `vlm_engine_local.py` — Photon local inference module

**Files:**
- Create: `modules/engine/vlm_engine_local.py`

**Interfaces:**
- Produces: `warmup(api_key: str, on_log=None) -> None`, `unload(on_log=None) -> None`, `ask_image(pil_image, question: str, api_key: str, on_log=None) -> str`, `ask_region(x: int, y: int, w: int, h: int, question: str, api_key: str, on_log=None) -> str`. Same signatures/semantics as `modules/engine/vlm_engine.py`'s `ask_image`/`ask_region`, so `main.py` can call either module through one variable. Raises `RuntimeError` with a French message on any failure (missing key, missing package, no GPU) — never lets a raw `ImportError`/CUDA exception escape.

- [ ] **Step 1: Write the module**

```python
"""
vlm_engine_local.py — Moondream Photon (local GPU inference) for Auto Bouffe
BETA's UI-state detection sandbox.

Mirrors vlm_engine.py's public surface (ask_image/ask_region/warmup/unload)
but runs the model on-device via the `moondream` package's local=True mode
instead of hitting Moondream Cloud over HTTP — no network round-trip, but
requires an NVIDIA GPU and the `moondream` package. Pip-installed on demand
into AI_DEPS_DIR by electron-app/main.js's ensureMoondreamLocalDeps(), same
pattern as EasyOCR/WinRT (see ocr_engine.py) — never bundled, imported lazily
here so this module stays importable even before the package exists.

Only the Auto Bouffe BETA sandbox page ever triggers this module (via
main.py's `cmd.get('local')` branch) — the production Auto Bouffe page always
goes through vlm_engine.py (Cloud), untouched by this file.
"""
from __future__ import annotations

_MODEL = None  # cached moondream.VL instance, loaded lazily, freed by unload()


def warmup(api_key: str, on_log=None) -> None:
    """Load the Photon model into VRAM if not already cached. No-op if a
    model is already loaded — call unload() first to force a reload."""
    global _MODEL
    if _MODEL is not None:
        return
    if not api_key:
        raise RuntimeError("clé API Moondream manquante — configure-la dans l'onglet Auto Bouffe BETA.")
    try:
        import moondream as md
    except ImportError as e:
        raise RuntimeError(
            "package 'moondream' introuvable — installation en tâche de fond au premier "
            "affichage de la page BETA, réessaie dans une minute ou deux."
        ) from e
    if on_log:
        on_log('Photon: chargement du modèle en VRAM…', 'INFO')
    try:
        _MODEL = md.vl(api_key=api_key, local=True)
    except Exception as e:
        raise RuntimeError(f"Photon: échec du chargement du modèle (GPU NVIDIA requis) — {e}") from e
    if on_log:
        on_log('Photon: modèle chargé.', 'INFO')


def unload(on_log=None) -> None:
    """Free the cached model (and its VRAM) if one is loaded. No-op otherwise."""
    global _MODEL
    if _MODEL is None:
        return
    _MODEL = None
    try:
        import torch
        torch.cuda.empty_cache()
    except ImportError:
        pass
    if on_log:
        on_log('Photon: modèle déchargé.', 'INFO')


def ask_image(pil_image, question: str, api_key: str, on_log=None) -> str:
    """Ask a natural-language question about a PIL image via Photon (local
    GPU), return the answer text. Lazily loads the model if warmup() wasn't
    called first (e.g. the "Tester" button used on its own)."""
    warmup(api_key, on_log=on_log)
    answer = _MODEL.query(pil_image, question)['answer']
    if on_log:
        on_log(f'Photon → "{answer}"', 'INFO')
    return answer


def ask_region(x: int, y: int, w: int, h: int, question: str, api_key: str, on_log=None) -> str:
    from .screen_reader import capture_region_pil
    img = capture_region_pil(x, y, w, h)
    return ask_image(img, question, api_key, on_log)
```

- [ ] **Step 2: Verify the module imports without the `moondream` package installed (lazy import check)**

Run (from repo root):
```bash
python -c "
import sys; sys.path.insert(0, '.')
from modules.engine import vlm_engine_local
print('MODEL cache at import:', vlm_engine_local._MODEL)
"
```
Expected: `MODEL cache at import: None` — no `ImportError` even though `moondream` isn't installed in this dev environment, proving the import stays lazy (inside `warmup()`, not at module top).

- [ ] **Step 3: Verify the two offline-testable failure paths**

Run:
```bash
python -c "
import sys; sys.path.insert(0, '.')
from modules.engine import vlm_engine_local as v

try:
    v.warmup('')
except RuntimeError as e:
    print('missing-key ->', e)

try:
    v.warmup('dummy-key-for-test')
except RuntimeError as e:
    print('missing-package ->', e)
"
```
Expected:
```
missing-key -> clé API Moondream manquante — configure-la dans l'onglet Auto Bouffe BETA.
missing-package -> package 'moondream' introuvable — installation en tâche de fond au premier affichage de la page BETA, réessaie dans une minute ou deux.
```

- [ ] **Step 4: Commit**

```bash
git add modules/engine/vlm_engine_local.py
git commit -m "feat: add vlm_engine_local.py — Moondream Photon (local GPU) backend"
```

---

### Task 2: `main.py` — route `vlm_*` IPC commands to Photon when `local` is set

**Files:**
- Modify: `main.py:443-468` (`_cmd_vlm_ask`, `_cmd_vlm_warmup`, `_cmd_vlm_unload`)

**Interfaces:**
- Consumes: `modules.engine.vlm_engine_local.{warmup,unload,ask_region}` (Task 1). `modules.engine.vlm_engine.{ask_region}` (existing, unchanged).
- Produces: IPC commands `vlm_ask`/`vlm_warmup`/`vlm_unload` now understand an optional `cmd['local']` boolean field (defaults to falsy/Cloud when absent — production page keeps working as-is).

- [ ] **Step 1: Replace the three handlers**

In `main.py`, replace lines 443-468 (the current `_cmd_vlm_ask`/`_cmd_vlm_warmup`/`_cmd_vlm_unload`) with:

```python
def _cmd_vlm_ask(cmd, rid):
    """Ask Moondream (Cloud, or Photon local GPU when cmd['local'] is truthy)
    a natural-language question about a screen region — used by Auto Bouffe
    to tell own-inventory / 3rd-party panel / closed apart without brittle
    pixel/OCR/template heuristics. Runs in a background thread and replies
    asynchronously so a slow network/GPU round-trip doesn't block the stdin
    loop that other commands (e.g. stop_all) also depend on."""
    def _run():
        try:
            if cmd.get('local'):
                from modules.engine import vlm_engine_local as engine_mod
            else:
                from modules.engine import vlm_engine as engine_mod
            on_log = lambda msg, lvl: _send({'type': 'log', 'level': lvl, 'msg': msg})
            answer = engine_mod.ask_region(cmd['x'], cmd['y'], cmd['w'], cmd['h'], cmd['question'],
                                            cmd.get('api_key', ''), on_log=on_log)
            _reply(rid, True, answer=answer)
        except Exception as e:
            _reply(rid, False, error=str(e))
    threading.Thread(target=_run, daemon=True, name='vlm-ask').start()

def _cmd_vlm_warmup(cmd, rid):
    """No-op for Moondream Cloud (no local model/VRAM to pre-load). For
    Photon (cmd['local'] truthy), actually loads the model into VRAM — runs
    in a background thread since a first load can take several seconds."""
    if not cmd.get('local'):
        _reply(rid, True)
        return
    def _run():
        try:
            from modules.engine import vlm_engine_local
            on_log = lambda msg, lvl: _send({'type': 'log', 'level': lvl, 'msg': msg})
            vlm_engine_local.warmup(cmd.get('api_key', ''), on_log=on_log)
            _reply(rid, True)
        except Exception as e:
            _reply(rid, False, error=str(e))
    threading.Thread(target=_run, daemon=True, name='vlm-warmup-local').start()

def _cmd_vlm_unload(cmd, rid):
    """No-op for Moondream Cloud. For Photon (cmd['local'] truthy), frees the
    cached model and its VRAM — fast, runs synchronously."""
    if not cmd.get('local'):
        _reply(rid, True)
        return
    try:
        from modules.engine import vlm_engine_local
        on_log = lambda msg, lvl: _send({'type': 'log', 'level': lvl, 'msg': msg})
        vlm_engine_local.unload(on_log=on_log)
        _reply(rid, True)
    except Exception as e:
        _reply(rid, False, error=str(e))
```

- [ ] **Step 2: Verify routing + regression on the Cloud (production) path**

Run:
```bash
python -c "
import sys, time; sys.path.insert(0, '.')
import main

main._cmd_vlm_warmup({'local': False}, 'rid-cloud')
main._cmd_vlm_unload({'local': False}, 'rid-cloud2')
main._cmd_vlm_warmup({'local': True, 'api_key': ''}, 'rid-local-nokey')
time.sleep(0.5)  # the local=True branch replies from a background thread — give it time to flush before the interpreter exits
"
```
Expected stdout (3 JSON lines, order matches call order):
```
{"type": "response", "id": "rid-cloud", "ok": true}
{"type": "response", "id": "rid-cloud2", "ok": true}
{"type": "response", "id": "rid-local-nokey", "ok": false, "error": "clé API Moondream manquante — configure-la dans l'onglet Auto Bouffe BETA."}
```
(`import main` is safe here — the stdin read loop and RAM monitor thread are both gated behind `if __name__ == '__main__':` at the bottom of `main.py`, so importing it only defines functions.)

- [ ] **Step 3: Commit**

```bash
git add main.py
git commit -m "feat: route vlm_ask/warmup/unload to Photon local when cmd.local is set"
```

---

### Task 3: `electron-app/main.js` — on-demand `moondream` package install + IPC trigger

**Files:**
- Modify: `electron-app/main.js` (new block inserted after `ensureOcrDeps()`, currently ending at line 436; new `ipcMain.handle` inserted after the `vlm_ask`/`vlm_warmup`/`vlm_unload` loop, currently ending at line 691)

**Interfaces:**
- Consumes: `AI_DEPS_DIR`, `PYTHON_EXE`, `_runChildStreaming(exe, args, send, opts)`, `writeLog(level, ...msgs)`, `mainWindow` (all existing module-level names in `main.js`, same ones `ensureOcrDeps()` already uses).
- Produces: exported-via-IPC channel `deps:ensure-moondream-local` (renderer calls it, awaits `{ok: true}` or `{ok:false, error}`). Function `ensureMoondreamLocalDeps()` is idempotent — safe to call every time the BETA page opens (marker file skips reinstall).

- [ ] **Step 1: Insert the installer, right after `ensureOcrDeps()` (after line 436, before the blank line preceding `app.whenReady()`)**

```js
// ── Moondream Photon — on-demand dependency install (local GPU inference,
// Auto Bouffe BETA sandbox only — never installed for users who don't open
// that page, unlike EasyOCR which ensureOcrDeps() installs for everyone). ──
function _moondreamLocalDepsMarkerPath() {
  return path.join(AI_DEPS_DIR, '.moondream_local_deps_installed');
}

function _moondreamLocalDepsInstalled() {
  try { return fs.existsSync(_moondreamLocalDepsMarkerPath()); } catch (_) { return false; }
}

function _moondreamLocalAlreadyImportable() {
  try {
    execSync(`"${PYTHON_EXE}" -c "import sys; sys.path.insert(0, r'${AI_DEPS_DIR}'); import moondream"`,
      { stdio: 'ignore', windowsHide: true, timeout: 30000 });
    return true;
  } catch (_) {
    return false;
  }
}

const _MOONDREAM_LOCAL_MAX_ATTEMPTS = 3;
const _MOONDREAM_LOCAL_RETRY_DELAY_MS = 5000;

async function _installMoondreamLocalDepsOnce(send) {
  send('Photon : installation du package moondream (GPU NVIDIA requis)…');
  await _runChildStreaming(
    PYTHON_EXE,
    ['-m', 'pip', 'install', '--target', AI_DEPS_DIR, 'moondream'],
    send, { cwd: path.dirname(PYTHON_EXE) }
  );
  fs.writeFileSync(_moondreamLocalDepsMarkerPath(), new Date().toISOString(), 'utf-8');
}

async function ensureMoondreamLocalDeps() {
  if (!PYTHON_EXE || !PYTHON_EXE.toLowerCase().includes('python-embed')) return;
  if (_moondreamLocalDepsInstalled()) return;
  const send = (message) => mainWindow?.webContents.send('setup:progress', { message });

  try {
    if (_moondreamLocalAlreadyImportable()) {
      try { fs.writeFileSync(_moondreamLocalDepsMarkerPath(), new Date().toISOString(), 'utf-8'); } catch (_) {}
      writeLog('INFO', 'Photon: package moondream déjà présent, rien à installer.');
      return;
    }

    for (let attempt = 1; attempt <= _MOONDREAM_LOCAL_MAX_ATTEMPTS; attempt++) {
      try {
        await _installMoondreamLocalDepsOnce(send);
        writeLog('INFO', 'Photon: package moondream installé.');
        return;
      } catch (e) {
        writeLog('WARNING', `Photon: tentative ${attempt}/${_MOONDREAM_LOCAL_MAX_ATTEMPTS} échouée —`, e.message);
        if (attempt === _MOONDREAM_LOCAL_MAX_ATTEMPTS) throw e;
        send(`Échec (${e.message}) — nouvel essai dans ${_MOONDREAM_LOCAL_RETRY_DELAY_MS / 1000}s…`);
        await new Promise(r => setTimeout(r, _MOONDREAM_LOCAL_RETRY_DELAY_MS));
      }
    }
  } catch (e) {
    writeLog('ERROR', 'Photon: installation du package moondream échouée après plusieurs tentatives —', e.message);
    // Non-fatal — la page BETA restera en erreur au moment du test IA tant que ce n'est pas installé.
  }
}
```

- [ ] **Step 2: Register the IPC trigger, right after the `vlm_ask`/`vlm_warmup`/`vlm_unload` loop (after line 691, before the `// ── IPC: Screen picker` comment)**

```js
// ── IPC: Auto Bouffe BETA — trigger the on-demand Photon install ────────────
ipcMain.handle('deps:ensure-moondream-local', async () => {
  try {
    await ensureMoondreamLocalDeps();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
```

- [ ] **Step 3: Verify syntax**

Run:
```bash
node --check "electron-app/main.js"
```
Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add electron-app/main.js
git commit -m "feat: add on-demand moondream package installer for Auto Bouffe BETA"
```

---

### Task 4: `electron-app/preload.js` — expose the installer, fix `vlmWarmup`/`vlmUnload` param passthrough

**Files:**
- Modify: `electron-app/preload.js:35-37`

**Interfaces:**
- Produces: `window.api.ensureMoondreamLocalDeps() -> Promise<{ok:boolean, error?:string}>`. `window.api.vlmWarmup(params)` / `window.api.vlmUnload(params)` now actually forward `params` to the engine (previously silently dropped — a latent bug, since Photon's warmup/unload need `{local:true, api_key}` to reach `main.py`).

- [ ] **Step 1: Replace lines 35-37**

Current:
```js
  vlmAsk:            (p) => ipcRenderer.invoke('engine:vlm_ask', p),
  vlmWarmup:         ()  => ipcRenderer.invoke('engine:vlm_warmup'),
  vlmUnload:         ()  => ipcRenderer.invoke('engine:vlm_unload'),
```

Replace with:
```js
  vlmAsk:            (p) => ipcRenderer.invoke('engine:vlm_ask', p),
  vlmWarmup:         (p) => ipcRenderer.invoke('engine:vlm_warmup', p),
  vlmUnload:         (p) => ipcRenderer.invoke('engine:vlm_unload', p),
  ensureMoondreamLocalDeps: () => ipcRenderer.invoke('deps:ensure-moondream-local'),
```

- [ ] **Step 2: Verify syntax**

Run:
```bash
node --check "electron-app/preload.js"
```
Expected: no output, exit code 0.

- [ ] **Step 3: Verify the production page still calls `vlmWarmup()`/`vlmUnload()` with no arguments (so `p` is `undefined`, harmless — `main.js`'s `engineCmd({ cmd, ...params })` spreads `undefined` as nothing)**

Run:
```bash
grep -n "vlmWarmup\|vlmUnload" "electron-app/renderer/js/page-autobouffe.js"
```
Expected: both call sites show `window.api.vlmWarmup();` / `window.api.vlmUnload();` (no arguments) — confirms the production page is unaffected by this signature change.

- [ ] **Step 4: Commit**

```bash
git add electron-app/preload.js
git commit -m "fix: forward params through vlmWarmup/vlmUnload, expose moondream local installer"
```

---

### Task 5: `page-autobouffe-beta.js` — always call Photon local

**Files:**
- Modify: `electron-app/renderer/js/page-autobouffe-beta.js:64-70` (`initAutoBouffeBeta`), `:140-153` (`_abfbVlmWarmup`/`_abfbVlmUnload`), `:155-169` (`_abfbAskTitle`)

**Interfaces:**
- Consumes: `window.api.ensureMoondreamLocalDeps()`, `window.api.vlmWarmup(p)`, `window.api.vlmUnload(p)`, `window.api.vlmAsk(p)` (Tasks 3-4).

- [ ] **Step 1: Trigger the installer on page entry — replace lines 64-70**

Current:
```js
/* Called by navigate() in app.js when entering the Auto Bouffe page */
async function initAutoBouffeBeta() {
  _abfbLoad();
  _abfbBindAutoSave();
  _abfbEnforceMinInterval();
  switchAbfbMode(_abfbMode);
}
```

Replace with:
```js
/* Called by navigate() in app.js when entering the Auto Bouffe BETA page */
async function initAutoBouffeBeta() {
  _abfbLoad();
  _abfbBindAutoSave();
  _abfbEnforceMinInterval();
  switchAbfbMode(_abfbMode);
  // Fire-and-forget — install (or confirm) the moondream package in the
  // background; the page stays usable in the meantime, only the IA test
  // button will fail until this completes.
  window.api.ensureMoondreamLocalDeps().catch(() => {});
}
```

- [ ] **Step 2: Send `local: true` (+ the API key) on warmup/unload — replace lines 140-153**

Current:
```js
async function _abfbVlmWarmup() {
  try {
    appendLog('INFO', 'Auto Bouffe BETA: préchauffage IA…');
    const res = await window.api.vlmWarmup();
    if (!res?.ok) appendLog('WARNING', 'Auto Bouffe BETA: préchauffage IA échoué: ' + (res?.error || '?'));
  } catch (e) { appendLog('WARNING', 'Auto Bouffe BETA: préchauffage IA indisponible: ' + (e.message || e)); }
}

async function _abfbVlmUnload() {
  try {
    const res = await window.api.vlmUnload();
    if (!res?.ok) appendLog('WARNING', 'Auto Bouffe BETA: déchargement IA échoué: ' + (res?.error || '?'));
  } catch (e) { appendLog('WARNING', 'Auto Bouffe BETA: déchargement IA indisponible: ' + (e.message || e)); }
}
```

Replace with:
```js
async function _abfbVlmWarmup() {
  const apiKey = document.getElementById('abfb-moondream-key')?.value.trim() || '';
  try {
    appendLog('INFO', 'Auto Bouffe BETA: préchauffage Photon (chargement modèle GPU)…');
    const res = await window.api.vlmWarmup({ local: true, api_key: apiKey });
    if (!res?.ok) appendLog('WARNING', 'Auto Bouffe BETA: préchauffage Photon échoué: ' + (res?.error || '?'));
  } catch (e) { appendLog('WARNING', 'Auto Bouffe BETA: préchauffage Photon indisponible: ' + (e.message || e)); }
}

async function _abfbVlmUnload() {
  try {
    const res = await window.api.vlmUnload({ local: true });
    if (!res?.ok) appendLog('WARNING', 'Auto Bouffe BETA: déchargement Photon échoué: ' + (res?.error || '?'));
  } catch (e) { appendLog('WARNING', 'Auto Bouffe BETA: déchargement Photon indisponible: ' + (e.message || e)); }
}
```

- [ ] **Step 3: Send `local: true` on every ask — replace lines 155-169**

Current:
```js
async function _abfbAskTitle(zone, debug, label) {
  const apiKey = document.getElementById('abfb-moondream-key')?.value.trim() || '';
  if (!apiKey) {
    if (debug) appendLog('WARNING', 'Auto Bouffe IA: clé API Moondream Cloud manquante — configure-la ci-dessus.');
    return null;
  }
  const res = await window.api.vlmAsk({ ...zone, question: _ABFB_TITLE_QUESTION, api_key: apiKey });
  if (!res?.ok) {
    if (debug) appendLog('WARNING', `Auto Bouffe IA (${label}) erreur: ` + (res?.error || 'réponse invalide'));
    return null;
  }
  const raw = String(res?.answer || '').trim();
  if (debug) appendLog('INFO', `Auto Bouffe IA (${label}) → "${raw}"`);
  return raw;
}
```

Replace with:
```js
async function _abfbAskTitle(zone, debug, label) {
  const apiKey = document.getElementById('abfb-moondream-key')?.value.trim() || '';
  if (!apiKey) {
    if (debug) appendLog('WARNING', 'Auto Bouffe BETA IA: clé API Moondream manquante — configure-la ci-dessus.');
    return null;
  }
  const res = await window.api.vlmAsk({ ...zone, question: _ABFB_TITLE_QUESTION, api_key: apiKey, local: true });
  if (!res?.ok) {
    if (debug) appendLog('WARNING', `Auto Bouffe BETA IA Photon (${label}) erreur: ` + (res?.error || 'réponse invalide'));
    return null;
  }
  const raw = String(res?.answer || '').trim();
  if (debug) appendLog('INFO', `Auto Bouffe BETA IA Photon (${label}) → "${raw}"`);
  return raw;
}
```

- [ ] **Step 4: Verify every `vlmAsk`/`vlmWarmup`/`vlmUnload` call site in this file now sends `local: true`**

Run:
```bash
grep -n "vlmAsk\|vlmWarmup\|vlmUnload" "electron-app/renderer/js/page-autobouffe-beta.js"
```
Expected: all three call sites show `local: true` (or `local:true`) in their payload.

- [ ] **Step 5: Verify the production page's file is untouched by this task**

Run:
```bash
git diff --stat electron-app/renderer/js/page-autobouffe.js
```
Expected: no output (empty diff — file not modified).

- [ ] **Step 6: Commit**

```bash
git add electron-app/renderer/js/page-autobouffe-beta.js
git commit -m "feat: Auto Bouffe BETA always calls Photon local (local:true on every IA call)"
```

---

### Task 6: `index.html` — update BETA page copy (Cloud → Photon local)

**Files:**
- Modify: `electron-app/renderer/index.html:580`, `:583`

**Interfaces:** None (copy-only change).

- [ ] **Step 1: Replace the help text at line 580**

Current line 580 (inside `#page-autobouffe-beta`):
```html
          1) Détecte la fenêtre du jeu (FiveM doit être ouvert). 2) Dessine UNE petite bande serrée sur les titres de panneau (TON inventaire à gauche, l'endroit où un panneau tiers véhicule/coffre/carton apparaît à droite) — reste précis, une bande trop large fait lire n'importe quel texte (FPS, watermark) au lieu du titre. La bande est mémorisée en % de la fenêtre : si elle bouge ou change de taille, la détection suit automatiquement. Une IA en ligne (Moondream Cloud) lit le titre à chaque cycle — pas de référence à capturer, pas de téléchargement local.
```

Replace with:
```html
          1) Détecte la fenêtre du jeu (FiveM doit être ouvert). 2) Dessine UNE petite bande serrée sur les titres de panneau (TON inventaire à gauche, l'endroit où un panneau tiers véhicule/coffre/carton apparaît à droite) — reste précis, une bande trop large fait lire n'importe quel texte (FPS, watermark) au lieu du titre. La bande est mémorisée en % de la fenêtre : si elle bouge ou change de taille, la détection suit automatiquement. IA locale (Photon, GPU NVIDIA requis) — installation automatique du package en tâche de fond au premier affichage de cette page, aucun appel réseau ensuite.
```

Since both the production page (line 432) and this BETA page (line 580) currently share the exact same sentence, use the `abfb-moondream-key` id a few lines below as the unique anchor to target only the BETA occurrence (an editor tool matching on the full paragraph text alone would be ambiguous between the two pages).

- [ ] **Step 2: Replace the label at line 583**

Current:
```html
          <label>Clé API Moondream Cloud</label>
```
(the one immediately followed by `<input ... id="abfb-moondream-key" ...>` — the production page's equivalent label at line 435 is followed by `id="abf-moondream-key"` instead, use that id to disambiguate).

Replace with:
```html
          <label>Clé API Moondream</label>
```

- [ ] **Step 3: Verify only the BETA page changed**

Run:
```bash
grep -n "Moondream Cloud" "electron-app/renderer/index.html"
```
Expected: exactly 2 matches remaining, both inside the production `#page-autobouffe` section (lines ~432 and ~435) — confirms the BETA section's wording was updated and production wording is untouched.

- [ ] **Step 4: Commit**

```bash
git add electron-app/renderer/index.html
git commit -m "docs: update Auto Bouffe BETA copy for Photon local (Cloud wording removed)"
```

---

### Task 7: Manual end-to-end smoke test (requires a real NVIDIA GPU — done by the user)

**Files:** None — verification only.

**Interfaces:** None.

- [ ] **Step 1: Launch the app in dev mode**

Run:
```bash
cd electron-app && npm run dev
```

- [ ] **Step 2: Open the "Auto Bouffe 🧪" nav item**

Expected: within a few seconds, `app.log` (View → Logs, or the repo-root `app.log` file) shows either `Photon: package moondream déjà présent, rien à installer.` (if already installed from a previous run) or a sequence of `Photon : installation du package moondream (GPU NVIDIA requis)…` progress lines ending in `Photon: package moondream installé.`.

- [ ] **Step 3: Configure and test detection**

1. Paste a Moondream API key into "Clé API Moondream".
2. Click "Choisir fenêtre", pick the FiveM window.
3. Click "Bande titre", drag a tight box over the inventory title area.
4. Click "Tester".

Expected: the result label shows one of 🟢/🟠/🔴/⚠️ within a few seconds (first click is slower — model loads into VRAM), and `app.log` shows `Photon: chargement du modèle en VRAM…` followed by `Photon → "<texte>"` lines — confirms the whole chain (renderer → preload → main.js → main.py → `vlm_engine_local.py` → GPU) is wired correctly. Without an NVIDIA GPU or a valid key, expect a clear French error in the result label/log instead of a silent hang — also a valid pass (error handling working as designed), not a blocker to closing this plan.

- [ ] **Step 4: Regression-check the production page**

Open the "Auto Bouffe" (non-BETA) nav item, click "Tester" there too (needs its own calibration first if not already set up on this machine).

Expected: same as before this plan — goes through Moondream Cloud (`app.log` shows `Moondream Cloud → "..."`, not any `Photon:` line) — confirms zero behavior change on the production path.
