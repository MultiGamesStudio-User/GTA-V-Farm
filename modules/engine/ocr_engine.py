"""
ocr_engine.py — Moteur OCR multi-backend, multi-stratégie, optimisé HUD jeux vidéo.

Stratégie :
  1. EasyOCR   (deep learning — essaie 5 variantes de prétraitement, garde le meilleur)
  2. WinRT     (Windows OCR natif, rapide — fallback si EasyOCR échoue)
  3. Tesseract (dernier recours)

Usage :
  from .ocr_engine import read_text, ocr_status
  text = read_text(img_bgr_numpy, scale=2, lang='en')
  info = ocr_status()
"""
from __future__ import annotations
import os
import sys
import logging
import numpy as np
import cv2

logger = logging.getLogger('engine.ocr')


# Stockage userData (APPDATA) pour éviter les problèmes de droits
if sys.platform == 'win32':
    _USERDATA = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'MacroEngine')
else:
    _USERDATA = os.path.join(os.path.expanduser('~/.macroengine'))
os.makedirs(_USERDATA, exist_ok=True)
_MODEL_DIR = os.path.join(_USERDATA, 'models', 'easyocr')
_DEBUG_DIR = os.path.join(_USERDATA, 'ocr_debug')   # si DEBUG_OCR=1, sauvegarde les images ici
os.makedirs(_MODEL_DIR, exist_ok=True)

_DEBUG_OCR = os.environ.get('DEBUG_OCR', '0') == '1'

# ══════════════════════════════════════════════════════════════════════════════
#  Détection des backends (lazy)
# ══════════════════════════════════════════════════════════════════════════════
_easyocr_reader = None
_EASYOCR_OK = None
_WINRT_OK   = None
_TESS_OK    = None


def _check_easyocr() -> bool:
    global _EASYOCR_OK
    if _EASYOCR_OK is None:
        try:
            import easyocr  # noqa: F401
            _EASYOCR_OK = True
        except ImportError:
            _EASYOCR_OK = False
    return _EASYOCR_OK


def _check_winrt() -> bool:
    global _WINRT_OK
    if _WINRT_OK is None:
        try:
            from winsdk.windows.media.ocr import OcrEngine  # noqa: F401
            _WINRT_OK = True
        except Exception:
            try:
                import winrt.windows.media.ocr  # noqa: F401
                _WINRT_OK = True
            except Exception:
                _WINRT_OK = False
    return _WINRT_OK


def _check_tesseract() -> bool:
    global _TESS_OK
    if _TESS_OK is None:
        try:
            import pytesseract
            for _p in [
                os.path.join(_ROOT, 'tesseract', 'tesseract.exe'),
                os.path.join(os.environ.get('PROGRAMFILES',     ''), 'Tesseract-OCR', 'tesseract.exe'),
                os.path.join(os.environ.get('PROGRAMFILES(X86)',''), 'Tesseract-OCR', 'tesseract.exe'),
                os.path.join(os.environ.get('LOCALAPPDATA',     ''), 'Programs', 'Tesseract-OCR', 'tesseract.exe'),
            ]:
                if os.path.isfile(_p):
                    pytesseract.pytesseract.tesseract_cmd = _p
                    break
            pytesseract.get_tesseract_version()
            _TESS_OK = True
        except Exception:
            _TESS_OK = False
    return _TESS_OK


def ocr_status() -> dict:
    """Retourne l'état de chaque backend et le moteur actif."""
    easyocr   = _check_easyocr()
    winrt     = _check_winrt()
    tesseract = _check_tesseract()
    engine = ('easyocr' if easyocr else 'winrt' if winrt else 'tesseract' if tesseract else 'none')
    return {
        'engine':    engine,
        'available': engine != 'none',
        'easyocr':   easyocr,
        'winrt':     winrt,
        'tesseract': tesseract,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  Utilitaires texte
# ══════════════════════════════════════════════════════════════════════════════
def _clean(text: str) -> str:
    out = ''.join(c if 32 <= ord(c) < 127 or c == '\n' else ' ' for c in text)
    lines = [' '.join(l.split()) for l in out.splitlines() if l.strip()]
    return '\n'.join(lines).strip()


def _score(text: str) -> float:
    """Score de qualité : favorise les alphanumériques + ponctuation courante."""
    if not text:
        return 0.0
    good    = sum(1 for c in text if c.isalnum() or c in ' .,/:\\-+%$€#@!?()[]')
    garbage = sum(1 for c in text if ord(c) > 127 or (ord(c) < 32 and c != '\n'))
    noise   = sum(1 for c in text if c in '|_~^`\\{}')
    # Bonus si le texte ressemble à du contenu HUD (chiffres + unités)
    hud_bonus = 1.5 if any(c.isdigit() for c in text) else 0.0
    return good * 2.0 - garbage * 5.0 - noise * 1.5 + hud_bonus


def _sort_items(items: list) -> list:
    """
    Trie les blocs EasyOCR par ligne (tolérance Y) puis par X.
    Évite que de légères variations de Y inversent l'ordre horizontal.
    """
    if not items:
        return []
    avg_h = sum(abs(b[2][1] - b[0][1]) for b, _, _ in items) / len(items)
    tol   = max(avg_h * 0.6, 12)

    items = sorted(items, key=lambda r: r[0][0][1])   # tri Y brut
    lines, current = [], [items[0]]
    for item in items[1:]:
        if abs(item[0][0][1] - current[0][0][0][1]) <= tol:
            current.append(item)
        else:
            lines.append(current)
            current = [item]
    lines.append(current)

    ordered = []
    for line in lines:
        line.sort(key=lambda r: r[0][0][0])
        ordered.extend(line)
    return ordered


# ══════════════════════════════════════════════════════════════════════════════
#  Génération des variantes de prétraitement
# ══════════════════════════════════════════════════════════════════════════════
def _upscale(img: np.ndarray, scale: int) -> np.ndarray:
    if scale > 1:
        h, w = img.shape[:2]
        img = cv2.resize(img, (w * scale, h * scale), interpolation=cv2.INTER_CUBIC)
    return img


def _border(img: np.ndarray, pad: int = 20, color=(255, 255, 255)) -> np.ndarray:
    return cv2.copyMakeBorder(img, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=color)


def _make_variants(img_bgr: np.ndarray, scale: int = 0) -> list[np.ndarray]:
    """
    Génère 6 variantes prétraitées pour maximiser les chances OCR sur HUD jeux.

    Variante 0 : upscale brut — EasyOCR est assez robuste pour l'utiliser tel quel
    Variante 1 : CLAHE couleur + unsharp — améliore le contraste général
    Variante 2 : extraction texte clair (HUD blanc/jaune sur fond sombre)
    Variante 3 : extraction texte sombre (texte noir sur fond clair)
    Variante 4 : canal le plus contrasté + CLAHE + inversion adaptative
    Variante 5 : threshold adaptatif gaussian sur luminance
    """
    h, w = img_bgr.shape[:2]

    # Upscale auto : min ×3 pour les petites régions, cible 800 px, plafond ×8
    if scale <= 0:
        s     = max(3, -(-800 // max(w, 1)))
        scale = min(s, 8)

    variants = []

    def _add_bgr(img):
        variants.append(_border(_upscale(img, scale)))

    def _add_gray(g):
        # Convertit en BGR (EasyOCR accepte BGR)
        rgb = cv2.cvtColor(g, cv2.COLOR_GRAY2BGR)
        variants.append(_border(_upscale(rgb, scale)))

    # ── V0 : brut
    _add_bgr(img_bgr.copy())

    # ── V1 : CLAHE LAB + unsharp masking
    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(4, 4))
    l = clahe.apply(l)
    v1 = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)
    blur = cv2.GaussianBlur(v1, (0, 0), sigmaX=1.2)
    v1 = cv2.addWeighted(v1, 2.0, blur, -1.0, 0)
    _add_bgr(v1)

    # ── V2 : texte clair sur fond sombre → isoler la luminosité haute
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    mean_val = float(np.mean(gray))

    if mean_val < 140:  # fond sombre probable
        # Threshold : garde seulement les pixels très lumineux (texte blanc/jaune)
        thresh = max(int(mean_val * 1.5), 80)
        _, mask = cv2.threshold(gray, thresh, 255, cv2.THRESH_BINARY)
        # Fermeture morphologique légère pour connecter les glyphes fragmentés
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        _add_gray(cv2.bitwise_not(mask))   # texte noir sur blanc
    else:  # fond clair → inversion + CLAHE
        _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        _add_gray(mask)

    # ── V3 : OTSU inversé sur CLAHE agressif
    clahe2 = cv2.createCLAHE(clipLimit=6.0, tileGridSize=(2, 2))
    gray_eq = clahe2.apply(gray)
    _, ot = cv2.threshold(gray_eq, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # Choisir la version (normale/inversée) où le texte est noir sur blanc
    if np.mean(ot) > 127:   # fond blanc → texte noir déjà bon
        _add_gray(ot)
    else:                   # fond noir → inverser
        _add_gray(cv2.bitwise_not(ot))

    # ── V4 : canal RGB le plus contrasté
    best_ch = max(cv2.split(img_bgr), key=lambda c: float(c.std()))
    best_ch = clahe.apply(best_ch)
    # Inversion adaptative si fond sombre
    if np.mean(best_ch) < 128:
        best_ch = cv2.bitwise_not(best_ch)
    _add_gray(best_ch)

    # ── V5 : threshold adaptatif gaussien (robuste sur fond texturé)
    gray_smooth = cv2.GaussianBlur(gray, (3, 3), 0)
    blk_size = max(11, (w // 8) | 1)
    adp = cv2.adaptiveThreshold(
        gray_smooth, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY,
        blk_size, 4
    )
    # Choisir normale ou inversée selon la densité de pixels noirs
    if np.mean(adp) < 127:
        adp = cv2.bitwise_not(adp)
    _add_gray(adp)

    return variants


def _save_debug(variants: list[np.ndarray], label: str = ''):
    """Sauvegarde les variantes si DEBUG_OCR=1."""
    if not _DEBUG_OCR:
        return
    os.makedirs(_DEBUG_DIR, exist_ok=True)
    import time
    ts = int(time.time() * 1000) % 100000
    for i, img in enumerate(variants):
        path = os.path.join(_DEBUG_DIR, f'{ts}_{label}_v{i}.png')
        cv2.imwrite(path, img)
    logger.debug(f'OCR debug images saved to {_DEBUG_DIR} (prefix {ts}_{label})')


# ══════════════════════════════════════════════════════════════════════════════
#  Backend 1 — EasyOCR (multi-variantes)
# ══════════════════════════════════════════════════════════════════════════════
def _get_easyocr_reader(langs: list[str]):
    global _easyocr_reader
    import easyocr
    key = tuple(sorted(langs))
    if _easyocr_reader is None or getattr(_easyocr_reader, '_langs', None) != key:
        logger.info(f'Init EasyOCR {langs} — premier appel peut prendre ~30s…')
        _easyocr_reader = easyocr.Reader(
            langs, gpu=False, verbose=False,
            model_storage_directory=_MODEL_DIR,
        )
        _easyocr_reader._langs = key
    return _easyocr_reader


def _run_easyocr_on(img: np.ndarray, reader, conf_min: float = 0.05) -> tuple[str, float]:
    """
    Lance EasyOCR sur une image prétraitée.
    Retourne (texte, score_confiance_moyen).
    """
    try:
        results = reader.readtext(img, detail=1, paragraph=False)
        items = [(bbox, text.strip(), conf)
                 for bbox, text, conf in results
                 if conf >= conf_min and text.strip()]

        if not items:
            return '', 0.0

        sorted_items = _sort_items(items)
        text = _clean(' '.join(t for _, t, _ in sorted_items))
        avg_conf = sum(c for _, _, c in items) / len(items)
        # Score combiné : qualité du texte + bonus confiance (pas multiplicatif
        # pour éviter que haute confiance sur texte faux batte bonne lecture)
        combined = _score(text) + avg_conf * 3.0
        return text, combined
    except Exception as e:
        logger.debug(f'EasyOCR run erreur: {e}')
        return '', 0.0


def _ocr_easyocr_multi(
    img_bgr: np.ndarray,
    scale:   int  = 0,
    lang:    str  = 'en',
) -> str:
    """
    Essaie toutes les variantes prétraitées et retourne le meilleur résultat.
    """
    langs = ['en']
    if lang.startswith('fr'):   langs = ['fr', 'en']
    elif lang.startswith('de'): langs = ['de', 'en']
    elif lang.startswith('es'): langs = ['es', 'en']

    reader   = _get_easyocr_reader(langs)
    variants = _make_variants(img_bgr, scale=scale)
    _save_debug(variants, 'easyocr')

    best_text  = ''
    best_score = -999.0

    for i, img in enumerate(variants):
        text, sc = _run_easyocr_on(img, reader)
        logger.debug(f'  variant {i}: score={sc:.1f} text={repr(text[:60])}')
        if sc > best_score:
            best_score = sc
            best_text  = text

    return best_text


# ══════════════════════════════════════════════════════════════════════════════
#  Backend 2 — Windows OCR (WinRT)
# ══════════════════════════════════════════════════════════════════════════════
def _ocr_winrt(img_bgr: np.ndarray, scale: int = 0) -> str:
    import asyncio
    import io
    from PIL import Image

    # Upscale minimal pour WinRT
    h, w = img_bgr.shape[:2]
    if scale <= 0:
        scale = min(max(2, -(-600 // max(w, 1))), 8)
    if scale > 1:
        img_bgr = cv2.resize(img_bgr, (w * scale, h * scale), interpolation=cv2.INTER_CUBIC)

    pil = Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
    buf = io.BytesIO()
    pil.save(buf, format='PNG')
    png_bytes = buf.getvalue()

    async def _run():
        try:
            from winsdk.windows.media.ocr import OcrEngine
            from winsdk.windows.storage.streams import InMemoryRandomAccessStream, DataWriter
            from winsdk.windows.graphics.imaging import BitmapDecoder, BitmapPixelFormat, BitmapAlphaMode
        except ImportError:
            from winrt.windows.media.ocr import OcrEngine
            from winrt.windows.storage.streams import InMemoryRandomAccessStream, DataWriter
            from winrt.windows.graphics.imaging import BitmapDecoder, BitmapPixelFormat, BitmapAlphaMode

        stream = InMemoryRandomAccessStream()
        writer = DataWriter(stream)
        writer.write_bytes(list(png_bytes))
        await writer.store_async()
        stream.seek(0)

        decoder = await BitmapDecoder.create_async(stream)
        bitmap  = await decoder.get_software_bitmap_async(
            BitmapPixelFormat.BGRA8, BitmapAlphaMode.PREMULTIPLIED
        )
        engine = OcrEngine.try_create_from_user_profile_languages()
        if engine is None:
            engine = OcrEngine.try_create_from_language(
                next(iter(OcrEngine.available_recognizer_languages), None)
            )
        if engine is None:
            return ''
        result = await engine.recognize_async(bitmap)
        return result.text

    try:
        loop = asyncio.new_event_loop()
        try:
            return _clean(loop.run_until_complete(_run()))
        finally:
            loop.close()
    except Exception as e:
        logger.debug(f'WinRT erreur: {e}')
        return ''


# ══════════════════════════════════════════════════════════════════════════════
#  Backend 3 — Tesseract (fallback)
# ══════════════════════════════════════════════════════════════════════════════
_PSM_AUTO = (7, 6, 8, 11, 13)


def _ocr_tesseract(
    img_bgr:   np.ndarray,
    scale:     int        = 0,
    psm:       int | None = None,
    lang:      str        = 'eng',
    whitelist: str        = '',
) -> str:
    import pytesseract
    from PIL import Image

    cfg = '--oem 3 -c preserve_interword_spaces=1'
    if whitelist:
        cfg += f' -c tessedit_char_whitelist={whitelist}'

    variants  = _make_variants(img_bgr, scale=scale)
    best_text  = ''
    best_score = -999.0

    psm_list = [psm] if psm is not None else list(_PSM_AUTO)
    for img in variants:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        pil  = Image.fromarray(gray)
        for p in psm_list:
            try:
                raw = pytesseract.image_to_string(pil, lang=lang, config=f'{cfg} --psm {p}')
                txt = _clean(raw)
                sc  = _score(txt)
                if sc > best_score:
                    best_score, best_text = sc, txt
            except Exception:
                pass

    return best_text


# ══════════════════════════════════════════════════════════════════════════════
#  Point d'entrée public
# ══════════════════════════════════════════════════════════════════════════════
def read_text(
    img_bgr:   np.ndarray,
    scale:     int         = 0,
    lang:      str         = 'en',
    psm:       int | None  = None,
    whitelist: str         = '',
    invert:    bool | None = None,   # gardé pour compatibilité, auto-géré maintenant
    engine:    str         = 'auto',
) -> str:
    """
    Lit le texte dans img_bgr (NumPy BGR).

    Avec engine='auto' :
      - EasyOCR multi-variantes (6 prétraitements, garde le meilleur)
      - Fallback WinRT si EasyOCR donne rien
      - Fallback Tesseract multi-variantes si WinRT indispo
    """
    if img_bgr is None or img_bgr.size == 0:
        return ''

    # Si invert explicite, pré-inverser l'image avant tout
    if invert is True:
        img_bgr = cv2.bitwise_not(img_bgr)

    use = engine if engine != 'auto' else (
        'easyocr'   if _check_easyocr()   else
        'winrt'     if _check_winrt()     else
        'tesseract' if _check_tesseract() else
        'none'
    )

    if use == 'none':
        raise RuntimeError(
            'Aucun moteur OCR disponible.\n'
            'pip install easyocr\n'
            'ou : https://github.com/UB-Mannheim/tesseract/wiki'
        )

    if use == 'easyocr':
        try:
            result = _ocr_easyocr_multi(img_bgr, scale=scale, lang=lang)
            if result:
                return result
        except Exception as e:
            logger.warning(f'EasyOCR erreur: {e}')

    if use in ('easyocr', 'winrt') and _check_winrt():
        try:
            result = _ocr_winrt(img_bgr, scale=scale)
            if result:
                return result
        except Exception as e:
            logger.debug(f'WinRT erreur: {e}')

    if _check_tesseract():
        tess_lang = lang if lang in ('eng', 'fra', 'deu', 'spa') else 'eng'
        return _ocr_tesseract(img_bgr, scale=scale, psm=psm, lang=tess_lang, whitelist=whitelist)

    return ''
