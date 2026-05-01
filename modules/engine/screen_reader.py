"""
screen_reader.py — Capture de régions écran, pixels et données OCR.

Nouvelles fonctions :
  - get_primary_screen_size()  → (largeur, hauteur) du moniteur principal
  - get_all_monitors()         → liste complète de tous les moniteurs
"""
import threading
import numpy as np
import mss
import cv2
from PIL import Image

_tls = threading.local()


def _get_sct():
    """Return a per-thread mss instance (Windows DCs are thread-local)."""
    if not hasattr(_tls, 'sct'):
        _tls.sct = mss.mss()
    return _tls.sct


def release_thread_sct() -> None:
    """Libère l'instance mss du thread courant (évite la fuite GDI sur fin de thread)."""
    if hasattr(_tls, 'sct'):
        try:
            _tls.sct.close()
        except Exception:
            pass
        del _tls.sct


def capture_region(x: int, y: int, w: int, h: int) -> np.ndarray:
    """Capture a screen region and return BGR numpy array."""
    mon = {'left': x, 'top': y, 'width': w, 'height': h}
    raw = _get_sct().grab(mon)
    img = np.frombuffer(raw.rgb, dtype=np.uint8).reshape(raw.height, raw.width, 3)
    return cv2.cvtColor(img, cv2.COLOR_RGB2BGR)


def capture_region_pil(x: int, y: int, w: int, h: int) -> Image.Image:
    """Capture a screen region and return PIL image."""
    img = capture_region(x, y, w, h)
    return Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))


def get_pixel_color(x: int, y: int) -> tuple[int, int, int]:
    """Get BGR color of a single pixel."""
    img = capture_region(x, y, 1, 1)
    b, g, r = img[0, 0]
    return (int(r), int(g), int(b))   # returns RGB tuple


def capture_full_window(left: int, top: int, right: int, bottom: int) -> np.ndarray:
    """Capture an entire window given its rect."""
    w = right - left
    h = bottom - top
    return capture_region(left, top, w, h)


def region_to_b64(x: int, y: int, w: int, h: int) -> str:
    """Capture region, encode to base64 PNG for IPC preview."""
    import base64, io
    pil = capture_region_pil(x, y, w, h)
    buf = io.BytesIO()
    pil.save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode()


# ── Informations écran ─────────────────────────────────────────────────────────
def get_primary_screen_size() -> tuple[int, int]:
    """
    Retourne (largeur, hauteur) du moniteur principal.
    Délègue à window_manager pour éviter la duplication ctypes.
    """
    from .window_manager import get_primary_screen_size as _wm_size
    return _wm_size()


def get_all_monitors() -> list[dict]:
    """
    Retourne la liste de tous les moniteurs (left, top, right, bottom, width,
    height, work_*, is_primary).
    Délègue à window_manager.
    """
    from .window_manager import get_all_monitors as _wm_monitors
    return _wm_monitors()
