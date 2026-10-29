import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';

const root = dirname(fileURLToPath(import.meta.url));
const output = resolve(root, 'output');
const FPS=30;
const basename='ghostloop-promo-v4';
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
    const info=await page.evaluate(()=>({duration:film.duration(),version:gsap.version,beats:window.FILM_BEATS.length,ghosts:document.querySelectorAll('#swarm .ghost').length}));
    if(info.duration!==32||info.beats!==8||info.ghosts!==12)throw new Error('Unexpected timeline: '+JSON.stringify(info));
    console.log(JSON.stringify(info));
    const frameCount=Math.round(info.duration*FPS);
    if(mode==='stills'){
      const stills=resolve(output,'v4-stills');await mkdir(stills,{recursive:true});
      for(const [name,t] of await page.evaluate(()=>window.REVIEW_FRAMES)){
        await page.evaluate(t=>window.seekFilm(t),t);
        await page.screenshot({path:resolve(stills,name+'.png')});
        console.log(`Captured ${name} at ${t}s`);
      }
      const uploadChecks=await page.evaluate(()=>{
        seekFilm(1.05);
        const cursor=document.querySelector('#upload-pointer').getBoundingClientRect();
        const button=document.querySelector('#choose-file').getBoundingClientRect();
        const hit=cursor.x+5>button.left&&cursor.x+5<button.right&&cursor.y+5>button.top&&cursor.y+5<button.bottom;
        seekFilm(2.1);const progress=+gsap.getProperty('#upload-progress','scaleX');
        seekFilm(3.1);const complete=getComputedStyle(document.querySelector('#uploaded-label')).visibility==='visible'&&+getComputedStyle(document.querySelector('.upload-check')).opacity>.9;
        return {hit,progress,complete,oldBoxRemoved:!document.querySelector('#crate-back')&&!document.querySelector('#file')};
      });
      if(!uploadChecks.hit||uploadChecks.progress<=0||uploadChecks.progress>=1||!uploadChecks.complete||!uploadChecks.oldBoxRemoved)throw new Error('Upload checks failed: '+JSON.stringify(uploadChecks));
      console.log('Upload click, partial progress, completion, and box removal verified.');
      const emotionChecks=await page.evaluate(()=>{
        const opacity=s=>+getComputedStyle(document.querySelector(s)).opacity;
        seekFilm(15.8);const initiallyHappy=[0,1,2].every(i=>getComputedStyle(document.querySelector('.runner'+i+' .runner-angry')).visibility==='hidden');
        seekFilm(17.6);const allAngry=[0,1,2].every(i=>opacity('.runner'+i+' .runner-happy')===0&&opacity('.runner'+i+' .runner-angry')===1);
        seekFilm(24.2);const happyAgain=[0,1,2].every(i=>opacity('.runner'+i+' .runner-happy')===1&&opacity('.runner'+i+' .runner-angry')===0);
        const noPins=[...document.querySelectorAll('.friction-pin')].every(el=>+getComputedStyle(el).opacity===0);
        const zero=document.querySelector('.score-after').textContent==='0';
        return {initiallyHappy,allAngry,happyAgain,noPins,zero};
      });
      if(Object.values(emotionChecks).some(v=>!v))throw new Error('Emotion/result checks failed: '+JSON.stringify(emotionChecks));
      console.log('Angry collision faces, happy retest, and zero remaining friction verified.');
      // Verify deterministic seeks and the one-caption-at-a-time constraint.
      await page.evaluate(()=>window.seekFilm(11));
      const first=await page.screenshot({type:'png'});
      await page.evaluate(()=>window.seekFilm(1));
      await page.evaluate(()=>window.seekFilm(11));
      const repeated=await page.screenshot({type:'png'});
      if(!first.equals(repeated))throw new Error('Non-deterministic backward seek at vortex');
      const captionErrors=await page.evaluate(()=>{
        const errors=[];
        for(let t=0;t<32;t+=.2){seekFilm(t);const visible=[...document.querySelectorAll('.caption')].filter(el=>getComputedStyle(el).visibility!=='hidden'&&+getComputedStyle(el).opacity>.05);if(visible.length>1)errors.push(t);}
        seekFilm(14.4);
        if([...document.querySelectorAll('#swarm .ghost')].some(el=>+getComputedStyle(el).opacity>.01))errors.push('ghosts failed to enter screen');
        return errors;
      });
      if(captionErrors.length)throw new Error('Story checks: '+JSON.stringify(captionErrors));
      console.log('Deterministic vortex seek, caption isolation, and swarm entry verified.');
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
      const args=['-y','-hide_banner','-loglevel','warning','-f','image2pipe','-framerate','30','-vcodec','mjpeg','-i','pipe:0','-an','-vf','scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p','-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',resolve(output,'picture-v4.mp4')];
      encoder=spawn('ffmpeg',args,{stdio:['pipe','inherit','inherit']});
      const completed=new Promise((resolve,reject)=>{encoder.on('error',reject);encoder.on('exit',code=>code===0?resolve():reject(new Error(`FFmpeg exited ${code}`)));});
      // Handle a failed encoder immediately, without an unhandled promise rejection.
      let encoderError;completed.catch(e=>{encoderError=e;});
      encoder.stdin.on('error',e=>{encoderError=e;});
      for(let frame=0;frame<frameCount;frame++){
        if(encoderError)throw encoderError;
        await page.evaluate(t=>window.seekFilm(t),frame/FPS);
        const buffer=await page.screenshot({type:'jpeg',quality:96});
        if(!encoder.stdin.write(buffer))await once(encoder.stdin,'drain');
        if(frame%120===0)console.log(`Rendered ${frame}/${frameCount} frames (${(frame/FPS).toFixed(0)}s)`);
      }
      encoder.stdin.end();await completed;
      console.log(`Rendered ${frameCount}/${frameCount} frames.`);
      await stat(resolve(output,'soundtrack-v3.wav'));
      const mux=spawn('ffmpeg',['-y','-hide_banner','-loglevel','warning','-i',resolve(output,'picture-v4.mp4'),'-i',resolve(output,'soundtrack-v3.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-af','loudnorm=I=-18:TP=-1.5:LRA=9','-ar','48000','-t',String(info.duration),'-movflags','+faststart',resolve(output,basename+'.mp4')],{stdio:'inherit'});
      const [code]=await once(mux,'exit');if(code!==0)throw new Error('Audio mux failed');
      console.log('Finished output/ghostloop-promo-v4.mp4');
    }
    if(errors.length)throw new Error('Browser errors: '+errors.join('; '));
    await writeFile(resolve(output,'v4-'+mode+'-verification.json'),JSON.stringify({mode,...info,browserErrors:errors,verifiedAt:new Date().toISOString()},null,2));
  }finally{
    if(encoder&&!encoder.killed&&encoder.exitCode===null)encoder.kill();
    await browser?.close();server.close();
  }
}
