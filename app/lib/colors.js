'use strict';

/*
 * Named colors usable on every supported Launchpad.
 *  - classic: red / green intensities (0-3) for Launchpad MK1 / S / Mini (MK1-MK2)
 *  - rgb: palette index for Launchpad MK2 / Mini MK3 / X / Pro MK3
 *  - css: colour used for the on-screen Launchpad and the colour pickers
 *  - dim: darker variant, used by the "pulse" light effect
 */
const COLORS = {
  OFF: { label: 'Off', red: 0, green: 0, rgb: 0, css: '#7D8386', dim: 'OFF' },
  LOW_RED: { label: 'Low Red', red: 1, green: 0, rgb: 7, css: '#B8423C', dim: 'OFF' },
  RED: { label: 'Red', red: 3, green: 0, rgb: 5, css: '#FF1000', dim: 'LOW_RED' },
  ORANGE: { label: 'Orange', red: 3, green: 1, rgb: 9, css: '#FF6A00', dim: 'LOW_AMBER' },
  LOW_AMBER: { label: 'Low Amber', red: 1, green: 1, rgb: 11, css: '#C99A2E', dim: 'OFF' },
  AMBER: { label: 'Amber', red: 3, green: 3, rgb: 96, css: '#FFBC00', dim: 'LOW_AMBER' },
  YELLOW: { label: 'Yellow', red: 2, green: 3, rgb: 13, css: '#F4FF00', dim: 'LOW_AMBER' },
  LOW_GREEN: { label: 'Low Green', red: 0, green: 1, rgb: 23, css: '#5E9A2A', dim: 'OFF' },
  GREEN: { label: 'Green', red: 0, green: 3, rgb: 21, css: '#85FF00', dim: 'LOW_GREEN' },
};

const COLOR_NAMES = Object.keys(COLORS);

function normalizeColor(name) {
  return COLORS[name] ? name : 'OFF';
}

module.exports = { COLORS, COLOR_NAMES, normalizeColor };
