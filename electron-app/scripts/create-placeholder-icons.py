#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate placeholder icons for MacroEngine"""

import os
import sys

# Force UTF-8 encoding
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from PIL import Image, ImageDraw

# Créer le dossier assets s'il n'existe pas
assets_dir = os.path.join(os.path.dirname(__file__), '..', 'assets')
os.makedirs(assets_dir, exist_ok=True)

def create_icon(size, filename, text="ME"):
    """Créer une icône simple avec du texte"""
    # Créer une image avec dégradé
    img = Image.new('RGB', size, color=(20, 100, 200))  # Bleu GTA-ish
    draw = ImageDraw.Draw(img)

    # Ajouter du texte au centre
    try:
        bbox = draw.textbbox((0, 0), text)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        x = (size[0] - text_width) // 2
        y = (size[1] - text_height) // 2
        draw.text((x, y), text, fill=(255, 255, 255))
    except:
        pass  # Si pas de police, continuer sans texte

    # Sauvegarder en ICO
    ico_path = os.path.join(assets_dir, filename)
    img.save(ico_path, 'ICO', sizes=[size])

    print(f"[OK] Created: {filename}")
    return ico_path

# Créer les 4 icônes
print("Creating placeholder icons...")
print()

create_icon((256, 256), 'icon.ico', 'ME')
create_icon((256, 256), 'installer-icon.ico', 'SETUP')
create_icon((256, 256), 'uninstaller-icon.ico', 'REMOVE')
create_icon((150, 57), 'installer-header.ico', 'ME')

print()
print("[OK] Icons created in:", assets_dir)
print()
print("[!] WARNING: Replace with real GTA V icons!")
print("    Use: https://convertio.co/png-ico/")
