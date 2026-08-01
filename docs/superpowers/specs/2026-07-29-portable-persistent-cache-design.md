# Portable exe : cache persistant au lieu de re-extraction à chaque lancement

## Problème

`MacroEngine-Portable.exe` (target NSIS "portable" d'electron-builder) extrait tout
son contenu (~380MB : Electron, python-embed, tesseract, bot) dans `%TEMP%\MacroEngine-Portable-Cache`
à **chaque lancement**, puis le supprime intégralement à la fermeture
(`node_modules/app-builder-lib/templates/nsis/portable.nsi`, `RMDir /r` avant et après
la section d'extraction). Mesuré : 4min+ avant réduction de payload, 33s après
(retrait `osd.traineddata`, jars debug tesseract, submodules pywin32 inutilisés).
Le cycle extract/delete reste la cause dominante — inhérent au template, pas à notre code.

## Décision

Patcher le template NSIS portable pour qu'il extraie **une seule fois par version**,
dans un dossier persistant cache plutôt que `%TEMP%`, au lieu de systématiquement.

## Design

- `$INSTDIR` fixe : `%LOCALAPPDATA%\MacroEngine\runtime` (persistant, pas `%TEMP%`).
- Marqueur de version écrit après extraction (`.version` contenant la version app).
- Au lancement : si marqueur == version courante ET l'exe cache existe → skip extraction,
  lance direct l'exe déjà en place.
- Sinon (premier lancement ou nouvelle version) → `RMDir /r` + extraction complète
  (comportement actuel), écrit le marqueur, applique `attrib +h +s` sur le dossier
  (obscurcissement cosmétique du code Python contre navigation Explorateur casuelle —
  **pas** une protection réelle contre un utilisateur qui active "afficher fichiers cachés"
  ou un reverse engineer motivé).
- Suppression de la ligne `RMDir /r $INSTDIR` post-exécution (sinon rien ne persiste).
- Pas de changement dans `main.js` : `process.resourcesPath` pointera vers un dossier
  stable au lieu d'un temp jetable ; toute la résolution de chemins existante continue
  de fonctionner sans modification.

## Implémentation

1. `electron-app/build-patches/portable.nsi` — template custom maintenu par nous,
   dérivé de l'original avec les modifications ci-dessus.
2. `electron-app/scripts/patch-portable-nsis.js` — injecte la version courante
   (placeholder `__APP_VERSION__`) et écrase
   `node_modules/app-builder-lib/templates/nsis/portable.nsi` avant chaque build.
   Nécessaire car `node_modules` n'est pas commit — le patch doit se réappliquer
   à chaque `npm install`/build.
3. `package.json` → script `build-portable` : appelle `patch-portable-nsis.js`
   avant `electron-builder`.

## Changement de comportement

Ce n'est plus un "portable" au sens strict (aucune trace après fermeture) : il laisse
une installation persistante cachée dans `%LOCALAPPDATA%\MacroEngine\runtime`. Voulu ici
(vitesse + dissimulation du code Python), mais pas de désinstalleur associé — un nettoyage
complet nécessite de supprimer ce dossier manuellement.

## Statut

Implémenté mais jamais câblé : `package.json`'s `build-portable`/`build`/`release`
scripts n'appelaient pas `patch-portable-nsis.js` avant `electron-builder` — le
build portable utilisait donc toujours le template stock (re-extraction +
suppression à chaque lancement), rendant `.ai_deps_installed`/`.ocr_deps_installed`
(voir `electron-app/main.js`) inutiles en pratique : re-téléchargement complet
(torch/transformers/modèle IA, easyocr/winrt) à *chaque* lancement du portable,
pas seulement au premier. Corrigé (2026-07-31) : les trois scripts appellent
maintenant `node scripts/patch-portable-nsis.js` avant `electron-builder`.
Validé (2026-08-01) avec un vrai `npm run build-portable` + deux lancements
successifs : le 2e lancement ne réextrait rien (371ms vs plusieurs secondes,
mtimes identiques).

Restait un trou : une *nouvelle version* du portable (ou une réinstallation)
déclenche quand même `RMDir /r` + réextraction complète de `$INSTDIR`, ce qui
aurait effacé `.ai_deps_installed`/`.ocr_deps_installed` et les paquets
pip-installés puisqu'ils vivaient dans `python-embed/` (à l'intérieur du cache
réextrait). Corrigé (2026-08-01) : torch/transformers/modèle IA et
easyocr/winrt sont maintenant installés via `pip install --target` dans
`%APPDATA%\MacroEngine\ai-deps` (calculé depuis `app.getPath('userData')`,
donc indépendant de `python-embed/`, du dossier d'installation NSIS et du
cache portable `%LOCALAPPDATA%\MacroEngine\runtime`) — survit à une
réinstallation, une mise à jour de version, ou un changement d'installeur ↔
portable. `main.py` lit le chemin via la variable d'env
`MACROENGINE_AI_DEPS_DIR` (injectée par `startEngine()`) et l'insère dans
`sys.path`, nécessaire car le fichier `._pth` du Python embarqué ignore
`PYTHONPATH`.
