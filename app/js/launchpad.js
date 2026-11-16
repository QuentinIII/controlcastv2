'use strict';
/* eslint no-unused-vars: 0 */
/* eslint no-undef: 0 */

/*
 * Key actions: lights, audio, web request, CLR browser and hotkeys.
 */

// All midi and gui key events land here
function keyEvent(source, key, action, edit) {
  const keyConfig = getKeyConfig(key);
  if (!edit) { // Right-click only selects the key for editing
    const steps = [handleLights, playAudio, sendAPI, sendCLR, sendHotkey];
    for (const step of steps) {
      try {
        step(key, action, keyConfig);
      } catch (err) {
        log.error(`Key ${key.join(',')} ${action} (${step.name}) failed:`, err);
      }
    }
  }
  if (action === 'press') {
    const changed = lastKey[0] !== key[0] || lastKey[1] !== key[1];
    lastKey = key;
    if (changed || edit) {
      $('.options .key_pos_label').text(`(${key.join(',')})`);
      setKeyOptions();
    }
  }
}

function readyLaunchpad() {
  const launchpadGuiKey = $('.launchpad .key');
  launchpadGuiKey.on('contextmenu', e => e.preventDefault());
  launchpadGuiKey.on('mousedown', event => {
    const key = getKeyPosition(event.currentTarget);
    if (event.which === 3) {
      keyEvent('gui', key, 'press', 'right-click');
      return;
    }
    if (event.which !== 1) return;
    $(event.currentTarget).addClass('held');
    keyEvent('gui', key, 'press');
  });
  launchpadGuiKey.on('mouseup', event => {
    if (!$(event.currentTarget).hasClass('held')) return;
    $(event.currentTarget).removeClass('held');
    keyEvent('gui', getKeyPosition(event.currentTarget), 'release');
  });
  launchpadGuiKey.on('mouseleave', event => {
    // Release if the mouse left the key while pressed
    if (!$(event.currentTarget).hasClass('held')) return;
    $(event.currentTarget).removeClass('held');
    keyEvent('gui', getKeyPosition(event.currentTarget), 'release');
  });
}

function getGuiKey(key) {
  if (Array.isArray(key)) key = key.join(',');
  return $(guiKeys.get(key) || []);
}

function getKeyPosition(el) {
  return String(el.dataset.pos).split(',').map(n => parseInt(n, 10));
}


// Lights


function markPressed(key, pressed) {
  const el = guiKeys.get(key.join(','));
  if (el) el.classList.toggle('pressed', pressed);
  $(`.c${key.join('-')}`).toggleClass('pressed', pressed);
}

function handleLights(key, action, keyConfig) {
  markPressed(key, action === 'press');
  if (keyConfig.light.mode === 'toggle') {
    if (action === 'press') {
      lights.setLatched(key, lights.isLatched(key) ? null : keyConfig.color.press);
    }
    return;
  }
  lights.setPressed(key, action === 'press' ? keyConfig.color.press : null);
}

// Apply the idle colour of a key (after load / edit)
function applyKeyLights(key, keyConfig) {
  lights.setBase(key, keyConfig.color.release);
  if (keyConfig.light.mode !== 'toggle') lights.setLatched(key, null);
  else if (lights.isLatched(key)) lights.setLatched(key, keyConfig.color.press);
  const track = tracks[key.join(',')];
  if (track && !track.paused && !track.ended) lights.setPlaying(key, keyConfig.light.playing);
  else lights.setPlaying(key, null);
}

function forEachKey(fn) {
  for (let c = 0; c <= 8; c++) {
    for (let r = 0; r <= 8; r++) {
      if (c === 8 && r === 8) continue; // 8,8 does not exist on the pad
      fn([c, r]);
    }
  }
}

function setAllLights() {
  forEachKey(key => {
    const keyConfig = getKeyConfig(key);
    applyKeyLights(key, keyConfig);
    setIcons(key, keyConfig);
  });
}

// Kept for compatibility with older code paths
function colorKey(key, action, keyConfig) {
  applyKeyLights(key, keyConfig);
}


// Audio


function audioIsPlaying(track) {
  return !!track && !track.paused && !track.ended;
}

function stopAudio(track) {
  if (!track) return;
  try {
    track.pause();
    track.currentTime = 0;
  } catch (e) { /* ignore */ }
}

function stopAllAudio(exceptKey) {
  for (const k of Object.keys(tracks)) {
    if (k !== exceptKey) stopAudio(tracks[k]);
  }
}

function disposeTrack(track) {
  track.ccSrc = null;
  try {
    track.pause();
    track.removeAttribute('src');
    track.load();
  } catch (e) { /* ignore */ }
}

function createTrack(keyStr, audio) {
  const url = toMediaUrl(audio.path);
  const track = new Audio();
  track.preload = 'auto';
  track.ccSrc = url;
  const key = keyStr.split(',').map(Number);
  track.addEventListener('playing', () => lights.setPlaying(key, getKeyConfig(key).light.playing));
  const stopped = () => lights.setPlaying(key, null);
  track.addEventListener('pause', stopped);
  track.addEventListener('ended', stopped);
  track.addEventListener('emptied', stopped);
  track.addEventListener('error', () => {
    stopped();
    if (!track.ccSrc) return;
    log.warn(`Audio error on key ${keyStr} (${audio.path}): ${track.error && track.error.message}`);
  });
  track.src = url;
  return track;
}

function getTrack(keyStr, audio) {
  let track = tracks[keyStr];
  const url = toMediaUrl(audio.path);
  if (!track || track.ccSrc !== url) {
    if (track) disposeTrack(track);
    track = createTrack(keyStr, audio);
    tracks[keyStr] = track;
  }
  track.volume = effectiveVolume(audio); // Key volume x master volume
  track.loop = !!audio.loop;
  applySink(track, audio); // Output device (global or per key)
  return track;
}

function loadTracks() {
  const keys = config.get('keys') || {};
  const wanted = {};
  for (const k of Object.keys(keys)) {
    const audio = keys[k] && keys[k].audio;
    if (audio && audio.path && !audio.stop_all) wanted[k] = completeKeyConfig(keys[k]).audio;
  }
  for (const k of Object.keys(tracks)) {
    if (!wanted[k]) {
      disposeTrack(tracks[k]);
      delete tracks[k];
    }
  }
  for (const k of Object.keys(wanted)) getTrack(k, wanted[k]);
}

function startTrack(keyStr, track) {
  try {
    track.currentTime = 0;
  } catch (e) { /* not loaded yet */ }
  const p = track.play();
  if (p && p.catch) {
    p.catch(err => {
      if (err.name === 'AbortError') return; // Stopped before it started
      log.warn(`Cannot play audio for key ${keyStr}: ${err.message}`);
      lights.setStatus(keyStr, 'RED', 800);
    });
  }
}

function playAudio(key, action, keyConfig) {
  const audio = keyConfig.audio;
  if (!audio) return;
  if (audio.stop_all) { // "Stop all sounds" key
    if (action === 'press') {
      stopAllAudio();
      if (typeof stopPreview === 'function') stopPreview();
    }
    return;
  }
  if (!audio.path) return;
  const keyStr = key.join(',');
  const track = getTrack(keyStr, audio);
  if (action === 'press') {
    if (!audioIsPlaying(track)) {
      if (audio.exclusive) stopAllAudio(keyStr);
      startTrack(keyStr, track);
      return;
    }
    switch (audio.type) {
      case 'toggle':
        stopAudio(track);
        break;
      case 'restart':
        if (audio.exclusive) stopAllAudio(keyStr);
        startTrack(keyStr, track);
        break;
      default:
      // normal / hold: keep playing
    }
  } else if (action === 'release' && audio.type === 'hold') {
    stopAudio(track);
  }
}


// Hotkeys (simulated by the main process)


function sendHotkey(key, action, keyConfig) {
  const hotkey = keyConfig.hotkey;
  if (!hotkey || !hotkey.string) return;
  if (hotkey.type === 'hold') {
    ipc.send(action === 'press' ? 'hotkey:down' : 'hotkey:up', hotkey.string);
  } else if (action === 'press') {
    ipc.send('hotkey:send', hotkey.string);
  }
}


// CLR Browser


function sendCLR(key, action, keyConfig) {
  if (action !== 'press') return;
  if (!config.get('app.clr.enabled')) return;
  const clr = keyConfig.clr;
  if (!clr || !clr.path) return;
  ipc.send('clr:key-press', { key: key.join(','), options: clr });
}


// GET request


function normalizeUrl(str) {
  str = String(str || '').trim();
  if (!str) return null;
  if (!/^https?:\/\//i.test(str)) str = `http://${str}`;
  try {
    return new URL(str).href;
  } catch (e) {
    return null;
  }
}

function sendAPI(key, action, keyConfig) {
  if (action !== 'press') return;
  const api = keyConfig.api;
  if (!api || !api.path) return;
  const url = normalizeUrl(api.path);
  if (!url) return;
  lights.setStatus(key, 'YELLOW', 0); // Pending
  fetch(url, { signal: AbortSignal.timeout(10000), cache: 'no-store' })
    .then(async res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if ((res.headers.get('content-type') || '').includes('json')) {
        const body = await res.json().catch(() => ({}));
        if (body && body.error) throw new Error(String(body.error));
      }
      lights.setStatus(key, 'GREEN', 1500);
    })
    .catch(err => {
      log.warn(`GET request for key ${key.join(',')} failed: ${err.message}`);
      lights.setStatus(key, 'RED', 1500);
    });
}
