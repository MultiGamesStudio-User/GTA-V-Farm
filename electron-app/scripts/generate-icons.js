#!/usr/bin/env node
/**
 * Icon generation script – Creates placeholder icons if missing
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const assetsDir = path.join(__dirname, '..', 'assets');

// Créer le dossier s'il n'existe pas
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// Fichiers requis
const requiredIcons = [
  'icon.ico',
  'installer-icon.ico',
  'uninstaller-icon.ico',
  'installer-header.ico'
];

// Vérifier quels fichiers manquent
const missingIcons = requiredIcons.filter(
  icon => !fs.existsSync(path.join(assetsDir, icon))
);

if (missingIcons.length > 0) {
  console.log('\n⚠️  Icônes manquantes – Création automatique...\n');

  // Créer les icônes via Python
  const pythonScript = path.join(__dirname, 'create-placeholder-icons.py');

  try {
    execSync(`python "${pythonScript}"`, { stdio: 'inherit' });
    console.log('\n✅ Icônes créées avec succès!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Erreur lors de la création des icônes');
    console.error('Installez Pillow: pip install Pillow\n');
    process.exit(1);
  }
} else {
  console.log('✅ Toutes les icônes sont présentes!\n');
  process.exit(0);
}

