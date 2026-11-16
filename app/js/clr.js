'use strict';
/* eslint no-unused-vars: 0 */
/* eslint no-undef: 0 */

/*
 * CLR Browser (renderer side). The web server itself runs in the main process
 * (app/main/clr-server.js) so it survives window reloads.
 */

function clrNoty() {
  const address = `http://localhost:${config.get('app.clr.port') || 3000}`;
  centerNOTY('alert', `CLR Browser address:<br><b>${address}</b>`, false, [
    { text: 'Copy to Clipboard', onClick: () => clipboard.writeText(address) },
    { text: 'Close' },
  ]);
}
