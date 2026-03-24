"""
coord_utils.py — Utilitaires de coordonnées et validation de points.

Fonctions pures (pas d'I/O, pas d'effets de bord) pour :
  - Valider qu'un point/région est bien dans une fenêtre cible
  - Convertir entre coordonnées écran et coordonnées fenêtre-relative
  - Redimensionner des coords d'une résolution vers une autre
  - Diagnostiquer les erreurs de positionnement

Utilisées avant chaque clic/région pour éviter les clics hors-cible.
"""
from __future__ import annotations


# ── Types ──────────────────────────────────────────────────────────────────────
# rect = (left, top, right, bottom) en pixels écran absolus

# ── Taille d'une fenêtre ───────────────────────────────────────────────────────
def rect_size(rect: tuple[int, int, int, int]) -> tuple[int, int]:
    """Retourne (largeur, hauteur) à partir d'un rect (left, top, right, bottom)."""
    left, top, right, bottom = rect
    return (right - left, bottom - top)


# ── Validation ─────────────────────────────────────────────────────────────────
def validate_point(x: int, y: int, rect: tuple[int, int, int, int]) -> bool:
    """Retourne True si (x, y) est à l'intérieur du rect (bornes incluses)."""
    left, top, right, bottom = rect
    return left <= x < right and top <= y < bottom


def validate_region(region: dict, rect: tuple[int, int, int, int]) -> bool:
    """
    Retourne True si la région {x, y, w, h} (en coordonnées ÉCRAN)
    est entièrement contenue dans le rect cible.
    """
    rx, ry, rw, rh = region['x'], region['y'], region['w'], region['h']
    left, top, right, bottom = rect
    return (
        rx >= left and ry >= top
        and rx + rw <= right
        and ry + rh <= bottom
    )


def clamp_point(x: int, y: int, rect: tuple[int, int, int, int]) -> tuple[int, int]:
    """Force (x, y) à rester dans le rect. Utile pour corriger un débordement léger."""
    left, top, right, bottom = rect
    return (
        max(left, min(x, right - 1)),
        max(top,  min(y, bottom - 1)),
    )


def clamp_region(region: dict, rect: tuple[int, int, int, int]) -> dict:
    """
    Rogne la région pour qu'elle tienne entièrement dans le rect.
    Retourne un nouveau dict {x, y, w, h}.
    """
    left, top, right, bottom = rect
    rx = max(region['x'], left)
    ry = max(region['y'], top)
    rr = min(region['x'] + region['w'], right)
    rb = min(region['y'] + region['h'], bottom)
    return {
        'x': rx, 'y': ry,
        'w': max(0, rr - rx),
        'h': max(0, rb - ry),
    }


# ── Conversion écran ↔ fenêtre ─────────────────────────────────────────────────
def window_to_screen(
    x: int, y: int,
    rect: tuple[int, int, int, int],
) -> tuple[int, int]:
    """
    Convertit des coordonnées RELATIVES À LA FENÊTRE (0,0 = coin haut-gauche)
    en coordonnées ÉCRAN absolues.
    """
    left, top, _, _ = rect
    return (x + left, y + top)


def screen_to_window(
    x: int, y: int,
    rect: tuple[int, int, int, int],
) -> tuple[int, int]:
    """
    Convertit des coordonnées ÉCRAN absolues en coordonnées
    RELATIVES À LA FENÊTRE (0,0 = coin haut-gauche).
    """
    left, top, _, _ = rect
    return (x - left, y - top)


def region_window_to_screen(region: dict, rect: tuple[int, int, int, int]) -> dict:
    """Convertit une région fenêtre-relative en coordonnées écran."""
    left, top, _, _ = rect
    return {'x': region['x'] + left, 'y': region['y'] + top,
            'w': region['w'], 'h': region['h']}


def region_screen_to_window(region: dict, rect: tuple[int, int, int, int]) -> dict:
    """Convertit une région écran en coordonnées fenêtre-relatives."""
    left, top, _, _ = rect
    return {'x': region['x'] - left, 'y': region['y'] - top,
            'w': region['w'], 'h': region['h']}


# ── Redimensionnement résolution ────────────────────────────────────────────────
def scale_point(
    x: int, y: int,
    from_w: int, from_h: int,
    to_w: int,   to_h: int,
) -> tuple[int, int]:
    """
    Adapte (x, y) d'une résolution source vers une résolution cible.
    Exemple : point calibré en 1920×1080 → fenêtre réelle 1280×720.
    """
    return (
        round(x * to_w / from_w),
        round(y * to_h / from_h),
    )


def scale_region(
    region: dict,
    from_w: int, from_h: int,
    to_w: int,   to_h: int,
) -> dict:
    """Adapte une région {x, y, w, h} d'une résolution source vers une cible."""
    sx = to_w / from_w
    sy = to_h / from_h
    return {
        'x': round(region['x'] * sx),
        'y': round(region['y'] * sy),
        'w': round(region['w'] * sx),
        'h': round(region['h'] * sy),
    }


def auto_scale_point(
    x: int, y: int,
    ref_w: int, ref_h: int,
    rect: tuple[int, int, int, int],
) -> tuple[int, int]:
    """
    Adapte (x, y) calibré sur (ref_w × ref_h) à la taille réelle de la fenêtre rect,
    puis convertit en coordonnées écran absolues.

    Utilisation typique : les coordonnées dans config.py sont pour 1920×1080,
    la fenêtre cible fait en réalité 1280×720.
    """
    win_w, win_h = rect_size(rect)
    sx, sy = scale_point(x, y, ref_w, ref_h, win_w, win_h)
    return window_to_screen(sx, sy, rect)


def auto_scale_region(
    region: dict,
    ref_w: int, ref_h: int,
    rect: tuple[int, int, int, int],
) -> dict:
    """
    Adapte une région calibrée sur (ref_w × ref_h) à la taille réelle
    de la fenêtre rect, en coordonnées écran absolues.
    """
    win_w, win_h = rect_size(rect)
    scaled = scale_region(region, ref_w, ref_h, win_w, win_h)
    return region_window_to_screen(scaled, rect)


# ── Diagnostics ────────────────────────────────────────────────────────────────
def describe_point(x: int, y: int, rect: tuple[int, int, int, int]) -> str:
    """
    Retourne une chaîne lisible pour debugger un point par rapport à une fenêtre.
    Exemple : "Écran(960,540) → Fenêtre(960,540) sur 1920×1080px [OK]"
    """
    left, top, right, bottom = rect
    w, h = right - left, bottom - top
    wx, wy = screen_to_window(x, y, rect)
    status = 'OK' if validate_point(x, y, rect) else 'HORS FENÊTRE'
    return f'Écran({x},{y}) → Fenêtre({wx},{wy}) sur {w}×{h}px [{status}]'


def describe_region(region: dict, rect: tuple[int, int, int, int]) -> str:
    """
    Retourne une chaîne lisible pour debugger une région par rapport à une fenêtre.
    """
    left, top, right, bottom = rect
    w, h = right - left, bottom - top
    ok = validate_region(region, rect)
    status = 'OK' if ok else 'DÉBORDE'
    rx, ry, rw, rh = region['x'], region['y'], region['w'], region['h']
    return (
        f'Région({rx},{ry},{rw}×{rh}) dans fenêtre {w}×{h}px '
        f'@ ({left},{top}) [{status}]'
    )


def check_point(
    x: int, y: int,
    rect: tuple[int, int, int, int],
    *,
    auto_clamp: bool = False,
) -> tuple[int, int, bool, str]:
    """
    Vérifie un point contre un rect.

    Retourne (x_final, y_final, valid, message).
    Si auto_clamp=True, ramène le point dans les bornes plutôt qu'échouer.
    """
    valid = validate_point(x, y, rect)
    msg = describe_point(x, y, rect)
    if not valid and auto_clamp:
        x, y = clamp_point(x, y, rect)
        msg += f' → corrigé en ({x},{y})'
        valid = True
    return (x, y, valid, msg)
