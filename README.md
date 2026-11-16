# ControlCast
Application de bureau pour piloter son stream avec un Launchpad (Novation).

## Que fait-elle ?
Chaque touche du Launchpad peut :
* envoyer (`Send`) ou maintenir (`Hold`) une combinaison de touches clavier (OBS, Discord, ...) ;
* jouer un son local ou distant (volume à 100 % par défaut ; normal, toggle, restart, hold, en boucle, en coupant les autres sons) ;
  un **dossier de sons** peut être relié dans la section Audio (bouton *FOLDER*, *RELOAD* pour le relire) : clic sur un son pour l'attribuer à la touche, double-clic pour l'écouter, champ de recherche pour filtrer ;
* **couper tous les sons d'un coup** (option *STOP ALL SOUNDS* de la section Audio) ;
* appeler une adresse web (GET) avec retour visuel (jaune = en cours, vert = OK, rouge = erreur) ;
* afficher une image / un gif animé dans OBS via le *CLR Browser* (source navigateur).

### Lumières des touches
* Couleur **inactive** et couleur **active** (9 couleurs : rouge, orange, ambre, jaune, vert, et versions faibles).
* Mode **Momentary** (couleur active tant que la touche est enfoncée) ou **Toggle** (chaque appui allume / éteint, idéal pour un indicateur de micro coupé).
* **Light While Playing** : pendant qu'un son joue, la touche peut rester allumée (*Solid*), **clignoter** (*Blink*, avec une 2e couleur au choix) ou **pulser** (*Pulse*), en vitesse lente / normale / rapide. Elle revient à sa couleur normale à la fin du son.

## Launchpads compatibles
* Launchpad MK1, Launchpad S, Launchpad Mini (MK1 / MK2) — testés historiquement
* Launchpad MK2, Launchpad Mini MK3, Launchpad X, Launchpad Pro / Pro MK3 — pris en charge (mode programmeur), *non testés sur matériel*

Le Launchpad peut être branché / débranché à tout moment, y compris après une mise en veille de Windows : il est reconnecté automatiquement.
Si un autre logiciel (DAW, autre appli MIDI) utilise déjà le Launchpad, le message s'affiche sous le Launchpad et ControlCast réessaie toutes les 2 secondes.

## Sauvegarde de la configuration (résistante aux plantages)
**Chaque modification est enregistrée automatiquement** (indicateur *Saved ✓* en haut du panneau, plus besoin de bouton SAVE).

La configuration est dans `%APPDATA%\ControlCast\config.json` (même emplacement que les anciennes versions : elle est reprise telle quelle).

* Chaque enregistrement est écrit dans un fichier temporaire, **forcé sur le disque**, puis remplacé de façon atomique : un écran bleu ou une coupure de courant ne peut plus effacer la configuration.
* La version précédente est gardée dans `config.json.bak` et des copies horodatées sont conservées dans `%APPDATA%\ControlCast\backups` (30 dernières).
* Au démarrage, si `config.json` est abîmé (vide, rempli de zéros, tronqué), ControlCast **restaure automatiquement** la dernière copie valide, vous prévient, et met le fichier abîmé de côté (`config.corrupt-*.json`) au lieu de l'écraser.
* Menu **File** : exporter / importer la configuration, restaurer une sauvegarde automatique, **effacer toute la configuration** (avec avertissement, une copie est sauvegardée avant), ouvrir le dossier des réglages.

## Stabilité sous Windows 11
* Electron 44 (au lieu d'Electron 1.6 de 2017), modules natifs N-API précompilés (pas de compilation nécessaire).
* La simulation clavier ne bloque plus l'application (l'ancienne version gelait l'interface 50 ms par touche).
* La fenêtre redémarre seule si elle plante ; les touches maintenues sont relâchées.
* La configuration est enregistrée à la mise en veille, à l'arrêt de Windows et à la fermeture.
* *Settings > Disable hardware acceleration* si la fenêtre scintille / reste noire avec certains pilotes graphiques.
* Journaux : `%APPDATA%\ControlCast\logs` (menu *Help > Open logs folder*). Plus aucun envoi de données à des services tiers (Loggly / Woopra supprimés).

## Installation / compilation
Prérequis : [Node.js](https://nodejs.org) 20 ou plus.

```bash
npm install
npm start          # lancer en développement
npm test           # tests automatiques
npm run dist       # créer l'installeur Windows (dist/ControlCast Setup x.y.z.exe), à lancer sous Windows
```

### Mise à jour depuis l'ancienne version (0.3.x)
1. Lancez une fois la nouvelle version **avant** de désinstaller l'ancienne si vous utilisez le CLR Browser : les images sont copiées automatiquement.
2. Désinstallez ensuite l'ancienne version (Paramètres Windows > Applications). La configuration (`%APPDATA%\ControlCast`) n'est pas supprimée.
3. Réactivez *Settings > Start with Windows* si besoin.

---
Application originale par DBKynd — Artwork and beta testing by Annemunition
