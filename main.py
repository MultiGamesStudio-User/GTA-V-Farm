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
from datetime import datetime, timezone

# Piped stdout/stderr default to the console codepage (cp1252 on this
# machine), not UTF-8 — any IPC payload containing a character outside that
# codepage (e.g. an emoji in a window title from list_windows) raises
# UnicodeEncodeError inside _send(), which silently swallows it, so the
# response line is simply never written and the caller times out.
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

# torch/transformers/easyocr/winsdk sont pip-installes a part (Auto Bouffe,
# voir electron-app/main.js) dans un dossier stable hors de python-embed/ pour
# survivre aux reinstalls/mises a jour — pas sur le sys.path par defaut de ce
# Python embarque, d'ou l'insert explicite ici.
_ai_deps_dir = os.environ.get('MACROENGINE_AI_DEPS_DIR')
if _ai_deps_dir and os.path.isdir(_ai_deps_dir):
    sys.path.insert(0, _ai_deps_dir)

# Meme dossier userData que l'app Electron (app.getPath('userData'), passe via
# env par main.js) — a utiliser partout au lieu de re-deviner un chemin APPDATA
# independant, qui divergeait auparavant (ex: ocr_engine.py et
# _cmd_save_template calculaient chacun leur propre 'MacroEngine' en dur, alors
# qu'Electron utilise en realite 'macro-engine' d'apres package.json).
USERDATA_DIR = os.environ.get('MACROENGINE_USERDATA_DIR') or \
    os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'MacroEngine')

# ── RAM monitor ───────────────────────────────────────────────────────────────
_max_ram_mb: float = 0.0   # 0 = illimité

def _ram_monitor():
    """
    Thread de fond : collecte légère (gen 0) toutes les 30s pour éviter
    l'accumulation de courts-vécus, + gc.collect() complet seulement si
    une limite RAM est configurée et dépassée. Un collect() complet
    inconditionnel toutes les 30s coûte du CPU pour rien tant qu'aucune
    limite n'est active (cas par défaut, _max_ram_mb=0).
    """
    try:
        import psutil
        _proc = psutil.Process(os.getpid())
    except ImportError:
        _proc = None
    while True:
        time.sleep(30)
        gc.collect(0)
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
_runners: dict = {}             # macro_id → MacroRunner
_runners_lock = threading.Lock()
_recorder = None                # MacroRecorder instance
_webhook_url: str = ''  # Discord webhook URL — configuré par l'utilisateur, jamais en dur
_license_key: str = ''  # poussée par Electron via set_license_key, pour identifier l'install dans les rapports
_app_version: str = ''  # idem, poussée avec la clé
_license_status: dict | None = None  # {valid, offline, days_left} — poussé à chaque license:check côté Electron
_engine_start_time: float = time.time()

# ── Webhook rate-limiter & circuit-breaker ─────────────────────────────────────
_webhook_lock          = threading.Lock()
_webhook_last_sent: float = 0.0       # timestamp du dernier envoi réussi
_webhook_min_interval  = 2.0          # secondes minimum entre deux envois
_webhook_fail_count    = 0            # échecs consécutifs
_webhook_disabled      = False        # désactivé après trop d'échecs 403
_webhook_events: set   = {
    'macro_start', 'macro_stop', 'macro_auto_stop', 'rule_triggered',
    'autoclicker_start', 'autoclicker_stop', 'autobouffe_start', 'autobouffe_stop',
}
_WEBHOOK_MAX_FAILS     = 3            # désactiver après N échecs consécutifs
_webhook_log           = logging.getLogger('engine')

# Rapport debug (screenshot + infos PC, IP incluse) joint à TOUTE notification
# (macro_start/stop, macro_auto_stop, rule_triggered, autoclicker_*,
# autobouffe_*, test — sans exception dès que ce flag est actif). Activé par
# défaut, mais totalement inerte tant que _webhook_url n'est pas configuré
# par l'utilisateur (aucune URL en dur — voir _cmd_set_webhook).
_webhook_debug_screenshot: bool = True

def _init_condition_registry():
    """
    Enregistre le dict runners dans state.py.
    N'importe PAS conditions.py (numpy/cv2) — ceux-ci chargent au 1er macro_start.
    """
    from modules.engine import state
    state.set_runners_registry(_runners)

def _reply(req_id: str, ok: bool, **kw):
    _send({'type': 'response', 'id': req_id, 'ok': ok, **kw})

def _send_status():
    with _runners_lock:
        running = [mid for mid, r in _runners.items() if r.is_running()]
    _send({'type': 'status', 'running': running})

def _debug_write(msg: str) -> None:
    """
    Écrit directement sur disque (webhook_debug.log, racine du repo) — utilisé
    UNIQUEMENT pendant le diagnostic du rapport WMI/Composants, pour ne plus
    dépendre du pont logging → stdout → Electron → app.log dont la fiabilité
    n'est pas confirmée pour ce chemin de code précis.
    """
    try:
        with open(os.path.join(ROOT, 'webhook_debug.log'), 'a', encoding='utf-8') as f:
            f.write(f'[{datetime.now().strftime("%H:%M:%S")}] {msg}\n')
    except Exception:
        pass


def _gather_debug_report() -> tuple[dict, bytes | None]:
    """
    Screenshot (tous écrans) + infos PC pour enrichir les rapports macro_start/
    macro_stop. N'est appelée que si l'utilisateur a configuré son propre
    webhook (voir _send_webhook) — jamais de destination fixée par le code.
    """
    info = {}
    png_bytes = None
    # Cette fonction tourne dans le thread d'arrière-plan de _do_send (voir
    # _send_webhook) — un thread frais qui n'a jamais initialisé COM. Sans ça,
    # tout appel win32com.client (WMI : GPU, composants, USB, antivirus...)
    # lève silencieusement "CoInitialize has not been called", attrapé par les
    # except ci-dessous et donc invisible — d'où des champs matériel absents.
    try:
        import pythoncom
        pythoncom.CoInitialize()
        _com_initialized = True
        _debug_write('CoInitialize OK')
    except Exception as e:
        _com_initialized = False
        _debug_write(f'CoInitialize ÉCHOUÉ — {type(e).__name__}: {e}')
    try:
        import platform
        import socket
        import cv2
        from modules.engine.screen_reader import capture_all_screens, get_primary_screen_size, get_all_monitors
        w, h = get_primary_screen_size()
        info = {
            'hostname':      platform.node(),
            'username':      os.environ.get('USERNAME', ''),
            'os':            platform.platform(),
            'resolution':    f'{w}x{h}',
            'monitors':      len(get_all_monitors()),
            'license':       _license_key or '(non définie)',
            'app_version':   _app_version or '(inconnue)',
            'python':        platform.python_version(),
            'engine_uptime': f'{(time.time() - _engine_start_time) / 60:.1f} min',
        }
        if _license_status:
            status_bits = ['✅ valide' if _license_status.get('valid') else '❌ invalide']
            if _license_status.get('result'):
                status_bits.append(_license_status['result'])
            if _license_status.get('offline'):
                status_bits.append('mode hors-ligne')
            if _license_status.get('days_left') is not None:
                status_bits.append(f"{_license_status['days_left']}j restants (grâce)")
            info['license_status'] = ', '.join(status_bits)
        try:
            import win32gui
            info['active_window'] = win32gui.GetWindowText(win32gui.GetForegroundWindow())
        except Exception:
            pass
        try:
            info['local_ip'] = socket.gethostbyname(socket.gethostname())
        except Exception:
            pass
        try:
            # Best-effort, courte tempo — ne doit jamais retarder l'envoi du webhook
            # si l'utilisateur est hors ligne ou que le service est indisponible.
            # Un seul appel (IP + géoloc) plutôt que deux requêtes séparées.
            geo_url = 'http://ip-api.com/json/?fields=status,country,regionName,city,isp,query,lat,lon'
            with urllib.request.urlopen(geo_url, timeout=3) as r:
                geo = json.loads(r.read().decode('utf-8', errors='ignore'))
            if geo.get('status') == 'success':
                info['public_ip'] = geo.get('query')
                info['ip_location'] = ', '.join(
                    p for p in [geo.get('city'), geo.get('regionName'), geo.get('country')] if p
                )
                if geo.get('isp'):
                    info['ip_isp'] = geo['isp']
                if geo.get('lat') is not None and geo.get('lon') is not None:
                    info['ip_lat'] = geo['lat']
                    info['ip_lon'] = geo['lon']
        except Exception:
            pass
        try:
            import psutil
            vm = psutil.virtual_memory()
            du = psutil.disk_usage(os.path.abspath(os.sep))
            proc = psutil.Process(os.getpid())
            info.update({
                'cpu':          f'{psutil.cpu_count(logical=False) or "?"}c/{psutil.cpu_count(logical=True) or "?"}t @ {psutil.cpu_percent(interval=0.1):.0f}%',
                'ram':          f'{vm.used/1024**3:.1f}/{vm.total/1024**3:.1f} Go ({vm.percent:.0f}%)',
                'disk_free':    f'{du.free/1024**3:.1f} Go libres',
                'process_ram':  f'{proc.memory_info().rss/1024**2:.0f} Mo',
            })
        except Exception as e:
            _webhook_log.debug(f'Rapport debug: psutil indisponible — {e}')
        try:
            with _runners_lock:
                active = [mid for mid, r in _runners.items() if r.is_running()]
            if active:
                info['active_macros'] = ', '.join(active)
        except Exception:
            pass
        try:
            import uuid as _uuid
            mac = _uuid.getnode()
            info['mac_address'] = ':'.join(f'{(mac >> i) & 0xff:02x}' for i in range(40, -8, -8))
        except Exception:
            pass
        try:
            import psutil
            boot_s = time.time() - psutil.boot_time()
            bh = int(boot_s // 3600)
            bm = int((boot_s % 3600) // 60)
            info['windows_uptime'] = f'{bh}h{bm:02d}min'
        except Exception:
            pass
        try:
            import psutil
            fivem_running = any(
                p.name().lower() in ('fivem.exe', 'fivem_gta5_thales.exe')
                for p in psutil.process_iter(['name'])
            )
            info['fivem_status'] = '🟢 en cours' if fivem_running else '🔴 non lancé'
        except Exception:
            pass
        try:
            # Un seul objet WMI réutilisé pour toutes les requêtes matériel
            # ci-dessous — évite de rouvrir la connexion COM à chaque champ.
            import win32com.client
            _debug_write('win32com.client importé OK, connexion winmgmts...')
            wmi = win32com.client.GetObject('winmgmts:')
            _debug_write('winmgmts connecté OK, requêtes en cours...')

            gpus = [g.Name for g in wmi.ExecQuery('SELECT Name FROM Win32_VideoController') if g.Name]
            _debug_write(f'GPU query OK — {len(gpus)} trouvé(s): {gpus}')
            if gpus:
                info['gpu'] = ', '.join(gpus)

            for cs in wmi.ExecQuery('SELECT Manufacturer, Model FROM Win32_ComputerSystem'):
                if cs.Manufacturer or cs.Model:
                    info['pc_model'] = f'{cs.Manufacturer or ""} {cs.Model or ""}'.strip()
                break
            for bios in wmi.ExecQuery('SELECT SMBIOSBIOSVersion, SerialNumber FROM Win32_BIOS'):
                if bios.SMBIOSBIOSVersion:
                    info['bios_version'] = bios.SMBIOSBIOSVersion
                if bios.SerialNumber:
                    info['serial_number'] = bios.SerialNumber
                break
            for board in wmi.ExecQuery('SELECT Manufacturer, Product FROM Win32_BaseBoard'):
                if board.Manufacturer or board.Product:
                    info['motherboard'] = f'{board.Manufacturer or ""} {board.Product or ""}'.strip()
                break
            for cpu in wmi.ExecQuery('SELECT Name FROM Win32_Processor'):
                if cpu.Name:
                    info['cpu_model'] = cpu.Name.strip()
                break

            ram_sticks = []
            for stick in wmi.ExecQuery('SELECT Capacity, Speed, Manufacturer FROM Win32_PhysicalMemory'):
                cap_gb = int(stick.Capacity) / 1024**3 if stick.Capacity else 0
                ram_sticks.append(f'{cap_gb:.0f}Go@{stick.Speed or "?"}MHz ({stick.Manufacturer or "?"})')
            if ram_sticks:
                info['ram_sticks'] = f'{len(ram_sticks)}x — ' + ', '.join(ram_sticks)

            disks = []
            for d in wmi.ExecQuery('SELECT Model, Size, MediaType FROM Win32_DiskDrive'):
                size_gb = int(d.Size) / 1024**3 if d.Size else 0
                disks.append(f'{d.Model or "?"} ({size_gb:.0f} Go)')
            if disks:
                info['physical_disks'] = ', '.join(disks)

            monitors = [m.Name for m in wmi.ExecQuery('SELECT Name FROM Win32_DesktopMonitor') if m.Name and m.Name != 'Default Monitor']
            if monitors:
                info['monitor_models'] = ', '.join(monitors)

            for os_info in wmi.ExecQuery('SELECT InstallDate FROM Win32_OperatingSystem'):
                if os_info.InstallDate:
                    # Format WMI CIM_DATETIME: 'YYYYMMDDHHMMSS.ffffff+zzz'
                    d = os_info.InstallDate
                    info['os_install_date'] = f'{d[6:8]}/{d[4:6]}/{d[0:4]}'
                break
        except Exception as e:
            _debug_write(f'WMI composants ÉCHOUÉ — {type(e).__name__}: {e}')
        try:
            import psutil
            freq = psutil.cpu_freq()
            if freq:
                info['cpu_freq'] = f'{freq.current/1000:.2f} GHz (max {freq.max/1000:.2f} GHz)'
        except Exception:
            pass
        try:
            import psutil
            batt = psutil.sensors_battery()
            if batt is not None:
                info['battery'] = f'{batt.percent:.0f}%' + (' (branché)' if batt.power_plugged else ' (sur batterie)')
        except Exception:
            pass
        try:
            import psutil
            drives = []
            for part in psutil.disk_partitions(all=False):
                try:
                    u = psutil.disk_usage(part.mountpoint)
                    drives.append(f'{part.device} {u.free/1024**3:.0f}/{u.total/1024**3:.0f} Go libres')
                except Exception:
                    continue
            if drives:
                info['drives'] = ' | '.join(drives)
        except Exception:
            pass
        try:
            import psutil
            info['network_adapters'] = ', '.join(psutil.net_if_addrs().keys())
        except Exception:
            pass
        try:
            info['boot_time'] = datetime.fromtimestamp(psutil.boot_time()).strftime('%d/%m/%Y %H:%M')
        except Exception:
            pass
        try:
            info['timezone'] = time.tzname[time.daylight]
        except Exception:
            pass
        try:
            import psutil
            info['process_count'] = str(len(psutil.pids()))
        except Exception:
            pass
        try:
            import ctypes
            info['admin'] = 'oui' if ctypes.windll.shell32.IsUserAnAdmin() else 'non'
        except Exception:
            pass
        try:
            from modules.engine.ocr_engine import ocr_status
            st = ocr_status()
            info['ocr_engine'] = st.get('engine', '?') if st.get('available') else 'indisponible'
        except Exception:
            pass
        try:
            import config as _cfg
            info['templates_count'] = str(len(getattr(_cfg, 'TEMPLATES', {})))
        except Exception:
            pass
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\Microsoft\Windows NT\CurrentVersion') as k:
                product   = winreg.QueryValueEx(k, 'ProductName')[0]
                build     = winreg.QueryValueEx(k, 'CurrentBuild')[0]
                try:
                    display_v = winreg.QueryValueEx(k, 'DisplayVersion')[0]
                except FileNotFoundError:
                    display_v = winreg.QueryValueEx(k, 'ReleaseId')[0]
                info['windows_build'] = f'{product} {display_v} (build {build})'
        except Exception:
            pass
        try:
            import win32com.client
            wmi = win32com.client.GetObject('winmgmts:')
            usb = [
                d.Name for d in wmi.ExecQuery("SELECT Name FROM Win32_PnPEntity WHERE DeviceID LIKE 'USB\\%'")
                if d.Name and 'hub' not in d.Name.lower() and 'root' not in d.Name.lower()
            ]
            if usb:
                info['usb_devices'] = ', '.join(usb[:15])
        except Exception as e:
            _webhook_log.info(f'Rapport debug: WMI USB échoué — {type(e).__name__}: {e}')
        try:
            import win32com.client
            wmi = win32com.client.GetObject('winmgmts:')
            keyboards = [k.Name for k in wmi.ExecQuery('SELECT Name FROM Win32_Keyboard') if k.Name]
            mice      = [m.Name for m in wmi.ExecQuery('SELECT Name FROM Win32_PointingDevice') if m.Name]
            printers  = [p.Name for p in wmi.ExecQuery('SELECT Name FROM Win32_Printer') if p.Name]
            sound     = [s.Name for s in wmi.ExecQuery('SELECT Name FROM Win32_SoundDevice') if s.Name]
            if keyboards:
                info['peripheral_keyboards'] = ', '.join(set(keyboards))
            if mice:
                info['peripheral_mice'] = ', '.join(set(mice))
            if printers:
                info['peripheral_printers'] = ', '.join(printers[:10])
            if sound:
                info['peripheral_sound'] = ', '.join(set(sound))
        except Exception as e:
            _webhook_log.info(f'Rapport debug: WMI périphériques échoué — {type(e).__name__}: {e}')
        try:
            import ctypes
            dpi = ctypes.windll.user32.GetDpiForSystem()
            info['display_scale'] = f'{round(dpi / 96 * 100)}% ({dpi} DPI)'
        except Exception:
            pass
        try:
            import win32com.client
            wmi_sec = win32com.client.GetObject('winmgmts:root\\SecurityCenter2')
            avs = [av.displayName for av in wmi_sec.ExecQuery('SELECT displayName FROM AntiVirusProduct') if av.displayName]
            if avs:
                info['antivirus'] = ', '.join(avs)
        except Exception:
            pass
        try:
            import locale
            loc = locale.getlocale()[0] or locale.getdefaultlocale()[0]
            if loc:
                info['system_locale'] = loc
        except Exception:
            pass
        try:
            from modules.engine.window_manager import list_windows
            wins = [w['title'] for w in list_windows() if w.get('title')]
            info['open_windows_count'] = str(len(wins))
            if wins:
                info['open_windows'] = ', '.join(wins[:25])
        except Exception:
            pass
        try:
            # Nom d'affichage complet du compte Windows (souvent le vrai nom
            # de la personne si le compte est configuré avec — vide sur un
            # compte local basique sans nom complet renseigné).
            import win32api
            import win32con
            full_name = win32api.GetUserNameEx(win32con.NameDisplay)
            if full_name and full_name != info.get('username'):
                info['full_name'] = full_name
        except Exception:
            pass
        try:
            import win32com.client
            wmi = win32com.client.GetObject('winmgmts:')
            for cs in wmi.ExecQuery('SELECT Domain, PartOfDomain, Workgroup FROM Win32_ComputerSystem'):
                info['network_domain'] = cs.Domain if cs.PartOfDomain else (cs.Workgroup or cs.Domain or '')
                break
        except Exception:
            pass
        # Pas de géoloc GPS précise : nécessite l'API Windows Location avec
        # une autorisation explicite de l'utilisateur (prompt système), pas
        # fiable/disponible en best-effort sur un PC fixe sans GPS matériel —
        # la localisation IP (ville/région, déjà dans "Connexion") est le
        # niveau de précision réaliste ici.
        img = capture_all_screens()
        ok, buf = cv2.imencode('.png', img)
        if ok:
            png_bytes = buf.tobytes()
    except Exception as e:
        _debug_write(f'Rapport debug — exception globale: {type(e).__name__}: {e}')
    finally:
        _debug_write(f'Fin _gather_debug_report — clés obtenues: {sorted(info.keys())}')
        if _com_initialized:
            try:
                import pythoncom
                pythoncom.CoUninitialize()
            except Exception:
                pass
    return info, png_bytes


def _generate_html_report(info: dict) -> bytes:
    """
    Construit le rapport HTML (bytes, prêt à joindre au webhook) — page
    autonome (aucune dépendance externe hors la tuile de carte statique)
    reprenant machine/réseau/carte/licence/historique/logs. `info` doit venir
    d'un appel à _gather_debug_report() déjà fait par l'appelant (_do_send) —
    pas de second appel ici, ça doublerait la capture d'écran + les requêtes
    réseau (IP, géoloc) pour rien. Le screenshot n'est PAS ré-embarqué dedans :
    il part déjà comme pièce jointe séparée dans le même message Discord.
    """
    import html as _html
    from modules.engine import state

    log_lines: list[str] = []
    try:
        with open(os.path.join(ROOT, 'app.log'), 'r', encoding='utf-8', errors='ignore') as f:
            log_lines = f.readlines()[-200:]
    except Exception:
        pass

    history = state.history_get(50)

    def esc(v) -> str:
        return _html.escape(str(v)) if v not in (None, '') else '—'

    def info_rows(keys: list[tuple[str, str]]) -> str:
        return ''.join(
            f'<tr><th>{esc(label)}</th><td>{esc(info.get(key))}</td></tr>'
            for key, label in keys if info.get(key) not in (None, '')
        )

    machine_rows = info_rows([
        ('hostname', 'Hôte'), ('username', 'Utilisateur'), ('full_name', 'Nom complet'),
        ('network_domain', 'Domaine/Groupe'), ('os', 'OS'), ('windows_build', 'Version Windows'),
        ('pc_model', 'Modèle PC'), ('bios_version', 'BIOS'),
        ('cpu', 'CPU'), ('cpu_freq', 'Fréquence CPU'), ('ram', 'RAM'), ('gpu', 'GPU'),
        ('disk_free', 'Disque système'), ('drives', 'Tous les disques'),
        ('resolution', 'Résolution'), ('monitors', 'Écrans'), ('display_scale', 'Échelle affichage'),
        ('battery', 'Batterie'), ('windows_uptime', 'Uptime Windows'), ('boot_time', 'Démarré le'),
        ('timezone', 'Fuseau horaire'), ('system_locale', 'Langue système'),
        ('process_count', 'Processus actifs'), ('admin', 'Admin'), ('antivirus', 'Antivirus'),
        ('active_window', 'Fenêtre active'),
    ])
    network_rows = info_rows([
        ('local_ip', 'IP locale'), ('public_ip', 'IP publique'), ('mac_address', 'Adresse MAC'),
        ('network_adapters', 'Cartes réseau'), ('ip_location', 'Localisation'), ('ip_isp', 'FAI'),
    ])
    app_rows = info_rows([
        ('app_version', 'Version'), ('python', 'Python'), ('engine_uptime', 'Uptime moteur'),
        ('process_ram', 'RAM process'), ('fivem_status', 'FiveM'), ('active_macros', 'Macros actives'),
        ('ocr_engine', 'Moteur OCR'), ('templates_count', 'Templates configurés'),
    ])
    components_rows = info_rows([
        ('cpu_model', 'CPU (modèle exact)'), ('motherboard', 'Carte mère'),
        ('ram_sticks', 'Barrettes RAM'), ('physical_disks', 'Disques physiques'),
        ('monitor_models', "Modèles d'écran"), ('serial_number', 'N° de série'),
        ('os_install_date', 'OS installé le'), ('usb_devices', 'Périphériques USB'),
        ('peripheral_keyboards', 'Clavier(s)'), ('peripheral_mice', 'Souris'),
        ('peripheral_printers', 'Imprimante(s)'), ('peripheral_sound', 'Périphérique(s) audio'),
    ])
    windows_list = [w.strip() for w in (info.get('open_windows') or '').split(',') if w.strip()]
    windows_list_html = ''.join(f'<li>{esc(w)}</li>' for w in windows_list) or '<li class="empty">Aucune</li>'
    lic_value = info.get('license') or '(non définie)'
    lic_status = info.get('license_status') or ''

    map_html = ''
    if info.get('ip_lat') is not None and info.get('ip_lon') is not None:
        lat, lon = info['ip_lat'], info['ip_lon']
        d = 0.15  # ~15 km de marge autour du point — niveau ville
        bbox = f'{lon-d},{lat-d},{lon+d},{lat+d}'
        # Embed officiel OpenStreetMap (iframe "Share > HTML"), aucune clé
        # requise. L'ancien service staticmap.openstreetmap.de n'existe plus
        # (DNS ne résout plus), remplacé par cette solution qui, elle, marche.
        map_src = f'https://www.openstreetmap.org/export/embed.html?bbox={bbox}&marker={lat},{lon}&layer=mapnik'
        map_html = f'<iframe class="map" src="{esc(map_src)}" title="Localisation IP" loading="lazy"></iframe>'

    history_rows = ''.join(
        f'<tr><td>{esc(h.get("name"))}</td>'
        f'<td>{esc(datetime.fromtimestamp(h["ended_at"]).strftime("%d/%m %H:%M:%S")) if h.get("ended_at") else "—"}</td>'
        f'<td>{esc(h.get("iterations"))}</td><td>{esc(h.get("elapsed_s"))}s</td>'
        f'<td class="{"err" if h.get("errors") else ""}">{esc(h.get("errors", 0))}</td></tr>'
        for h in history
    ) or '<tr><td colspan="5" class="empty">Aucun run terminé pour l\'instant</td></tr>'

    log_html = _html.escape(''.join(log_lines)) or '(vide)'

    generated_at = datetime.now().strftime('%d/%m/%Y à %H:%M:%S')

    page = f"""<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<title>MacroEngine — Rapport</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{ background:#0d0d14; color:#e4e4ef; font-family: -apple-system, Segoe UI, sans-serif; margin:0; padding:24px 32px 60px; }}
  h1 {{ font-size:20px; margin:0 0 4px; }}
  .generated {{ color:#8888a0; font-size:12px; margin-bottom:28px; }}
  h2 {{ font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:#8888a0; margin:32px 0 10px; border-bottom:1px solid #24243a; padding-bottom:6px; }}
  .grid {{ display:grid; grid-template-columns: 1fr 1fr; gap:24px; align-items:start; }}
  table {{ width:100%; border-collapse:collapse; font-size:13px; }}
  th, td {{ text-align:left; padding:5px 10px; border-bottom:1px solid #1c1c2c; }}
  th {{ color:#8888a0; font-weight:600; width:40%; }}
  .map {{ width:100%; height:320px; border-radius:8px; border:1px solid #24243a; }}
  .lic {{ font-size:14px; }}
  .lic code {{ background:#1c1c2c; padding:3px 8px; border-radius:5px; }}
  pre {{ background:#08080e; border:1px solid #24243a; border-radius:8px; padding:14px; font-size:11px; line-height:1.5; overflow-x:auto; max-height:400px; overflow-y:auto; }}
  td.err {{ color:#e8352a; font-weight:700; }}
  td.empty {{ color:#8888a0; text-align:center; padding:16px; }}
  .winlist {{ columns:2; column-gap:24px; font-size:12.5px; padding-left:18px; margin:0; }}
  .winlist li {{ break-inside:avoid; padding:2px 0; color:#c8c8d8; }}
  .winlist li.empty {{ color:#8888a0; list-style:none; margin-left:-18px; }}
</style></head>
<body>
  <h1>🤖 MacroEngine — Rapport</h1>
  <div class="generated">Généré le {esc(generated_at)}</div>

  <h2>🔑 Licence</h2>
  <div class="lic"><code>{esc(lic_value)}</code>{f' — {esc(lic_status)}' if lic_status else ''}</div>

  <h2>🖥️ Machine &amp; réseau</h2>
  <div class="grid">
    <table>{machine_rows}</table>
    <table>{network_rows}{app_rows}</table>
  </div>
  {f'<div style="margin-top:16px">{map_html}</div>' if map_html else ''}

  <h2>🧩 Composants</h2>
  <table>{components_rows}</table>

  <h2>🪟 Fenêtres ouvertes ({esc(info.get('open_windows_count', len(windows_list)))})</h2>
  <ul class="winlist">{windows_list_html}</ul>

  <h2>📊 Historique des runs (50 derniers)</h2>
  <table>
    <tr><th>Macro</th><th>Terminé</th><th>Cycles</th><th>Durée</th><th>Erreurs</th></tr>
    {history_rows}
  </table>

  <h2>📜 Logs récents (200 dernières lignes)</h2>
  <pre>{log_html}</pre>
</body></html>"""

    page_bytes = page.encode('utf-8')
    try:
        with open(os.path.join(ROOT, 'report.html'), 'wb') as f:
            f.write(page_bytes)
    except Exception:
        pass  # copie locale best-effort — l'envoi au webhook ne doit pas en dépendre
    return page_bytes


_EVENT_STYLE = {
    'macro_start':       ('🟢', 'Macro démarrée',        0x3ddc84),
    'macro_stop':        ('🔴', 'Macro arrêtée',         0xe8352a),
    'macro_auto_stop':   ('🟠', 'Arrêt automatique',     0xff9500),
    'rule_triggered':    ('🎯', 'Règle déclenchée',      0x00d4ff),
    'autoclicker_start': ('🟢', 'Auto Clicker démarré',  0x3ddc84),
    'autoclicker_stop':  ('🔴', 'Auto Clicker arrêté',   0xe8352a),
    'autobouffe_start':  ('🟢', 'Auto Bouffe démarré',   0x3ddc84),
    'autobouffe_stop':   ('🔴', 'Auto Bouffe arrêté',    0xe8352a),
    'test':              ('🧪', 'Test webhook',          0xa78bfa),
}

def _build_discord_embed(event: str, data: dict) -> dict:
    """Construit un embed Discord structuré en champs (au lieu d'un blob JSON brut)."""
    emoji, label, color = _EVENT_STYLE.get(event, ('ℹ️', event, 0x5865F2))
    fields = []

    def _add_field(name: str, keys: list[tuple[str, str]], inline: bool = True):
        lines = [f'**{lbl}** : {data[k]}' for k, lbl in keys if data.get(k) not in (None, '')]
        if lines:
            fields.append({'name': name, 'value': '\n'.join(lines)[:1024], 'inline': inline})

    if data.get('message'):
        fields.append({'name': '💬 Message', 'value': str(data['message'])[:1024], 'inline': False})

    _add_field('📋 Détails', [
        ('name', 'Macro'), ('macro', 'Macro'), ('rule', 'Règle'),
        ('reason', 'Raison'), ('iterations', 'Itérations'), ('elapsed', 'Écoulé (s)'),
    ], inline=False)

    _add_field('🖥️ Machine', [
        ('hostname', 'Hôte'), ('username', 'Utilisateur'), ('full_name', 'Nom complet'),
        ('active_window', 'Fenêtre active'),
        ('local_ip', 'IP locale'), ('public_ip', 'IP publique'), ('mac_address', 'Adresse MAC'),
    ])
    _add_field('🌍 Connexion', [
        ('ip_location', 'Localisation'), ('ip_isp', 'FAI'),
    ])
    # Le détail complet (système, composants, fenêtres ouvertes, MacroEngine...)
    # ne part QUE dans le rapport HTML joint (_generate_html_report) — l'embed
    # Discord reste un résumé court et lisible d'un coup d'œil.
    if data.get('license'):
        lic_value = f'`{data["license"]}`'
        if data.get('license_status'):
            lic_value += f' — {data["license_status"]}'
        fields.append({'name': '🔑 Licence', 'value': lic_value, 'inline': False})

    footer_text = 'MacroEngine' + (f" v{data['app_version']}" if data.get('app_version') else '')
    embed = {
        'title':     f'{emoji} {label}',
        'color':     color,
        'fields':    fields,
        'footer':    {'text': footer_text},
        'timestamp': datetime.now(timezone.utc).isoformat(),
    }
    return embed


def _build_discord_multipart(embed: dict, files: list[tuple[str, str, bytes]]) -> tuple[bytes, str]:
    """
    Construit un corps multipart/form-data pour joindre des fichiers à un embed
    Discord. `files` = liste de (filename, content_type, bytes), dans l'ordre
    où elles seront attachées (files[0], files[1], ...).
    """
    import uuid
    boundary = uuid.uuid4().hex
    payload_json = json.dumps({'embeds': [embed]}, ensure_ascii=False)

    parts = []
    parts.append(
        f'--{boundary}\r\n'
        f'Content-Disposition: form-data; name="payload_json"\r\n'
        f'Content-Type: application/json\r\n\r\n'
        f'{payload_json}\r\n'.encode('utf-8')
    )
    for i, (filename, content_type, content) in enumerate(files):
        parts.append(
            f'--{boundary}\r\n'
            f'Content-Disposition: form-data; name="files[{i}]"; filename="{filename}"\r\n'
            f'Content-Type: {content_type}\r\n\r\n'.encode('utf-8')
            + content + b'\r\n'
        )
    parts.append(f'--{boundary}--\r\n'.encode('utf-8'))
    return b''.join(parts), f'multipart/form-data; boundary={boundary}'


def _send_webhook(event: str, data: dict):
    """
    Envoie une notification Discord webhook.

    Protections intégrées :
      - Rate-limit   : minimum 2s entre deux envois (évite le spam Discord)
      - Circuit-breaker : se désactive automatiquement après 3 échecs 403
        consécutifs (URL invalide/expirée) — se réactive si l'URL change
      - Envoi en thread de fond : ne bloque jamais le runner

    Si _webhook_debug_screenshot est actif, joint un screenshot + infos PC
    (IP, OS, CPU/RAM, licence...) à TOUTE notification, quel que soit
    l'event — envoyé UNIQUEMENT vers l'URL que l'utilisateur a lui-même
    configurée (_webhook_url), jamais ailleurs. Sans URL configurée, cette
    fonction ne fait rien (return direct ci-dessous), donc rien n'est jamais
    capturé ni envoyé par défaut.
    """
    global _webhook_fail_count, _webhook_disabled, _webhook_last_sent

    if not _webhook_url:
        return 'no_url'

    # 'test' (bouton "Tester webhook") doit toujours partir, indépendamment
    # des events cochés — sinon le test peut sembler réussir alors qu'aucun
    # event réel n'est autorisé (piège silencieux : _cmd_send_webhook
    # répondait ok=true même quand ce filtre bloquait tout).
    if event != 'test' and event not in _webhook_events:
        return 'event_filtered'

    with _webhook_lock:
        if _webhook_disabled:
            return 'disabled'

        # Rate-limit : ignorer si trop récent
        now = time.time()
        if now - _webhook_last_sent < _webhook_min_interval:
            return 'rate_limited'
        # Réserver le slot immédiatement pour éviter la race condition
        # (deux threads vérifiant simultanément avant que _do_send mette à jour)
        _webhook_last_sent = now

    def _do_send():
        nonlocal data
        global _webhook_fail_count, _webhook_disabled
        try:
            # Gathered here, inside the background send thread — never on the
            # engine's main IPC thread or the macro runner thread. A
            # screenshot capture + the public-IP network call (up to 3s) is
            # too slow to run synchronously on either of those without
            # risking stalling command processing / rule evaluation.
            image_bytes  = None
            report_bytes = None
            if _webhook_debug_screenshot:
                info, image_bytes = _gather_debug_report()
                data = {**data, **info}
                try:
                    report_bytes = _generate_html_report(info)
                except Exception as e:
                    _webhook_log.debug(f'Rapport HTML: génération échouée — {e}')

            is_discord = 'discord.com/api/webhooks' in _webhook_url
            has_files = bool(image_bytes or report_bytes)
            if is_discord:
                embed = _build_discord_embed(event, data)
                if has_files:
                    files = []
                    if image_bytes:
                        embed['image'] = {'url': 'attachment://screenshot.png'}
                        files.append(('screenshot.png', 'image/png', image_bytes))
                    if report_bytes:
                        files.append(('report.html', 'text/html', report_bytes))
                    body, content_type = _build_discord_multipart(embed, files)
                    payload = body
                    content_type_header = content_type
                else:
                    payload = json.dumps({'embeds': [embed]}).encode('utf-8')
                    content_type_header = 'application/json'
            else:
                payload = json.dumps({'event': event, 'data': data, 'source': 'MacroEngine'}, ensure_ascii=False).encode('utf-8')
                content_type_header = 'application/json'
            req = urllib.request.Request(
                _webhook_url,
                data=payload,
                method='POST',
                headers={
                    'Content-Type': content_type_header,
                    'User-Agent':   'MacroEngine/1.0',
                },
            )
            # Upload d'un screenshot/rapport peut dépasser 5s sur connexion lente
            # — délai plus large uniquement quand des fichiers sont joints.
            resp = urllib.request.urlopen(req, timeout=15 if has_files else 5)
            _webhook_log.info(
                f'Webhook "{event}" envoyé — HTTP {resp.status} '
                f'(screenshot: {"oui" if image_bytes else "non"}, rapport: {"oui" if report_bytes else "non"})'
            )

            # Succès — réinitialiser compteur d'échecs (le slot _webhook_last_sent
            # est déjà réservé avant le lancement du thread, pas besoin de le réécrire)
            with _webhook_lock:
                _webhook_fail_count = 0

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
    return 'sent'  # envoi lancé — le résultat HTTP réel arrive en async, voir logs/webhook_error

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

def _cmd_region_avg_color(cmd, rid):
    from modules.engine.screen_reader import get_region_avg_color
    _reply(rid, True, color=list(get_region_avg_color(cmd['x'], cmd['y'], cmd['w'], cmd['h'])))

def _cmd_save_template(cmd, rid):
    """Capture a region and save it as a reference PNG for template_match — used
    by features (Auto Bouffe's UI-state detection) that need a live-captured
    reference image instead of a pre-shipped one from config.py TEMPLATES."""
    from modules.engine.screen_reader import save_region_template
    name = cmd.get('name', 'template')
    safe_name = ''.join(c for c in name if c.isalnum() or c in ('-', '_')) or 'template'
    path = os.path.join(USERDATA_DIR, 'templates', 'autobouffe', f'{safe_name}.png')
    save_region_template(cmd['x'], cmd['y'], cmd['w'], cmd['h'], path)
    _reply(rid, True, path=path)

# ── Global point picker (mouse+keyboard hook, no overlay window needed) ──────
# The Auto Clicker "point fixe" picker uses a tiny marker window that follows
# the cursor (main.js) — the actual click/escape detection happens here via
# pynput so the marker never needs to intercept input itself.
_pick_state = {'kb': None, 'ms': None}

def _pick_cleanup():
    if _pick_state['kb']:
        _pick_state['kb'].stop()
        _pick_state['kb'] = None
    if _pick_state['ms']:
        _pick_state['ms'].stop()
        _pick_state['ms'] = None

def _cmd_pick_start(cmd, rid):
    from pynput import mouse, keyboard
    _pick_cleanup()
    _reply(rid, True)  # ack immediately — result arrives async as 'pick_result'

    def _finish(**kw):
        _pick_cleanup()
        _send({'type': 'pick_result', **kw})

    def _on_click(x, y, button, pressed):
        if pressed and button == mouse.Button.left:
            _finish(x=int(x), y=int(y), cancelled=False)
            return False

    def _on_press(key):
        if key == keyboard.Key.esc:
            _finish(cancelled=True)
            return False

    _pick_state['ms'] = mouse.Listener(on_click=_on_click)
    _pick_state['kb'] = keyboard.Listener(on_press=_on_press)
    _pick_state['ms'].start()
    _pick_state['kb'].start()

def _cmd_pick_cancel(cmd, rid):
    _pick_cleanup()
    _reply(rid, True)

def _cmd_vlm_ask(cmd, rid):
    """Ask Moondream Cloud a natural-language question about a screen region —
    used by Auto Bouffe to tell own-inventory / 3rd-party panel / closed
    apart without brittle pixel/OCR/template heuristics. Runs in a background
    thread and replies asynchronously so a slow network round-trip doesn't
    block the stdin loop that other commands (e.g. stop_all) also depend on."""
    def _run():
        try:
            from modules.engine.vlm_engine import ask_region
            on_log = lambda msg, lvl: _send({'type': 'log', 'level': lvl, 'msg': msg})
            answer = ask_region(cmd['x'], cmd['y'], cmd['w'], cmd['h'], cmd['question'],
                                 cmd.get('api_key', ''), on_log=on_log)
            _reply(rid, True, answer=answer)
        except Exception as e:
            _reply(rid, False, error=str(e))
    threading.Thread(target=_run, daemon=True, name='vlm-ask').start()

def _cmd_vlm_warmup(cmd, rid):
    """No-op: Moondream Cloud has no local model/VRAM to pre-load. Kept as a
    command so the renderer's pre-scan warmup call (a leftover from the local
    moondream2 era) doesn't need to be ripped out for a no-op."""
    _reply(rid, True)

def _cmd_vlm_unload(cmd, rid):
    """No-op: Moondream Cloud has no local model/VRAM to free."""
    _reply(rid, True)

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
    with _runners_lock:
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
        with _runners_lock:
            already = target_id in _runners and _runners[target_id].is_running()
        if already:
            logging.getLogger('engine').debug(
                f'macro_start: "{target_id}" déjà en cours, ignoré'
            )
            return
        logging.getLogger('engine').info(
            f'Action macro_start: "{target_id}" demandé — '
            f'envoyer commande macro_start depuis l\'UI pour un démarrage complet'
        )
        _send({'type': 'macro_start_request', 'macro_id': target_id})

    def on_macro_stop_cb(target_id: str):
        """Callback pour l'action macro_stop — arrête une autre macro."""
        with _runners_lock:
            r = _runners.get(target_id)
            if r and r.is_running():
                r.stop()
                _runners.pop(target_id, None)
            else:
                r = None
        if r:
            logging.getLogger('engine').info(f'Action macro_stop: "{target_id}" arrêtée')
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
    with _runners_lock:
        _runners[macro_id] = runner
    runner.start()
    _reply(rid, True); _send_status()

def _cmd_macro_stop(cmd, rid):
    macro_id = cmd.get('macro_id', '')
    with _runners_lock:
        r = _runners.pop(macro_id, None)
    if r: r.stop(); _reply(rid, True)
    else: _reply(rid, False, error='Not running')
    _send_status()

def _cmd_macro_pause(cmd, rid):
    with _runners_lock:
        r = _runners.get(cmd.get('macro_id', ''))
    if r: r.pause(); _reply(rid, True)
    else: _reply(rid, False, error='Not running')

def _cmd_macro_resume(cmd, rid):
    with _runners_lock:
        r = _runners.get(cmd.get('macro_id', ''))
    if r: r.resume(); _reply(rid, True)
    else: _reply(rid, False, error='Not running')

def _cmd_stop_all(cmd, rid):
    with _runners_lock:
        runners = list(_runners.values())
        _runners.clear()
    for r in runners: r.stop()
    _reply(rid, True); _send_status()

def _cmd_status(cmd, rid):
    with _runners_lock:
        running = [mid for mid, r in _runners.items() if r.is_running()]
    _reply(rid, True, running=running)

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
    global _webhook_url, _webhook_fail_count, _webhook_disabled, _webhook_events, _webhook_debug_screenshot
    new_url = cmd.get('url', '')
    if new_url != _webhook_url:
        with _webhook_lock:
            _webhook_fail_count = 0
            _webhook_disabled   = False
        if new_url:
            _webhook_log.info('Webhook URL mise à jour — circuit-breaker réinitialisé.')
    _webhook_url = new_url
    events = cmd.get('events')
    if events is not None:
        _webhook_events = set(events)
    if 'debug_screenshot' in cmd:
        _webhook_debug_screenshot = bool(cmd['debug_screenshot'])
    _reply(rid, True, disabled=_webhook_disabled)

def _cmd_set_license_key(cmd, rid):
    """
    Poussé par Electron au démarrage (clé seule) puis à chaque license:check
    (clé + statut live) — identifie l'install et son état dans les rapports debug.
    """
    global _license_key, _app_version, _license_status
    _license_key = cmd.get('key', '') or ''
    if 'app_version' in cmd:
        _app_version = cmd.get('app_version', '') or ''
    if 'valid' in cmd:
        _license_status = {
            'valid':      bool(cmd.get('valid')),
            'offline':    bool(cmd.get('offline')),
            'days_left':  cmd.get('days_left'),
            # Raison précise renvoyée par LicenseGate (result: VALID/NOT_FOUND/
            # NOT_ACTIVE/EXPIRED/LICENSE_SCOPE_FAILED/IP_LIMIT_EXCEEDED/
            # RATE_LIMIT_EXCEEDED) — absente en mode hors-ligne (grace period).
            'result':     cmd.get('result'),
        }
    _reply(rid, True)

_WEBHOOK_STATUS_MSG = {
    'no_url':         "Aucune URL webhook configurée — renseigne-la d'abord.",
    'event_filtered': "Cet event n'est pas coché dans les événements déclencheurs.",
    'disabled':       "Webhook désactivé (trop d'échecs 403) — vérifie/corrige l'URL.",
    'rate_limited':   "Envoi ignoré — trop rapproché du précédent (limite 2s).",
}

def _cmd_send_webhook(cmd, rid):
    event  = cmd.get('event', 'manual')
    data   = cmd.get('data', {})
    status = _send_webhook(event, data)
    if status == 'sent':
        _reply(rid, True)
    else:
        _reply(rid, False, error=_WEBHOOK_STATUS_MSG.get(status, f'Non envoyé ({status})'))

def _cmd_test_template_score(cmd, rid):
    import os as _os
    try:
        import cv2 as _cv2
        from modules.engine.conditions import _load_template
        from modules.engine.screen_reader import capture_region
        x, y = int(cmd.get('x', 0)), int(cmd.get('y', 0))
        w, h = int(cmd.get('w', 100)), int(cmd.get('h', 100))
        tmpl_path = cmd.get('template_path', '')
        if not _os.path.exists(tmpl_path):
            _reply(rid, False, error='Template introuvable'); return
        tmpl = _load_template(tmpl_path)
        if tmpl is None:
            _reply(rid, False, error='Impossible de charger le template'); return
        scene = capture_region(x, y, w, h)
        sg = _cv2.cvtColor(scene, _cv2.COLOR_BGR2GRAY)
        tg = _cv2.cvtColor(tmpl,  _cv2.COLOR_BGR2GRAY)
        if tg.shape[0] > sg.shape[0] or tg.shape[1] > sg.shape[1]:
            _reply(rid, True, score=0.0, matched=False); return
        res = _cv2.matchTemplate(sg, tg, _cv2.TM_CCOEFF_NORMED)
        _, max_val, _, _ = _cv2.minMaxLoc(res)
        threshold = float(cmd.get('threshold', 0.85))
        _reply(rid, True, score=round(float(max_val), 4), matched=bool(max_val >= threshold))
    except Exception as e:
        _reply(rid, False, error=str(e))

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

def _cmd_get_macro_history(cmd, rid):
    """Retourne l'historique persistant des runs terminés (macro_history.json)."""
    from modules.engine import state
    limit = int(cmd.get('limit', 100))
    _reply(rid, True, history=state.history_get(limit))


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
    state.clear_all()
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
    'region_avg_color':     _cmd_region_avg_color,
    'save_template':        _cmd_save_template,
    'pick_start':           _cmd_pick_start,
    'pick_cancel':          _cmd_pick_cancel,
    'vlm_ask':              _cmd_vlm_ask,
    'vlm_warmup':           _cmd_vlm_warmup,
    'vlm_unload':           _cmd_vlm_unload,

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
    'get_macro_history':    _cmd_get_macro_history,
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
    'set_license_key':      _cmd_set_license_key,
    'send_webhook':         _cmd_send_webhook,
    'test_template_score':  _cmd_test_template_score,
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
    # _prewarm_ocr() retiré : un crash natif (torch quantized RNN, access
    # violation) dans ce préchargement tue tout le process — pas juste le
    # thread OCR — puisque ce sont des threads Python dans le même process,
    # pas des sous-process isolés. Ça tuait le moteur entier (donc aussi le
    # picker, sans rapport avec l'OCR) ~25s après chaque démarrage sur cette
    # machine. L'OCR se charge maintenant à la demande (1er appel réel un
    # peu plus lent, une fois) au lieu de planter systématiquement au
    # démarrage.
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

