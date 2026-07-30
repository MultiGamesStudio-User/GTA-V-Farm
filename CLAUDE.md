# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

MacroEngine is a GTA V / FiveM automation tool with two tightly coupled layers:

- **Python backend** (`main.py` + `modules/engine/`) — runs as a subprocess, communicates with Electron over stdin/stdout using newline-delimited JSON (JSON Lines). Each message has a `type` field: `"response"`, `"log"`, or `"status"`. Reading stdin and dispatching are synchronous in the main thread — a slow command (e.g. OCR) blocks the next IPC line from being processed.
- **Electron frontend** (`electron-app/`) — hosts the UI, spawns the Python process, and relays IPC messages between the renderer and the backend.

The Python backend is **not** a web server — all communication is via process stdio, not HTTP.

## Key Files

| File | Role |
|------|------|
| `main.py` | IPC server entry point — reads JSON commands from stdin, dispatches via a large command table (macro lifecycle, window/coord helpers, OCR, webhooks, license, recorder, state) |
| `config.py` | All bot parameters (resolution, keys, farm profiles, detection thresholds, templates) |
| `modules/engine/macro_runner.py` | `MacroRunner` class — runs a macro in its own daemon thread; evaluates `start_guard`/`stop_conditions`/`timeout_s`/`max_iterations`, then per-rule conditions before dispatching actions |
| `modules/engine/actions.py` | Executable action types — input (key/mouse/text), state (variables/counters), integration (webhook, notify, sound, clipboard) |
| `modules/engine/conditions.py` | Condition types — visual (pixel/template/region), macro/window/process state, counters, variables, keyboard, clipboard |
| `modules/engine/ocr_engine.py` | OCR cascade: EasyOCR (primary, 6 preprocessing variants scored) → WinRT native OCR → Tesseract (fallback) |
| `modules/engine/screen_reader.py` | Screenshot capture via `mss` |
| `modules/engine/recorder.py` | Input recorder for creating macros from user actions |
| `modules/engine/coord_utils.py` | Point/region validation, screen↔window coordinate conversion, resolution auto-scaling — backs the `validate_point`/`validate_region`/`scale_coords` IPC commands |
| `modules/engine/humanizer.py` | Gaussian timing jitter and Bezier-curve mouse movement; applied by `actions.exec_action` when `ctx['_humanize']` is set |
| `modules/engine/state.py` | Process-level singleton (module dicts + one lock) for counters, variables, pixel snapshots, dead zones, per-macro stats. Also holds `_runners_ref`, a registry set by `main.py._init_condition_registry()` so `conditions.py` can check other macros' running state without importing `macro_runner` (avoids pulling in cv2/numpy at startup) |
| `electron-app/main.js` | Electron main process — spawns Python, manages windows, handles auto-update |
| `electron-app/preload.js` | IPC security layer (contextBridge); all engine calls go through a generic `engine:<cmd>` forwarder |
| `electron-app/renderer/js/app.js` | Main UI logic — owns `navigate(page)` and `switchSettingsTab(tab)`/`switchTestTab(tab)`, loaded last so it can wire up the `page-*.js` modules |
| `electron-app/renderer/js/page-*.js` | One self-contained module per page/tab (dashboard, conditions, actions, windows, autoclicker). No formal router: each defines global `initX()`/`renderX()` functions that `app.js` calls by naming convention. See "Adding Features" below. |
| `electron-app/updater.js` | Auto-update via `update-manifest.json` |

## Macro JSON Structure

Macros are stored in `macros.json`. A full macro object:

```json
{
  "name": "Mon Farm",
  "loop": true,
  "loop_delay": 0.1,
  "humanize": true,
  "humanize_factor": 0.12,
  "stop_conditions": [{"type": "process_not_running", "exe": "FiveM.exe"}],
  "start_guard":     [{"type": "window_focused", "title": "FiveM"}],
  "max_iterations":  1000,
  "timeout_s":       7200,
  "pre_stop_actions":[{"type": "key_tap", "key": "esc"}],
  "rules": [...]
}
```

Rule `type` values are defined in `conditions.py` (visual, macro state, counter, variable, window, process, time, random, keyboard, clipboard). Action `type` values are defined in `actions.py`. By convention, macros that rely on a captured screen region document it with a `_calibration_note` field.

## Development Commands

```bash
# Install JS dependencies (run once, from electron-app/)
cd electron-app && npm install

# Run in dev mode (Electron + Python, with DevTools)
cd electron-app && npm run dev

# Debug Python backend separately
python -m pdb main.py

# Install Python dependencies
pip install -r requirements.txt

# Build installer + portable exe
cd electron-app && npm run build

# Build NSIS installer only
cd electron-app && npm run build-nsis

# Build portable exe only
cd electron-app && npm run build-portable
```

Build output goes to `electron-app/dist/`. There is no lint script and no project-level automated test suite (Python or JS) — `.github/workflows/test-build.yml` runs `npm run build-portable` on PRs as a build-success smoke test, not a unit test gate.

**Known dependency gap:** `ocr_engine.py`'s EasyOCR and WinRT backends are used at runtime but `easyocr` and `winsdk`/`winrt` are not listed in `requirements.txt` (only `pytesseract` is) — install them manually if working on OCR.

## Release Process

```bash
# 1. Bump version (patch/minor/major) — updates package.json + CHANGELOG.md
cd electron-app && npm run release-prepare patch

# 2. Edit CHANGELOG.md with actual changes

# 3. Commit + tag
git commit -am "chore: bump to vX.Y.Z"
git tag vX.Y.Z
git push && git push --tags
```

`.github/workflows/build-release.yml` runs on every push to `main` (or manual dispatch): builds on `windows-latest`, then auto-commits a regenerated `update-manifest.json` back to `main` as the github-actions bot (`[skip ci]`) and publishes a GitHub Release, with release notes parsed from `CHANGELOG.md`.

## Adding Features

- **New Python action type**: add handler in `modules/engine/actions.py`, register in `exec_action()`. Actions reach the runner/engine only through the `ctx` dict passed in (`on_macro_start`, `on_macro_stop`, `on_webhook`, `on_log`, `stop_self`, `_stop`/`_pause_lock` events, `_humanize*`) — without a real `ctx`, callback-based actions are no-ops (see `main.py`'s test-exec path, which passes a stub ctx).
- **New condition type**: add handler in `modules/engine/conditions.py`, register in `eval_condition()`.
- **New Python module**: create in `modules/engine/`, import in `main.py` or the relevant module, register any new IPC commands in the dispatch table in `main.py`.
- **New UI page**: create `electron-app/renderer/js/page-*.js`, add its nav-item/tab markup + `#page-X` (or `#settings-panel-X`) block in `index.html`, add a `<script defer>` tag before `app.js`, define `initX()`, and hook it into `navigate()` (top-level page) or `switchSettingsTab()`/`switchTestTab()` (sub-tab) in `app.js`. Stop any polling loop on tab-leave.
- **New detection template**: capture via Tools → Image Capture in-app (region picker, SPACE to capture), save to `templates/`, register in `config.py` → `TEMPLATES`.

## Logs & Debugging

- Runtime log: `app.log` (root of repo, last 500 lines kept on startup)
- Python logs stream to Electron as `{"type": "log", "level": "...", "msg": "..."}` JSON lines
- Electron DevTools: `Ctrl+Shift+I` in the running app
- In-app log viewer: View → Logs
- End-user hotkeys (see README.md): F12 emergency stop, F11 pause/resume, F10 reload macros

## Important Constraints

- **Windows only** — uses `pywin32`, `pydirectinput`, and NSIS for the installer.
- **AZERTY keyboard layout** assumed in `config.py` key bindings.
- **Single-player / FiveM only** — using in GTA Online violates Rockstar ToS.
- Tesseract binary is bundled in `tesseract/`; Python embed in `python-embed/` (production only).
- The `state` module (`modules/engine/state.py`) holds shared runtime state (counters, variables) across macro runners — treat it as a process-level singleton.
- `main.py` also runs a Discord webhook sender (rate-limited, circuit-breaker after repeated 403s, optional debug screenshot/machine-info embed) and a background RAM-monitor thread — factor these in before changing startup/shutdown behavior.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
