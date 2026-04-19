#!/usr/bin/env node
/**
 * Script de génération des icônes MacroEngine
 * Génère les fichiers PNG et ICO nécessaires
 */

const fs = require('fs');
const path = require('path');

// Chemin du dossier assets
const assetsDir = path.join(__dirname, '..', 'assets');

// Créer le dossier s'il n'existe pas
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// Fonction pour créer une icône PNG simple (1x1 transparent pour l'instant)
// TODO: Remplacer par une vraie icône
const createPlaceholderIcons = () => {
  const sizes = [16, 32, 64, 128, 256];
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  console.log('ℹ️  Créant les icônes placeholder...');
  console.log('⚠️  IMPORTANT: Remplacez les fichiers ICO par vos véritables icônes GTA V style!');
  console.log('');
  console.log('Instructions:');
  console.log('1. Créez une icône 256x256 au format PNG');
  console.log('2. Convertissez-la en ICO avec un outil en ligne:');
  console.log('   - https://convertio.co/png-ico/');
  console.log('   - https://icoconvert.com/');
  console.log('3. Sauvegardez les fichiers dans: ' + assetsDir);
  console.log('');
  console.log('Fichiers attendus:');
  console.log('  - icon.ico (256x256)');
  console.log('  - installer-icon.ico (256x256)');
  console.log('  - uninstaller-icon.ico (256x256)');
  console.log('  - installer-header.ico (150x57)');
};

// Vérifier si les fichiers existent déjà
const requiredIcons = [
  'icon.ico',
  'installer-icon.ico',
  'uninstaller-icon.ico',
  'installer-header.ico'
];

const missingIcons = requiredIcons.filter(
  icon => !fs.existsSync(path.join(assetsDir, icon))
);

if (missingIcons.length > 0) {
  console.log('\n❌ Icônes manquantes:');
  missingIcons.forEach(icon => console.log('  - ' + icon));
  createPlaceholderIcons();
  process.exit(1);
} else {
  console.log('✅ Toutes les icônes sont présentes!');
  process.exit(0);
}
