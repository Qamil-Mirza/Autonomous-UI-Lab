// GhostLoop launch film renderer: serves the stage locally, seeks the GSAP timeline at exact frame times,
// pipes frames into FFmpeg, and muxes the synthesized score. Modes: --preview, --stills, (default) render.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';

const root = dirname(fileURLToPath(import.meta.url));
const output = resolve(root, 'output');
const FPS = 30;
const basename = 'ghostloop-launch';
await mkdir(output, { recursive: true });
const mode = process.argv.includes('--preview') ? 'preview' : process.argv.includes('--stills') ? 'stills' : 'render';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const file = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(file);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(mode === 'preview' ? 5189 : 0, '127.0.0.1'); await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}`;
if (mode === 'preview') { console.log(`Launch film preview: ${url}`); } else {
  let browser, encoder;
  const errors = [];
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--hide-scrollbars'] });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url + '/?render=1');
    await page.evaluate(() => window.filmReady);
    const info = await page.evaluate(() => ({ duration: film.duration(), version: gsap.version, beats: window.FILM_BEATS.length, captions: document.querySelectorAll('.caption').length, testers: document.querySelectorAll('.tester').length, images: [...document.images].filter(i => !i.naturalWidth).map(i => i.src) }));
    if (info.duration !== 71 || info.beats !== 12 || info.testers !== 3 || info.images.length) throw new Error('Unexpected stage: ' + JSON.stringify(info));
    console.log(JSON.stringify(info));
    const frameCount = Math.round(info.duration * FPS);
    if (mode === 'stills') {
      const stills = resolve(output, 'stills'); await mkdir(stills, { recursive: true });
      for (const [name, t] of await page.evaluate(() => window.REVIEW_FRAMES)) {
        await page.evaluate(t => window.seekFilm(t), t);
        await page.screenshot({ path: resolve(stills, name + '.png') });
        console.log(`Captured ${name} at ${t}s`);
      }
      // Story checks: one caption at a time, cursor hits on real controls, deterministic backward seeks.
      const checks = await page.evaluate(() => {
        const out = { captionOverlaps: [], hits: {} };
        for (let t = 0; t < window.FILM_DURATION; t += .25) { seekFilm(t); const visible = [...document.querySelectorAll('.caption')].filter(el => getComputedStyle(el).visibility !== 'hidden' && +getComputedStyle(el).opacity > .05); if (visible.length > 1) out.captionOverlaps.push(t); }
        const hit = (cursor, box, t) => { seekFilm(t); const c = document.querySelector(cursor).getBoundingClientRect(); const r = document.querySelector(box).getBoundingClientRect(); return c.left + 4 >= r.left && c.left + 4 <= r.right && c.top + 3 >= r.top && c.top + 3 <= r.bottom; };
        out.hits.start = hit('#cur-setup', '#ring-start', 16.95);
        out.hits.review = hit('#cur-rec', '#ring-review', 42.5);
        out.hits.test = hit('#cur-review', '#ring-test', 48.3);
        seekFilm(15.5); out.typed = document.querySelector('#task-text').textContent.length > 40;
        seekFilm(53.9); out.stat = document.querySelector('#stat-b').textContent;
        seekFilm(69.6); out.end = getComputedStyle(document.querySelector('#end')).visibility === 'visible';
        return out;
      });
      if (checks.captionOverlaps.length || !checks.hits.start || !checks.hits.review || !checks.hits.test || !checks.typed || checks.stat !== '66.7%' || !checks.end) throw new Error('Story checks failed: ' + JSON.stringify(checks));
      console.log('Caption isolation, cursor targets, typing, count-up, and end card verified.');
      await page.evaluate(() => window.seekFilm(26.4)); const first = await page.screenshot({ type: 'png' });
      await page.evaluate(() => window.seekFilm(3)); await page.evaluate(() => window.seekFilm(26.4)); const again = await page.screenshot({ type: 'png' });
      if (!first.equals(again)) throw new Error('Non-deterministic backward seek');
      console.log('Deterministic seek verified.');
      await page.goto(url); await page.evaluate(() => window.filmReady);
      await page.click('#play'); await page.waitForTimeout(150); await page.click('#play');
      if (await page.evaluate(() => film.time()) <= 0) throw new Error('Play did not advance');
      await page.locator('#seek').evaluate(el => { el.value = 40; el.dispatchEvent(new Event('input')); });
      if (Math.abs(await page.evaluate(() => film.time()) - 40) > .01) throw new Error('Seek failed');
      console.log('Preview play/pause/seek verified.');
    } else {
      const args = ['-y', '-hide_banner', '-loglevel', 'warning', '-f', 'image2pipe', '-framerate', '30', '-vcodec', 'mjpeg', '-i', 'pipe:0', '-an', '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', resolve(output, 'picture.mp4')];
      encoder = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
      const completed = new Promise((res, rej) => { encoder.on('error', rej); encoder.on('exit', code => code === 0 ? res() : rej(new Error(`FFmpeg exited ${code}`))); });
      let encoderError; completed.catch(e => { encoderError = e; }); encoder.stdin.on('error', e => { encoderError = e; });
      for (let frame = 0; frame < frameCount; frame++) {
        if (encoderError) throw encoderError;
        await page.evaluate(t => window.seekFilm(t), frame / FPS);
        const buffer = await page.screenshot({ type: 'jpeg', quality: 96 });
        if (!encoder.stdin.write(buffer)) await once(encoder.stdin, 'drain');
        if (frame % 150 === 0) console.log(`Rendered ${frame}/${frameCount} frames (${(frame / FPS).toFixed(0)}s)`);
      }
      encoder.stdin.end(); await completed;
      console.log(`Rendered ${frameCount}/${frameCount} frames.`);
      await stat(resolve(output, 'score.wav'));
      const mux = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'warning', '-i', resolve(output, 'picture.mp4'), '-i', resolve(output, 'score.wav'), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=9', '-ar', '48000', '-t', String(info.duration), '-movflags', '+faststart', resolve(output, basename + '.mp4')], { stdio: 'inherit' });
      const [code] = await once(mux, 'exit'); if (code !== 0) throw new Error('Audio mux failed');
      console.log(`Finished output/${basename}.mp4`);
    }
    if (errors.length) throw new Error('Browser errors: ' + errors.join('; '));
    await writeFile(resolve(output, mode + '-verification.json'), JSON.stringify({ mode, ...info, browserErrors: errors, verifiedAt: new Date().toISOString() }, null, 2));
  } finally {
    if (encoder && !encoder.killed && encoder.exitCode === null) encoder.kill();
    await browser?.close(); server.close();
  }
}
