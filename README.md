# ControlCast

**[Français](#français) | [English](#english)**

Télécharger / Download : [page des versions / releases page](https://github.com/QuentinIII/controlcastv2/releases) — historique / changelog : [CHANGELOG.md](CHANGELOG.md)

---

## Français

Application de bureau Windows pour piloter son stream avec un Launchpad (Novation).

### Installation
1. Téléchargez `ControlCast-Setup-x.y.z.exe` sur la [page des versions](https://github.com/QuentinIII/controlcastv2/releases).
2. Lancez-le. Windows peut afficher « Windows a protégé votre ordinateur » (installeur non signé) : cliquez sur **Informations complémentaires** puis **Exécuter quand même**.
3. Les mises à jour s'installent par-dessus la version existante : la configuration est conservée.

### Que fait-elle ?
Chaque touche du Launchpad peut :
* envoyer (`SEND KEYS`) ou maintenir (`HOLD KEYS`) une combinaison de touches clavier (OBS, Discord, ...) ;
* jouer un son local ou distant, **à 100 % par défaut** : *Normal*, *Toggle*, *Restart*, *Hold*, en boucle (*Loop*), en coupant les autres sons (*Stop others*) ;
* **couper tous les sons d'un coup** (option *STOP ALL SOUNDS* de la section Audio) ;
* appeler une adresse web (GET) avec retour lumineux (jaune = en cours, vert = OK, rouge = erreur) ;
* afficher une image / un gif animé dans OBS via le *CLR Browser* (source navigateur).

#### Volume général et sortie son (VoiceMeeter)
Sous le Launchpad, **MASTER** règle le volume de tous les sons et **OUTPUT** choisit la sortie son (par exemple *VoiceMeeter Input* ou *VoiceMeeter Aux Input*) ; ↻ actualise la liste. Dans la section **Audio**, la ligne *Output* permet à une touche d'utiliser une autre sortie que la sortie générale. Si une sortie est débranchée, les sons passent par la sortie Windows par défaut (sortie affichée en rouge) jusqu'à son retour.

#### Dossier de sons
Dans la section **Audio**, *FOLDER* relie un dossier de sons (sous-dossiers compris) et *RELOAD* relit son contenu. Un champ de recherche filtre la liste ; **clic** sur un son pour l'attribuer à la touche, **double-clic** pour l'écouter.

#### Lumières des touches
* Couleur **Inactive** et couleur **Active** (9 couleurs : rouge, orange, ambre, jaune, vert et versions faibles).
* Mode **Momentary** (couleur active tant que la touche est enfoncée) ou **Toggle** (chaque appui allume / éteint, idéal pour un indicateur de micro coupé).
* **Light While Playing** : pendant qu'un son joue, la touche reste allumée (*Solid*), **clignote** (*Blink*, avec une 2e couleur au choix) ou **pulse** (*Pulse*), en vitesse lente / normale / rapide, puis revient à sa couleur normale.

### Launchpads compatibles
* Launchpad MK1, Launchpad S, Launchpad Mini (MK1 / MK2) — testés
* Launchpad MK2, Mini MK3, X, Pro / Pro MK3 — pris en charge (mode programmeur), *non testés sur matériel*

Le Launchpad peut être branché / débranché à tout moment, y compris après une mise en veille : il est reconnecté automatiquement. Si un autre logiciel l'utilise déjà, un message s'affiche sous le Launchpad et ControlCast réessaie toutes les 2 secondes.

### Configuration : enregistrement automatique et résistant aux plantages
* **Chaque modification est enregistrée automatiquement** (indicateur *Saved ✓* en haut du panneau, plus de bouton SAVE). Une modification faite juste avant de fermer est aussi enregistrée.
* Fichier : `%APPDATA%\ControlCast\config.json` (même emplacement que les anciennes versions, reprise telle quelle).
* Écriture dans un fichier temporaire **forcé sur le disque**, puis remplacement atomique : un écran bleu ou une coupure de courant ne peut plus effacer la configuration.
* Version précédente dans `config.json.bak` et 30 copies horodatées dans `%APPDATA%\ControlCast\backups`.
* Si `config.json` est abîmé au démarrage (vide, rempli de zéros, tronqué), la dernière copie valide est **restaurée automatiquement** et le fichier abîmé est mis de côté (`config.corrupt-*.json`).
* Menu **File** : exporter / importer, restaurer une sauvegarde automatique, **effacer toute la configuration** (avec avertissement ; une copie est faite avant), ouvrir le dossier des réglages.

### Stabilité sous Windows 11
* Electron 44 (au lieu d'Electron 1.6 de 2017), modules natifs précompilés.
* La simulation clavier ne bloque plus l'interface.
* La fenêtre redémarre seule si elle plante ; les touches maintenues sont relâchées.
* Configuration enregistrée à la mise en veille, à l'arrêt de Windows et à la fermeture.
* *Settings > Disable hardware acceleration* si la fenêtre scintille ou reste noire avec certains pilotes graphiques.
* Journaux : `%APPDATA%\ControlCast\logs` (*Help > Open logs folder*). Aucun envoi de données à des services tiers.

### Mise à jour depuis l'ancienne version (0.3.x)
1. Lancez une fois la nouvelle version **avant** de désinstaller l'ancienne si vous utilisez le CLR Browser : les images sont copiées automatiquement.
2. Désinstallez l'ancienne version (Paramètres Windows > Applications). La configuration n'est pas supprimée.
3. Réactivez *Settings > Start with Windows* si besoin.

### Compiler soi-même
Prérequis : [Node.js](https://nodejs.org) 20 ou plus.
```bash
npm install
npm start          # lancer en développement
npm test           # tests automatiques
npm run dist       # créer l'installeur Windows dans dist/ (sous Windows)
```
Chaque envoi sur GitHub construit automatiquement l'installeur et le publie sur la page des versions.

---

## English

Windows desktop app to control your stream with a Novation Launchpad.

### Installation
1. Download `ControlCast-Setup-x.y.z.exe` from the [releases page](https://github.com/QuentinIII/controlcastv2/releases).
2. Run it. Windows may show "Windows protected your PC" (unsigned installer): click **More info** then **Run anyway**.
3. Updates install over the existing version: your configuration is kept.

### What does it do?
Each Launchpad key can:
* send (`SEND KEYS`) or hold (`HOLD KEYS`) a keyboard shortcut (OBS, Discord, ...);
* play a local or remote sound, **at 100% by default**: *Normal*, *Toggle*, *Restart*, *Hold*, looped (*Loop*), stopping the other sounds (*Stop others*);
* **stop every sound at once** (*STOP ALL SOUNDS* option in the Audio section);
* call a web address (GET) with light feedback (yellow = pending, green = OK, red = error);
* show an image / animated gif in OBS through the *CLR Browser* (browser source).

#### Master volume and audio output (VoiceMeeter)
Under the Launchpad, **MASTER** sets the volume of every sound and **OUTPUT** picks the audio output (e.g. *VoiceMeeter Input* or *VoiceMeeter Aux Input*); ↻ refreshes the list. In the **Audio** section, the *Output* row lets a key use another output than the main one. If an output is unplugged, sounds use the Windows default output (shown in red) until it comes back.

#### Sound folder
In the **Audio** section, *FOLDER* links a folder of sounds (sub-folders included) and *RELOAD* re-reads it. A search field filters the list; **click** a sound to assign it to the key, **double-click** to preview it.

#### Key lights
* **Inactive** and **Active** colours (9 colours: red, orange, amber, yellow, green and low variants).
* **Momentary** mode (active colour while the key is held) or **Toggle** (each press switches it on / off, great for a "mic muted" indicator).
* **Light While Playing**: while a sound plays, the key stays lit (*Solid*), **blinks** (*Blink*, with a second colour) or **pulses** (*Pulse*), slow / normal / fast, then goes back to its normal colour.

### Supported Launchpads
* Launchpad MK1, Launchpad S, Launchpad Mini (MK1 / MK2) — tested
* Launchpad MK2, Mini MK3, X, Pro / Pro MK3 — supported (programmer mode), *not tested on hardware*

The Launchpad can be plugged / unplugged at any time, also after sleep: it reconnects automatically. If another program already uses it, a message is shown under the Launchpad and ControlCast retries every 2 seconds.

### Configuration: automatic and crash-proof saving
* **Every change is saved automatically** (*Saved ✓* indicator at the top of the panel, no SAVE button anymore). A change made right before closing is saved too.
* File: `%APPDATA%\ControlCast\config.json` (same place as older versions, reused as is).
* Written to a temporary file, **flushed to disk**, then atomically swapped: a blue screen or power loss can no longer wipe the configuration.
* Previous version kept in `config.json.bak` and 30 timestamped copies in `%APPDATA%\ControlCast\backups`.
* If `config.json` is damaged at startup (empty, zero-filled, truncated), the latest valid copy is **restored automatically** and the damaged file is kept aside (`config.corrupt-*.json`).
* **File** menu: export / import, restore an automatic backup, **reset the whole configuration** (with a warning; a copy is made first), open the settings folder.

### Windows 11 stability
* Electron 44 (instead of Electron 1.6 from 2017), prebuilt native modules.
* Keyboard simulation no longer freezes the UI.
* The window restarts by itself after a crash; held keys are released.
* Configuration saved on sleep, Windows shutdown and exit.
* *Settings > Disable hardware acceleration* if the window flickers or stays black with some graphics drivers.
* Logs: `%APPDATA%\ControlCast\logs` (*Help > Open logs folder*). No data is sent to third-party services.

### Upgrading from the old version (0.3.x)
1. If you use the CLR Browser, start the new version once **before** uninstalling the old one: images are copied automatically.
2. Uninstall the old version (Windows Settings > Apps). The configuration is not deleted.
3. Enable *Settings > Start with Windows* again if needed.

### Build it yourself
Requires [Node.js](https://nodejs.org) 20 or later.
```bash
npm install
npm start          # run in development
npm test           # automated tests
npm run dist       # build the Windows installer in dist/ (on Windows)
```
Every push to GitHub builds the installer and publishes it on the releases page.

---
Application originale par / original app by DBKynd — Artwork and beta testing by Annemunition
