/**
 * prepare-python.js
 * Downloads Python 3.11 embeddable package, enables pip, and installs
 * all dependencies from requirements.txt into the embedded distribution.
 *
 * Run before building:  node scripts/prepare-python.js
 *
 * Result: electron-app/python-embed/ ready to be included via extraResources.
 */
'use strict';

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { execSync } = require('child_process');

const PYTHON_VER  = '3.11.9';
const ZIP_NAME    = `python-${PYTHON_VER}-embed-amd64.zip`;
const ZIP_URL     = `https://www.python.org/ftp/python/${PYTHON_VER}/${ZIP_NAME}`;
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';

const TESS_VER    = '5.4.0.20240606';
const TESS_EXE_URL = `https://github.com/UB-Mannheim/tesseract/releases/download/v${TESS_VER}/tesseract-ocr-w64-setup-${TESS_VER}.exe`;

const SCRIPT_DIR  = __dirname;
const APP_DIR     = path.resolve(SCRIPT_DIR, '..');
const EMBED_DIR   = path.join(APP_DIR, 'python-embed');
const TESS_DIR    = path.join(APP_DIR, '..', 'tesseract');
const REQ_FILE    = path.join(APP_DIR, '..', 'requirements.txt');

// ── Helpers ──────────────────────────────────────────────────────────────────
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const attempt = (targetUrl, redirects) => {
      if (redirects > 5) { reject(new Error('Too many redirects')); return; }
      const proto = targetUrl.startsWith('https') ? https : http;
      proto.get(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          attempt(res.headers.location, redirects + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`));
          return;
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      }).on('error', reject);
    };
    attempt(url, 0);
  });
}

function unzip(zipPath, destDir) {
  // Use PowerShell's Expand-Archive (available on Win10+)
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${destDir}'"`,
    { stdio: 'inherit', windowsHide: true }
  );
}

function removePycache(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__') {
        fs.rmSync(full, { recursive: true });
      } else {
        removePycache(full);
      }
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const pythonExe = path.join(EMBED_DIR, 'python.exe');

  // Skip if already prepared
  if (fs.existsSync(pythonExe)) {
    console.log('[prepare-python] python-embed/ already exists — skipping download.');
    console.log('[prepare-python] Delete python-embed/ to force re-download.');
  } else {
    // 1. Download embeddable zip
    const zipDest = path.join(APP_DIR, ZIP_NAME);
    console.log(`[prepare-python] Downloading ${ZIP_URL} …`);
    await download(ZIP_URL, zipDest);
    console.log('[prepare-python] Download complete.');

    // 2. Extract
    console.log('[prepare-python] Extracting…');
    if (fs.existsSync(EMBED_DIR)) fs.rmSync(EMBED_DIR, { recursive: true });
    fs.mkdirSync(EMBED_DIR, { recursive: true });
    unzip(zipDest, EMBED_DIR);
    fs.unlinkSync(zipDest);
    console.log('[prepare-python] Extracted to python-embed/');

    // 3. Enable pip: uncomment "import site" in python311._pth
    const pthFile = path.join(EMBED_DIR, `python311._pth`);
    if (fs.existsSync(pthFile)) {
      let pth = fs.readFileSync(pthFile, 'utf-8');
      pth = pth.replace(/^#\s*import site/m, 'import site');
      // Also add Lib\site-packages so pip-installed packages are found
      if (!pth.includes('Lib\\site-packages')) {
        pth += '\nLib\\site-packages\n';
      }
      fs.writeFileSync(pthFile, pth, 'utf-8');
      console.log('[prepare-python] Enabled import site in _pth file.');
    }
  }

  // Ensure pip is available (may have been cleaned up from a previous build)
  let hasPip = false;
  try {
    execSync(`"${pythonExe}" -m pip --version`, { stdio: 'ignore', windowsHide: true });
    hasPip = true;
  } catch (_) {}
  if (!hasPip) {
    const getPipPath = path.join(EMBED_DIR, 'get-pip.py');
    console.log('[prepare-python] pip missing — downloading get-pip.py…');
    await download(GET_PIP_URL, getPipPath);
    console.log('[prepare-python] Installing pip…');
    execSync(`"${pythonExe}" "${getPipPath}" --no-warn-script-location`, {
      cwd: EMBED_DIR,
      stdio: 'inherit',
      windowsHide: true,
    });
    try { fs.unlinkSync(getPipPath); } catch (_) {}
    console.log('[prepare-python] pip installed.');
  }

  // 5. Install requirements (requirements.txt already pins opencv-python-headless)
  if (fs.existsSync(REQ_FILE)) {
    console.log('[prepare-python] Installing requirements…');
    execSync(
      `"${pythonExe}" -m pip install -r "${REQ_FILE}" --no-warn-script-location --disable-pip-version-check`,
      { cwd: EMBED_DIR, stdio: 'inherit', windowsHide: true }
    );
    console.log('[prepare-python] Requirements installed.');
  } else {
    console.log('[prepare-python] No requirements.txt found — skipping pip install.');
  }

  // 6. Remove setuptools/wheel from the bundle (not needed at runtime) — but
  // KEEP pip: Auto Bouffe's local-AI dependencies (torch/transformers, ~2-4 Go)
  // are deliberately not bundled here (see requirements-ai.txt) and instead
  // get pip-installed on the client's own machine at first launch
  // (electron-app/main.js → ensureAiDeps()), which needs pip to still work
  // in the shipped python-embed.
  console.log('[prepare-python] Cleaning up build-only packages…');
  for (const pkg of ['setuptools', 'wheel']) {
    try {
      execSync(`"${pythonExe}" -m pip uninstall ${pkg} -y --quiet`, {
        cwd: EMBED_DIR, stdio: 'ignore', windowsHide: true
      });
    } catch (_) {}
  }

  // 7. Strip pywin32 submodules the bot never imports (only win32gui/win32con/
  // win32process are used — see modules/engine/window_manager.py) and anything
  // pip left behind on Windows file locks (uninstall renames to ~name and gives
  // up if it can't delete). Portable startup re-extracts this whole folder, so
  // every unused MB here is pure launch-time cost.
  const spDir = path.join(EMBED_DIR, 'Lib', 'site-packages');
  if (fs.existsSync(spDir)) {
    // 'pip' itself is intentionally NOT stripped here — see the note on the
    // uninstall loop above, ensureAiDeps() needs it at runtime.
    const UNUSED_PREFIXES = ['win32com', 'win32comext', 'pythonwin', 'adodbapi', 'isapi', 'setuptools', 'wheel'];
    const UNUSED_FILES = ['PyWin32.chm'];
    for (const entry of fs.readdirSync(spDir)) {
      const isOrphan = entry.startsWith('~');
      const isUnused = UNUSED_PREFIXES.some(p => entry === p || entry.startsWith(p + '-') || entry.startsWith(p + '.'));
      const isUnusedFile = UNUSED_FILES.includes(entry);
      if (isOrphan || isUnused || isUnusedFile) {
        fs.rmSync(path.join(spDir, entry), { recursive: true, force: true });
      }
    }
    // Remove __pycache__ dirs to save space
    removePycache(spDir);
  }

  console.log('[prepare-python] Done! python-embed/ is ready for packaging.');

  // ── Tesseract-OCR ──────────────────────────────────────────────────────────
  const tessExe = path.join(TESS_DIR, 'tesseract.exe');
  if (fs.existsSync(tessExe)) {
    console.log('[prepare-python] tesseract/ already exists — skipping download.');
  } else {
    console.log(`[prepare-python] Downloading Tesseract-OCR ${TESS_VER}…`);
    const setupPath = path.join(APP_DIR, 'tesseract-setup.exe');
    await download(TESS_EXE_URL, setupPath);
    console.log('[prepare-python] Extracting Tesseract with 7z…');
    const tmpDir = path.join(APP_DIR, '_tess_extract');
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      execSync(`7z x "${setupPath}" -o"${tmpDir}" -y`, { stdio: 'inherit', windowsHide: true });
    } catch (e) {
      console.error('[prepare-python] 7z extraction failed. Make sure 7-Zip is in PATH.');
      throw e;
    }
    // Copy only essential files: tesseract.exe + DLLs + tessdata
    if (fs.existsSync(TESS_DIR)) fs.rmSync(TESS_DIR, { recursive: true });
    fs.mkdirSync(path.join(TESS_DIR, 'tessdata'), { recursive: true });
    fs.copyFileSync(path.join(tmpDir, 'tesseract.exe'), path.join(TESS_DIR, 'tesseract.exe'));
    for (const f of fs.readdirSync(tmpDir).filter(n => n.endsWith('.dll'))) {
      fs.copyFileSync(path.join(tmpDir, f), path.join(TESS_DIR, f));
    }
    // osd.traineddata (orientation/script detection) and the ScrollView Java
    // debug viewer jars ship with the installer but the bot never uses OSD
    // (--psm 0) or the debug viewer — pure launch-time weight on portable.
    const TESSDATA_SKIP = new Set([
      'osd.traineddata', 'ScrollView.jar', 'piccolo2d-core-3.0.1.jar',
      'piccolo2d-extras-3.0.1.jar', 'jaxb-api-2.3.1.jar',
    ]);
    const srcTessdata = path.join(tmpDir, 'tessdata');
    if (fs.existsSync(srcTessdata)) {
      for (const f of fs.readdirSync(srcTessdata)) {
        if (TESSDATA_SKIP.has(f)) continue;
        const src = path.join(srcTessdata, f);
        if (fs.statSync(src).isFile()) {
          fs.copyFileSync(src, path.join(TESS_DIR, 'tessdata', f));
        }
      }
    }
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
    try { fs.unlinkSync(setupPath); } catch (_) {}
    console.log('[prepare-python] Tesseract-OCR installed to tesseract/');
  }
}

main().catch(err => {
  console.error('[prepare-python] FATAL:', err);
  process.exit(1);
});
