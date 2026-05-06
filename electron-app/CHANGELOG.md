# Changelog

## [2.4.3] – 2026-05-06

### Added
- 🎉 New features here

### Fixed
- 🐛 Bug fixes here

### Changed
- 📝 Changes here

---



## [2.4.2] – 2026-05-01

### Added
- Kill switch par macro : touche configurable pour arrêt forcé global (même hors focus)
- Webhook générique HTTP en plus de Discord + filtre d'events configurable
- Éditeur template visuel : preview région + score de match live dans l'onglet Tests
- Onglets dans les pages Paramètres et Tests
- Raccourcis globaux autoclicker via Electron globalShortcut (hors focus)

### Fixed
- Kill switch utilise keyboard.add_hotkey (OS-level, zéro thread polling)
- Écriture atomique JSON (write .tmp + rename) — plus de corruption sur crash
- globalShortcut diff-based — plus d'unregisterAll agressif

---

