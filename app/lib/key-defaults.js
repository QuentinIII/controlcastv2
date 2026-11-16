'use strict';

const { fillDefaults, clone } = require('./config-store');

const CONFIG_VERSION = 7;

function defaultKeyConfig() {
  return {
    description: '',
    color: {
      press: 'OFF',
      release: 'OFF',
    },
    light: {
      mode: 'momentary', // momentary | toggle (latching: stays on until pressed again)
      playing: {
        mode: 'none', // none | solid | blink | pulse  (while the key's sound is playing)
        color: 'GREEN',
        color2: 'OFF', // second blink colour
        rate: 'normal', // slow | normal | fast
      },
    },
    hotkey: {
      type: 'send',
      string: '',
    },
    audio: {
      path: '',
      type: 'normal',
      volume: '50',
      loop: false,
      exclusive: false, // stop the other sounds when this one starts
    },
    api: {
      path: '',
    },
    clr: {
      path: '',
      pos: '',
      animate: {
        open: {
          delay: '0.0',
          type: 'fadeIn',
          duration: '1.0',
        },
        close: {
          delay: '2.0',
          type: 'fadeOut',
          duration: '1.0',
        },
      },
      css: '.img {\n  width: 50%;\n}',
    },
  };
}

// Stored keys may come from older versions: complete them with defaults
function completeKeyConfig(keyConfig) {
  return fillDefaults(clone(keyConfig) || {}, defaultKeyConfig());
}

function appDefaults() {
  return {
    app: {
      version: CONFIG_VERSION,
      pos: { x: null, y: null },
      close_to_tray: false,
      auto_start: false,
      start_minimized: false,
      disable_gpu: false,
      audio_folder: '', // Folder of sounds listed in the Audio section
      clr: {
        enabled: false,
        port: 3000,
      },
    },
    keys: {},
  };
}

// Upgrade configs written by older ControlCast versions
function migrate(data) {
  if (!data.app) data.app = {};
  if (!data.keys || typeof data.keys !== 'object') data.keys = {};
  let v = Number(data.app.version) || CONFIG_VERSION;
  if (v < 6) {
    for (const k of Object.keys(data.keys)) {
      if (!data.keys[k].api) data.keys[k].api = { path: '' };
    }
    v = 6;
  }
  if (v < 7) {
    // v7: light effects, audio loop/exclusive. Woopra id no longer used.
    for (const k of Object.keys(data.keys)) data.keys[k] = completeKeyConfig(data.keys[k]);
    delete data.app.id;
    v = 7;
  }
  data.app.version = v;
  return data;
}

module.exports = { CONFIG_VERSION, defaultKeyConfig, completeKeyConfig, appDefaults, migrate };
