"""
window_manager.py — Détecter et gérer les fenêtres cibles.

Nouvelles fonctions :
  - get_window_size(hwnd)        → (largeur, hauteur) de la fenêtre
  - get_window_info(hwnd)        → dict complet (title, exe, rect, size)
  - get_all_monitors()           → liste de tous les moniteurs connectés
  - get_primary_screen_size()    → (largeur, hauteur) du moniteur principal
"""
import ctypes
import ctypes.wintypes
import win32gui
import win32con
import win32process
import psutil


# ── Enumération des fenêtres ───────────────────────────────────────────────────
def list_windows() -> list[dict]:
    """
    Retourne la liste {hwnd, title, pid, exe} de toutes les fenêtres visibles.

    Optimisation clé : on construit un dict pid→nom en une seule passe avec
    process_iter() plutôt que d'appeler psutil.Process(pid) pour chaque fenêtre
    — ce qui évite le timeout quand il y a beaucoup de processus système.
    """
    # Cache pid→exe en une seule passe (x10 plus rapide que par-fenêtre)
    try:
        pid_map: dict[int, str] = {
            p.pid: p.info['name']
            for p in psutil.process_iter(['pid', 'name'])
        }
    except Exception:
        pid_map = {}

    results = []

    def _cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd)
        if not title.strip():
            return
        try:
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
        except Exception:
            pid = 0
        exe = pid_map.get(pid, '')
        results.append({'hwnd': hwnd, 'title': title, 'pid': pid, 'exe': exe})

    win32gui.EnumWindows(_cb, None)
    return results


def find_window(title_contains: str = '', exe_contains: str = '') -> dict | None:
    """Trouve la première fenêtre dont le titre et/ou l'exe correspondent."""
    for w in list_windows():
        if title_contains and title_contains.lower() not in w['title'].lower():
            continue
        if exe_contains and exe_contains.lower() not in w['exe'].lower():
            continue
        return w
    return None


# ── Géométrie d'une fenêtre ────────────────────────────────────────────────────
def get_window_rect(hwnd: int) -> tuple[int, int, int, int] | None:
    """Retourne (left, top, right, bottom) d'une fenêtre, ou None."""
    try:
        return win32gui.GetWindowRect(hwnd)
    except Exception:
        return None


def get_window_size(hwnd: int) -> tuple[int, int] | None:
    """
    Retourne (largeur, hauteur) d'une fenêtre en pixels, ou None.
    Utile pour vérifier que la fenêtre a bien la taille attendue avant
    d'envoyer des coordonnées calibrées.
    """
    rect = get_window_rect(hwnd)
    if rect is None:
        return None
    left, top, right, bottom = rect
    return (right - left, bottom - top)


def get_window_info(hwnd: int) -> dict | None:
    """
    Retourne un dict complet pour une fenêtre :
      hwnd, title, pid, exe, rect {left,top,right,bottom}, width, height

    Retourne None si la fenêtre n'existe plus.
    """
    try:
        rect = get_window_rect(hwnd)
        if rect is None:
            return None
        title = win32gui.GetWindowText(hwnd)
        try:
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            proc = psutil.Process(pid)
            exe = proc.name()
        except Exception:
            pid, exe = 0, ''
        left, top, right, bottom = rect
        return {
            'hwnd':   hwnd,
            'title':  title,
            'pid':    pid,
            'exe':    exe,
            'rect':   {'left': left, 'top': top, 'right': right, 'bottom': bottom},
            'width':  right - left,
            'height': bottom - top,
        }
    except Exception:
        return None


# ── Focus ──────────────────────────────────────────────────────────────────────
def focus_window(hwnd: int) -> bool:
    """Met la fenêtre au premier plan."""
    try:
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(hwnd)
        return True
    except Exception:
        return False


def is_window_focused(hwnd: int) -> bool:
    """Retourne True si la fenêtre est la fenêtre active."""
    try:
        return win32gui.GetForegroundWindow() == hwnd
    except Exception:
        return False


# ── Moniteurs ─────────────────────────────────────────────────────────────────
def get_primary_screen_size() -> tuple[int, int]:
    """
    Retourne (largeur, hauteur) du moniteur principal.
    Utilise GetSystemMetrics — toujours disponible sans dépendances.
    """
    w = ctypes.windll.user32.GetSystemMetrics(0)   # SM_CXSCREEN
    h = ctypes.windll.user32.GetSystemMetrics(1)   # SM_CYSCREEN
    return (w, h)


def get_all_monitors() -> list[dict]:
    """
    Retourne la liste de tous les moniteurs connectés.
    Chaque dict contient :
      left, top, right, bottom, width, height,
      work_left, work_top, work_right, work_bottom  (zone sans barre des tâches)
      is_primary (bool)

    Essentiel pour les setups multi-écrans : si la fenêtre FiveM est sur
    le moniteur 2, les coordonnées absolues sont décalées de plusieurs milliers
    de pixels — sans ça, tous les clics ratent.
    """
    class _MONITORINFO(ctypes.Structure):
        _fields_ = [
            ('cbSize',    ctypes.c_ulong),
            ('rcMonitor', ctypes.wintypes.RECT),
            ('rcWork',    ctypes.wintypes.RECT),
            ('dwFlags',   ctypes.c_ulong),
        ]

    monitors = []

    MONITORENUMPROC = ctypes.WINFUNCTYPE(
        ctypes.c_bool,
        ctypes.c_ulong, ctypes.c_ulong,
        ctypes.POINTER(ctypes.wintypes.RECT),
        ctypes.c_double,
    )

    def _cb(hMonitor, _hdc, _lprc, _data):
        mi = _MONITORINFO()
        mi.cbSize = ctypes.sizeof(_MONITORINFO)
        if ctypes.windll.user32.GetMonitorInfoW(hMonitor, ctypes.byref(mi)):
            r = mi.rcMonitor
            w = mi.rcWork
            monitors.append({
                'left':         r.left,
                'top':          r.top,
                'right':        r.right,
                'bottom':       r.bottom,
                'width':        r.right  - r.left,
                'height':       r.bottom - r.top,
                'work_left':    w.left,
                'work_top':     w.top,
                'work_right':   w.right,
                'work_bottom':  w.bottom,
                'is_primary':   bool(mi.dwFlags & 1),
            })
        return True

    ctypes.windll.user32.EnumDisplayMonitors(None, None, MONITORENUMPROC(_cb), 0)
    return monitors


def find_monitor_for_window(hwnd: int) -> dict | None:
    """
    Retourne le moniteur qui contient le centre de la fenêtre, ou None.
    Utile pour savoir sur quel écran tourne FiveM en multi-écran.
    """
    rect = get_window_rect(hwnd)
    if rect is None:
        return None
    left, top, right, bottom = rect
    cx = (left + right) // 2
    cy = (top  + bottom) // 2
    for mon in get_all_monitors():
        if (mon['left'] <= cx < mon['right'] and
                mon['top'] <= cy < mon['bottom']):
            return mon
    return None
