'use strict';

/*
 * CLR Browser: a small web page (to add as an OBS "Browser source") that shows
 * images / gifs with animations when a key is pressed.
 *
 * Runs in the main process so it keeps working if the window reloads, and the
 * images are kept in %APPDATA%\ControlCast\clr-images (they used to be stored
 * inside the install folder and were lost at every update).
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

class ClrServer {
  constructor(opts) {
    this.assetsDir = opts.assetsDir;
    this.indexFile = opts.indexFile;
    this.imagesDir = opts.imagesDir;
    this.getKeys = opts.getKeys;
    this.logger = opts.logger || console;
    this.server = null;
    this.io = null;
    this.port = null;
    fs.mkdirSync(this.imagesDir, { recursive: true });
  }

  get running() {
    return !!this.server;
  }

  imageFile(key, ext) {
    return path.join(this.imagesDir, `${key.replace(/[^0-9,]/g, '')}${ext.toLowerCase()}`);
  }

  imageSrc(key, ext) {
    const file = this.imageFile(key, ext);
    const m = Math.floor(fs.statSync(file).mtimeMs / 1000);
    return `images/${encodeURIComponent(path.basename(file))}?m=${m}`;
  }

  currentImages() {
    const images = {};
    const keys = this.getKeys() || {};
    for (const key of Object.keys(keys)) {
      const p = keys[key] && keys[key].clr && keys[key].clr.path;
      if (!p) continue;
      const ext = path.extname(p.split('?')[0]).toLowerCase();
      try {
        images[key] = { src: this.imageSrc(key, ext) };
      } catch (e) { /* image not cached yet */ }
    }
    return images;
  }

  start(port) {
    if (this.server) return Promise.resolve(this.port);
    const app = express();
    app.disable('x-powered-by');
    app.get('/', (req, res) => res.sendFile(this.indexFile));
    app.use('/images', express.static(this.imagesDir, { maxAge: 0 }));
    app.use(express.static(this.assetsDir));
    const server = http.createServer(app);
    const io = new Server(server, { serveClient: true });
    io.on('connection', socket => {
      socket.emit('images', this.currentImages());
    });
    return new Promise((resolve, reject) => {
      server.once('error', err => {
        this.logger.error(`CLR Browser: cannot listen on port ${port}: ${err.message}`);
        try {
          io.close();
        } catch (e) { /* ignore */ }
        reject(err);
      });
      server.listen(port, () => {
        this.server = server;
        this.io = io;
        this.port = port;
        server.on('error', err => this.logger.error(`CLR Browser error: ${err.message}`));
        this.logger.info(`CLR Browser listening on *:${port}`);
        resolve(port);
      });
    });
  }

  stop() {
    if (!this.server) return Promise.resolve();
    const server = this.server;
    const io = this.io;
    this.server = null;
    this.io = null;
    return new Promise(resolve => {
      try {
        io.close(); // Also closes the http server
      } catch (e) { /* ignore */ }
      server.close(() => resolve());
      if (server.closeAllConnections) server.closeAllConnections();
      setTimeout(resolve, 1500);
    }).then(() => this.logger.info('CLR Browser stopped'));
  }

  emit(event, data) {
    if (this.io) this.io.emit(event, data);
  }

  // Copy (local file) or download (URL) the image for a key into the cache
  async setImage(key, source) {
    const isUrl = /^https?:\/\//i.test(source);
    const ext = path.extname(source.split('?')[0]).toLowerCase();
    if (!IMAGE_EXT.includes(ext)) throw new Error(`Only ${IMAGE_EXT.join(' | ')} images are supported`);
    let data;
    if (isUrl) {
      const res = await fetch(source, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = Buffer.from(await res.arrayBuffer());
    } else {
      data = await fs.promises.readFile(source);
    }
    // Remove other cached formats for this key
    for (const e of IMAGE_EXT) {
      if (e !== ext) {
        try {
          fs.unlinkSync(this.imageFile(key, e));
        } catch (err) { /* ignore */ }
      }
    }
    const file = this.imageFile(key, ext);
    await fs.promises.writeFile(`${file}.tmp`, data);
    await fs.promises.rename(`${file}.tmp`, file);
    const src = this.imageSrc(key, ext);
    this.emit('image_change', { key, src });
    return src;
  }
}

module.exports = { ClrServer, IMAGE_EXT };
