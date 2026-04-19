# 🎮 MacroEngine – Automation System

> Professional macro automation platform for GTA V with visual macro editor, OCR detection, and advanced conditions system.

---

## ⚠️ Legal Disclaimer

**This tool is for single-player use only.** Using this in GTA Online violates Rockstar Games' Terms of Service and may result in:
- Account suspension
- Permanent ban
- Loss of progress

**Use at your own risk.**

---

## 🚀 Features

- 🎨 **Visual Macro Editor** – Build macros without code
- 🔍 **OCR Detection** – Real-time text recognition using Tesseract
- ⚙️ **Advanced Conditions** – IF/THEN logic, loops, waits
- 🖱️ **Input Automation** – Mouse, keyboard, controller inputs
- 💾 **Persistent Config** – Save and load macro profiles
- 🎯 **Accuracy** – High-precision object detection via OpenCV
- 🖥️ **Cross-resolution** – Auto-scales to any screen resolution
- 📊 **Monitoring** – Real-time logs and performance metrics

---

## 📋 System Requirements

- **Windows 10/11** (x64)
- **2GB RAM** minimum
- **100MB disk space**
- No additional installations required (everything is portable)

---

## 🔧 Installation

### Method 1: Installer (Recommended)

1. Download `MacroEngine-Setup.exe` from [Releases](https://github.com/Multigames-studio/GTA-V-FARM/releases)
2. Run the installer
3. Launch from Start Menu or Desktop shortcut
4. ✅ Done! Auto-updates are enabled

### Method 2: Portable (No Installation)

1. Download `MacroEngine-Portable.exe` from [Releases](https://github.com/Multigames-studio/GTA-V-FARM/releases)
2. Run it directly – no installation needed
3. First run will extract dependencies (~200MB)

---

## 🎯 Quick Start

1. **Open MacroEngine**
2. **Create a new macro** in the Visual Editor
3. **Add actions:**
   - Drive forward/backward
   - Turn left/right
   - Collect items (hold E)
   - Enter/exit vehicles
   - Custom conditions (IF health < 50, THEN...)
4. **Test** with F12 (Emergency Stop)
5. **Run** – Press the Play button

### Controls

| Key | Action |
|-----|--------|
| **F12** | Emergency Stop |
| **F11** | Pause / Resume |
| **F10** | Reload Macros |

---

## 📸 Advanced: Custom Image Detection

1. Open **Tools → Image Capture**
2. Press SPACE to capture a region
3. Save as `template_name.png`
4. Use in macros: `If image "template_name" detected → ...`

---

## 🔌 Configuration

All settings are in the UI:
- **Game Settings** – GTA keybinds (QWERTY/AZERTY), resolution
- **Detection Sensitivity** – Adjust OCR/image matching thresholds
- **Performance** – RAM monitor, logging level

No need to edit config files!

---

## 🛠️ Development

### Prerequisites

- Node.js 16+ (bundled in installer)
- Python 3.11+ (bundled in installer)

### Build from Source

```bash
cd electron-app
npm install
npm run dev              # Run in dev mode
npm run build-nsis       # Build installer
npm run build-portable   # Build portable exe
npm run release          # Release with auto-update
```

### Project Structure

```
GTA V FARM/
├── electron-app/       ← UI (Electron)
│   ├── main.js        ← App entry point
│   ├── preload.js     ← IPC security layer
│   ├── renderer/      ← Frontend (HTML/CSS/JS)
│   └── assets/        ← Icons & images
├── modules/           ← Python engine
│   ├── screen_reader.py   ← Screenshot capture
│   ├── ocr_engine.py      ← Text detection
│   ├── fishing.py         ← Fishing automation
│   └── state_machine.py   ← Action executor
├── main.py            ← Python entry point
├── requirements.txt    ← Python dependencies
└── templates/         ← Image templates for detection
```

---

## 🐛 Troubleshooting

### Macro doesn't execute
1. Check if GTA V is in focus
2. Verify templates exist (`Tools → Manage Templates`)
3. Check logs: **View → Logs**

### Poor detection accuracy
1. Recapture templates in-game (not menus)
2. Increase sensitivity in **Settings → Detection**
3. Use better lighting/contrast

### Crash on startup
1. Run: `MacroEngine-Setup.exe --reset`
2. Reinstall if issue persists
3. Check [Issues](https://github.com/Multigames-studio/GTA-V-FARM/issues)

---

## 📦 Updates

Auto-update checks every 24h. To manually update:
1. **Menu → Check for Updates**
2. Or download fresh from [Releases](https://github.com/Multigames-studio/GTA-V-FARM/releases)

---

## 📝 License

MIT License – See [LICENSE](./LICENSE)

---

## 🤝 Contributing

Found a bug? Have ideas?
- 🐛 [Report Issues](https://github.com/Multigames-studio/GTA-V-FARM/issues)
- 💡 [Suggest Features](https://github.com/Multigames-studio/GTA-V-FARM/discussions)
- 🍴 [Fork & PR](https://github.com/Multigames-studio/GTA-V-FARM)

---

## 👨‍💻 Author

**Multigames Studio** – [GitHub](https://github.com/Multigames-studio)

---

Made with ❤️ for GTA V fans

**Build Status:** Automated via GitHub Actions ✨
