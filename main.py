"""
main.py — Macro Engine IPC server
Communicates via JSON lines on stdin/stdout with Electron.

IN  (stdin):  {"cmd": "...", "id": "uid", ...params}
OUT (stdout): {"type": "response", "id": "uid", "ok": true/false, ...}
              {"type": "log",      "level": "INFO",  "msg": "..."}
              {"type": "status",   "running": ["macro_id", ...]}
"""
from __future__ import annotations
import sys, os, json, threading, logging, urllib.request, time, gc

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

# ── RAM monitor ───────────────────────────────────────────────────────────────
_max_ram_mb: float = 0.0   # 0 = illimité

def _ram_monitor():
    """Thread de fond : gc.collect() toutes les 30 s + alerte si RAM > limite."""
    try:
        import psutil
        _proc = psutil.Process(os.getpid())
    except ImportError:
        _proc = None
    while True:
        time.sleep(30)
        gc.collect()
        if _proc and _max_ram_mb > 0:
            try:
                rss_mb = _proc.memory_info().rss / (1024 * 1024)
                if rss_mb > _max_ram_mb:
                    _send({'type': 'log', 'level': 'WARNING',
                           'msg': f'RAM {rss_mb:.0f} Mo > limite {_max_ram_mb:.0f} Mo — gc.collect() déclenché'})
                    gc.collect()
            except Exception:
                pass

# ── JSON log handler ──────────────────────────────────────────────────────────
_send_lock = threading.Lock()

def _send(obj: dict):
    with _send_lock:
        try:
            sys.stdout.write(json.dumps(obj, ensure_ascii=False) + '\n')
            sys.stdout.flush()
        except Exception:
            pass

class _JsonLogHandler(logging.Handler):
    def emit(self, record):
        _send({'type': 'log', 'level': record.levelname, 'msg': self.format(record)})

_root = logging.getLogger()
_root.setLevel(logging.DEBUG)
_root.addHandler(_JsonLogHandler())

# ── Runner registry ───────────────────────────────────────────────────────────
_runners: dict = {}   # macro_id → MacroRunner
_recorder = None      # MacroRecorder instance
_webhook_url: str = ''  # Discord webhook URL

# ── Webhook rate-limiter & circuit-breaker ─────────────────────────────────────
_webhook_lock          = threading.Lock()
_webhook_last_sent: float = 0.0       # timestamp du dernier envoi réussi
_webhook_min_interval  = 2.0          # secondes minimum entre deux envois
_webhook_fail_count    = 0            # échecs consécutifs
_webhook_disabled      = False        # désactivé après trop d'échecs 403
_WEBHOOK_MAX_FAILS     = 3            # désactiver après N échecs consécutifs
_webhook_log           = logging.getLogger('engine')

def _init_condition_registry():
    """
    Donne aux conditions l'accès au registre des runners.
    Appelé une fois au démarrage — permet à macro_is_running de fonctionner.
    """
    from modules.engine.conditions import set_runners_registry
    set_runners_registry(_runners)

def _reply(req_id: str, ok: bool, **kw):
    _send({'type': 'response', 'id': req_id, 'ok': ok, **kw})

def _send_status():
    running = [mid for mid, r in _runners.items() if r.is_running()]
    _send({'type': 'status', 'running': running})

def _send_webhook(event: str, data: dict):
    """
    Envoie une notification Discord webhook.

    Protections intégrées :
      - Rate-limit   : minimum 2s entre deux envois (évite le spam Discord)
      - Circuit-breaker : se désactive automatiquement après 3 échecs 403
        consécutifs (URL invalide/expirée) — se réactive si l'URL change
      - Envoi en thread de fond : ne bloque jamais le runner
    """
    global _webhook_fail_count, _webhook_disabled, _webhook_last_sent

    if not _webhook_url:
        return

    with _webhook_lock:
        if _webhook_disabled:
            return

        # Rate-limit : ignorer si trop récent
        now = time.time()
        if now - _webhook_last_sent < _webhook_min_interval:
            return
        # Réserver le slot immédiatement pour éviter la race condition
        # (deux threads vérifiant simultanément avant que _do_send mette à jour)
        _webhook_last_sent = now

    def _do_send():
        global _webhook_fail_count, _webhook_disabled, _webhook_last_sent
        try:
            embed = {
                'title':       f'MacroEngine — {event}',
                'description': json.dumps(data, ensure_ascii=False, indent=2)[:2000],
                'color':       0x5865F2,
                'footer':      {'text': 'MacroEngine'},
            }
            payload = json.dumps({'embeds': [embed]}).encode('utf-8')
            req = urllib.request.Request(
                _webhook_url,
                data=payload,
                method='POST',
                headers={
                    'Content-Type': 'application/json',
                    'User-Agent':   'MacroEngine/1.0',
                },
            )
            urllib.request.urlopen(req, timeout=5)

            # Succès — réinitialiser compteur d'échecs
            with _webhook_lock:
                _webhook_fail_count = 0
                _webhook_last_sent  = time.time()

        except urllib.error.HTTPError as e:
            with _webhook_lock:
                _webhook_fail_count += 1
                fails = _webhook_fail_count

            if e.code == 403:
                # 403 = URL invalide ou webhook supprimé — inutile de réessayer
                if fails >= _WEBHOOK_MAX_FAILS:
                    with _webhook_lock:
                        _webhook_disabled = True
                    _webhook_log.error(
                        f'Webhook désactivé : {_WEBHOOK_MAX_FAILS} erreurs 403 consécutives. '
                        f'L\'URL est invalide ou le webhook Discord a été supprimé. '
                        f'Mettez à jour l\'URL dans les paramètres.'
                    )
                    _send({'type': 'webhook_error', 'code': 403,
                           'msg': 'Webhook désactivé — URL invalide ou supprimée. '
                                  'Corrigez l\'URL dans Paramètres > Webhook.'})
                else:
                    _webhook_log.warning(
                        f'Webhook 403 ({fails}/{_WEBHOOK_MAX_FAILS}) — '
                        f'URL invalide ou webhook Discord supprimé.'
                    )
            elif e.code == 429:
                # 429 = rate limit Discord — augmenter l'intervalle temporairement
                _webhook_log.warning('Webhook rate-limité par Discord (429). Ralentissement.')
                with _webhook_lock:
                    _webhook_last_sent = time.time() + 10  # pause 10s supplémentaires
            else:
                _webhook_log.warning(f'Webhook HTTP {e.code}: {e.reason}')

        except Exception as e:
            with _webhook_lock:
                _webhook_fail_count += 1
            _webhook_log.warning(f'Webhook erreur réseau: {e}')

    threading.Thread(target=_do_send, daemon=True).start()

# ── Command dispatch ──────────────────────────────────────────────────────────
def _cmd_list_windows(cmd, rid):
    from modules.engine.window_manager import list_windows
    _reply(rid, True, windows=list_windows())

def _cmd_preview_region(cmd, rid):
    from modules.engine.screen_reader import region_to_b64
    _reply(rid, True, b64=region_to_b64(cmd['x'], cmd['y'], cmd['w'], cmd['h']))

def _cmd_pick_color(cmd, rid):
    from modules.engine.screen_reader import get_pixel_color
    _reply(rid, True, color=list(get_pixel_color(cmd['x'], cmd['y'])))

def _cmd_test_condition(cmd, rid):
    from modules.engine.conditions import eval_condition
    _reply(rid, True, result=eval_condition(cmd))

def _cmd_exec_action(cmd, rid):
    from modules.engine.actions import exec_action
    _pl = threading.Event(); _pl.set()
    ctx = {
        'on_webhook':     _send_webhook,
        'on_log':         lambda msg, lvl: _send({'type': 'log', 'level': lvl, 'msg': msg}),
        'on_macro_start': lambda name: _send({'type': 'macro_start_request', 'name': name}),
        'on_macro_stop':  lambda name: None,
        'stop_self':      lambda: None,
        '_stop':          threading.Event(),
        '_pause_lock':    _pl,
        '_humanize':      False,
        '_humanize_factor': 0.12,
    }
    exec_action(cmd, ctx); _reply(rid, True)

def _cmd_macro_start(cmd, rid):
    from modules.engine.macro_runner import MacroRunner
    macro    = cmd['macro']
    macro_id = cmd.get('macro_id', macro.get('name', 'macro'))
    if macro_id in _runners and _runners[macro_id].is_running():
        _reply(rid, False, error='Déjà en cours'); return

    def on_log(msg, level):
        _send({'type': 'log', 'level': level, 'msg': f'[{macro_id}] {msg}'})

    def on_webhook(event, data):
        _send_webhook(event, data)

    def on_macro_start_cb(target_id: str):
        """Callback pour l'action macro_start — lance une autre macro."""
        if not target_id:
            return
        if target_id in _runners and _runners[target_id].is_running():
            logging.getLogger('engine').debug(
                f'macro_start: "{target_id}" déjà en cours, ignoré'
            )
            return
        # Chercher la macro dans la liste gérée par l'UI
        # L'action macro_start ne peut lancer que des macros déjà connues du runner
        logging.getLogger('engine').info(
            f'Action macro_start: "{target_id}" demandé — '
            f'envoyer commande macro_start depuis l\'UI pour un démarrage complet'
        )
        _send({'type': 'macro_start_request', 'macro_id': target_id})

    def on_macro_stop_cb(target_id: str):
        """Callback pour l'action macro_stop — arrête une autre macro."""
        r = _runners.get(target_id)
        if r and r.is_running():
            r.stop()
            _runners.pop(target_id, None)
            logging.getLogger('engine').info(
                f'Action macro_stop: "{target_id}" arrêtée'
            )
            _send_status()
        else:
            logging.getLogger('engine').warning(
                f'Action macro_stop: "{target_id}" introuvable ou déjà arrêtée'
            )

    runner = MacroRunner(
        macro,
        on_log=on_log,
        on_webhook=on_webhook,
        on_macro_start=on_macro_start_cb,
        on_macro_stop=on_macro_stop_cb,
    )
    _runners[macro_id] = runner
    runner.start()
    _reply(rid, True); _send_status()

def _cmd_macro_stop(cmd, rid):
    macro_id = cmd.get('macro_id', '')
    r = _runners.pop(macro_id, None)
    if r: r.stop(); _reply(rid, True)
    else: _reply(rid, False, error='Not running')
    _send_status()

def _cmd_macro_pause(cmd, rid):
    r = _runners.get(cmd.get('macro_id', ''))
    if r: r.pause(); _reply(rid, True)
    else: _reply(rid, False, error='Not running')

def _cmd_macro_resume(cmd, rid):
    r = _runners.get(cmd.get('macro_id', ''))
    if r: r.resume(); _reply(rid, True)
    else: _reply(rid, False, error='Not running')

def _cmd_stop_all(cmd, rid):
    for r in list(_runners.values()): r.stop()
    _runners.clear()
    _reply(rid, True); _send_status()

def _cmd_status(cmd, rid):
    _reply(rid, True, running=[mid for mid, r in _runners.items() if r.is_running()])

def _cmd_focus_window(cmd, rid):
    from modules.engine.window_manager import focus_window
    hwnd = int(cmd.get('hwnd', 0))
    ok = focus_window(hwnd)
    _reply(rid, ok)

def _cmd_get_window_rect(cmd, rid):
    from modules.engine.window_manager import get_window_rect
    hwnd = int(cmd.get('hwnd', 0))
    rect = get_window_rect(hwnd)
    if rect:
        _reply(rid, True, rect={'left': rect[0], 'top': rect[1], 'right': rect[2], 'bottom': rect[3]})
    else:
        _reply(rid, False, error='Window not found')

def _cmd_check_ocr(cmd, rid):
    from modules.engine.ocr_engine import ocr_status
    st = ocr_status()
    _reply(rid, True, available=st['available'], engine=st['engine'],
           easyocr=st['easyocr'], winrt=st['winrt'], tesseract=st['tesseract'])

def _cmd_ocr_text(cmd, rid):
    """Retourne le texte brut OCR d'une région — pour le tester UI."""
    from modules.engine.conditions import ocr_region_raw
    from modules.engine.ocr_engine import ocr_status
    st = ocr_status()
    if not st['available']:
        _reply(rid, False, error='OCR indisponible — pip install easyocr')
        return
    # Mode debug : active la sauvegarde des images si demandé
    if cmd.get('debug'):
        import os
        os.environ['DEBUG_OCR'] = '1'
        import modules.engine.ocr_engine as _ocrmod
        _ocrmod._DEBUG_OCR = True
    try:
        text = ocr_region_raw(cmd)
        from modules.engine.ocr_engine import _DEBUG_DIR
        _reply(rid, True, text=text, engine=st['engine'],
               debug_dir=_DEBUG_DIR if cmd.get('debug') else None)
    except Exception as e:
        _reply(rid, False, error=str(e))
    finally:
        if cmd.get('debug'):
            import modules.engine.ocr_engine as _ocrmod
            _ocrmod._DEBUG_OCR = False

def _cmd_set_webhook(cmd, rid):
    global _webhook_url, _webhook_fail_count, _webhook_disabled
    new_url = cmd.get('url', '')
    if new_url != _webhook_url:
        # Nouvelle URL → réinitialiser le circuit-breaker
        with _webhook_lock:
            _webhook_fail_count = 0
            _webhook_disabled   = False
        if new_url:
            _webhook_log.info('Webhook URL mise à jour — circuit-breaker réinitialisé.')
    _webhook_url = new_url
    _reply(rid, True, disabled=_webhook_disabled)

def _cmd_send_webhook(cmd, rid):
    event = cmd.get('event', 'manual')
    data = cmd.get('data', {})
    _send_webhook(event, data)
    _reply(rid, True)

def _cmd_is_window_focused(cmd, rid):
    from modules.engine.window_manager import is_window_focused
    hwnd = int(cmd.get('hwnd', 0))
    _reply(rid, True, focused=is_window_focused(hwnd))


def _cmd_get_screen_info(cmd, rid):
    """
    Retourne les informations de tous les moniteurs connectés + taille primaire.
    Indispensable pour les setups multi-écrans : si FiveM est sur le moniteur 2,
    les coordonnées absolues sont décalées — cette commande permet à l'UI de
    savoir où se situe chaque écran.
    """
    from modules.engine.window_manager import get_all_monitors, get_primary_screen_size
    monitors = get_all_monitors()
    pw, ph = get_primary_screen_size()
    _reply(rid, True, monitors=monitors, primary_width=pw, primary_height=ph)


def _cmd_get_window_info(cmd, rid):
    """
    Retourne les informations complètes d'une fenêtre (titre, exe, rect, taille).
    Utilisé pour vérifier que la fenêtre cible est bien détectée et a la bonne
    taille avant d'envoyer des coordonnées calibrées.
    """
    from modules.engine.window_manager import get_window_info
    hwnd = int(cmd.get('hwnd', 0))
    info = get_window_info(hwnd)
    if info:
        _reply(rid, True, **info)
    else:
        _reply(rid, False, error='Fenêtre introuvable ou inaccessible')


def _cmd_validate_point(cmd, rid):
    """
    Vérifie qu'un point (x, y) est bien à l'intérieur d'une fenêtre cible.
    Retourne : valid (bool), description (texte lisible), rect de la fenêtre.
    Paramètres optionnels : auto_clamp (bool) — corrige le point si hors-bornes.
    """
    from modules.engine.window_manager import get_window_rect
    from modules.engine.coord_utils import check_point
    x = int(cmd.get('x', 0))
    y = int(cmd.get('y', 0))
    hwnd = cmd.get('hwnd', None)
    auto_clamp = bool(cmd.get('auto_clamp', False))
    if hwnd:
        rect = get_window_rect(int(hwnd))
        if rect is None:
            _reply(rid, False, error='Fenêtre introuvable'); return
        fx, fy, valid, desc = check_point(x, y, rect, auto_clamp=auto_clamp)
        _reply(rid, True, valid=valid, description=desc,
               x=fx, y=fy,
               rect={'left': rect[0], 'top': rect[1],
                     'right': rect[2], 'bottom': rect[3]})
    else:
        _reply(rid, True, valid=True,
               description=f'Point({x},{y}) — aucune fenêtre cible spécifiée',
               x=x, y=y)


def _cmd_validate_region(cmd, rid):
    """
    Vérifie qu'une région {x, y, w, h} est entièrement dans une fenêtre.
    Retourne : valid (bool), description (texte), et la région (éventuellement rognée).
    """
    from modules.engine.window_manager import get_window_rect
    from modules.engine.coord_utils import validate_region, describe_region, clamp_region
    region = cmd.get('region', {})
    hwnd = cmd.get('hwnd', None)
    auto_clamp = bool(cmd.get('auto_clamp', False))
    if not region or 'x' not in region:
        _reply(rid, False, error='Champ "region" manquant ou invalide'); return
    if hwnd:
        rect = get_window_rect(int(hwnd))
        if rect is None:
            _reply(rid, False, error='Fenêtre introuvable'); return
        valid = validate_region(region, rect)
        desc  = describe_region(region, rect)
        final_region = clamp_region(region, rect) if auto_clamp else region
        _reply(rid, True, valid=valid, description=desc, region=final_region,
               rect={'left': rect[0], 'top': rect[1],
                     'right': rect[2], 'bottom': rect[3]})
    else:
        _reply(rid, True, valid=True,
               description='Région OK — aucune fenêtre cible spécifiée',
               region=region)


def _cmd_scale_coords(cmd, rid):
    """
    Adapte des coordonnées d'une résolution de référence vers une cible.
    Cas d'usage : coords calibrées en 1920×1080 → fenêtre réelle 1280×720.

    Paramètres :
      from_w, from_h : résolution de référence (défaut 1920×1080)
      to_w, to_h     : résolution cible (ou déduite depuis hwnd si fourni)
      x, y           : point à adapter (optionnel)
      region         : region dict {x,y,w,h} à adapter (optionnel)
    """
    from modules.engine.coord_utils import scale_point, scale_region
    from modules.engine.window_manager import get_window_size
    from_w = int(cmd.get('from_w', 1920))
    from_h = int(cmd.get('from_h', 1080))
    # Si hwnd fourni, déduire to_w/to_h de la fenêtre réelle
    hwnd = cmd.get('hwnd', None)
    if hwnd:
        sz = get_window_size(int(hwnd))
        if sz is None:
            _reply(rid, False, error='Fenêtre introuvable'); return
        to_w, to_h = sz
    else:
        to_w = int(cmd.get('to_w', 1920))
        to_h = int(cmd.get('to_h', 1080))
    result: dict = {'from_w': from_w, 'from_h': from_h, 'to_w': to_w, 'to_h': to_h}
    if 'x' in cmd and 'y' in cmd:
        sx, sy = scale_point(int(cmd['x']), int(cmd['y']), from_w, from_h, to_w, to_h)
        result['x'] = sx
        result['y'] = sy
    if 'region' in cmd:
        result['region'] = scale_region(cmd['region'], from_w, from_h, to_w, to_h)
    _reply(rid, True, **result)


def _cmd_find_window_monitor(cmd, rid):
    """
    Retourne quel moniteur contient la fenêtre (utile pour les setups multi-écrans).
    """
    from modules.engine.window_manager import find_monitor_for_window
    hwnd = int(cmd.get('hwnd', 0))
    mon = find_monitor_for_window(hwnd)
    if mon:
        _reply(rid, True, monitor=mon)
    else:
        _reply(rid, False, error='Fenêtre introuvable ou aucun moniteur détecté')

def _cmd_get_stats(cmd, rid):
    """Retourne les stats d'exécution d'une macro ou de toutes les macros."""
    from modules.engine import state
    macro_id = cmd.get('macro_id', None)
    if macro_id:
        s = state.stats_get(macro_id)
        if s:
            _reply(rid, True, **s)
        else:
            _reply(rid, False, error=f'Aucune stat pour "{macro_id}"')
    else:
        _reply(rid, True, stats=state.stats_get_all())


def _cmd_get_variables(cmd, rid):
    """Retourne toutes les variables et compteurs de la session."""
    from modules.engine import state
    _reply(rid, True,
           variables=state.get_all_variables(),
           counters=state.get_all_counters())


def _cmd_set_variable(cmd, rid):
    """Définit une variable depuis l'UI."""
    global _max_ram_mb
    from modules.engine import state
    name  = cmd.get('name', '')
    value = cmd.get('value')
    if not name:
        _reply(rid, False, error='Champ "name" requis'); return
    if name == '__max_ram_mb':
        _max_ram_mb = float(value or 0)
        _reply(rid, True, name=name, value=_max_ram_mb); return
    state.var_set(name, value)
    _reply(rid, True, name=name, value=value)


def _cmd_set_counter(cmd, rid):
    """Définit ou incrémente un compteur depuis l'UI."""
    from modules.engine import state
    name   = cmd.get('name', '')
    action = cmd.get('action', 'set')   # 'set'|'inc'|'dec'|'reset'
    value  = int(cmd.get('value', 0))
    if not name:
        _reply(rid, False, error='Champ "name" requis'); return
    if action == 'set':
        result = state.counter_set(name, value)
    elif action == 'inc':
        result = state.counter_inc(name, value or 1)
    elif action == 'dec':
        result = state.counter_dec(name, value or 1)
    elif action == 'reset':
        state.counter_reset(name); result = 0
    else:
        _reply(rid, False, error=f'Action inconnue : {action}'); return
    _reply(rid, True, name=name, value=result)


def _cmd_clear_state(cmd, rid):
    """Remet à zéro variables, compteurs et snapshots de pixels."""
    from modules.engine import state
    state.get_all_variables()  # préserve la ref mais vide
    import modules.engine.state as _st
    _st._variables.clear()
    _st._counters.clear()
    _st._pixel_snapshots.clear()
    _reply(rid, True)


def _cmd_set_dead_zones(cmd, rid):
    """Définit les zones interdites pour les actions souris."""
    from modules.engine import state
    zones = cmd.get('zones', [])
    state.set_dead_zones(zones)
    _reply(rid, True, count=len(zones))


def _cmd_get_dead_zones(cmd, rid):
    """Retourne la liste des zones interdites actives."""
    from modules.engine import state
    _reply(rid, True, zones=state.get_dead_zones())


def _cmd_pixel_snapshot(cmd, rid):
    """Sauvegarde la couleur d'un pixel sous une clé nommée (pour pixel_changed)."""
    from modules.engine.screen_reader import get_pixel_color
    from modules.engine import state
    x   = int(cmd.get('x', 0))
    y   = int(cmd.get('y', 0))
    key = cmd.get('key', f'pixel_{x}_{y}')
    color = get_pixel_color(x, y)
    state.pixel_snapshot_save(key, x, y, color)
    _reply(rid, True, key=key, color=list(color))


def _cmd_record_start(cmd, rid):
    global _recorder
    from modules.engine.recorder import MacroRecorder
    if _recorder and _recorder.is_recording():
        _reply(rid, False, error='Already recording')
        return
    def on_event(action):
        _send({'type': 'record_event', 'action': action})
    _recorder = MacroRecorder(on_event=on_event)
    _recorder.start()
    _reply(rid, True)

def _cmd_record_stop(cmd, rid):
    global _recorder
    if not _recorder or not _recorder.is_recording():
        _reply(rid, False, error='Not recording')
        return
    actions = _recorder.stop()
    _recorder = None
    _reply(rid, True, actions=actions)

_DISPATCH = {
    # ── Fenêtres ──────────────────────────────────────────────────────────────
    'list_windows':         _cmd_list_windows,
    'focus_window':         _cmd_focus_window,
    'get_window_rect':      _cmd_get_window_rect,
    'get_window_info':      _cmd_get_window_info,
    'is_window_focused':    _cmd_is_window_focused,

    # ── Écrans & moniteurs ────────────────────────────────────────────────────
    'get_screen_info':      _cmd_get_screen_info,
    'find_window_monitor':  _cmd_find_window_monitor,

    # ── Coordonnées & validation ──────────────────────────────────────────────
    'validate_point':       _cmd_validate_point,
    'validate_region':      _cmd_validate_region,
    'scale_coords':         _cmd_scale_coords,

    # ── Capture & couleurs ────────────────────────────────────────────────────
    'preview_region':       _cmd_preview_region,
    'pick_color':           _cmd_pick_color,

    # ── Conditions & actions ──────────────────────────────────────────────────
    'test_condition':       _cmd_test_condition,
    'exec_action':          _cmd_exec_action,

    # ── Macros ────────────────────────────────────────────────────────────────
    'macro_start':          _cmd_macro_start,
    'macro_stop':           _cmd_macro_stop,
    'macro_pause':          _cmd_macro_pause,
    'macro_resume':         _cmd_macro_resume,
    'stop_all':             _cmd_stop_all,
    'status':               _cmd_status,

    # ── Enregistrement ───────────────────────────────────────────────────────
    'record_start':         _cmd_record_start,
    'record_stop':          _cmd_record_stop,

    # ── Stats & état global ───────────────────────────────────────────────────
    'get_stats':            _cmd_get_stats,
    'get_variables':        _cmd_get_variables,
    'set_variable':         _cmd_set_variable,
    'set_counter':          _cmd_set_counter,
    'clear_state':          _cmd_clear_state,

    # ── Dead zones ────────────────────────────────────────────────────────────
    'set_dead_zones':       _cmd_set_dead_zones,
    'get_dead_zones':       _cmd_get_dead_zones,

    # ── Snapshots pixels ──────────────────────────────────────────────────────
    'pixel_snapshot':       _cmd_pixel_snapshot,

    # ── OCR & Webhook ─────────────────────────────────────────────────────────
    'check_ocr':            _cmd_check_ocr,
    'ocr_text':             _cmd_ocr_text,
    'set_webhook':          _cmd_set_webhook,
    'send_webhook':         _cmd_send_webhook,
}

def _handle(cmd: dict):
    c   = cmd.get('cmd', '')
    rid = cmd.get('id', '')
    handler = _DISPATCH.get(c)
    if handler:
        try:    handler(cmd, rid)
        except Exception as e: _reply(rid, False, error=str(e))
    else:
        _reply(rid, False, error=f'Unknown command: {c}')

# ── Main loop ─────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    _init_condition_registry()   # donne aux conditions l'accès aux runners
    threading.Thread(target=_ram_monitor, daemon=True, name='ram-monitor').start()
    _send({'type': 'log', 'level': 'INFO', 'msg': 'MacroEngine ready'})
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw: continue
        try:   cmd = json.loads(raw)
        except json.JSONDecodeError:
            _send({'type': 'log', 'level': 'WARNING', 'msg': f'Bad JSON: {raw}'}); continue
        try:   _handle(cmd)
        except Exception as e:
            _reply(cmd.get('id', ''), False, error=str(e))

