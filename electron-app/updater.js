'use strict';
/**
 * updater.js — Mise à jour automatique incrémentale
 *
 * Télécharge update-manifest.json depuis GitHub, compare les hashes SHA256
 * des fichiers locaux, et télécharge uniquement les fichiers modifiés.
 */

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const MANIFEST_URL = 'https://raw.githubusercontent.com/MultiGamesStudio-User/GTA-V-Farm/main/update-manifest.json';
const BASE_URL     = 'https://raw.githubusercontent.com/MultiGamesStudio-User/GTA-V-Farm/main/';

// ── Helpers réseau ────────────────────────────────────────────────────────────
function _get(url, asBuffer = false) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'MacroEngine-Updater/1.0', 'Cache-Control': 'no-cache' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return _get(res.headers.location, asBuffer).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} — ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve(asBuffer ? buf : buf.toString('utf-8'));
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function fetchManifest() {
  return _get(MANIFEST_URL).then(body => JSON.parse(body));
}

function downloadFile(relPath, destPath) {
  return _get(BASE_URL + relPath, true).then(buf => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const tmp = destPath + '.tmp';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, destPath);
  });
}

// ── Hash local ────────────────────────────────────────────────────────────────
function fileHash(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch (_) {
    return null; // fichier absent
  }
}

// ── API principale ────────────────────────────────────────────────────────────
/**
 * checkForUpdates(botDir, onProgress?)
 *
 * botDir      — dossier racine du bot (resources/bot/ en prod, ../ en dev)
 * onProgress  — callback(relPath) appelé pour chaque fichier téléchargé
 *
 * Retourne : { upToDate, version, updated[], errors[] }
 */
async function checkForUpdates(botDir, onProgress) {
  const manifest = await fetchManifest();
  const { version, files } = manifest;

  // Fichiers exclus de la mise à jour automatique (modifiés localement)
  const SKIP_FILES = new Set(['main.py', 'modules/engine/screen_reader.py']);

  // Comparer les hashes
  const toUpdate = [];
  for (const [relPath, expectedHash] of Object.entries(files)) {
    if (SKIP_FILES.has(relPath)) continue;
    const localPath = path.join(botDir, relPath);
    if (fileHash(localPath) !== expectedHash) {
      toUpdate.push(relPath);
    }
  }

  if (toUpdate.length === 0) {
    return { upToDate: true, version, updated: [], errors: [] };
  }

  // Télécharger les fichiers modifiés
  const updated = [];
  const errors  = [];

  for (const relPath of toUpdate) {
    try {
      await downloadFile(relPath, path.join(botDir, relPath));
      updated.push(relPath);
      if (onProgress) onProgress(relPath);
    } catch (e) {
      errors.push({ file: relPath, error: e.message });
    }
  }

  return { upToDate: false, version, updated, errors };
}

module.exports = { checkForUpdates };
