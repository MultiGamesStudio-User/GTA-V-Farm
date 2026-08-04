# Changelog

## [2.5.7] – 2026-08-04

### Added
- 🎉 Page Auto Bouffe BETA — sandbox de test isolé, séparé de la page Auto Bouffe production

---



## [2.5.6] – 2026-08-03

### Changed
- ⚡ Auto Bouffe : le VLM local (moondream2, torch/transformers, 2-4 Go téléchargés au premier lancement) est remplacé par **Moondream Cloud** — une clé API gratuite (moondream.ai) à renseigner dans l'onglet Auto Bouffe, plus aucune dépendance Python lourde ni téléchargement de modèle.
- 🧹 Bannière "dépendances en cours d'installation" retirée du haut de l'interface — les messages de setup (installation OCR EasyOCR/WinRT) vont désormais uniquement dans les logs.

---



## [2.5.5] – 2026-08-01

### Fixed
- 🐛 **Régression critique v2.5.4** : le préchargement auto du modèle IA (moondream2) dès l'ouverture du logiciel faisait planter tout le moteur Python (access violation) sur un warning PyTorch bénin lié à une couche RNN quantifiée — plus aucun bouton (macros, stop, etc.) ne répondait après le crash. Le modèle IA revient au chargement lazy (premier `vlm_ask` réel), comme avant v2.5.4.

---



## [2.5.4] – 2026-08-01

### Fixed
- 🐛 Dossier userData divergent : `ocr_engine.py` (modèles EasyOCR, debug OCR) et `main.py` (templates Auto Bouffe capturés) devinaient chacun leur propre chemin `%APPDATA%\MacroEngine` au lieu d'utiliser le vrai dossier Electron (`%APPDATA%\macro-engine`) — deux dossiers séparés au lieu d'un seul. `main.js` transmet maintenant le vrai chemin via la variable d'env `MACROENGINE_USERDATA_DIR`.
- 🐛 Warnings pip bénins (ex: "Target directory ... already exists") affichés dans la bannière de setup comme s'ils étaient une erreur — déplacés vers `app.log` uniquement.

### Changed
- ⚡ IA locale Auto Bouffe (moondream2) : `torch.inference_mode()` autour de l'inférence (pas de graphe autograd inutile), `cudnn.benchmark` + TF32 activés sur GPU Ampere+ — traitement d'image plus rapide.
- ⚡ Le modèle IA se précharge maintenant dès l'ouverture du logiciel (au lieu d'attendre le premier `vlm_ask`, souvent en plein milieu du premier cycle Auto Bouffe) — le chargement (~10s) se fait en tâche de fond pendant que l'utilisateur navigue dans l'UI.

---



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

