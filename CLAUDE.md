# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

MacroEngine is a GTA V / FiveM automation tool with two tightly coupled layers:

- **Python backend** (`main.py` + `modules/engine/`) — runs as a subprocess, communicates with Electron over stdin/stdout using newline-delimited JSON (JSON Lines). Each message has a `type` field: `"response"`, `"log"`, or `"status"`.
- **Electron frontend** (`electron-app/`) — hosts the UI, spawns the Python process, and relays IPC messages between the renderer and the backend.

The Python backend is **not** a web server — all communication is via process stdio, not HTTP.

## Key Files

| File | Role |
|------|------|
| `main.py` | IPC server entry point — reads JSON commands from stdin, dispatches to engine modules |
| `config.py` | All bot parameters (resolution, keys, farm profiles, detection thresholds, templates) |
| `modules/engine/macro_runner.py` | `MacroRunner` class — executes a macro in a background thread with lifecycle hooks |
| `modules/engine/actions.py` | All executable action types (key_tap, hold, mouse_move, click, wait, repeat…) |
| `modules/engine/conditions.py` | All condition types used in macro rules and stop/guard clauses |
| `modules/engine/ocr_engine.py` | Tesseract wrapper for region-based text detection |
| `modules/engine/screen_reader.py` | Screenshot capture via `mss` |
| `modules/engine/recorder.py` | Input recorder for creating macros from user actions |
| `electron-app/main.js` | Electron main process — spawns Python, manages windows, handles auto-update |
| `electron-app/preload.js` | IPC security layer (contextBridge) |
| `electron-app/renderer/js/app.js` | Main UI logic |
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

Rule `type` values are defined in `conditions.py` (visual, macro state, counter, window, process, time, random, keyboard, clipboard). Action `type` values are defined in `actions.py`.

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

Build output goes to `electron-app/dist/`.

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

GitHub Actions (`.github/workflows/build-release.yml`) automatically builds and publishes a GitHub Release on every push to `main`. The workflow regenerates `update-manifest.json` for the auto-updater.

## Adding Features

- **New Python action type**: add handler in `modules/engine/actions.py`, register in `exec_action()`.
- **New condition type**: add handler in `modules/engine/conditions.py`, register in `eval_condition()`.
- **New Python module**: create in `modules/engine/`, import in `main.py` or the relevant module, register any new IPC commands in the `_COMMANDS` dispatch table in `main.py`.
- **New UI page**: create `electron-app/renderer/js/page-*.js`, wire navigation in `app.js`, style in `styles.css`.
- **New detection template**: capture via Tools → Image Capture in-app, save to `templates/`, register in `config.py` → `TEMPLATES`.

## Logs & Debugging

- Runtime log: `app.log` (root of repo, last 500 lines kept on startup)
- Python logs stream to Electron as `{"type": "log", "level": "...", "msg": "..."}` JSON lines
- Electron DevTools: `Ctrl+Shift+I` in the running app
- In-app log viewer: View → Logs

## Important Constraints

- **Windows only** — uses `pywin32`, `pydirectinput`, and NSIS for the installer.
- **AZERTY keyboard layout** assumed in `config.py` key bindings.
- **Single-player / FiveM only** — using in GTA Online violates Rockstar ToS.
- Tesseract binary is bundled in `tesseract/`; Python embed in `python-embed/` (production only).
- The `state` module (`modules/engine/state.py`) holds shared runtime state (counters, variables) across macro runners — treat it as a process-level singleton.
