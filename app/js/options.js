'use strict';
/* eslint no-unused-vars: 0 */
/* eslint no-undef: 0 */

/*
 * "Edit Key" panel.
 * Every DOM handler is bound ONCE here (the previous version re-bound handlers
 * on every focus / hover, which piled up and slowed the app down over time).
 */

const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus', '.webm'];
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
let settingOptions = false; // True while the panel is being filled programmatically

function keyChanged(keyConfig) {
  setIcons(lastKey, keyConfig);
  applyKeyLights(lastKey, keyConfig);
  checkmarks();
  updateSaveState();
}

function updateSaveState() {
  $('#save_settings').toggleClass('pending', Object.keys(tempKeys).length > 0);
}

function buildColorSelects() {
  $('.color_select').each((i, el) => {
    const wrap = $(el);
    wrap.empty();
    for (const name of COLOR_NAMES) {
      const sw = $('<div>').addClass(name).attr('data-color', name).attr('title', COLORS[name].label);
      if (name === 'OFF') sw.append('<img src="./images/x.png">');
      wrap.append(sw);
    }
    wrap.append('<span class="clear subtext">Off</span>');
  });
}

function showColorSelect(el, color) {
  const wrap = $(el);
  wrap.children('div').removeClass('selected').find('img').removeClass('selected');
  const sel = wrap.children(`div[data-color="${color}"]`);
  sel.addClass('selected');
  if (color === 'OFF') sel.find('img').addClass('selected');
  wrap.children('span').text(COLORS[color] ? COLORS[color].label : color);
}

function readyOptions() {
  buildColorSelects();

  // Highlight the key being edited while hovering the options panel
  $('.options').on('mouseenter', () => {
    getGuiKey(lastKey).addClass('editing');
    $(`.center.c${lastKey.join('-')}`).addClass('editing');
  }).on('mouseleave', () => {
    $('.launchpad .key.editing').removeClass('editing');
    $('.center').removeClass('editing');
  });

  $('.expandable').on('click', event => {
    if ($(event.target).hasClass('clear_opt')) return;
    const content = $(event.currentTarget).next();
    if (content.hasClass('expanded')) {
      content.removeClass('expanded').stop(true, true).slideUp(150);
    } else {
      $('.content.expanded').removeClass('expanded').stop(true, true).slideUp(150);
      content.addClass('expanded').stop(true, true).slideDown(150);
    }
  });

  $('.options').on('click', '.color_select div', event => {
    const sw = $(event.currentTarget);
    const wrap = sw.parent();
    const color = sw.data('color');
    const keyConfig = editKeyConfig(lastKey);
    setProp(keyConfig, wrap.data('config'), color);
    showColorSelect(wrap, color);
    keyChanged(keyConfig);
  });

  $('#discard_settings').on('click', () => {
    tempKeys = {};
    setKeyOptions();
    setAllLights();
    loadTracks();
    updateSaveState();
  });

  $('#save_settings').on('click', () => {
    const keys = config.get('keys') || {};
    for (const key of Object.keys(tempKeys)) keys[key] = tempKeys[key];
    config.set('keys', removeDefaultKeys(keys));
    tempKeys = {};
    updateSaveState();
    // Wait for the file to be really written (flushed to disk) before confirming
    if (config.flush()) {
      centerNOTY('success', 'Save Successful!');
    } else {
      centerNOTY('error', 'Saving failed! See the log file (Help &gt; Open logs folder).', 5000);
    }
    loadTracks();
  });

  $('#kill_audio').on('click', () => stopAllAudio());
  ipc.on('audio:stop-all', () => stopAllAudio());

  const volumeSlider = $('#volume_slider');
  volumeSlider.slider({
    min: 0,
    max: 100,
    range: 'min',
    animate: 'fast',
    slide: (event, ui) => {
      $('#vol_val').text(`${ui.value}%`);
      const track = tracks[lastKey.join(',')];
      if (track) track.volume = ui.value / 100;
    },
    change: (event, ui) => {
      if (settingOptions || !event.originalEvent) return; // Programmatic change
      const keyConfig = editKeyConfig(lastKey);
      keyConfig.audio.volume = String(ui.value);
      keyChanged(keyConfig);
    },
  });


  // Hotkey capture


  const combo = { ctrl: null, shift: null, alt: null, key: null };
  const hotkeyInput = $('#hotkey_string');
  hotkeyInput.on('focus', () => {
    combo.ctrl = combo.shift = combo.alt = combo.key = null;
  });
  hotkeyInput.on('keydown', keydownEvent => {
    keydownEvent.preventDefault();
    const name = keycode(keydownEvent.originalEvent);
    if (!name) return;
    const keyName = name.toUpperCase();
    const ignoredKeys = ['CAPS LOCK', 'NUM LOCK', 'SCROLL LOCK', 'PAUSE/BREAK', 'MY CALCULATOR'];
    if (ignoredKeys.includes(keyName)) return;
    if (keyName === 'BACKSPACE' && !combo.ctrl && !combo.shift && !combo.alt && hotkeyInput.val()) {
      // Backspace alone clears the hotkey
      hotkeyInput.val('');
    } else {
      const code = (keydownEvent.originalEvent.code || '').toUpperCase();
      if (code.includes('CONTROL')) {
        combo.ctrl = code.includes('LEFT') ? 'L-CTRL' : 'R-CTRL';
      } else if (code.includes('SHIFT')) {
        combo.shift = code.includes('LEFT') ? 'L-SHIFT' : 'R-SHIFT';
      } else if (code.includes('ALT')) {
        combo.alt = code.includes('LEFT') ? 'L-ALT' : 'R-ALT';
      } else {
        combo.key = keyName;
      }
      const display = [combo.ctrl, combo.shift, combo.alt, combo.key].filter(Boolean);
      hotkeyInput.val(display.join(' + '));
    }
    const keyConfig = editKeyConfig(lastKey);
    keyConfig.hotkey.string = hotkeyInput.val();
    keyChanged(keyConfig);
  });
  hotkeyInput.on('keyup', keyupEvent => {
    const name = (keycode(keyupEvent.originalEvent) || '').toUpperCase();
    const code = (keyupEvent.originalEvent.code || '').toUpperCase();
    if (code.includes('CONTROL')) combo.ctrl = null;
    else if (code.includes('SHIFT')) combo.shift = null;
    else if (code.includes('ALT')) combo.alt = null;
    else if (combo.key === name) combo.key = null;
  });


  // Path inputs


  $('#audio_path').on('change', event => {
    const val = $(event.currentTarget).val().trim();
    if (!val) return;
    const ext = path.extname(val.split('?')[0]).toLowerCase();
    if (!AUDIO_EXT.includes(ext)) {
      centerNOTY('notify', `Only able to play [ ${AUDIO_EXT.join(' | ')} ] files.`, 4000);
      return;
    }
    if (/^https?:\/\//i.test(val)) {
      fetch(val, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        })
        .catch(err => {
          centerNOTY('warning', 'Unable to access that audio file.', 3000);
          log.warn('Audio URL check failed', err.message);
        });
    } else {
      require('fs').access(val, require('fs').constants.R_OK, err => {
        if (err) centerNOTY('warning', 'Unable to access that audio file.', 3000);
      });
    }
  });

  $('#clr_path').on('change', event => {
    const val = $(event.currentTarget).val().trim();
    if (!val) return;
    const ext = path.extname(val.split('?')[0]).toLowerCase();
    if (!IMAGE_EXT.includes(ext)) {
      centerNOTY('notify', `Only able to show [ ${IMAGE_EXT.join(' | ')} ] files.`, 4000);
      return;
    }
    ipc.invoke('clr:set-image', lastKey.join(','), val).catch(err => {
      centerNOTY('warning', 'Unable to access that image file.', 3000);
      log.warn('CLR image error', err.message);
    });
  });

  $('#browse').on('click', async () => {
    const file = await ipc.invoke('dialog:open-file', {
      title: 'Choose Audio File',
      filters: [{ name: 'Audio', extensions: AUDIO_EXT.map(e => e.slice(1)) }],
    });
    if (file) $('#audio_path').val(file).trigger('input').trigger('change');
  });

  $('#clr_browse').on('click', async () => {
    const file = await ipc.invoke('dialog:open-file', {
      title: 'Choose Image File',
      filters: [{ name: 'Image', extensions: IMAGE_EXT.map(e => e.slice(1)) }],
    });
    if (file) $('#clr_path').val(file).trigger('input').trigger('change');
  });

  $('.api_request input').on('blur', event => {
    const str = $(event.currentTarget).val();
    if (str === '') return;
    if (!normalizeUrl(str)) centerNOTY('notify', 'That is not a known web address format.', 4000);
  });


  // Generic option fields


  $('.opt').on('input change', event => {
    if (settingOptions) return;
    const el = event.currentTarget;
    if (el.type === 'radio' && !el.checked) return;
    const keyConfig = editKeyConfig(lastKey);
    setProp(keyConfig, $(el).data('config'), $(el).val());
    if (el.name === 'pl_mode') togglePlayingRows(keyConfig);
    keyChanged(keyConfig);
  });

  $('.opt_bool').on('change', event => {
    if (settingOptions) return;
    const keyConfig = editKeyConfig(lastKey);
    setProp(keyConfig, $(event.currentTarget).data('config'), event.currentTarget.checked);
    if (event.currentTarget.id === 'audio_stop_all') {
      $('.audio').toggleClass('stop_all_mode', event.currentTarget.checked);
      if (event.currentTarget.checked) stopAudio(tracks[lastKey.join(',')]);
    }
    keyChanged(keyConfig);
  });


  // CSS editor


  css_editor = ace.edit('clr_css');
  css_editor.setTheme('ace/theme/tomorrow_night_eighties');
  css_editor.getSession().setMode('ace/mode/css');
  css_editor.getSession().setTabSize(2);
  css_editor.$blockScrolling = Infinity;
  css_editor.getSession().on('change', () => {
    if (settingOptions) return;
    const keyConfig = editKeyConfig(lastKey);
    keyConfig.clr.css = css_editor.getSession().getValue();
    updateSaveState();
  });

  $('#reset_clr_css').on('click', () => {
    css_editor.setValue(defaultKeyConfig().clr.css);
    css_editor.clearSelection();
  });

  $('#clr_css').on('focusout', () => {
    if ($('.ace_error').length) centerNOTY('warning', 'There is an error in the custom CSS', 3000);
  });

  $('.num_input').numeric({
    allowMinus: false,
    allowThouSep: false,
    allowDecSep: true,
    maxDecimalPlaces: 3,
    maxPreDecimalPlaces: 3,
  });


  // Clear buttons


  $('#clear_all').on('click', () => {
    tempKeys[lastKey.join(',')] = defaultKeyConfig();
    lights.reset(lastKey);
    stopAudio(tracks[lastKey.join(',')]);
    setKeyOptions();
    keyChanged(getKeyConfig(lastKey));
  });

  const clearSection = (selector, fn) => {
    $(`${selector} .clear_opt`).on('click', () => {
      const keyConfig = editKeyConfig(lastKey);
      fn(keyConfig, defaultKeyConfig());
      setKeyOptions();
      keyChanged(keyConfig);
    });
  };
  clearSection('.color', (k, d) => {
    k.color = d.color;
    k.light.mode = d.light.mode;
  });
  clearSection('.hotkey', (k, d) => {
    k.hotkey = d.hotkey;
  });
  clearSection('.audio', (k, d) => {
    stopAudio(tracks[lastKey.join(',')]);
    k.audio = d.audio;
  });
  clearSection('.playing_light', (k, d) => {
    k.light.playing = d.light.playing;
  });
  clearSection('.api_request', (k, d) => {
    k.api = d.api;
  });
  clearSection('.clr_options', (k, d) => {
    k.clr = d.clr;
  });


  // General


  readySoundFolder();
  $('#flush_clr').on('click', () => ipc.send('clr:flush'));
  ipc.on('clr:show-address', () => clrNoty());
  setKeyOptions();
}

function togglePlayingRows(keyConfig) {
  $('.pl_color2').toggle(keyConfig.light.playing.mode === 'blink');
}

function setIcons(key, keyConfig) {
  const usingHotkey = keyConfig.hotkey.string;
  const usingAudio = keyConfig.audio.path || keyConfig.audio.stop_all;
  const usingAPI = keyConfig.api.path;
  const usingCLR = config.get('app.clr.enabled') ? keyConfig.clr.path : null;
  const icons = [];
  if (usingHotkey) icons.push('<img src="images/hotkey.png">');
  if (usingAudio) icons.push('<img src="images/audio.png">');
  if (usingCLR) icons.push('<img src="images/clr.png">');
  if (usingAPI) icons.push('<img src="images/cloud.png">');
  const html = `<div${icons.length > 2 ? ' class="shift_up"' : ''}><span>${icons.join('')}</span></div>`;
  const el = guiKeys.get(key.join(','));
  if (el && el.innerHTML !== html) el.innerHTML = html;
  if (el) el.title = keyConfig.description || '';
}

// Fill the Edit Key panel with the settings of lastKey
function setKeyOptions() {
  settingOptions = true;
  try {
    const keyConfig = getKeyConfig(lastKey);
    $('#key_description').val(keyConfig.description);
    $('.color_select').each((i, el) => showColorSelect(el, getPath(keyConfig, $(el).data('config')) || 'OFF'));
    const radio = (name, value) => $(`input[name="${name}"][value="${value}"]`).prop('checked', true);
    radio('light_mode', keyConfig.light.mode);
    radio('pl_mode', keyConfig.light.playing.mode);
    radio('pl_rate', keyConfig.light.playing.rate);
    togglePlayingRows(keyConfig);
    $('#hotkey_string').val(keyConfig.hotkey.string);
    radio('hotkey_type', keyConfig.hotkey.type);
    $('#audio_path').val(keyConfig.audio.path);
    $('#volume_slider').slider('value', parseInt(keyConfig.audio.volume, 10));
    $('#vol_val').text(`${keyConfig.audio.volume}%`);
    radio('audio_type', keyConfig.audio.type);
    $('#audio_loop').prop('checked', !!keyConfig.audio.loop);
    $('#audio_exclusive').prop('checked', !!keyConfig.audio.exclusive);
    $('#audio_stop_all').prop('checked', !!keyConfig.audio.stop_all);
    $('.audio').toggleClass('stop_all_mode', !!keyConfig.audio.stop_all);
    $('#api_path').val(keyConfig.api.path);
    $('#clr_path').val(keyConfig.clr.path);
    $('#clr_pos').val(keyConfig.clr.pos);
    $('#animate-open').val(keyConfig.clr.animate.open.type);
    $('#animate-close').val(keyConfig.clr.animate.close.type);
    $('.open .delay').val(keyConfig.clr.animate.open.delay);
    $('.open .duration').val(keyConfig.clr.animate.open.duration);
    $('.close .delay').val(keyConfig.clr.animate.close.delay);
    $('.close .duration').val(keyConfig.clr.animate.close.duration);
    if (css_editor.getValue() !== keyConfig.clr.css) {
      css_editor.setValue(keyConfig.clr.css);
      css_editor.clearSelection();
    }
    checkmarks();
    setIcons(lastKey, keyConfig);
    markCurrentSound();
  } finally {
    settingOptions = false;
  }
}

function checkmarks() {
  const k = getKeyConfig(lastKey);
  $('.color .check_mark').toggle(k.color.press !== 'OFF' || k.color.release !== 'OFF' || k.light.mode !== 'momentary');
  $('.hotkey .check_mark').toggle(k.hotkey.string !== '');
  $('.audio .check_mark').toggle(k.audio.path !== '' || !!k.audio.stop_all);
  $('.playing_light .check_mark').toggle(k.light.playing.mode !== 'none');
  $('.api_request .check_mark').toggle(k.api.path !== '');
  $('.clr_options .check_mark').toggle(k.clr.path !== '');
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return String(a) === String(b);
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every(k => deepEqual(a[k], b[k]));
}

function removeDefaultKeys(keys) { // Keep config.json as small as possible
  const def = defaultKeyConfig();
  for (const key of Object.keys(keys)) {
    if (deepEqual(completeKeyConfig(keys[key]), def)) delete keys[key];
  }
  return keys;
}

function isURL(str) {
  return !!normalizeUrl(str);
}

function toTitleCase(str) {
  if (Array.isArray(str)) str = str.join(' ');
  return str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

function setProp(obj, str, val) {
  setPath(obj, str, val);
}


// Sound folder: list the sounds of a folder to assign them quickly


let folderFiles = []; // { full, rel, search }
let folderScan = 0;
let previewAudio = null;

function samePath(a, b) {
  if (!a || !b) return false;
  a = path.normalize(a);
  b = path.normalize(b);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function scanSoundFolder(dir) {
  const names = await require('fs').promises.readdir(dir, { recursive: true });
  return names
    .filter(n => AUDIO_EXT.includes(path.extname(n).toLowerCase()))
    .slice(0, 5000)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map(rel => ({ full: path.join(dir, rel), rel, search: rel.toLowerCase() }));
}

function renderSoundList() {
  const filter = String($('#audio_filter').val() || '').toLowerCase().trim();
  const words = filter.split(/\s+/).filter(Boolean);
  const list = document.getElementById('audio_files');
  const frag = document.createDocumentFragment();
  let shown = 0;
  for (const f of folderFiles) {
    if (words.length && !words.every(w => f.search.includes(w))) continue;
    const opt = document.createElement('option');
    opt.value = f.full;
    opt.textContent = f.rel.replace(/\.[^.\\/]+$/, '');
    opt.title = f.rel;
    frag.appendChild(opt);
    shown++;
  }
  list.replaceChildren(frag);
  $('#audio_files_info').text(folderFiles.length ?
    `${shown} / ${folderFiles.length} sounds - Click: assign to the key - Double-click: preview` :
    'No sound found in this folder (mp3, wav, ogg, flac, m4a...)');
  markCurrentSound();
}

function markCurrentSound() {
  const current = getKeyConfig(lastKey).audio.path;
  const list = document.getElementById('audio_files');
  if (!list) return;
  let found = null;
  for (const opt of list.options) {
    const match = samePath(opt.value, current);
    opt.selected = match;
    if (match) found = opt;
  }
  if (!found) list.selectedIndex = -1;
  else if (found.scrollIntoView) found.scrollIntoView({ block: 'nearest' });
}

async function loadSoundFolder(notify) {
  const dir = config.get('app.audio_folder') || '';
  $('#audio_folder').val(dir ? path.basename(dir) || dir : '').attr('title', dir);
  $('.audio_folder_list').toggleClass('visible', !!dir);
  $('#audio_folder_reload').prop('disabled', !dir);
  if (!dir) {
    folderFiles = [];
    return;
  }
  const scan = ++folderScan;
  $('#audio_files_info').text('Loading...');
  try {
    const files = await scanSoundFolder(dir);
    if (scan !== folderScan) return; // A newer scan started meanwhile
    folderFiles = files;
    renderSoundList();
    if (notify) centerNOTY('success', `${files.length} sound${files.length > 1 ? 's' : ''} found`, 1200);
  } catch (err) {
    if (scan !== folderScan) return;
    folderFiles = [];
    renderSoundList();
    $('#audio_files_info').text(`Cannot read this folder (${err.code || err.message})`);
    if (notify) centerNOTY('warning', 'Cannot read the sound folder.', 3000);
  }
}

function stopPreview() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio.removeAttribute('src');
    previewAudio.load();
    previewAudio = null;
  }
}

function readySoundFolder() {
  $('#audio_folder_browse').on('click', async () => {
    const dir = await ipc.invoke('dialog:open-file', {
      title: 'Choose a folder of sounds',
      defaultPath: config.get('app.audio_folder') || undefined,
      properties: ['openDirectory'],
    });
    if (!dir) return;
    config.set('app.audio_folder', dir);
    $('#audio_filter').val('');
    loadSoundFolder(true);
  });

  $('#audio_folder_reload').on('click', () => loadSoundFolder(true));
  $('#audio_filter').on('input', () => renderSoundList());

  $('#audio_files').on('change', event => {
    const file = $(event.currentTarget).val();
    if (!file || samePath(file, getKeyConfig(lastKey).audio.path)) return;
    $('#audio_path').val(file).trigger('input');
  });

  $('#audio_files').on('dblclick', 'option', event => {
    const file = event.currentTarget.value;
    const same = previewAudio && previewAudio.ccFile === file && !previewAudio.paused;
    stopPreview();
    if (same) return; // Second double-click stops the preview
    previewAudio = new Audio(toMediaUrl(file));
    previewAudio.ccFile = file;
    previewAudio.volume = Math.min(1, Math.max(0, (parseInt(getKeyConfig(lastKey).audio.volume, 10) || 100) / 100));
    previewAudio.play().catch(err => log.warn('Preview failed', err.message));
  });

  $('#kill_audio').on('click', stopPreview);
  loadSoundFolder();
}
