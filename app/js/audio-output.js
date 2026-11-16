'use strict';
/* eslint no-unused-vars: 0 */
/* eslint no-undef: 0 */

/*
 * Master volume and audio output device selection (e.g. VoiceMeeter inputs).
 *
 * - app.master_volume (0-100) multiplies every key volume.
 * - app.audio_output {id, label}: output used by every key ('' = Windows default).
 * - keys.x,y.audio.output {id, label}: optional per-key override ('' = global).
 * Devices are matched by id, then by name (ids can change when devices are
 * re-plugged or drivers are reinstalled).
 */

let outputDevices = []; // [{ deviceId, label }]
let outputsReady = false;

function masterVolume() {
  const v = parseInt(config.get('app.master_volume'), 10);
  return isNaN(v) ? 1 : Math.min(100, Math.max(0, v)) / 100;
}

function effectiveVolume(audio) {
  const v = parseInt(audio && audio.volume, 10);
  const keyVol = isNaN(v) ? 1 : Math.min(100, Math.max(0, v)) / 100;
  return keyVol * masterVolume();
}

// Returns the deviceId to use for a {id, label} reference ('' = system default)
function resolveDevice(ref) {
  if (!ref || (!ref.id && !ref.label)) return '';
  const byId = outputDevices.find(d => d.deviceId === ref.id);
  if (byId) return byId.deviceId;
  const byLabel = ref.label && outputDevices.find(d => d.label === ref.label);
  if (byLabel) return byLabel.deviceId;
  return null; // Device not available right now
}

function sinkFor(audio) {
  const own = audio && audio.output;
  if (own && (own.id || own.label)) {
    const id = resolveDevice(own);
    if (id !== null) return id;
  }
  const global = resolveDevice(config.get('app.audio_output'));
  return global === null ? '' : global; // Missing device: fall back to Windows default
}

// Route a media element to the right output (only calls setSinkId when it changes)
function applySink(el, audio) {
  if (!el || typeof el.setSinkId !== 'function') return;
  const sink = sinkFor(audio);
  if (el.ccSink === sink) return;
  el.ccSink = sink;
  el.setSinkId(sink).catch(err => {
    el.ccSink = undefined;
    log.warn(`Cannot use audio output '${sink}': ${err.message}`);
  });
}

function applyAllOutputs() {
  for (const k of Object.keys(tracks)) {
    const audio = getKeyConfig(k).audio;
    tracks[k].volume = effectiveVolume(audio);
    applySink(tracks[k], audio);
  }
  if (typeof previewAudio !== 'undefined' && previewAudio) applySink(previewAudio, getKeyConfig(lastKey).audio);
}

function deviceOptionsHtml(firstLabel) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return [`<option value="">${esc(firstLabel)}</option>`]
    .concat(outputDevices.map(d => `<option value="${esc(d.deviceId)}">${esc(d.label)}</option>`))
    .join('');
}

function fillDeviceSelect(sel, ref, firstLabel) {
  const el = $(sel);
  el.html(deviceOptionsHtml(firstLabel));
  if (ref && (ref.id || ref.label)) {
    const id = resolveDevice(ref);
    if (id === null) {
      // Remember the missing device so the choice is not lost
      el.append($('<option>').val('__missing__').text(`${ref.label || ref.id} (not connected)`));
      el.val('__missing__');
    } else {
      el.val(id);
    }
  } else {
    el.val('');
  }
}

function refOf(deviceId) {
  if (!deviceId) return { id: '', label: '' };
  const d = outputDevices.find(x => x.deviceId === deviceId);
  return { id: deviceId, label: d ? d.label : '' };
}

function renderOutputSelects() {
  fillDeviceSelect('#global_output', config.get('app.audio_output'), 'Windows default output');
  fillDeviceSelect('#audio_output', getKeyConfig(lastKey).audio.output, 'Same as main output');
  const missing = resolveDevice(config.get('app.audio_output')) === null;
  $('#global_output').toggleClass('missing', missing)
    .attr('title', missing ? 'This output is not connected: sounds use the Windows default output' : '');
}

async function refreshOutputDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    outputDevices = devices
      .filter(d => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Output ${i + 1}` }));
  } catch (err) {
    log.warn('Cannot list audio outputs:', err.message);
    outputDevices = [];
  }
  outputsReady = true;
  renderOutputSelects();
  applyAllOutputs();
}

function setMasterUi(value) {
  $('#master_slider').slider('value', value);
  $('#master_val').text(`${value}%`);
}

function readyAudioOutput() {
  const master = Math.round(masterVolume() * 100);
  $('#master_slider').slider({
    min: 0,
    max: 100,
    range: 'min',
    value: master,
    slide: (event, ui) => {
      $('#master_val').text(`${ui.value}%`);
      config.set('app.master_volume', ui.value); // In memory now, written to disk shortly after
      applyAllOutputs();
    },
    change: (event, ui) => {
      $('#master_val').text(`${ui.value}%`);
      if (!event.originalEvent) return;
      config.set('app.master_volume', ui.value);
      applyAllOutputs();
    },
  });
  $('#master_val').text(`${master}%`);

  $('#global_output').on('change', event => {
    const v = $(event.currentTarget).val();
    if (v === '__missing__') return;
    config.set('app.audio_output', refOf(v));
    renderOutputSelects();
    applyAllOutputs();
  });

  $('#audio_output').on('change', event => {
    if (settingOptions) return;
    const v = $(event.currentTarget).val();
    if (v === '__missing__') return;
    const keyConfig = editKeyConfig(lastKey);
    keyConfig.audio.output = refOf(v);
    keyChanged(keyConfig);
    const track = tracks[lastKey.join(',')];
    if (track) applySink(track, keyConfig.audio);
  });

  $('#refresh_outputs').on('click', () => refreshOutputDevices());
  navigator.mediaDevices.addEventListener('devicechange', () => refreshOutputDevices());

  config.onChange(p => {
    if (p === null || p === 'app.master_volume') setMasterUi(Math.round(masterVolume() * 100));
    if (p === null || p === 'app.audio_output') {
      renderOutputSelects();
      applyAllOutputs();
    }
  });

  refreshOutputDevices();
}
