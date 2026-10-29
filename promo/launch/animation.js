/* GhostLoop launch film: one paused GSAP master timeline drives every frame (preview, scrubbing, and render agree). */
const $=s=>document.querySelector(s);
const renderMode=new URLSearchParams(location.search).has('render');
if(renderMode)document.documentElement.classList.add('render');
const DUR=71;
window.FILM_DURATION=DUR;
window.FILM_BEATS=['hook','problem','reveal','describe','simulate','watch','propose','approve','measure','figma','loop','end'];
window.REVIEW_FRAMES=[['01-hook',1.6],['02-nobody',5.4],['03-reveal',9.4],['04-describe',14.2],['05-start',16.9],['06-signup',20.4],['07-plan',26.4],['08-watch',31],['09-check',34.8],['10-propose',39.2],['11-approve',47.6],['12-measure',55],['13-figma',60.6],['14-loop',65.8],['15-end',69.6]];

// Element boxes recorded from the live product at 1440×900 (promo/launch/assets/ui/boxes.json).
const B=window.UI_BOXES;
const CAM={left:240,top:148,w:1440,h:944,chrome:44};

// ---------- Characters and pointers ----------
['#cur-setup','#cur-proto','#cur-runs','#cur-rec','#cur-review'].forEach(s=>$(s).innerHTML=pointer());
const testers=[['curious','happy'],['speedy','happy'],['careful','happy']];
$('#testers').innerHTML=testers.map(([k],i)=>`<div class="tester tester${i}" data-kind="${k}">${lineGhost(k)}</div>`).join('');
$('#runner').innerHTML=lineGhost('plain');

// ---------- Captions ----------
const captions=[
 ['Describe what a user <em>should be able to do.</em>',11.3,17.3],
 ['AI users try <em>your real app.</em> In a real browser.',18.4,24.8],
 ['Watch where they <em>get stuck.</em>',25.1,28.5],
 ['Every step <em>recorded.</em>',29.3,32.2],
 ['Success is checked from app state, <em>not the agent’s word.</em>',32.5,35.6],
 ['Finds the pattern. <em>Proposes one small change.</em>',36.4,43.2],
 ['<em>Nothing changes</em> until you approve it.',44.4,49.4],
 ['Retested under <em>the same task.</em>',50.4,53.6],
 ['<em>Measured,</em> not guessed.',53.9,57.4],
 ['Every tested version lands in <em>Figma.</em> Editable.',58.5,62.5,'light'],
];
$('#captions').innerHTML=captions.map(([t,,,c],i)=>`<div class="caption ${c||''}" id="cap${i}"><span>${t}</span></div>`).join('');

// ---------- Helpers ----------
const tl=gsap.timeline({paused:true,defaults:{ease:'power3.out'}});window.film=tl;
function caption(i){const [,a,b]=captions[i];tl.fromTo('#cap'+i,{autoAlpha:0,y:26},{autoAlpha:1,y:0,duration:.55,ease:'expo.out'},a).to('#cap'+i,{autoAlpha:0,y:-18,duration:.3,ease:'power2.in'},b);}
captions.forEach((_,i)=>caption(i));
function place(sel,box,pad=10){gsap.set(sel,{left:box.x-pad,top:box.y-pad,width:box.w+pad*2,height:box.h+pad*2});}
function center(box){return {x:box.x+box.w/2,y:box.y+box.h/2};}
// Camera: move a window so that a screen-space point lands on a stage target at a given scale.
function focus(win,point,scale,tx=960,ty=620){const px=point.x,py=point.y+CAM.chrome;const cx=CAM.left+CAM.w/2,cy=CAM.top+CAM.h/2;return {x:tx-cx-(px-CAM.w/2)*scale,y:ty-cy-(py-CAM.h/2)*scale,scale};}
const HOME={x:0,y:0,scale:.86};
function enter(win,at){tl.fromTo(win,{autoAlpha:0,y:90,scale:.8},{autoAlpha:1,y:0,scale:.86,duration:.8,ease:'expo.out'},at);}
function exit(win,at){tl.to(win,{autoAlpha:0,y:-70,scale:.8,duration:.45,ease:'power2.in'},at);}
function cam(win,point,scale,at,dur=1.1,tx,ty){tl.to(win,{...focus(win,point,scale,tx,ty),duration:dur,ease:'power2.inOut'},at);}
function move(cursor,box,at,dur=.6,dx=0,dy=0){const c=center(box);tl.to(cursor,{left:c.x+dx-4,top:c.y+dy-3,duration:dur,ease:'power2.inOut'},at);}
function click(win,cursor,box,at){const c=center(box);const el=document.createElement('div');el.className='click';el.style.left=c.x+'px';el.style.top=c.y+'px';$(win+' .overlay').appendChild(el);
 tl.to(cursor,{scale:.85,duration:.08,yoyo:true,repeat:1},at).fromTo(el,{opacity:1,scale:.4},{opacity:0,scale:3.2,duration:.5,ease:'power2.out'},at+.05);}
function ring(sel,at,hold=1.6){tl.fromTo(sel,{autoAlpha:0,scale:1.25},{autoAlpha:1,scale:1,duration:.4,ease:'back.out(2)'},at).to(sel,{autoAlpha:0,duration:.25},at+hold);}
function typeText(sel,text,at,dur){const o={n:0};tl.to(o,{n:text.length,duration:dur,ease:'none',onUpdate(){$(sel).firstChild.textContent=text.slice(0,Math.round(o.n));}},at);}
const CURSOR_HIDE={autoAlpha:0,duration:.2};

// ---------- 0–11: Hook, problem, reveal ----------
tl.set('#t-hook',{autoAlpha:1},0)
 .from('#t-hook .w',{y:70,opacity:0,duration:.7,stagger:.09,ease:'expo.out'},.2)
 .to('#t-hook',{autoAlpha:0,y:-30,duration:.35,ease:'power2.in'},3.1)
 .set('#t-nobody',{autoAlpha:1},3.45)
 .from('#t-nobody .w',{y:70,opacity:0,duration:.7,stagger:.08,ease:'expo.out'},3.5)
 .set('#peek',{autoAlpha:1},4.1)
 .to('#peek',{x:0,rotation:-6,duration:1,ease:'back.out(1.4)'},4.1)
 .to('#peek',{rotation:-10,y:-8,duration:.5,yoyo:true,repeat:1,ease:'sine.inOut'},5.4)
 .to('#t-nobody',{autoAlpha:0,y:-30,duration:.35,ease:'power2.in'},6.7)
 .to('#peek',{x:520,rotation:-14,duration:.5,ease:'power2.in'},6.6);
// Reveal: wordmark letters rise, the "oo" loop draws itself, mascot settles.
tl.set('#reveal',{autoAlpha:1},7.1)
 .from('#wordmark .l',{y:90,opacity:0,duration:.8,stagger:.05,ease:'expo.out'},7.15)
 .fromTo('#loop-path',{strokeDasharray:700,strokeDashoffset:700},{strokeDashoffset:0,duration:1.05,ease:'power2.inOut'},7.45)
 .fromTo('#hero-ghost',{x:-200,y:60,rotation:-18,opacity:0},{x:0,y:0,rotation:0,opacity:1,duration:.9,ease:'back.out(1.3)'},7.5)
 .fromTo('#tagline',{opacity:0,y:24},{opacity:1,y:0,duration:.6},8.5)
 .to('#hero-ghost',{y:-12,rotation:3,duration:.7,yoyo:true,repeat:1,ease:'sine.inOut'},9.2)
 .to('#reveal',{autoAlpha:0,scale:.96,duration:.45,ease:'power2.in'},10.7);

// ---------- 11–18: Describe (dashboard setup) ----------
place('#ring-start',B['setupBottom.start'],8);
gsap.set('#task-cover',{left:B['setup.task'].x+1,top:B['setup.task'].y+1,width:B['setup.task'].w-2,height:B['setup.task'].h-2});
gsap.set('#cur-setup',{left:1100,top:600});
enter('#w-setup',11.05);
cam('#w-setup',{x:830,y:B['setup.task'].y+30},1.15,12.1,1,960,560);
tl.set('#task-cover',{opacity:1},12.2).to('#cur-setup',{autoAlpha:1,duration:.2},12.2);
typeText('#task-cover','Create an account, pick the Free plan, and invite one teammate without starting a paid trial.',12.7,3.1);
// The page scrolls to the Start button: swap to the scrolled capture and re-seat the typed task text.
tl.fromTo('#setup-bottom',{autoAlpha:0,y:160},{autoAlpha:1,y:0,duration:.5,ease:'power2.inOut'},15.9)
 .set('#task-cover',{top:B['setupBottom.task'].y+1},16.0)
 .to('#cur-setup',{top:B['setupBottom.task'].y+60,duration:.01},16.0);
cam('#w-setup',{x:900,y:B['setupBottom.start'].y-80},1.0,15.9,.9,960,600);
move('#cur-setup',B['setupBottom.start'],16.2,.7);
click('#w-setup','#cur-setup',B['setupBottom.start'],16.95);
ring('#ring-start',16.95,.7);
exit('#w-setup',17.6);

// ---------- 18–29: Simulate (Matrix Coor prototype) ----------
const sig=B;const typed=[['#ty-name','signup.name'],['#ty-email','signup.email'],['#ty-pass','signup.password'],['#ty-ws','workspace.name']];
typed.forEach(([s,k])=>gsap.set(s,{left:B[k].x+1,top:B[k].y,width:B[k].w-2,height:B[k].h}));
gsap.set('#chk-terms',{left:B['signup.terms'].x,top:B['signup.terms'].y});
place('#ring-trial',B['plan.proTrial'],8);place('#ring-free',B['plan.freeContinue'],8);
gsap.set('#tag-trial',{left:B['plan.proTrial'].x+150,top:B['plan.proTrial'].y-6});
gsap.set('#tag-careful',{left:B['plan.freeContinue'].x-300,top:B['plan.freeContinue'].y+50});
gsap.set('#think',{left:B['plan.freeContinue'].x-40,top:B['plan.freeContinue'].y-60});
gsap.set('#cur-proto',{left:700,top:700});
tl.set('#pg-signup',{autoAlpha:1},0);
enter('#w-proto',18.1);
// Three testers float in from the left edge of the screen and hover beside the form.
const hover=[[300,330],[250,470],[330,610]];
testers.forEach((_,i)=>{tl.fromTo('.tester'+i,{left:-160,top:hover[i][1]+40,opacity:0,rotation:-12},{left:hover[i][0],top:hover[i][1],opacity:1,rotation:0,duration:1,ease:'back.out(1.2)'},18.6+i*.18)
 .to('.tester'+i,{y:-10,duration:.9+i*.1,yoyo:true,repeat:5,ease:'sine.inOut'},19.6);});
cam('#w-proto',{x:720,y:470},1.0,18.9,1,960,600);
tl.to('#cur-proto',{autoAlpha:1,duration:.2},19.6);
move('#cur-proto',B['signup.name'],19.7,.5);tl.to('#ty-name',{opacity:1,duration:.15},20.2);
move('#cur-proto',B['signup.email'],20.4,.35);tl.to('#ty-email',{opacity:1,duration:.15},20.75);
move('#cur-proto',B['signup.password'],20.95,.3);tl.to('#ty-pass',{opacity:1,duration:.15},21.25);
move('#cur-proto',B['signup.terms'],21.4,.3);click('#w-proto','#cur-proto',B['signup.terms'],21.7);tl.to('#chk-terms',{opacity:1,duration:.1},21.72);
move('#cur-proto',B['signup.create'],21.85,.35);click('#w-proto','#cur-proto',B['signup.create'],22.25);
tl.set('#pg-workspace',{autoAlpha:1},22.4).to('.typed',{opacity:0,duration:.01},22.4).set('#chk-terms',{opacity:0},22.4)
 .from('#pg-workspace',{x:60,opacity:0,duration:.35,ease:'power2.out'},22.4);
move('#cur-proto',B['workspace.name'],22.6,.35);tl.to('#ty-ws',{opacity:1,duration:.15},23);
move('#cur-proto',B['workspace.continue'],23.1,.35);click('#w-proto','#cur-proto',B['workspace.continue'],23.5);
tl.set('#pg-plan',{autoAlpha:1},23.65).set('#ty-ws',{opacity:0},23.65).from('#pg-plan',{x:60,opacity:0,duration:.35,ease:'power2.out'},23.65)
 .to('#cur-proto',CURSOR_HIDE,23.9);
cam('#w-proto',{x:720,y:500},1.12,23.9,1,960,610);
// Two testers drift to the loud orange trial button; the careful one hesitates over Free.
const trial=center(B['plan.proTrial']),free=center(B['plan.freeContinue']);
tl.to('.tester0',{left:trial.x-150,top:trial.y-170,rotation:8,duration:1.3,ease:'power2.inOut'},24.3)
 .to('.tester1',{left:trial.x-10,top:trial.y-180,rotation:-6,duration:1.3,ease:'power2.inOut'},24.45)
 .to('.tester2',{left:free.x-180,top:free.y-160,rotation:-4,duration:1.2,ease:'power2.inOut'},24.6);
ring('#ring-trial',25.6,2.7);
tl.fromTo('#tag-trial',{autoAlpha:0,y:10},{autoAlpha:1,y:0,duration:.4},25.9)
 .fromTo('#think',{autoAlpha:0,scale:.4},{autoAlpha:1,scale:1,duration:.4,ease:'back.out(2)'},26.3)
 .fromTo('#tag-careful',{autoAlpha:0,y:10},{autoAlpha:1,y:0,duration:.4},26.5)
 .to('.tester1',{rotation:-14,x:6,duration:.12,yoyo:true,repeat:5,ease:'sine.inOut'},26.4);
tl.to('#tag-trial,#tag-careful,#think',{autoAlpha:0,duration:.25},28.3);
exit('#w-proto',28.55);

// ---------- 29–36: Watch (runs + check) ----------
place('#br-timeline',{x:B['runs.timeline'].x-14,y:B['runs.timeline'].y-12,w:B['runs.timeline'].w+28,h:260},0);
enter('#w-runs',29.05);
cam('#w-runs',{x:980,y:B['runs.replay'].y+200},1.05,29.9,1.1,960,600);
cam('#w-runs',{x:980,y:B['runs.timeline'].y+120},1.1,31.4,1.2,960,560);
tl.fromTo('#br-timeline',{autoAlpha:0},{autoAlpha:1,duration:.4},32.3).to('#br-timeline',{autoAlpha:0,duration:.3},34.0);
// Cut to the headline check: 50% · 2 of 4 trials reached the goal.
exit('#w-runs',33.75);
place('#ring-pct',{x:B['rec.pct'].x,y:B['rec.pct'].y,w:B['rec.pctCard'].x+B['rec.pctCard'].w-B['rec.pct'].x,h:B['rec.pct'].h},14);
enter('#w-rec',34.0);
tl.set('#w-rec',{...focus('#w-rec',{x:B['rec.pct'].x+330,y:B['rec.pct'].y+120},1.25,960,600)},34.0)
 .fromTo('#w-rec',{autoAlpha:0,scale:1.1},{autoAlpha:1,scale:1.25,duration:.6,ease:'expo.out'},34.0);
ring('#ring-pct',34.5,1.5);

// ---------- 36–44: Propose (recommendations) ----------
place('#br-suggest',{x:B['rec.suggest'].x-16,y:B['rec.suggest'].y-16,w:B['rec.why'].x+B['rec.why'].w-B['rec.suggest'].x+32,h:120},0);
place('#ring-review',B['rec.review'],8);
gsap.set('#cur-rec',{left:1000,top:800});
cam('#w-rec',{x:810,y:B['rec.title'].y+200},.95,36.1,1.2,960,600);
cam('#w-rec',{x:870,y:B['rec.suggest'].y+50},1.3,38.2,1.1,960,600);
tl.fromTo('#br-suggest',{autoAlpha:0},{autoAlpha:1,duration:.4},38.9).to('#br-suggest',{autoAlpha:0,duration:.3},41.2);
cam('#w-rec',{x:870,y:B['rec.review'].y-60},1.0,41.3,.9,960,640);
tl.to('#cur-rec',{autoAlpha:1,duration:.2},41.4);
move('#cur-rec',B['rec.review'],41.5,.8);
click('#w-rec','#cur-rec',B['rec.review'],42.5);ring('#ring-review',42.5,.7);
exit('#w-rec',43.4);

// ---------- 44–50: Approve (review) ----------
const brTop=B['review.suggestion'].y-26;
place('#br-change',{x:B['review.suggestion'].x-24,y:brTop,w:700,h:B['review.why'].y-brTop+60},0);
place('#ring-test',B['review.test'],8);
gsap.set('#cur-review',{left:900,top:800});
enter('#w-review',44.05);
cam('#w-review',{x:660,y:B['review.suggestion'].y+110},1.15,44.9,1.1,960,600);
tl.fromTo('#br-change',{autoAlpha:0},{autoAlpha:1,duration:.4},45.4).to('#br-change',{autoAlpha:0,duration:.3},46.9);
cam('#w-review',{x:B['review.test'].x+140,y:B['review.test'].y-60},1.2,47.0,1,960,600);
tl.to('#cur-review',{autoAlpha:1,duration:.2},47.2);
move('#cur-review',B['review.test'],47.3,.8);
click('#w-review','#cur-review',B['review.test'],48.3);ring('#ring-test',48.3,.9);
exit('#w-review',49.45);

// ---------- 50–58: Measure (results) ----------
place('#ring-result',{x:B['results.original'].x-16,y:B['results.original'].y-10,w:B['results.change'].x+B['results.change'].w-B['results.original'].x+32,h:B['results.pp'].y+B['results.pp'].h-B['results.original'].y+20},0);
enter('#w-results',50.05);
tl.to('#w-results',{...focus('#w-results',{x:620,y:B['results.title'].y+260},1.05,700,600),duration:1.1,ease:'power2.inOut'},50.9);
ring('#ring-result',51.6,5.6);
const stat={b:50,d:0};
tl.fromTo('#stat',{autoAlpha:0,y:40,scale:.92},{autoAlpha:1,y:0,scale:1,duration:.7,ease:'expo.out'},52.0)
 .to(stat,{b:66.7,d:16.7,duration:1.4,ease:'power2.out',onUpdate(){$('#stat-b').textContent=stat.b.toFixed(1).replace('.0','')+'%';$('#stat-d').textContent='+'+stat.d.toFixed(1)+' pp';}},52.5)
 .from('.stat-verdict',{opacity:0,x:-10,duration:.4},53.6)
 .to('#illustrative',{opacity:1,duration:.3},52.0)
 .to('#stat,#illustrative',{autoAlpha:0,y:-30,duration:.4,ease:'power2.in'},57.45);
exit('#w-results',57.5);

// ---------- 58–63: Figma ----------
tl.to('#dark',{opacity:1,duration:.5},58.0).to('#caption-band',{opacity:0,duration:.3},57.9).to('#caption-band',{opacity:1,duration:.3},62.9)
 .set('#figma',{autoAlpha:1},58.1)
 .fromTo('#figma .canvas',{opacity:0},{opacity:1,duration:.5},58.1)
 .fromTo('#figma .f-a',{y:60,opacity:0},{y:0,opacity:1,duration:.7,ease:'expo.out'},58.5)
 .fromTo('#figma .f-b',{y:60,opacity:0},{y:0,opacity:1,duration:.7,ease:'expo.out'},58.75)
 .fromTo('#figma .match',{opacity:0,y:20,scale:.9},{opacity:1,y:0,scale:1,duration:.5,ease:'back.out(1.6)'},60.0)
 .to('#figma',{autoAlpha:0,duration:.4},62.6)
 .to('#dark',{opacity:0,duration:.5},62.6);

// ---------- 63–71: The loop, then the mark ----------
const bigPath=$('#loop-big');const bigLen=bigPath.getTotalLength();
tl.set('#loop',{autoAlpha:1},63.0)
 .fromTo('#loop-big',{strokeDasharray:bigLen,strokeDashoffset:bigLen},{strokeDashoffset:0,duration:1.6,ease:'power2.inOut'},63.05);
['.w1','.w2','.w3','.w4','.w5','.w6'].forEach((w,i)=>tl.fromTo(w,{opacity:0,scale:.6},{opacity:1,scale:1,duration:.45,ease:'back.out(2)'},63.4+i*.33));
const run={p:0};
tl.to('#runner',{opacity:1,duration:.2},63.4)
 .to(run,{p:1,duration:3.2,ease:'power1.inOut',onUpdate(){const pt=bigPath.getPointAtLength(run.p*bigLen);const ahead=bigPath.getPointAtLength(Math.min(bigLen,run.p*bigLen+8));const ang=Math.atan2(ahead.y-pt.y,ahead.x-pt.x)*180/Math.PI;gsap.set('#runner',{x:pt.x,y:pt.y,rotation:ang*.2});}},63.4)
 .to('#loop',{autoAlpha:0,scale:.9,duration:.5,ease:'power2.in'},67.0)
 .set('#end',{autoAlpha:1},67.3)
 .from('#end-mark span',{y:80,opacity:0,duration:.8,stagger:.08,ease:'expo.out'},67.35)
 .fromTo('#end-tag',{opacity:0,y:20},{opacity:1,y:0,duration:.6},68.2)
 .fromTo('#end-note',{opacity:0},{opacity:1,duration:.5},68.8);
tl.set({},{},DUR);

// ---------- Preview controls ----------
const audio=$('#audio'),play=$('#play'),seek=$('#seek'),sound=$('#sound');
const fmt=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
function update(){const t=tl.time();seek.value=t;$('#time').textContent=`${fmt(t)} / ${fmt(DUR)}`;if(t>=DUR){play.textContent='Play';audio.pause();}}
tl.eventCallback('onUpdate',update);tl.pause(0);update();
function fit(){if(!renderMode)$('#stage').style.transform=`scale(${Math.min(innerWidth/1920,(innerHeight-70)/1080)})`;}
addEventListener('resize',fit);fit();
function start(){if(tl.time()>=DUR)tl.time(0);audio.currentTime=tl.time();audio.muted=!sound.checked;if(sound.checked)audio.play().catch(()=>{});tl.play();play.textContent='Pause';}
play.onclick=()=>{if(tl.paused()||tl.time()>=DUR)start();else{tl.pause();audio.pause();play.textContent='Play';}};
$('#replay').onclick=()=>{tl.pause(0);start();};
seek.oninput=()=>{tl.pause(Number(seek.value));audio.pause();audio.currentTime=tl.time();play.textContent='Play';};
sound.onchange=()=>{audio.muted=!sound.checked;if(sound.checked&&!tl.paused()){audio.currentTime=tl.time();audio.play().catch(()=>{});}};
window.seekFilm=t=>{tl.pause(Math.min(DUR,Math.max(0,t)),false);update();};
window.filmReady=Promise.all([document.fonts.ready,...[...document.images].map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=r;i.onerror=r;}))]).then(()=>true);
