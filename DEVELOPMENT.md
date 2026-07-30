# 👨‍💻 Developer Guide – MacroEngine

## Setup

### Prerequisites
- **Node.js** 16+ ([download](https://nodejs.org/))
- **Python** 3.11+ ([download](https://www.python.org/))
- **Git** ([download](https://git-scm.com/))

### Clone & Install

```bash
git clone https://github.com/MultiGamesStudio-User/GTA-V-Farm.git
cd "GTA V FARM"
cd electron-app
npm install
```

---

## Development Workflow

### Run Dev Mode
```bash
npm run dev
```
- Launches Electron with DevTools
- Auto-reload on code changes
- No build required

### Debug Python Backend
```bash
# Terminal 1: Start Electron
npm run dev

# Terminal 2: Attach debugger
python -m pdb main.py
```

### Build Locally
```bash
# Full installer + portable
npm run build

# Just installer (NSIS)
npm run build-nsis

# Just portable exe
npm run build-portable
```

Output: `electron-app/dist/`

---

## Code Structure

```
GTA V FARM/
│
├── main.py                     ← Python entry point
├── modules/
│   ├── engine/
│   │   ├── screen_reader.py   ← Screenshot capture
│   │   ├── ocr_engine.py      ← Tesseract integration
│   │   └── state_machine.py   ← Action executor
│   └── ...
├── templates/                  ← Image templates for detection
├── config.py                   ← Configuration
│
└── electron-app/               ← UI (Electron)
    ├── main.js                 ← App entry point
    ├── preload.js              ← IPC security layer
    ├── renderer/               ← Frontend
    │   ├── index.html
    │   ├── styles.css
    │   └── js/
    │       ├── app.js          ← Main UI logic
    │       ├── macros-editor.js
    │       └── ...
    ├── scripts/
    │   ├── prepare-python.js   ← Download Python/Tesseract
    │   ├── generate-icons.js   ← Icon checker
    │   └── release.js          ← Version management
    ├── installer/
    │   └── installer.nsh       ← NSIS config
    ├── assets/                 ← Icons (add your own!)
    └── package.json            ← Electron config
```

---

## Release Process

### 1. Prepare Release
```bash
cd electron-app
npm run release-prepare patch    # or minor/major
```
Updates:
- `package.json` version
- `CHANGELOG.md`
- Prompts for commit & tag

### 2. Edit Changelog
Edit `CHANGELOG.md` with actual changes (kept by script)

### 3. Commit & Tag
```bash
git commit -am "chore: bump to v2.3.0"
git tag v2.3.0
git push && git push --tags
```

### 4. Build & Publish
```bash
npm run release
```
- Builds both NSIS + Portable
- Publishes to GitHub Releases
- Triggers auto-update checks

---

## Adding Features

### New Python Module
1. Create file in `modules/engine/`
2. Import in `main.py` or relevant module
3. Add entry in `state_machine.py` if it's an action
4. Test with `npm run dev`

### New UI Page
1. Create `electron-app/renderer/js/page-*.js`
2. Add button in `app.js` to navigate
3. Style in `styles.css`
4. Test in dev mode

### New Detection Template
1. Use **Tools → Image Capture** in app
2. Name: `template_*.png`
3. Use in macros: `If image "template_name" found`

---

## Testing

### Manual Testing
```bash
npm run dev           # Launch dev version
# Test in GTA V (solo mode)
```

### Build Testing
```bash
npm run build-nsis
# Run: electron-app/dist/MacroEngine-Setup.exe
```

### Auto-Update Testing
Set `update-manifest.json` and test update flow

---

## Common Tasks

| Task | Command |
|------|---------|
| Check for dependency updates | `npm outdated` |
| Update electron-builder | `npm update electron-builder` |
| Update Python deps | `pip install --upgrade -r requirements.txt` |
| Clean build artifacts | `rm -rf electron-app/dist` |
| Full reset | `rm -rf electron-app/node_modules && npm install` |

---

## Debugging

### Electron DevTools
Press `Ctrl+Shift+I` in app to open DevTools

### Console Logging
```javascript
// In renderer process
console.log('From UI:', data);

// In main process
console.log('From Electron:', event);
```

### Python Logs
Check logs: **View → Logs** in app, or `logs/farm_bot.log`

---

## Performance Tips

- Use `npm run dev` for testing (faster than rebuilds)
- Profile Python with: `python -m cProfile main.py`
- Use DevTools Network tab to debug Electron IPC
- Keep template images **small** (< 100KB each)

---

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md)

---

**Questions?** Open an [Issue](https://github.com/MultiGamesStudio-User/GTA-V-Farm/issues) or [Discussion](https://github.com/MultiGamesStudio-User/GTA-V-Farm/discussions)!
