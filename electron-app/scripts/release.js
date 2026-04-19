#!/usr/bin/env node
/**
 * Release script – Automates versioning, changelog, and building
 * Usage: npm run release-prepare [major|minor|patch]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Parse arguments
const versionType = process.argv[2] || 'patch';
if (!['major', 'minor', 'patch'].includes(versionType)) {
  console.error('❌ Invalid version type. Use: major, minor, or patch');
  process.exit(1);
}

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');

// Read current version
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const currentVersion = packageJson.version;
const [major, minor, patch] = currentVersion.split('.').map(Number);

// Calculate new version
let newVersion;
switch (versionType) {
  case 'major':
    newVersion = `${major + 1}.0.0`;
    break;
  case 'minor':
    newVersion = `${major}.${minor + 1}.0`;
    break;
  case 'patch':
    newVersion = `${major}.${minor}.${patch + 1}`;
    break;
}

console.log(`\n📦 MacroEngine Release Script`);
console.log(`───────────────────────────────`);
console.log(`Current: ${currentVersion}`);
console.log(`New:     ${newVersion}`);
console.log(`Type:    ${versionType}`);

// Update package.json
packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
console.log(`\n✅ Updated package.json`);

// Update CHANGELOG
const today = new Date().toISOString().split('T')[0];
const changelogHeader = `## [${newVersion}] – ${today}\n\n### Added\n- 🎉 New features here\n\n### Fixed\n- 🐛 Bug fixes here\n\n### Changed\n- 📝 Changes here\n\n---\n\n`;

let changelog = fs.readFileSync(changelogPath, 'utf8');
changelog = changelog.replace(/^# Changelog/m, `# Changelog\n\n${changelogHeader}`);
fs.writeFileSync(changelogPath, changelog);
console.log(`✅ Updated CHANGELOG.md (edit the entries!)`);

// Update electron-app/package.json
const electronPackagePath = path.join(__dirname, '..', 'electron-app', 'package.json');
const electronPackage = JSON.parse(fs.readFileSync(electronPackagePath, 'utf8'));
electronPackage.version = newVersion;
fs.writeFileSync(electronPackagePath, JSON.stringify(electronPackage, null, 2) + '\n');
console.log(`✅ Updated electron-app/package.json`);

// Next steps
console.log(`\n📝 Next steps:`);
console.log(`1. Edit CHANGELOG.md with your changes`);
console.log(`2. Commit: git commit -am "chore: bump version to v${newVersion}"`);
console.log(`3. Tag: git tag v${newVersion}`);
console.log(`4. Push: git push && git push --tags`);
console.log(`5. Build: npm run release`);
console.log(`\nℹ️  Or run: npm run release-commit -- ${versionType}\n`);

process.exit(0);
