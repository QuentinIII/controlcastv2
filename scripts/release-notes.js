'use strict';

// Prints the release notes of the current version: the matching CHANGELOG.md
// section followed by bilingual installation instructions.
// Usage: node scripts/release-notes.js > release-notes.md

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');

const lines = changelog.split(/\r?\n/);
const start = lines.findIndex(l => l.startsWith(`## [${version}]`));
let section = '';
if (start !== -1) {
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## ['));
  if (end === -1) end = lines.length;
  section = lines.slice(start + 1, end).join('\n').trim();
}

const file = `ControlCast-Setup-${version}.exe`;
process.stdout.write(`${section || `ControlCast ${version}`}

---

### 🇫🇷 Installation
Téléchargez \`${file}\` ci-dessous et lancez-le (installation par-dessus l'ancienne version : la configuration est conservée).
Windows peut afficher « Windows a protégé votre ordinateur » (installeur non signé) : cliquez sur **Informations complémentaires** puis **Exécuter quand même**.

### 🇬🇧 Installation
Download \`${file}\` below and run it (installs over the previous version: your configuration is kept).
Windows may show "Windows protected your PC" (unsigned installer): click **More info** then **Run anyway**.
`);
