"""
fishing.py — GTA V fishing mini-game — détection 100% automatique

Pipeline :
  1. Capture zone écran (configurable ou centre)
  2. Trouve l'anneau de pêche (cercle sombre + arc coloré) via HoughCircles
  3. Vérifie si les pixels indicateur TOUCHENT les pixels de la zone colorée
  4. Quand contact confirmé → appuie la touche (OCR)
"""
from __future__ import annotations
import math
import os
import time
import threading
import logging

import numpy as np
import cv2

from .screen_reader import capture_region

logger = logging.getLogger('engine.fishing')

# ══════════════════════════════════════════════════════════════════════════════
#  Constantes
# ══════════════════════════════════════════════════════════════════════════════

# --- ZONE COLORÉE (arc cible sur l'anneau) ---
# Ce sont des éléments UI → très saturés, très lumineux (S>150, V>150)
# BLEU (arc bleu)
_ZONE_BLUE_LO  = np.array([ 85, 150, 150], np.uint8)
_ZONE_BLUE_HI  = np.array([135, 255, 255], np.uint8)
# VERT (arc vert)
_ZONE_GREEN_LO = np.array([ 35, 150, 150], np.uint8)
_ZONE_GREEN_HI = np.array([ 85, 255, 255], np.uint8)
# ORANGE (arc orange)
_ZONE_ORANGE_LO = np.array([  5, 150, 150], np.uint8)
_ZONE_ORANGE_HI = np.array([ 25, 255, 255], np.uint8)

# --- INDICATEUR (curseur qui tourne sur l'anneau) ---
# Orange / jaune vif
_IND_ORANGE_LO = np.array([  3, 120, 180], np.uint8)
_IND_ORANGE_HI = np.array([ 30, 255, 255], np.uint8)
# Blanc très lumineux
_IND_WHITE_LO = np.array([  0,   0, 200], np.uint8)
_IND_WHITE_HI = np.array([180,  50, 255], np.uint8)
# Rouge vif (H wrap-around)
_IND_RED1_LO = np.array([  0, 120, 180], np.uint8)
_IND_RED1_HI = np.array([  5, 255, 255], np.uint8)
_IND_RED2_LO = np.array([170, 120, 180], np.uint8)
_IND_RED2_HI = np.array([180, 255, 255], np.uint8)

# Nombre de frames consécutives « touching » avant d'appuyer
_CONFIRM_FRAMES = 2

# --- Capture & anneau ---
_SEARCH_SIZE = 900       # carré capturé autour du centre écran (px)
_RING_R_MIN  = 25        # rayon min anneau (px)
_RING_R_MAX  = 250       # rayon max anneau (px) — l'anneau GTA V fait ~150-200px en 1080p
_RING_WIDTH  = 14        # épaisseur bande anneau pour l'échantillonnage (px)

# --- Scoring candidat HoughCircles ---
_MIN_DARK_RATIO   = 0.05   # min % pixels sombres sur la bande
_MIN_COLOR_RATIO  = 0.01   # min % pixels colorés (UI = faible portion)
_DARK_V_THRESH    = 80     # V < seuil = pixel sombre (fond anneau)
_ARC_SAT_MIN      = 150    # S min pour compter un pixel UI coloré
_ARC_VAL_MIN      = 150    # V min pour compter un pixel UI coloré
_MIN_RING_SCORE   = 0.03   # score min pour accepter un candidat


# ══════════════════════════════════════════════════════════════════════════════
#  Détection de l'anneau — approche par forme (HoughCircles + validation)
# ══════════════════════════════════════════════════════════════════════════════

def _score_ring_candidate(hsv: np.ndarray, cx: int, cy: int, r: int,
                          band: int = 8) -> float:
    """
    Évalue si un cercle candidat (cx, cy, r) ressemble à l'anneau de pêche.
    Version vectorisée numpy — ~50x plus rapide que les boucles Python.

    L'anneau de pêche GTA V a :
      - Un fond de bande SOMBRE (V < thresh)
      - Un arc COLORÉ très saturé dessus (UI element, S et V élevés)
      - L'arc ne couvre qu'une PORTION du cercle (pas tout)
      - Le fond sombre couvre la majorité de la bande
    """
    h_img, w_img = hsv.shape[:2]
    half = band / 2.0

    # Bounding box du ring band
    r_out = int(r + half + 2)
    y0, y1 = max(0, cy - r_out), min(h_img, cy + r_out + 1)
    x0, x1 = max(0, cx - r_out), min(w_img, cx + r_out + 1)
    if y1 <= y0 or x1 <= x0:
        return 0.0

    # Distance map dans le bounding box
    yy, xx = np.mgrid[y0:y1, x0:x1]
    dist = np.sqrt((xx - cx).astype(np.float32) ** 2 +
                   (yy - cy).astype(np.float32) ** 2)
    ring_mask = (dist >= r - half) & (dist <= r + half)

    total = int(np.count_nonzero(ring_mask))
    if total < 50:
        return 0.0

    crop = hsv[y0:y1, x0:x1]
    v_ch = crop[:, :, 2]
    s_ch = crop[:, :, 1]

    dark_count  = int(np.count_nonzero(ring_mask & (v_ch < _DARK_V_THRESH)))
    color_count = int(np.count_nonzero(
        ring_mask & (s_ch >= _ARC_SAT_MIN) & (v_ch >= _ARC_VAL_MIN)))

    dark_ratio  = dark_count  / total
    color_ratio = color_count / total

    if dark_ratio < _MIN_DARK_RATIO or color_ratio < _MIN_COLOR_RATIO:
        return 0.0

    # L'arc coloré ne doit pas couvrir plus de 60% du cercle
    # (sinon c'est probablement l'océan/ciel, pas un anneau UI)
    if color_ratio > 0.60:
        return 0.0

    # Score de base
    score = dark_ratio * 0.4 + color_ratio * 0.6

    # Pénalité pour les rayons suspects (faux positifs décor/paysage)
    if r >= _RING_R_MAX - 10:
        score *= 0.3
    elif r >= _RING_R_MAX - 40:
        score *= 0.7

    return score


def _find_ring(img: np.ndarray) -> tuple[int, int, int] | None:
    """
    Cherche l'anneau de pêche via multi-pass HoughCircles + fallback contours.
    Retourne (cx, cy, radius) en coordonnées locales, ou None.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    hsv  = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    blur = cv2.GaussianBlur(gray, (5, 5), 1.5)

    best_score = 0.0
    best_ring  = None

    # Multi-pass : du plus strict au plus permissif
    _HOUGH_PARAMS = [
        (1.2, 60, 80, 35),   # strict
        (1.2, 50, 60, 25),   # moyen
        (1.5, 40, 50, 20),   # permissif
    ]

    for dp, minDist, p1, p2 in _HOUGH_PARAMS:
        circles = cv2.HoughCircles(
            blur, cv2.HOUGH_GRADIENT, dp=dp, minDist=minDist,
            param1=p1, param2=p2,
            minRadius=_RING_R_MIN, maxRadius=_RING_R_MAX,
        )
        if circles is None:
            continue
        for c in circles[0]:
            cx_c, cy_c, r_c = int(c[0]), int(c[1]), int(c[2])
            score = _score_ring_candidate(hsv, cx_c, cy_c, r_c)
            if score > best_score:
                best_score = score
                best_ring  = (cx_c, cy_c, r_c)
        # Bon score → inutile de tester des params plus lâches
        if best_score > 0.3:
            break

    # Fallback : analyse de contours colorés si Hough n'a rien trouvé
    if best_ring is None or best_score < _MIN_RING_SCORE:
        fb = _find_ring_by_color(hsv)
        if fb is not None:
            fb_score = _score_ring_candidate(hsv, fb[0], fb[1], fb[2])
            if fb_score > best_score:
                best_ring = fb

    return best_ring


def _find_ring_by_color(hsv: np.ndarray) -> tuple[int, int, int] | None:
    """
    Fallback : cherche l'arc coloré par contour, puis en déduit le cercle.
    Fonctionne même quand HoughCircles ne détecte aucun bord.
    """
    # Masque explicite des 3 couleurs UI (pas un simple seuil S/V)
    blue_m   = cv2.inRange(hsv, _ZONE_BLUE_LO,   _ZONE_BLUE_HI)
    green_m  = cv2.inRange(hsv, _ZONE_GREEN_LO,  _ZONE_GREEN_HI)
    zorange_m = cv2.inRange(hsv, _ZONE_ORANGE_LO, _ZONE_ORANGE_HI)
    colored = blue_m | green_m | zorange_m

    # Nettoyage morphologique
    kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    colored = cv2.morphologyEx(colored, cv2.MORPH_CLOSE, kern)
    colored = cv2.morphologyEx(colored, cv2.MORPH_OPEN, kern)

    contours, _ = cv2.findContours(colored, cv2.RETR_EXTERNAL,
                                   cv2.CHAIN_APPROX_SIMPLE)

    best_score = 0.0
    best = None

    for cnt in contours:
        if len(cnt) < 15:
            continue
        area = cv2.contourArea(cnt)
        if area < 300:
            continue

        (cx, cy), radius = cv2.minEnclosingCircle(cnt)
        cx, cy, radius = int(cx), int(cy), int(radius)

        if radius < _RING_R_MIN or radius > _RING_R_MAX:
            continue

        # Un arc ne remplit pas le cercle entier (ratio < 0.5)
        circle_area = math.pi * radius * radius
        if circle_area > 0 and area / circle_area > 0.5:
            continue

        score = _score_ring_candidate(hsv, cx, cy, radius)
        if score > best_score:
            best_score = score
            best = (cx, cy, radius)

    return best


def _get_screen_center() -> tuple[int, int]:
    """Retourne le centre de l'écran principal."""
    try:
        import ctypes
        user32 = ctypes.windll.user32
        return user32.GetSystemMetrics(0) // 2, user32.GetSystemMetrics(1) // 2
    except Exception:
        return 960, 540


def _capture_search_zone(capture_zone: dict | None = None) -> tuple[np.ndarray, int, int]:
    """
    Capture la zone de recherche.
    Si capture_zone est fourni ({x, y, w, h}), utilise cette zone.
    Sinon, capture un carré centré sur l'écran.
    Retourne (image, offset_x, offset_y).
    """
    if capture_zone:
        ox = int(capture_zone['x'])
        oy = int(capture_zone['y'])
        w  = int(capture_zone['w'])
        h  = int(capture_zone['h'])
        img = capture_region(ox, oy, w, h)
        return img, ox, oy

    sw, sh = _get_screen_center()
    half   = _SEARCH_SIZE // 2
    ox     = max(0, sw - half)
    oy     = max(0, sh - half)
    img    = capture_region(ox, oy, _SEARCH_SIZE, _SEARCH_SIZE)
    return img, ox, oy


# ══════════════════════════════════════════════════════════════════════════════
#  Analyse de l'anneau — approche par contact de couleurs (pixel proximity)
# ══════════════════════════════════════════════════════════════════════════════

# Pixels minimum pour considérer qu'un masque est réel (anti-bruit)
_MIN_ZONE_PX = 8
_MIN_IND_PX  = 15   # indicateur = plusieurs px brillants, pas juste du bruit
# Rayon de dilatation : combien de pixels de marge pour « touche »
_TOUCH_RADIUS = 10

def _colors_touching(
    img: np.ndarray,
    cx: int, cy: int, radius: int,
    ring_width: int = _RING_WIDTH,
    proximity: int  = _TOUCH_RADIUS,
) -> dict:
    """
    Approche simplifiée : vérifie si les pixels de l'indicateur TOUCHENT
    les pixels de la zone colorée sur la bande de l'anneau.

    Méthode :
      1. Isole la bande annulaire (ring_band)
      2. Crée le masque zone (bleu | vert | orange)
      3. Crée le masque indicateur (orange_vif | blanc | rouge)
      4. Dilate le masque zone de `proximity` pixels
      5. Si des pixels indicateur tombent dans la zone dilatée → touching

    Retourne un dict :
      touching   — bool : l'indicateur touche la zone
      has_zone   — bool : zone colorée détectée
      has_ind    — bool : indicateur détecté
      zone_pct   — float : % pixels zone / bande anneau
      ind_pct    — float : % pixels indicateur / bande anneau
      overlap_pct— float : % pixels indicateur qui touchent la zone dilatée
    """
    h, w = img.shape[:2]
    hsv  = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

    half = ring_width / 2.0
    r_out = int(radius + half + 2)

    # Crop au bounding box du ring
    y0, y1 = max(0, cy - r_out), min(h, cy + r_out + 1)
    x0, x1 = max(0, cx - r_out), min(w, cx + r_out + 1)
    crop = hsv[y0:y1, x0:x1]
    ch, cw = crop.shape[:2]
    lcx, lcy = cx - x0, cy - y0

    # Masque bande annulaire
    yy, xx = np.mgrid[0:ch, 0:cw]
    dist = np.sqrt((xx - lcx).astype(np.float32) ** 2 +
                   (yy - lcy).astype(np.float32) ** 2)
    ring = (dist >= radius - half) & (dist <= radius + half)

    total = int(np.count_nonzero(ring))
    empty = dict(touching=False, has_zone=False, has_ind=False,
                 zone_pct=0.0, ind_pct=0.0, overlap_pct=0.0)
    if total < 30:
        return empty

    # ── Masque ZONE (arc cible) : bleu | vert | orange UI ─────────────
    zone_pix = ring & (
        (cv2.inRange(crop, _ZONE_BLUE_LO,   _ZONE_BLUE_HI)   > 0) |
        (cv2.inRange(crop, _ZONE_GREEN_LO,  _ZONE_GREEN_HI)  > 0) |
        (cv2.inRange(crop, _ZONE_ORANGE_LO, _ZONE_ORANGE_HI) > 0)
    )

    # ── Masque INDICATEUR : tout pixel BRILLANT sur la bande sombre
    # qui n'est PAS la zone colorée.
    # Principe : l'anneau a un fond SOMBRE (V < 80).  L'indicateur est
    # n'importe quel élément UI brillant (V ≥ 130) qui n'est pas la zone.
    # Cela évite de dépendre d'une couleur exacte inconnue.
    v_crop = crop[:, :, 2]
    ind_pix = ring & (v_crop >= 130) & ~zone_pix

    zone_cnt = int(np.count_nonzero(zone_pix))
    ind_cnt  = int(np.count_nonzero(ind_pix))
    zone_pct = zone_cnt / total * 100
    ind_pct  = ind_cnt  / total * 100
    has_zone = zone_cnt >= _MIN_ZONE_PX
    has_ind  = ind_cnt  >= _MIN_IND_PX

    if not has_zone or not has_ind:
        return dict(touching=False, has_zone=has_zone, has_ind=has_ind,
                    zone_pct=round(zone_pct, 1), ind_pct=round(ind_pct, 1),
                    overlap_pct=0.0)

    # ── Dilatation zone → vérification overlap ────────────────────────
    kern = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (2 * proximity + 1, 2 * proximity + 1))
    zone_dilated = cv2.dilate(zone_pix.astype(np.uint8) * 255, kern) > 0

    overlap = int(np.count_nonzero(ind_pix & zone_dilated))
    overlap_pct = overlap / max(1, ind_cnt) * 100

    # L'indicateur « touche » la zone si ≥15% de ses pixels chevauchent
    touching = overlap_pct >= 15.0

    return dict(
        touching=touching,
        has_zone=has_zone,
        has_ind=has_ind,
        zone_pct=round(zone_pct, 1),
        ind_pct=round(ind_pct, 1),
        overlap_pct=round(overlap_pct, 1),
    )


# ══════════════════════════════════════════════════════════════════════════════
#  Lecture OCR de la touche (centre de l'anneau)
# ══════════════════════════════════════════════════════════════════════════════

# Touches possibles dans le mini-jeu pêche GTA V
# AZERTY : Z Q S D  |  QWERTY : W A S D  |  autres layouts communs
_VALID_KEYS = {'z', 'q', 's', 'd', 'w', 'a', 'e', 'r', 'f', 'x', 'c', 'v'}

# Table de corrections OCR courantes
_OCR_FIX = {
    # Z
    '2': 'z', 'ž': 'z', 'ż': 'z',
    # Q
    '0': 'q', 'o': 'q', 'ø': 'q', 'ö': 'q',
    # S
    '5': 's', '$': 's', 'š': 's',
    # D
    'ð': 'd', 'đ': 'd',
    # W
    'vv': 'w', 'vu': 'w',
    # A
    '@': 'a',
}


def _read_key(img: np.ndarray, cx: int, cy: int, box: int = 30) -> str:
    """
    OCR la lettre au centre de l'anneau avec multi-prétraitement.
    Essaie 6 variantes et garde la meilleure (= clé valide ou n'importe
    quel caractère alpha unique si toutes les variantes échouent le filtre strict).
    Retourne la touche lowercase ou ''.
    """
    try:
        from .ocr_engine import read_text
        x1 = max(0, cx - box);  y1 = max(0, cy - box)
        x2 = min(img.shape[1], cx + box)
        y2 = min(img.shape[0], cy + box)
        crop = img[y1:y2, x1:x2]
        if crop.size == 0:
            return ''

        up   = cv2.resize(crop, None, fx=4, fy=4, interpolation=cv2.INTER_CUBIC)
        gray = cv2.cvtColor(up, cv2.COLOR_BGR2GRAY)

        # Variante 1 : seuil fixe 150 (texte clair sur fond sombre)
        _, th1 = cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY)
        # Variante 2 : seuil 120 (plus permissif)
        _, th2 = cv2.threshold(gray, 120, 255, cv2.THRESH_BINARY)
        # Variante 3 : seuil 180 (plus strict)
        _, th3 = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY)
        # Variante 4 : inverser (texte sombre sur fond clair)
        _, th4 = cv2.threshold(gray, 120, 255, cv2.THRESH_BINARY_INV)
        # Variante 5 : seuil adaptatif
        th5 = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY, 21, 4
        )
        # Variante 6 : seuil adaptatif inversé
        th6 = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV, 21, 4
        )

        fallback_char = ''  # meilleur résultat hors _VALID_KEYS
        for th in (th1, th2, th3, th4, th5, th6):
            bgr  = cv2.cvtColor(th, cv2.COLOR_GRAY2BGR)
            text = read_text(bgr, scale=1, lang='en', psm=10)
            raw  = text.strip().lower()
            key  = _OCR_FIX.get(raw, raw)
            key  = ''.join(c for c in key if c.isalpha())
            if len(key) == 1:
                if key in _VALID_KEYS:
                    return key          # trouvé dans la liste autorisée → stop
                if not fallback_char:
                    fallback_char = key # garde le premier char alpha valide

        # Fallback : n'importe quel caractère alpha (layout inconnu)
        if fallback_char:
            logger.debug(f'[fishing] OCR fallback char: "{fallback_char}"')
            return fallback_char

    except Exception as e:
        logger.debug(f'[fishing] OCR error: {e}')
    return ''


# ══════════════════════════════════════════════════════════════════════════════
#  Debug — sauvegarde de frames annotées
# ══════════════════════════════════════════════════════════════════════════════

_DEBUG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'ocr_debug')
_MAX_DEBUG_FRAMES = 50  # ne garder que les N derniers screenshots


def _save_debug_frame(
    img: np.ndarray,
    cx: int, cy: int, radius: int,
    info: dict,
    key: str,
    tag: str = '',
) -> None:
    """Sauvegarde une frame annotée dans ocr_debug/ pour le debug visuel."""
    try:
        os.makedirs(_DEBUG_DIR, exist_ok=True)

        vis = img.copy()

        # Dessiner l'anneau (cercle vert)
        cv2.circle(vis, (cx, cy), radius, (0, 255, 0), 2)
        cv2.circle(vis, (cx, cy), 3, (0, 0, 255), -1)

        # Texte status
        touching = info.get('touching', False)
        zone_pct = info.get('zone_pct', 0)
        ind_pct  = info.get('ind_pct', 0)
        ovl_pct  = info.get('overlap_pct', 0)
        txt = (f'TOUCH:{"OUI" if touching else "NON"} '
               f'KEY:{key or "?"} '
               f'Z:{zone_pct:.0f}% I:{ind_pct:.0f}% '
               f'OVL:{ovl_pct:.0f}% R:{radius}')
        color = (0, 255, 0) if touching else (0, 255, 255)
        cv2.putText(vis, txt, (10, 30), cv2.FONT_HERSHEY_SIMPLEX,
                    0.7, color, 2)
        if tag:
            cv2.putText(vis, tag, (10, 60), cv2.FONT_HERSHEY_SIMPLEX,
                        0.6, (0, 200, 255), 2)

        ts = time.strftime('%H%M%S')
        ms = f'{time.time() % 1:.3f}'[2:]
        fname = os.path.join(_DEBUG_DIR, f'fish_{ts}_{ms}_{tag}.png')
        cv2.imwrite(fname, vis)

        # Nettoyage : supprimer les vieux fichiers si trop nombreux
        files = sorted(
            [f for f in os.listdir(_DEBUG_DIR) if f.startswith('fish_')],
        )
        while len(files) > _MAX_DEBUG_FRAMES:
            os.remove(os.path.join(_DEBUG_DIR, files.pop(0)))

    except Exception as e:
        logger.debug(f'[fishing] debug save error: {e}')


# ══════════════════════════════════════════════════════════════════════════════
#  snapshot_ring — diagnostic ponctuel (bouton "Tester" UI)
# ══════════════════════════════════════════════════════════════════════════════

def snapshot_ring(_config: dict = None) -> dict:
    """
    Capture l'écran, cherche l'anneau et retourne un rapport de diagnostic.
    Si _config contient 'capture_zone', utilise cette zone.
    """
    zone = (_config or {}).get('capture_zone')
    img, ox, oy = _capture_search_zone(zone)
    found = _find_ring(img)

    if found is None:
        return {
            'ring_found':      False,
            'touching':        False,
            'zone_pct':        0.0,
            'indicator_pct':   0.0,
            'overlap_pct':     0.0,
            'detected_key':    '',
            'ring_cx':         0,
            'ring_cy':         0,
            'ring_radius':     0,
        }

    lcx, lcy, radius = found
    info = _colors_touching(img, lcx, lcy, radius)
    key  = _read_key(img, lcx, lcy) if info['touching'] else ''

    # Sauvegarder une frame debug au snapshot
    _save_debug_frame(img, lcx, lcy, radius, info, key, tag='snapshot')

    return {
        'ring_found':       True,
        'touching':         info['touching'],
        'zone_pct':         info['zone_pct'],
        'indicator_pct':    info['ind_pct'],
        'overlap_pct':      info['overlap_pct'],
        'detected_key':     key,
        'ring_cx':          lcx + ox,
        'ring_cy':          lcy + oy,
        'ring_radius':      radius,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  FishingBot — thread de fond entièrement automatique
# ══════════════════════════════════════════════════════════════════════════════

class FishingBot:
    """
    Bot pêche automatique — aucune configuration requise.

    Paramètres optionnels dans config :
      poll_ms     — intervalle polling (défaut 30 ms)
      cooldown_ms — délai min entre deux appuis (défaut 600 ms)
      use_direct  — pydirectinput si True / pyautogui si False (défaut True)
    """

    def __init__(self, config: dict = None,
                 on_log=None, on_press=None, on_stats=None):
        self.config   = config or {}
        self.on_log   = on_log   or (lambda msg, lvl: None)
        self.on_press = on_press or (lambda key: None)
        self.on_stats = on_stats or (lambda s: None)
        self._stop    = threading.Event()
        self._thread: threading.Thread | None = None
        self._stats   = {'presses': 0, 'detections': 0, 'errors': 0,
                         'last_key': '', 'ring_found': False}

    # ── lifecycle ──────────────────────────────────────────────────────────────

    def start(self):
        self._stop.clear()
        self._stats = {'presses': 0, 'detections': 0, 'errors': 0,
                       'last_key': '', 'ring_found': False}
        self._thread = threading.Thread(
            target=self._run, daemon=True, name='fishing-bot'
        )
        self._thread.start()
        self.on_log('FishingBot démarré — détection automatique active', 'INFO')

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)
            self._thread = None
        self.on_log(
            f'FishingBot arrêté — {self._stats["presses"]} appuis effectués', 'INFO'
        )

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def get_stats(self) -> dict:
        return dict(self._stats)

    # ── boucle principale ──────────────────────────────────────────────────────

    def _run(self):
        cfg        = self.config
        poll_s     = float(cfg.get('poll_ms',     30))  / 1000.0
        cooldown   = float(cfg.get('cooldown_ms', 600)) / 1000.0
        use_direct = bool(cfg.get('use_direct', True))
        ring_width = int(cfg.get('ring_width', _RING_WIDTH))
        proximity  = int(cfg.get('tolerance', _TOUCH_RADIUS))
        default_key = str(cfg.get('default_key', '')).strip().lower()
        cap_zone   = cfg.get('capture_zone')  # {x, y, w, h} ou None

        # Cache position anneau — re-détection toutes les ~0.5 s
        REDETECT_INTERVAL = 0.5
        cached_ring: tuple[int, int, int] | None = None
        last_full_detect = 0.0
        last_press  = 0.0
        miss_count  = 0

        # Trigger : compteur de frames consécutives « touching »
        confirm_cnt       = 0
        pressed_this_zone = False  # True = déjà appuyé, attend sortie

        # Clé OCR : essaye périodiquement jusqu'à succès
        cached_key       = ''
        last_ocr_try     = 0.0

        if cap_zone:
            self.on_log(
                f'[fishing] Zone de capture : {cap_zone["x"]},{cap_zone["y"]}'
                f' {cap_zone["w"]}×{cap_zone["h"]}', 'INFO'
            )

        while not self._stop.is_set():
            try:
                now = time.time()

                # ── Capture ────────────────────────────────────────────────
                img, ox, oy = _capture_search_zone(cap_zone)

                # ── Détection complète (périodique ou quand perdu) ─────────
                need_detect = (
                    cached_ring is None
                    or now - last_full_detect >= REDETECT_INTERVAL
                    or miss_count >= 5
                )
                if need_detect:
                    found = _find_ring(img)
                    last_full_detect = now
                    miss_count = 0

                    if found:
                        cached_ring = found
                        if not self._stats['ring_found']:
                            self._stats['ring_found'] = True
                            self.on_log(
                                f'[fishing] Anneau détecté — centre='
                                f'({found[0]+ox},{found[1]+oy})'
                                f' rayon={found[2]}px', 'INFO'
                            )
                            self.on_stats(self.get_stats())
                    else:
                        if self._stats['ring_found']:
                            self._stats['ring_found'] = False
                            self.on_log(
                                '[fishing] Anneau perdu — recherche...', 'INFO'
                            )
                            self.on_stats(self.get_stats())
                        cached_ring = None
                        self._stop.wait(poll_s)
                        continue

                if cached_ring is None:
                    self._stop.wait(poll_s)
                    continue

                # ── Vérifier contact couleurs ──────────────────────────────
                lcx, lcy, radius = cached_ring
                info = _colors_touching(img, lcx, lcy, radius, ring_width, proximity)

                # Rien détecté du tout → ring probablement perdu
                if not info['has_zone'] and not info['has_ind']:
                    miss_count += 1
                    confirm_cnt = 0          # BUG FIX : reset état
                    pressed_this_zone = False
                    self._stop.wait(poll_s)
                    continue
                miss_count = 0

                # ── Lire touche OCR (retry toutes les 0.5 s si pas encore lu)
                if not cached_key and now - last_ocr_try >= 0.5:
                    last_ocr_try = now
                    cached_key = _read_key(img, lcx, lcy) or ''
                    if cached_key:
                        self._ocr_fail_count = 0
                        self.on_log(
                            f'[fishing] Touche détectée : "{cached_key.upper()}"',
                            'INFO',
                        )
                    else:
                        _ocr_fail_count = getattr(self, '_ocr_fail_count', 0) + 1
                        self._ocr_fail_count = _ocr_fail_count
                        if _ocr_fail_count == 3:
                            self.on_log(
                                '[fishing] ⚠ OCR ne lit pas la touche — vérifie que'
                                ' la canne est lancée et que le mini-jeu est visible.',
                                'WARN',
                            )
                        # Fallback : si OCR échoue 8x et qu'une touche par défaut est configurée
                        if _ocr_fail_count >= 8 and default_key:
                            cached_key = default_key
                            self.on_log(
                                f'[fishing] Touche par défaut utilisée : "{default_key.upper()}"',
                                'WARN',
                            )

                # ── Debug : sauvegarder frame (~2 s, toujours) ────────────
                if now - getattr(self, '_last_dbg', 0) >= 2.0:
                    self._last_dbg = now
                    _save_debug_frame(
                        img, lcx, lcy, radius, info, cached_key,
                        tag='detect',
                    )

                # ── Logique de déclenchement ──────────────────────────────
                if info['touching']:
                    confirm_cnt += 1
                else:
                    confirm_cnt = 0
                    pressed_this_zone = False  # reset pour la prochaine entrée

                # Appuyer après _CONFIRM_FRAMES consécutives, UNE SEULE FOIS
                if (confirm_cnt >= _CONFIRM_FRAMES
                        and not pressed_this_zone
                        and now - last_press >= cooldown):
                    key = cached_key
                    if not key:
                        # Dernier essai OCR synchrone avant de rater la fenêtre
                        key = _read_key(img, lcx, lcy) or ''
                        cached_key = key
                        if key:
                            self._ocr_fail_count = 0
                    if not key and default_key:
                        key = default_key
                        cached_key = default_key
                    if not key:
                        # OCR toujours silencieux — log une seule fois puis passe
                        ocr_blocked = getattr(self, '_ocr_blocked_logged', False)
                        if not ocr_blocked:
                            self._ocr_blocked_logged = True
                            self.on_log(
                                '[fishing] ⚠ Impossible de lire la touche OCR —'
                                ' configure une "Touche par défaut" dans les options avancées.', 'WARN'
                            )
                        self._stop.wait(poll_s)
                        continue
                    self._ocr_blocked_logged = False
                    _save_debug_frame(
                        img, lcx, lcy, radius, info, key,
                        tag='PRESS',
                    )
                    self._press(key, use_direct)
                    pressed_this_zone = True
                    self._stats['presses'] += 1
                    self._stats['detections'] += 1
                    self._stats['last_key'] = key
                    last_press = time.time()
                    self.on_press(key)
                    self.on_stats(self.get_stats())
                    self.on_log(
                        f'[fishing] ✓ Touche "{key.upper()}" pressée'
                        f' ({self._stats["presses"]} total)', 'INFO'
                    )

            except Exception as e:
                self._stats['errors'] += 1
                logger.debug(f'[fishing] tick error: {e}')

            self._stop.wait(poll_s)

    @staticmethod
    def _press(key: str, use_direct: bool) -> None:
        try:
            if use_direct:
                import pydirectinput
                pydirectinput.keyDown(key); time.sleep(0.05); pydirectinput.keyUp(key)
            else:
                import pyautogui
                pyautogui.keyDown(key);    time.sleep(0.05); pyautogui.keyUp(key)
        except Exception as e:
            logger.warning(f'[fishing] Appui touche "{key}" échoué : {e}')
