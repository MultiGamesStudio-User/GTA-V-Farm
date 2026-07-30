#!/usr/bin/env node
/**
 * patch-portable-nsis.js
 * Remplace le template NSIS "portable" d'electron-builder (qui re-extrait tout
 * dans %TEMP% puis supprime, a chaque lancement) par une version qui extrait
 * une seule fois par version dans un dossier persistant cache sous
 * %LOCALAPPDATA%. Voir docs/superpowers/specs/2026-07-29-portable-persistent-cache-design.md
 *
 * node_modules n'etant pas commit, ce patch doit se reappliquer avant chaque
 * build portable (npm run build-portable l'appelle automatiquement).
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const APP_DIR     = path.resolve(__dirname, '..');
const SRC_TEMPLATE = path.join(APP_DIR, 'build-patches', 'portable.nsi');
const DEST_TEMPLATE = path.join(APP_DIR, 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'portable.nsi');

function main() {
  if (!fs.existsSync(DEST_TEMPLATE)) {
    console.log('[patch-portable-nsis] node_modules/app-builder-lib introuvable — skip (pas de build portable prevu ?).');
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf-8'));
  const version = pkg.version;

  let script = fs.readFileSync(SRC_TEMPLATE, 'utf-8');
  script = script.split('__APP_VERSION__').join(version);

  fs.writeFileSync(DEST_TEMPLATE, script, 'utf-8');
  console.log(`[patch-portable-nsis] Template portable patche (cache persistant, v${version}) -> ${DEST_TEMPLATE}`);
}

main();
