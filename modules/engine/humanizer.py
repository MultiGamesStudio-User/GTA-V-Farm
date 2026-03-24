"""
humanizer.py — Variation naturelle des timings et de la souris.

Rend les actions moins mécaniquement régulières via :
  - Variation gaussienne des durées (±factor%)
  - Jitter de la position souris (offset aléatoire en pixels)
  - Sleep humanisé (time.sleep avec variation)
  - Courbe de Bézier pour les mouvements de souris (optionnel)

Aucun effet de bord, fonctions pures sauf humanized_sleep.
"""
from __future__ import annotations
import random
import time
import math


# ── Timings ────────────────────────────────────────────────────────────────────
def vary(duration: float, factor: float = 0.12) -> float:
    """
    Retourne `duration` +/- une variation gaussienne de `factor` (0.0–1.0).
    Exemple : vary(1.0, 0.1) → valeur entre ~0.87 et ~1.13 en moyenne.
    La valeur est toujours >= 10ms pour éviter les durées négatives ou nulles.
    """
    sigma   = duration * factor
    varied  = duration + random.gauss(0, sigma)
    return max(0.01, varied)


def vary_range(min_s: float, max_s: float) -> float:
    """
    Tire une durée aléatoire entre min_s et max_s avec distribution gaussienne
    (concentrée au milieu, plus réaliste qu'une distribution uniforme).
    """
    mid   = (min_s + max_s) / 2
    sigma = (max_s - min_s) / 6   # ~99.7% des valeurs dans [min, max]
    return max(min_s, min(max_s, random.gauss(mid, sigma)))


def humanized_sleep(duration: float, factor: float = 0.12) -> None:
    """time.sleep avec variation gaussienne intégrée."""
    time.sleep(vary(duration, factor))


# ── Position souris ────────────────────────────────────────────────────────────
def jitter(x: int, y: int, radius: int = 4) -> tuple[int, int]:
    """
    Ajoute un offset aléatoire (distribution circulaire) à (x, y).
    `radius` : rayon max en pixels. Utile pour les clics, pas les drags.
    """
    angle    = random.uniform(0, 2 * math.pi)
    dist     = random.uniform(0, radius)
    return (
        x + round(dist * math.cos(angle)),
        y + round(dist * math.sin(angle)),
    )


def jitter_xy(x: int, y: int, rx: int = 4, ry: int = 4) -> tuple[int, int]:
    """Jitter avec rayon horizontal et vertical indépendants."""
    return (
        x + random.randint(-rx, rx),
        y + random.randint(-ry, ry),
    )


# ── Courbe de Bézier pour mouvements souris ────────────────────────────────────
def bezier_points(
    x0: int, y0: int,
    x1: int, y1: int,
    steps: int = 30,
    curve: float = 0.3,
) -> list[tuple[int, int]]:
    """
    Génère une trajectoire de souris en courbe de Bézier quadratique entre
    (x0, y0) et (x1, y1). Plus naturel qu'une ligne droite.

    `curve` : intensité de la courbe (0.0 = ligne droite, 1.0 = très courbé).
    Retourne une liste de points (x, y) à parcourir.
    """
    # Point de contrôle décalé perpendiculairement au milieu du segment
    mx = (x0 + x1) / 2
    my = (y0 + y1) / 2
    dx = x1 - x0
    dy = y1 - y0
    # Perpendiculaire normalisée
    length = math.hypot(dx, dy) or 1
    px = -dy / length
    py =  dx / length
    offset = random.uniform(-curve, curve) * length * 0.4
    cx = mx + px * offset
    cy = my + py * offset

    points = []
    for i in range(steps + 1):
        t  = i / steps
        t1 = 1 - t
        bx = t1 * t1 * x0 + 2 * t1 * t * cx + t * t * x1
        by = t1 * t1 * y0 + 2 * t1 * t * cy + t * t * y1
        points.append((round(bx), round(by)))
    return points


# ── Wrappers de haut niveau ────────────────────────────────────────────────────
def apply_to_action(action: dict, factor: float = 0.12) -> dict:
    """
    Retourne une copie de l'action avec tous les champs de durée humanisés.
    Modifie : duration, delay_between, interval.
    Ne modifie PAS x, y, keys, etc.
    """
    result = dict(action)
    for field in ('duration', 'delay_between', 'interval', 'min', 'max'):
        if field in result:
            result[field] = vary(float(result[field]), factor)
    return result
