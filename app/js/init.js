'use strict';
/* eslint no-unused-vars: 0 */
/* eslint no-undef: 0 */

/*
 * Renderer bootstrap: configuration client, notifications, Launchpad connection.
 * Files are loaded as classic <script> tags and share these globals.
 */

const { ipcRenderer: ipc, clipboard, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const midi = require('@julusian/midi');
const keycode = require('keycode');
const { LaunchpadManager } = require('./lib/launchpad-manager');
const { LightEngine } = require('./lib/light-engine');
const { COLORS, COLOR_NAMES } = require('./lib/colors');
const { defaultKeyConfig, completeKeyConfig } = require('./lib/key-defaults');
const { getPath, setPath, clone } = require('./lib/config-store');

window.$ = window.jQuery = require('jquery');
require('./js/jquery/jquery-ui.min.js');
require('./js/jquery/alphanum.min.js');


// Logging (to %APPDATA%\ControlCast\logs)


const log = {
  info: (...a) => {
    console.log(...a); // eslint-disable-line no-console
    ipc.send('log', 'info', ...a.map(String));
  },
  warn: (...a) => {
    console.warn(...a); // eslint-disable-line no-console
    ipc.send('log', 'warn', ...a.map(String));
  },
  error: (...a) => {
    console.error(...a); // eslint-disable-line no-console
    ipc.send('log', 'error', ...a.map(x => (x && x.stack) || String(x)));
  },
};

window.addEventListener('error', e => log.error('Renderer error:', e.error || e.message));
window.addEventListener('unhandledrejection', e => log.error('Unhandled rejection (renderer):', e.reason));


// Configuration client: in-memory copy, persisted by the main process


const config = (() => {
  let data = ipc.sendSync('config:get-all');
  const listeners = [];
  return {
    get: p => clone(p === undefined ? data : getPath(data, p)),
    set: (p, value) => {
      setPath(data, p, clone(value));
      ipc.send('config:set', p, value);
    },
    // Blocks until the file is safely written on disk
    flush: () => ipc.sendSync('config:flush'),
    onChange: fn => listeners.push(fn),
    _changed: (p, value) => {
      if (p === null) data = value;
      else setPath(data, p, value);
      listeners.forEach(fn => fn(p, value));
    },
  };
})();

ipc.on('config:changed', (e, p, value) => config._changed(p, value));
ipc.on('config:reset', (e, all) => config._changed(null, all));

const startupInfo = ipc.sendSync('app:startup-info');


// State shared by the other renderer files


let lastKey = [0, 0]; // Last key pressed / being edited
let tempKeys = {}; // Unsaved key settings
let tracks = {}; // Audio elements per key
let css_editor; // eslint-disable-line camelcase
const guiKeys = new Map(); // "x,y" -> DOM element

const launchpad = new LaunchpadManager({ midi, logger: log, pollMs: 2000 });

// Single place where colours are applied, to both the GUI and the device
const lights = new LightEngine({
  output: (key, color) => {
    const el = guiKeys.get(key.join(','));
    if (el && el.dataset.color !== color) {
      el.classList.remove(el.dataset.color);
      el.classList.add(color);
      el.dataset.color = color;
    }
    launchpad.setLed(key[0], key[1], color);
  },
});


// Notifications


function centerNOTY(type, text, timeout, buttons) {
  const box = document.createElement('div');
  box.className = `toast ${type || ''}`;
  const msg = document.createElement('div');
  msg.innerHTML = text; // Only app-generated text goes here
  box.appendChild(msg);
  const blanket = $('.blanket');
  blanket.stop(true, true).fadeIn(100);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    box.classList.remove('show');
    setTimeout(() => {
      box.remove();
      if (!document.querySelector('#toasts .toast')) blanket.stop(true, true).fadeOut(150);
    }, 160);
  };
  if (buttons && buttons.length) {
    const wrap = document.createElement('div');
    wrap.className = 'toast_buttons';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.textContent = b.text;
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        if (b.onClick) b.onClick();
        close();
      });
      wrap.appendChild(btn);
    }
    box.appendChild(wrap);
  }
  box.addEventListener('click', close);
  document.getElementById('toasts').appendChild(box);
  requestAnimationFrame(() => box.classList.add('show'));
  if (timeout !== false) setTimeout(close, timeout || 1500);
  return { close };
}

ipc.on('app:toast', (e, t) => centerNOTY(t.type, t.text, t.timeout));


// Launchpad connection


function setLaunchpadStatus(text, connected) {
  $('.midi_connected').toggleClass('connected', !!connected);
  $('.lp_status').text(text).toggleClass('connected', !!connected);
}

launchpad.on('connected', info => {
  setLaunchpadStatus(`${info.label} connected (${info.name})`, true);
  lights.renderAll(true); // Send every light to the freshly connected device
});

launchpad.on('disconnected', () => setLaunchpadStatus('Launchpad not connected'));
launchpad.on('error-message', msg => setLaunchpadStatus(msg));

launchpad.on('press', key => keyEvent('midi', key, 'press'));
launchpad.on('release', key => keyEvent('midi', key, 'release'));

ipc.on('launchpad:reconnect', () => launchpad.reconnect());

ipc.on('system:resume', () => {
  // USB devices are re-enumerated after sleep: reconnect and resend all lights
  setTimeout(() => launchpad.reconnect(), 1500);
});

ipc.on('app:shutdown', () => {
  try {
    lights.destroy();
    Object.values(tracks).forEach(t => t.pause());
    launchpad.stop(); // Turns all lights off and closes the MIDI ports
  } catch (err) {
    log.error('Shutdown error', err);
  }
  ipc.send('app:shutdown-done');
});

window.addEventListener('beforeunload', () => {
  // Reload (Ctrl+R): free the MIDI ports so the new page can open them
  try {
    launchpad.stop();
  } catch (e) { /* ignore */ }
});


// Startup


$(document).ready(() => {
  const addKey = (container, cls, pos) => {
    const el = document.createElement('div');
    el.className = `key ${cls} OFF`;
    el.dataset.pos = pos;
    el.dataset.color = 'OFF';
    container.append(el);
    guiKeys.set(pos, el);
  };
  for (let c = 0; c < 8; c++) addKey($('.launchpad .keys_top'), 'round', `${c},8`);
  for (let c = 0; c < 8; c++) {
    for (let r = 0; r < 8; r++) addKey($('.launchpad .keys_main'), 'square', `${r},${c}`);
  }
  for (let r = 0; r < 8; r++) addKey($('.launchpad .keys_side'), 'round', `8,${r}`);

  if (config.get('app.clr.enabled')) {
    $('.clr_options').show();
  } else {
    $('#flush_clr').hide();
  }

  readyLaunchpad();
  readyOptions();
  readyAudioOutput();

  $('body').fadeIn(120);

  setAllLights();
  loadTracks();
  launchpad.start();

  if (!startupInfo.hotkeys) {
    $('.hotkey .content').prepend('<div class="hotkey_warning">Keyboard simulation could not be loaded. ' +
      'See the log file (Help &gt; Open logs folder).</div>');
  }

  if (startupInfo.recovery) {
    const r = startupInfo.recovery;
    const text = r.from ?
      `Your configuration file was damaged (${r.reason}).<br>It was <b>restored automatically</b> from:<br><small>${r.from}</small>` :
      `Your configuration file was damaged (${r.reason}) and no backup was found.<br>` +
      'The damaged file was kept next to config.json.';
    centerNOTY(r.from ? 'notify' : 'error', text, false, [{ text: 'OK' }]);
  }
});

config.onChange(p => {
  if (p === null) {
    // Whole configuration replaced (import / restore / reset)
    tempKeys = {};
    stopAllAudio();
    forEachKey(key => lights.reset(key));
    loadSoundFolder();
    updateSaveState();
    setAllLights();
    loadTracks();
    setKeyOptions();
    $('.clr_options').toggle(!!config.get('app.clr.enabled'));
    $('#flush_clr').toggle(!!config.get('app.clr.enabled'));
  } else if (p === 'app.clr.enabled') {
    const on = !!config.get('app.clr.enabled');
    $('.clr_options').toggle(on);
    $('#flush_clr').toggle(on);
    setAllLights();
  }
});


// Key configuration helpers


function getKeyConfig(key) {
  if (Array.isArray(key)) key = key.join(',');
  if (tempKeys[key]) return tempKeys[key];
  const stored = config.get(`keys.${key}`);
  return stored ? completeKeyConfig(stored) : defaultKeyConfig();
}

// Editing helper: get a mutable copy registered in tempKeys
function editKeyConfig(key) {
  key = Array.isArray(key) ? key.join(',') : key;
  if (!tempKeys[key]) tempKeys[key] = getKeyConfig(key);
  return tempKeys[key];
}

function toMediaUrl(p) {
  if (/^https?:\/\//i.test(p) || /^file:\/\//i.test(p)) return p;
  try {
    return pathToFileURL(path.normalize(p)).href;
  } catch (e) {
    return p;
  }
}
