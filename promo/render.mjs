// GhostLoop promo v5 renderer. Serves the stage locally, seeks the GSAP timeline at exact times, and encodes with FFmpeg.
// Captures at 60 fps and blends frame pairs (tmix) into 30 fps output for natural motion blur.
// Modes: --preview (local server), --stills (review frames + story checks), default (full render + audio mux).
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';

const root = dirname(fileURLToPath(import.meta.url));
const output = resolve(root, 'output');
const FPS = 30, CAPTURE_FPS = 60;
const basename = 'ghostloop-promo-v5';
await mkdir(output, { recursive: true });
const mode = process.argv.includes('--preview') ? 'preview' : process.argv.includes('--stills') ? 'stills' : 'render';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const file = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(file);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(mode === 'preview' ? 5188 : 0, '127.0.0.1'); await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}`;
if (mode === 'preview') { console.log(`Promo preview: ${url}`); } else {
  let browser, encoder;
  const errors = [];
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--hide-scrollbars'] });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url + '/?render=1');
    await page.evaluate(() => window.filmReady);
    const info = await page.evaluate(() => ({ duration: film.duration(), version: gsap.version, beats: window.FILM_BEATS.length, ghosts: document.querySelectorAll('#ghosts .ghost').length, captions: document.querySelectorAll('.caption').length }));
    if (info.duration !== 30 || info.beats !== 8 || info.ghosts !== 12) throw new Error('Unexpected timeline: ' + JSON.stringify(info));
    console.log(JSON.stringify(info));
    if (mode === 'stills') {
      const stills = resolve(output, 'v5-stills'); await mkdir(stills, { recursive: true });
      for (const [name, t] of await page.evaluate(() => window.REVIEW_FRAMES)) {
        await page.evaluate(t => window.seekFilm(t), t);
        await page.screenshot({ path: resolve(stills, name + '.png') });
        console.log(`Captured ${name} at ${t}s`);
      }
      const checks = await page.evaluate(() => {
        const out = { overlaps: [] };
        const visible = el => getComputedStyle(el).visibility !== 'hidden' && +getComputedStyle(el).opacity > .05;
        for (let t = 0; t < 30; t += .2) { seekFilm(t); if ([...document.querySelectorAll('.caption')].filter(visible).length > 1) out.overlaps.push(+t.toFixed(1)); }
        seekFilm(2.95); out.uploaded = +getComputedStyle(document.querySelector('#chip-check')).opacity > .9 && new DOMMatrix(getComputedStyle(document.querySelector('#chip-check')).transform).a > .9;
        seekFilm(5.4); const f = document.querySelector('#frame'); out.appOpen = f.offsetWidth === 1240 && f.offsetHeight === 720;
        seekFilm(12.6); out.allEntered = [...document.querySelectorAll('#ghosts .ghost')].every(g => +g.style.opacity < .02);
        seekFilm(17.1); out.pins = ['#pin-a', '#pin-b', '#pin-c'].every(s => +getComputedStyle(document.querySelector(s)).opacity > .9);
        seekFilm(21.9); out.freePrimary = getComputedStyle(document.querySelector('#btn-free')).backgroundColor === 'rgb(23, 32, 29)';
        seekFilm(24.4); out.zero = document.querySelector('#score .s-b').textContent === '0';
        const stray = t => { seekFilm(t); return ['#ripple', '#loopback'].filter(sel => +getComputedStyle(document.querySelector(sel)).opacity > .01); };
        out.noStrays = [.5, 1.2, 2.5, 7.4, 10.4, 14.25].every(t => stray(t).length === 0);
        seekFilm(22.6); { const btn = document.querySelector('#btn-free').getBoundingClientRect(), lab = document.querySelector('#btn-free .roll span:last-child').getBoundingClientRect();
          out.labelCentered = Math.abs((lab.top + lab.height / 2) - (btn.top + btn.height / 2)) < 3 && Math.abs((lab.left + lab.width / 2) - (btn.left + btn.width / 2)) < 3; }
        seekFilm(22.6); { const btn = document.querySelector('#btn-pro').getBoundingClientRect(), lab = document.querySelector('#btn-pro .roll span:last-child').getBoundingClientRect();
          out.proRenamed = lab.top >= btn.top && lab.bottom <= btn.bottom && Math.abs((lab.left + lab.width / 2) - (btn.left + btn.width / 2)) < 3; }
        seekFilm(20.3); out.threeFixes = ['#fix1', '#fix2', '#fix3'].every(s => +getComputedStyle(document.querySelector(s)).opacity > .9);
        seekFilm(29.5); out.brand = getComputedStyle(document.querySelector('#mark')).visibility === 'visible' && +getComputedStyle(document.querySelector('#tagline')).opacity > .9;
        return out;
      });
      if (checks.overlaps.length || Object.entries(checks).some(([k, v]) => k !== 'overlaps' && !v)) throw new Error('Story checks failed: ' + JSON.stringify(checks));
      console.log('Caption isolation, upload, build, swarm entry, pins, fix applied, centered label, no stray marks, zero stuck points, and brand card verified.');
      // Compare animated state, not raw pixels: Chrome's GPU raster varies by ±1 level between identical frames.
      const state = () => page.evaluate(() => JSON.stringify({
        world: document.querySelector('#world').style.transform,
        night: document.querySelector('#night').style.clipPath,
        ghosts: [...document.querySelectorAll('#ghosts .ghost')].map(g => [g.style.transform, g.style.opacity, g.style.zIndex, g.querySelector('.mouth').getAttribute('d'), g.querySelector('.body').getAttribute('d')]),
        els: ['#frame', '#btn-free', '#btn-pro', '#panel', '#blob1', '#blob2', '#blob3', '#pin-a', '#pin-b', '#pin-c', '#cursor', '#o2', '#mark', '#mascot', '#tagline', '#score', '#zipfly', '#chip'].map(s => { const c = getComputedStyle(document.querySelector(s)); return [c.left, c.top, c.width, c.height, c.opacity, c.transform, c.backgroundColor, c.visibility].join('|'); }),
        caps: [...document.querySelectorAll('.caption')].map(c => getComputedStyle(c).visibility + getComputedStyle(c).opacity + [...c.querySelectorAll('.w>span')].map(w => w.style.transform).join()),
      }));
      for (const t of [4.35, 10.4, 14.25, 18.45, 21.45, 26.7]) {
        await page.evaluate(() => window.seekFilm(29.9)); await page.evaluate(t => window.seekFilm(t), t); const a = await state();
        await page.evaluate(() => window.seekFilm(.5)); await page.evaluate(t => window.seekFilm(t), t); const b = await state();
        if (a !== b) throw new Error('Non-deterministic seek at ' + t);
      }
      console.log('Deterministic forward and backward seeks verified at six beats.');
      await page.goto(url); await page.evaluate(() => window.filmReady);
      await page.click('#play'); await page.waitForTimeout(200); await page.click('#play');
      if (await page.evaluate(() => film.time()) <= 0) throw new Error('Play did not advance');
      await page.locator('#seek').evaluate(el => { el.value = 18; el.dispatchEvent(new Event('input')); });
      if (Math.abs(await page.evaluate(() => film.time()) - 18) > .01) throw new Error('Seek failed');
      console.log('Preview play/pause/seek verified.');
    } else {
      const frames = Math.round(info.duration * CAPTURE_FPS);
      const picture = resolve(output, 'picture-v5.mp4');
      const vf = "tmix=frames=2:weights='1 1',select='mod(n\\,2)',setpts=N/(30*TB),scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p";
      const args = ['-y', '-hide_banner', '-loglevel', 'warning', '-f', 'image2pipe', '-framerate', String(CAPTURE_FPS), '-vcodec', 'mjpeg', '-i', 'pipe:0', '-an', '-vf', vf, '-r', String(FPS), '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', picture];
      encoder = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
      const completed = new Promise((res, rej) => { encoder.on('error', rej); encoder.on('exit', c => c === 0 ? res() : rej(new Error(`FFmpeg exited ${c}`))); });
      let encoderError; completed.catch(e => { encoderError = e; }); encoder.stdin.on('error', e => { encoderError = e; });
      for (let f = 0; f < frames; f++) {
        if (encoderError) throw encoderError;
        await page.evaluate(t => window.seekFilm(t), f / CAPTURE_FPS);
        const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
        if (!encoder.stdin.write(buf)) await once(encoder.stdin, 'drain');
        if (f % 300 === 0) console.log(`Captured ${f}/${frames} (${(f / CAPTURE_FPS).toFixed(0)}s)`);
      }
      encoder.stdin.end(); await completed;
      console.log(`Captured ${frames} frames at ${CAPTURE_FPS} fps; blended to ${FPS} fps.`);
      await stat(resolve(output, 'soundtrack-v5.wav'));
      const mux = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'warning', '-i', picture, '-i', resolve(output, 'soundtrack-v5.wav'), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=9', '-ar', '48000', '-t', String(info.duration), '-movflags', '+faststart', resolve(output, basename + '.mp4')], { stdio: 'inherit' });
      const [code] = await once(mux, 'exit'); if (code !== 0) throw new Error('Audio mux failed');
      console.log(`Finished output/${basename}.mp4`);
    }
    if (errors.length) throw new Error('Browser errors: ' + errors.join('; '));
    await writeFile(resolve(output, 'v5-' + mode + '-verification.json'), JSON.stringify({ mode, ...info, browserErrors: errors, verifiedAt: new Date().toISOString() }, null, 2));
  } finally {
    if (encoder && !encoder.killed && encoder.exitCode === null) encoder.kill();
    await browser?.close(); server.close();
  }
}
