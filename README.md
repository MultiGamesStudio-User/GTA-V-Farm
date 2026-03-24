# GTA V Farm Bot

Script Python autonome pour le farming dans GTA V (solo / session privée).  
Il analyse les images du jeu en temps réel, appuie sur des touches du clavier
et déplace la souris pour exécuter des actions répétitives automatiquement.

> **⚠️ Avertissement** : Ce projet est destiné à un usage **solo uniquement**.  
> L'utiliser dans GTA Online peut entraîner un **ban** selon les CGU de Rockstar Games.

---

## Architecture

```
GTA V FARM/
├── main.py                   ← point d'entrée
├── config.py                 ← TOUS les paramètres (touches, timings, séquences…)
├── requirements.txt
├── modules/
│   ├── screen_capture.py     ← capture d'écran rapide (mss)
│   ├── image_analyzer.py     ← détection d'éléments (OpenCV template matching)
│   ├── input_controller.py   ← clavier & souris (SendInput Windows)
│   ├── farm_actions.py       ← actions de jeu (conduire, collecter…)
│   └── state_machine.py      ← cerveau : machine à états finis
├── templates/                ← images de référence pour la détection
└── logs/                     ← journaux d'exécution
```

---

## Installation

**Prérequis** : Python 3.11+ sur Windows

```powershell
cd "d:\GTAV\Script\GTA V FARM"
pip install -r requirements.txt
```

---

## Démarrage rapide

### 1. Créer les templates visuels

Les templates sont des captures des éléments de l'interface que le bot doit reconnaître
(ex : le prompt "Appuyez sur E", la jauge de stock plein, etc.).

```powershell
python main.py --capture
```

Le script attend 3 secondes, prend un screenshot et le sauvegarde dans `templates/screenshot.png`.  
**Découpez** ensuite la zone voulue avec un éditeur d'image (Paint, Photoshop…) et sauvegardez-la
sous le nom correspondant dans `config.py > TEMPLATES` (ex : `collect_prompt.png`).

### 2. Configurer la séquence de farming

Ouvrez `config.py` et modifiez la section `FARM_SEQUENCE` :

```python
FARM_SEQUENCE = [
    {"action": "drive_forward",  "duration": 3.0},   # avance 3 s
    {"action": "turn_right",     "duration": 0.8},   # tourne à droite 0.8 s
    {"action": "drive_forward",  "duration": 5.0},   # avance 5 s
    {"action": "stop",           "duration": 0.5},
    {"action": "exit_vehicle",   "duration": 1.5},
    {"action": "collect",        "duration": 4.0},   # appuie sur E 4 s
    {"action": "enter_vehicle",  "duration": 2.0},
    {"action": "drive_forward",  "duration": 5.0},
    ...
]
```

Actions disponibles :

| Action           | Description                          |
|------------------|--------------------------------------|
| `drive_forward`  | Avancer en voiture                   |
| `drive_reverse`  | Reculer                              |
| `turn_left`      | Accélérer + tourner à gauche         |
| `turn_right`     | Accélérer + tourner à droite         |
| `stop`           | Freiner                              |
| `exit_vehicle`   | Descendre du véhicule (touche F)     |
| `enter_vehicle`  | Monter dans un véhicule (touche F)   |
| `collect`        | Maintenir E pour collecter           |
| `sprint`         | Sprinter à pied                      |

### 3. Lancer le bot

```powershell
python main.py
```

Le bot attend **5 secondes** avant de démarrer → remettez-vous dans GTA V !

---

## Contrôles en cours d'exécution

| Touche | Action              |
|--------|---------------------|
| F12    | Arrêt d'urgence     |
| F11    | Pause / Reprise     |

---

## Personnalisation avancée

### Changer les touches du jeu (AZERTY → QWERTY)

Dans `config.py` :
```python
KEY_ACCELERATE  = "w"     # QWERTY
KEY_STEER_LEFT  = "a"
KEY_STEER_RIGHT = "d"
KEY_BRAKE       = "s"
```

### Ajuster la résolution

```python
SCREEN_WIDTH  = 2560
SCREEN_HEIGHT = 1440
```

### Détection d'image plus permissive

```python
DETECTION_THRESHOLD = 0.70   # valeur par défaut : 0.80
```

### Ajouter sa propre séquence / action

1. Ajouter une méthode dans `modules/farm_actions.py`
2. L'enregistrer dans le dictionnaire `_execute_step` de `modules/state_machine.py`
3. L'utiliser dans `FARM_SEQUENCE` de `config.py`

---

## Journaux

Les logs sont enregistrés dans `logs/farm_bot.log`.  
Pour réduire la verbosité, changer `LOG_LEVEL = "INFO"` dans `config.py`.
