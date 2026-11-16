# Changelog

Format : chaque version en français puis en anglais. / Each version in French, then English.

## [0.6.0] - 2026-11-16

### 🇫🇷 Nouveautés
- **Volume général (MASTER)** sous le Launchpad : s'applique à tous les sons, en plus du volume de chaque touche.
- **Choix de la sortie son (OUTPUT)** : tous les sons peuvent aller vers une sortie précise (VoiceMeeter Input, VoiceMeeter Aux Input, casque, haut-parleurs...) au lieu de la sortie Windows par défaut. Bouton ↻ pour actualiser la liste.
- **Sortie par touche** (section Audio, ligne *Output*) : une touche peut utiliser une autre sortie que la sortie générale (par exemple jingles vers le stream, son de test dans le casque).
- Si une sortie choisie est débranchée, les sons passent par la sortie Windows par défaut et la sortie manquante est affichée en rouge ; elle est réutilisée automatiquement quand elle revient.

### 🇬🇧 New
- **Master volume (MASTER)** under the Launchpad: applies to every sound, on top of each key's volume.
- **Audio output selection (OUTPUT)**: every sound can go to a specific output (VoiceMeeter Input, VoiceMeeter Aux Input, headphones, speakers...) instead of the Windows default output. ↻ button to refresh the list.
- **Per-key output** (Audio section, *Output* row): a key can use another output than the main one (e.g. jingles to the stream, a test sound in the headphones).
- If a chosen output is unplugged, sounds use the Windows default output and the missing output is shown in red; it is used again automatically when it comes back.

## [0.5.0] - 2026-11-16

Première version stable de la refonte pour Windows 11 (regroupe les versions de test 0.4.0 à 0.4.4).
First stable release of the Windows 11 overhaul (includes test versions 0.4.0 to 0.4.4).

### 🇫🇷 Nouveautés
- **Enregistrement automatique** : chaque modification est sauvegardée immédiatement (indicateur *Saved ✓*), les boutons SAVE / DISCARD disparaissent. Une modification faite juste avant de fermer est aussi enregistrée.
- **Configuration résistante aux écrans bleus** : écriture forcée sur le disque puis remplacement atomique, copie `config.json.bak`, 30 sauvegardes horodatées, restauration automatique si le fichier est abîmé.
- **Menu File** : exporter / importer la configuration, restaurer une sauvegarde automatique, **effacer toute la configuration** (avec avertissement, copie faite avant).
- **Lumières** : mode *Toggle* (allumé / éteint à chaque appui), **Light While Playing** (allumé, clignotant ou pulsé pendant la lecture d'un son, vitesse réglable, 2e couleur), couleurs orange et jaune.
- **Audio** : volume à **100 % par défaut** (les touches restées à 50 % passent à 100 %), **dossier de sons** avec recherche, clic pour attribuer et double-clic pour écouter, bouton *RELOAD*, options *Loop* et *Stop others*, nouvelle option **STOP ALL SOUNDS** pour couper tous les sons depuis une touche.
- **Launchpad** : reconnexion automatique (débranchement, sortie de veille), prise en charge des Launchpad MK2, Mini MK3, X et Pro (non testée sur matériel).
- **Installeur Windows** construit automatiquement sur GitHub à chaque version.

### 🇫🇷 Corrections et stabilité
- Electron 1.6 → 44, modules natifs précompilés : plus de compilation sous Windows.
- La simulation clavier ne gèle plus l'interface (50 ms bloquées par touche auparavant).
- Fuites de gestionnaires d'événements corrigées dans le panneau d'options (ralentissement au fil des heures).
- Un bug de l'éditeur CSS pouvait effacer les réglages d'une touche : corrigé.
- Le retour lumineux des requêtes web ne modifie plus la configuration.
- La fenêtre redémarre seule après un plantage ; les touches clavier maintenues sont relâchées.
- Configuration enregistrée à la mise en veille et à l'arrêt de Windows ; la fermeture vers la zone de notification ne bloque plus l'arrêt de Windows.
- Images du CLR Browser stockées dans `%APPDATA%` (elles étaient perdues à chaque mise à jour).
- Suppression des envois de données vers Loggly et Woopra.

### 🇬🇧 New
- **Automatic saving**: every change is saved right away (*Saved ✓* indicator); the SAVE / DISCARD buttons are gone. A change made right before closing is saved too.
- **Blue-screen-proof configuration**: data flushed to disk then atomically swapped, `config.json.bak` copy, 30 timestamped backups, automatic restore when the file is damaged.
- **File menu**: export / import the configuration, restore an automatic backup, **reset the whole configuration** (with a warning, a copy is made first).
- **Lights**: *Toggle* mode (on / off at each press), **Light While Playing** (solid, blinking or pulsing while a sound plays, adjustable speed, second colour), orange and yellow colours.
- **Audio**: volume **100% by default** (keys left at 50% are moved to 100%), **sound folder** with search, click to assign and double-click to preview, *RELOAD* button, *Loop* and *Stop others* options, new **STOP ALL SOUNDS** option to stop every sound from a key.
- **Launchpad**: automatic reconnection (unplug, wake from sleep), support for Launchpad MK2, Mini MK3, X and Pro (not tested on hardware).
- **Windows installer** built automatically on GitHub for each version.

### 🇬🇧 Fixes and stability
- Electron 1.6 → 44, prebuilt native modules: no more compiling on Windows.
- Keyboard simulation no longer freezes the UI (it used to block 50 ms per key).
- Fixed event handler leaks in the options panel (slowdown over time).
- Fixed a CSS editor bug that could wipe a key's settings.
- Web request light feedback no longer alters the configuration.
- The window restarts by itself after a crash; held keyboard keys are released.
- Configuration saved on sleep and Windows shutdown; "close to tray" no longer blocks Windows shutdown.
- CLR Browser images stored in `%APPDATA%` (they were lost at every update).
- Removed data reporting to Loggly and Woopra.

## [0.3.4]
Dernière version de l'application originale par DBKynd. / Last version of the original app by DBKynd.
