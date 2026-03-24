# ============================================================
#  config.py  –  Tous les paramètres du bot de farming FiveM / GTA V
# ============================================================

# --- Fenêtre / Résolution -----------------------------------
GAME_WINDOW_TITLE = "FiveM"        # titre de la fenêtre FiveM
SCREEN_WIDTH      = 1920
SCREEN_HEIGHT     = 1080

# Zone de capture
CAPTURE_REGION = {
    "top":    0,
    "left":   0,
    "width":  SCREEN_WIDTH,
    "height": SCREEN_HEIGHT,
}

# --- Sécurité -----------------------------------------------
EMERGENCY_STOP_KEY = "f12"   # arrêt d'urgence
PAUSE_KEY          = "f11"   # pause / reprise

# --- Timings (secondes) -------------------------------------
LOOP_DELAY          = 0.05
ACTION_DELAY        = 0.15
DETECTION_THRESHOLD = 0.78   # confiance minimale pour la détection d'image

# --- Touches du jeu (AZERTY / FiveM) ------------------------
KEY_ENTER_EXIT       = "f"
KEY_INTERACT         = "e"
KEY_SPRINT           = "shift"
KEY_COVER            = "q"
KEY_RELOAD           = "r"
KEY_MAP              = "esc"
KEY_PHONE            = "up"
KEY_CONFIRM          = "e"
KEY_CANCEL           = "backspace"

# ────────────────────────────────────────────────────────────
#  FARMING (touches communes)
# ────────────────────────────────────────────────────────────

KEY_FARM             = "e"   # appuyer pour miner / interagir avec le gisement
KEY_TRUNK            = "l"   # ouvrir le coffre du véhicule
KEY_CLOSE_INVENTORY  = "esc" # fermer l'inventaire / le coffre

# Durée d'une animation de minage (en secondes) — à calibrer
MINE_DURATION        = 8.0

# Nombre de cycles de minage avant de vider l'inventaire dans le coffre
MINE_CYCLES_BEFORE_TRANSFER = 3

# Nom exact de l'item fer tel qu'il apparaît dans l'inventaire du jeu
IRON_ITEM_NAME       = "Fer"

# Items à transférer automatiquement vers le véhicule après le minage
ITEMS_TO_TRANSFER    = ["Fer"]

# Délai d'ouverture du coffre / chargement de l'inventaire
INVENTORY_OPEN_DELAY  = 1.2
INVENTORY_CLOSE_DELAY = 0.8

# Position approximative de l'inventaire joueur (zone de gauche)
# et de l'inventaire véhicule (zone de droite) — en pixels
# Ces valeurs correspondent à la résolution 1920×1080
PLAYER_INV_REGION  = {'x': 30,  'y': 130, 'w': 490, 'h': 400}
VEHICLE_INV_REGION = {'x': 840, 'y': 130, 'w': 490, 'h': 400}

# Position du drop-target au centre de l'inventaire véhicule (pour le drag)
VEHICLE_INV_DROP_X = 956
VEHICLE_INV_DROP_Y = 269

# ────────────────────────────────────────────────────────────
#  BESOINS : NOURRITURE & EAU
# ────────────────────────────────────────────────────────────

# Seuil en % — si la barre descend en dessous, manger / boire
FOOD_BAR_THRESHOLD  = 50.0
WATER_BAR_THRESHOLD = 50.0

# Région de la BARRE DE NOURRITURE sur le HUD (à calibrer)
# Format : {"x": pixel_x, "y": pixel_y, "w": largeur, "h": hauteur}
FOOD_BAR_REGION  = {'x': 1745, 'y': 985, 'w': 148, 'h': 8}
WATER_BAR_REGION = {'x': 967,  'y': 761, 'w': 273, 'h': 109}

# Couleur de la barre PLEINE (BGR) – vert pour nourriture, bleu pour eau
FOOD_BAR_COLOR_BGR  = [25, 65, 50]    # vert
WATER_BAR_COLOR_BGR = [25, 76, 60]    # bleu
BAR_COLOR_TOLERANCE = 40              # tolérance ±40 par canal

# Noms exacts des items de nourriture et de boisson dans l'inventaire
FOOD_ITEM_NAMES  = ["Sandwich", "Pizza Calzone", "Burger", "Hot Dog"]
WATER_ITEM_NAMES = ["Eau", "Milkshake Chocolat", "Coca", "Bouteille d'eau"]

# ────────────────────────────────────────────────────────────
#  MACROS — types d'étapes disponibles
# ────────────────────────────────────────────────────────────
# {"type": "tap",        "key": "e",       "delay": 0.2}
# {"type": "hold",       "key": "shift",   "duration": 1.5}
# {"type": "wait",       "duration": 2.0}
# {"type": "mouse_move", "dx": 0,  "dy": -100, "smooth": True}
# {"type": "click",      "button": "left"}
# {"type": "repeat",     "count": 3,       "steps": [...]}

# ────────────────────────────────────────────────────────────
#  PROFILS DE FARM
# ────────────────────────────────────────────────────────────
# mine_mode : "detection" | "tap" | "hold"

FARM_PROFILES = {
    "iron_mine": {
        "label":                   "Minage de Fer",
        "description":             "Détecte le prompt de minage, appuie sur la touche et transfère vers le coffre",
        "mine_mode":               "detection",
        "mine_key":                KEY_FARM,
        "mine_duration":           MINE_DURATION,
        "mine_timeout":            15.0,
        "cycles_before_transfer":  MINE_CYCLES_BEFORE_TRANSFER,
        "transfer_enabled":        True,
        "check_needs":             True,
        "pre_mine_steps":          [],
        "post_mine_steps":         [],
    },
    "collect_items": {
        "label":                   "Collecte d'objets",
        "description":             "Maintient la touche d'interaction pour ramasser des objets en boucle",
        "mine_mode":               "hold",
        "mine_key":                KEY_INTERACT,
        "mine_duration":           2.0,
        "mine_timeout":            10.0,
        "cycles_before_transfer":  5,
        "transfer_enabled":        False,
        "check_needs":             True,
        "pre_mine_steps":          [],
        "post_mine_steps":         [],
    },
    "press_interact": {
        "label":                   "Interaction rapide",
        "description":             "Appuie rapidement sur E à répétition (looting, PNJ, etc.)",
        "mine_mode":               "tap",
        "mine_key":                KEY_INTERACT,
        "mine_duration":           0.3,
        "mine_timeout":            5.0,
        "cycles_before_transfer":  10,
        "transfer_enabled":        False,
        "check_needs":             True,
        "pre_mine_steps":          [],
        "post_mine_steps":         [],
    },
    "custom_farm": {
        "label":                   "Farm personnalisé",
        "description":             "Profil entièrement configurable via l'éditeur de macros",
        "mine_mode":               "tap",
        "mine_key":                KEY_FARM,
        "mine_duration":           1.0,
        "mine_timeout":            10.0,
        "cycles_before_transfer":  5,
        "transfer_enabled":        False,
        "check_needs":             True,
        "pre_mine_steps":          [],
        "post_mine_steps":         [],
    },
}

# Profil actif au démarrage du bot
ACTIVE_PROFILE = "iron_mine"

# ────────────────────────────────────────────────────────────
#  TEMPLATES (images de référence pour la détection visuelle)
# ────────────────────────────────────────────────────────────
TEMPLATE_DIR = "templates"

TEMPLATES = {
    # Interface inventaire
    "inventory_open"    : "inventory_open.png",       # fenêtre inventaire visible
    "vehicle_inv_open"  : "vehicle_inv_open.png",     # coffre véhicule ouvert
    "iron_item"         : "iron_item.png",            # icône de l'item Fer
    "context_menu"      : "context_menu.png",         # menu contextuel (clic droit)
    "btn_utiliser"      : "btn_utiliser.png",         # bouton "Utiliser"
    "btn_donner"        : "btn_donner.png",           # bouton "Donner"

    # Besoins joueur
    "food_bar_low"      : "food_bar_low.png",         # barre nourriture basse
    "water_bar_low"     : "water_bar_low.png",        # barre eau basse
    "food_item"         : "food_item.png",            # item nourriture dans inventaire
    "water_item"        : "water_item.png",           # item boisson dans inventaire

    # États du jeu
    "mine_prompt"       : "mine_prompt.png",          # prompt "Appuyez sur X pour miner"
    "collect_prompt"    : "collect_prompt.png",       # prompt générique interaction
    "minimap_marker"    : "minimap_marker.png",
    "player_dead"       : "player_dead.png",
    "loading_screen"    : "loading_screen.png",
    "in_vehicle"        : "in_vehicle.png",
}

# --- Logging -------------------------------------------------
LOG_DIR   = "logs"
LOG_LEVEL = "DEBUG"
