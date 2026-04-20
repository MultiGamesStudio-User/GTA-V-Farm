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

// URLs construites depuis le config (injecté par main.js via checkForUpdates)
let MANIFEST_URL = '';
let BASE_URL     = '';

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
 * checkForUpdates(botDir, rendererDir, github, onProgress?)
 *
 * botDir       — dossier racine du bot (resources/bot/ en prod, ../ en dev)
 * rendererDir  — dossier renderer dépacké (resources/app.asar.unpacked/renderer/ en prod)
 * github       — { user, repo, branch } depuis app.config.json
 * onProgress   — callback(relPath) appelé pour chaque fichier téléchargé
 *
 * Retourne : { upToDate, version, updated[], errors[] }
 *
 * Convention des chemins dans le manifest :
 *   - fichiers Python : clé = "main.py", "modules/engine/actions.py", …
 *     → écrits dans botDir/<clé>
 *   - fichiers renderer : clé = "electron-app/renderer/js/app.js", …
 *     → écrits dans rendererDir/<partie après "electron-app/renderer/">
 */
const RENDERER_MANIFEST_PREFIX = 'electron-app/renderer/';

async function checkForUpdates(botDir, rendererDir, github, onProgress) {
  const base = `https://raw.githubusercontent.com/${github.user}/${github.repo}/${github.branch}`;
  MANIFEST_URL = `${base}/update-manifest.json`;
  BASE_URL     = `${base}/`;
  const manifest = await fetchManifest();
  const { version, files } = manifest;

  // Fichiers exclus de la mise à jour automatique (modifiés localement)
  const SKIP_FILES = new Set(['main.py', 'modules/engine/screen_reader.py']);

  // Comparer les hashes
  const toUpdate = [];
  for (const [relPath, expectedHash] of Object.entries(files)) {
    if (SKIP_FILES.has(relPath)) continue;
    // Toujours updater package.json (pour version UI)
    const isPkg = relPath === 'electron-app/package.json';
    const localPath = relPath.startsWith(RENDERER_MANIFEST_PREFIX)
      ? path.join(rendererDir, relPath.slice(RENDERER_MANIFEST_PREFIX.length))
      : path.join(botDir, relPath);
    if (fileHash(localPath) !== expectedHash || isPkg) {
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
      const destPath = relPath.startsWith(RENDERER_MANIFEST_PREFIX)
        ? path.join(rendererDir, relPath.slice(RENDERER_MANIFEST_PREFIX.length))
        : path.join(botDir, relPath);
      await downloadFile(relPath, destPath);
      updated.push(relPath);
      if (onProgress) onProgress(relPath);
    } catch (e) {
      errors.push({ file: relPath, error: e.message });
    }
  }

  return { upToDate: false, version, updated, errors };
}

module.exports = { checkForUpdates };
