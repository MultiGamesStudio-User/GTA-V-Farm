# Changelog

## [2.5.3] – 2026-08-01

### Fixed
- 🐛 Version portable : le patch de cache persistant NSIS (extraction unique par version au lieu de réextraction/suppression à chaque lancement) n'était jamais appliqué au build — `build-portable`/`build`/`release` n'appelaient pas `patch-portable-nsis.js` avant `electron-builder`. Corrigé et validé (build réel + 2 lancements successifs : 371ms au 2e lancement, aucune réextraction).
- 🐛 Dépendances IA Auto Bouffe (torch/transformers/modèle) et OCR (easyocr/winrt) réinstallées intégralement à chaque mise à jour de version ou réinstallation, car pip-installées à l'intérieur de `python-embed/` (recréé à chaque install/portable). Déplacées vers `%APPDATA%\MacroEngine\ai-deps` (`pip install --target`, indépendant du dossier d'installation) — installées une fois, survivent à toute réinstallation/mise à jour.

### Changed
- 📝 Commentaires explicatifs du système Auto Bouffe/OCR (`main.js`) déplacés en messages `writeLog` (visibles dans `app.log`) plutôt qu'en commentaires source figés.

---



## [2.5.2] – 2026-07-30

### Added
- Installation des dépendances IA Auto Bouffe : retry automatique (3 tentatives) sur échec transitoire (réseau, rate-limit), sans avoir à relancer l'app

### Fixed
- Fenêtre de course au tout premier lancement : Auto Bouffe pouvait appeler l'IA avant que le blocage d'installation ne soit posé
- Message d'erreur d'installation IA générique ("exit 1") remplacé par la vraie raison de l'échec

---



## [2.5.1] – 2026-07-30

### Fixed
- Suppression du warning `GenerationMixin` inoffensif de `transformers`, affiché à tort en ERROR à chaque chargement du modèle IA
- Race condition : l'installation des dépendances IA au premier lancement pouvait tourner en même temps qu'une utilisation réelle d'Auto Bouffe et corrompre une réponse en cours (texte de pip mélangé à la réponse du modèle) — skip l'install si déjà présente, et bloque les appels IA tant qu'une installation réelle est en cours

---



## [2.5.0] – 2026-07-30

### Added
- Auto Bouffe : nouvel onglet auto-manger/boire à intervalle configurable, avec IA locale (moondream2, GPU si dispo sinon CPU) pour détecter l'état de l'inventaire (fermé / ouvert / panneau tiers ouvert) au lieu de couleur/OCR/template
- Sélecteur de fenêtre de jeu (liste des fenêtres ouvertes) + calibrage d'une bande titre en % relatif à la fenêtre — suit automatiquement si elle bouge/redimensionne
- Installation automatique des dépendances IA (torch/transformers/modèle, ~2-4 Go) au premier lancement réel de l'app, avec progression visible, plutôt que bundlées dans chaque installeur
- Le modèle IA se décharge (VRAM libérée) entre les cycles et se recharge quelques secondes avant chaque scan — pas de réservation VRAM inutile sur un intervalle de plusieurs heures

### Fixed
- Focus fenêtre : `SetForegroundWindow` échouait silencieusement depuis un process en arrière-plan (protection Windows anti-vol-de-focus) — les touches/clics n'atteignaient pas toujours le jeu
- Capture de touche stockait le nom DOM brut (`Tab`, `Control`...) au lieu du format attendu par `pydirectinput`, rendant certaines touches totalement inertes sans erreur visible
- stdout par défaut en cp1252 au lieu d'UTF-8 : réponses IPC silencieusement perdues (ex: titres de fenêtre avec emoji) et texte accentué corrompu dans tous les logs
- Build portable : extraction complète à chaque lancement au lieu d'un cache par version dans `%LOCALAPPDATA%`
- Owner/repo GitHub mal renseignés (update-manifest 404, config publish electron-builder jamais synchronisée)
- Raccourcis globaux : mauvaise action transmise au renderer, collision F6 entre arrêt enregistrement et Auto Clicker

### Changed
- Onglets Paramètres/Tests réorganisés, mise en page Auto Clicker consolidée
- `release.js` ne tentait plus de mettre à jour un `electron-app/electron-app/package.json` inexistant

---



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

