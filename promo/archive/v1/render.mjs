import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';

const root = dirname(fileURLToPath(import.meta.url));
const output = resolve(root, 'output');
await mkdir(output, {recursive:true});
const mode = process.argv.includes('--preview') ? 'preview' : process.argv.includes('--stills') ? 'stills' : 'render';
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.wav':'audio/wav','.mp4':'video/mp4','.png':'image/png','.jpg':'image/jpeg'};
const server = createServer(async (req,res)=>{
  try {
    const name = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const path = resolve(root, '.' + (name==='/'?'/index.html':name));
    if(!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    const file = await readFile(path);
    res.writeHead(200, {'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(file);
  } catch {res.writeHead(404);res.end('Not found');}
});
server.listen(mode==='preview'?5188:0,'127.0.0.1');await once(server,'listening');
const url=`http://127.0.0.1:${server.address().port}`;
if(mode==='preview'){console.log(`Promo preview: ${url}`);}else{
  let browser, encoder;
  const errors=[];
  try{
    browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--hide-scrollbars']});
    const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url+'/?render=1');
    await page.evaluate(()=>window.filmReady);
    const info=await page.evaluate(()=>({duration:film.duration(),version:gsap.version,scenes:document.querySelectorAll('.scene').length}));
    if(info.duration!==40||info.scenes!==8)throw new Error('Unexpected timeline: '+JSON.stringify(info));
    console.log(JSON.stringify(info));
    if(mode==='stills'){
      for(const [name,t] of [['01-intro',2],['02-drop',4.5],['03-build',12],['04-swarm',17],['05-friction',22.5],['06-recommend',27],['07-retest',34.8],['08-outro',38.6]]){
        await page.evaluate(t=>window.seekFilm(t),t);
        await page.screenshot({path:resolve(output,name+'.png')});
        console.log(`Captured ${name} at ${t}s`);
      }
      // Confirm the preview can navigate backward, reset, play, pause, and seek.
      await page.goto(url);await page.evaluate(()=>window.filmReady);
      await page.click('#play');await page.waitForTimeout(150);await page.click('#play');
      const moving=await page.evaluate(()=>film.time());if(moving<=0)throw new Error('Play did not advance');
      await page.locator('#seek').evaluate(el=>{el.value=22;el.dispatchEvent(new Event('input'));});
      if(Math.abs(await page.evaluate(()=>film.time())-22)>.01)throw new Error('Seek failed');
      await page.click('#replay');await page.waitForTimeout(100);await page.click('#play');
      if(await page.evaluate(()=>film.time())>1)throw new Error('Replay failed');
      console.log('Preview play/pause/seek/replay verified.');
    } else {
      const args=['-y','-hide_banner','-loglevel','warning','-f','image2pipe','-framerate','30','-vcodec','mjpeg','-i','pipe:0','-an','-vf','scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p','-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',resolve(output,'picture.mp4')];
      encoder=spawn('ffmpeg',args,{stdio:['pipe','inherit','inherit']});
      const completed=new Promise((resolve,reject)=>{encoder.on('error',reject);encoder.on('exit',code=>code===0?resolve():reject(new Error(`FFmpeg exited ${code}`)));});
      // Handle a failed encoder immediately, without an unhandled promise rejection.
      let encoderError;completed.catch(e=>{encoderError=e;});
      encoder.stdin.on('error',e=>{encoderError=e;});
      for(let frame=0;frame<1200;frame++){
        if(encoderError)throw encoderError;
        await page.evaluate(t=>window.seekFilm(t),frame/30);
        const buffer=await page.screenshot({type:'jpeg',quality:96});
        if(!encoder.stdin.write(buffer))await once(encoder.stdin,'drain');
        if(frame%120===0)console.log(`Rendered ${frame}/1200 frames (${(frame/30).toFixed(0)}s)`);
      }
      encoder.stdin.end();await completed;
      console.log('Rendered 1200/1200 frames.');
      await stat(resolve(output,'soundtrack.wav'));
      const mux=spawn('ffmpeg',['-y','-hide_banner','-loglevel','warning','-i',resolve(output,'picture.mp4'),'-i',resolve(output,'soundtrack.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-af','loudnorm=I=-18:TP=-1.5:LRA=9','-ar','48000','-t','40','-movflags','+faststart',resolve(output,'ghostloop-promo.mp4')],{stdio:'inherit'});
      const [code]=await once(mux,'exit');if(code!==0)throw new Error('Audio mux failed');
      console.log('Finished output/ghostloop-promo.mp4');
    }
    if(errors.length)throw new Error('Browser errors: '+errors.join('; '));
    await writeFile(resolve(output,mode+'-verification.json'),JSON.stringify({mode,...info,browserErrors:errors,verifiedAt:new Date().toISOString()},null,2));
  }finally{
    if(encoder&&!encoder.killed&&encoder.exitCode===null)encoder.kill();
    await browser?.close();server.close();
  }
}
