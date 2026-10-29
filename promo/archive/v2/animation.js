/* GhostLoop v2: one continuous object journey, driven by a deterministic GSAP timeline. */
const $=s=>document.querySelector(s);
const renderMode=new URLSearchParams(location.search).has('render');
if(renderMode)document.documentElement.classList.add('render');
window.FILM_DURATION=32;
window.FILM_BEATS=['drop','build','personalities','vortex','friction','recommend','retest','brand'];
window.REVIEW_FRAMES=[['01-drop',1.1],['02-impact',2.45],['03-build',4.15],['04-ready',6.5],['05-personalities',9.1],['06-orbit',11],['07-enter',12.8],['08-friction',17.5],['09-fixes',20.6],['10-retest',24.2],['11-result',26.8],['12-brand',30.5]];
$('.crate-icon').innerHTML=ghost();$('.outro-ghost').innerHTML=ghost();
$('#approve-pointer').innerHTML=pointer();$('#app-cursor').innerHTML=pointer();
const captions=[['Drop your code.',.15,2.5],['We’ll <em>build it.</em>',2.8,4.65],['Ready to test.',4.9,7.2],['Meet your <em>testers.</em>',7.55,10.1,'light'],['Let them loose.',10.4,13.8,'light'],['Find the <em>friction.</em>',14.6,19],['Make it clearer.',19.3,22.9],['Run it again.',23.2,25.2],['Less friction.',25.5,28.2]];
$('#captions').innerHTML=captions.map(([text],i)=>`<div class="caption ${captions[i][3]||''}" id="cap${i}"><span>${text}</span></div>`).join('');
$('#build-particles').innerHTML=Array.from({length:20},(_,i)=>`<div class="particle p${i}"></div>`).join('');
const starts=[
 [580,635,1.35,'curious'],[960,660,1.35,'impatient'],[1340,635,1.35,'cautious'],
 [270,460,.64,'neutral'],[1640,460,.65,'curious'],[350,800,.7,'impatient'],[1570,800,.65,'cautious'],
 [550,300,.48,'neutral'],[1370,290,.55,'impatient'],[220,650,.48,'cautious'],[1700,650,.54,'neutral'],[1110,900,.6,'curious']
];
const models=starts.map(([x,y,size,kind])=>({x,y,size,kind,scale:0,alpha:0,rot:0,swirl:0}));
$('#swarm').innerHTML=models.map((m,i)=>`<div class="ghost g${i}">${ghost(m.kind)}<div class="ghost-trail"></div></div>`).join('');
$('#personality-labels').innerHTML=['Curious','Speedy','Careful'].map((n,i)=>`<div class="personality-label label${i}" style="left:${starts[i][0]}px">${n}</div>`).join('');
$('#runners').innerHTML=['curious','impatient','cautious'].map((k,i)=>`<div class="runner runner${i}">${ghost(k)}</div>`).join('');
const tl=gsap.timeline({paused:true,defaults:{ease:'power3.out'}});window.film=tl;
const chapter=(name,t)=>tl.addLabel(name,t);
chapter('drop',0);chapter('build',3.7);chapter('personalities',7.5);chapter('vortex',10.2);chapter('friction',14.5);chapter('recommend',19.3);chapter('retest',23.2);chapter('brand',28.5);
// Explicit start values also make backward seeking deterministic.
tl.set('.personality-label',{autoAlpha:0},0).set('.runner',{autoAlpha:0},0).set('.particle',{opacity:0},0);
captions.forEach(([text,start,end],i)=>{
 tl.fromTo('#cap'+i,{autoAlpha:0,y:105,rotation:2},{autoAlpha:1,y:0,rotation:0,duration:.65,ease:'expo.out'},start)
 .to('#cap'+i,{y:-110,autoAlpha:0,duration:.35,ease:'power3.in'},end-.35);
});
// Anticipation → drop → compression → rebound.
tl.fromTo('#file',{x:-470,y:-70,rotation:-32,scale:.82,opacity:0},{x:0,y:0,rotation:-9,scale:1,opacity:1,duration:1.0,ease:'back.out(1.3)'},.05)
 .fromTo('#crate-back,#housing',{y:150,opacity:0},{y:0,opacity:1,duration:.8,ease:'back.out(1.2)'},.25)
 .fromTo('#floor-shadow',{scale:.3,opacity:0},{scale:1,opacity:1,duration:.8},.25)
 .to('#file',{y:-45,rotation:8,duration:.38,ease:'power2.out'},1.25)
 .to('#file',{y:390,scale:.43,rotation:-3,duration:.72,ease:'power3.in'},1.7)
 .to('#file',{opacity:0,duration:.12},2.42)
 .to('#housing,#crate-back',{scaleX:1.07,scaleY:.9,duration:.16,ease:'power2.out'},2.4)
 .to('#housing,#crate-back',{scaleX:1,scaleY:1,duration:.75,ease:'elastic.out(1,.35)'},2.56)
 .fromTo('#impact-ring',{scale:.3,opacity:.7},{scale:1.2,opacity:0,duration:.8},2.42)
 .to('.flap-left',{rotation:-45,duration:.18,yoyo:true,repeat:1},2.42)
 .to('.flap-right',{rotation:45,duration:.18,yoyo:true,repeat:1},2.42)
 .to('.build-dots i',{y:-9,stagger:.12,duration:.2,yoyo:true,repeat:3,ease:'sine.inOut'},2.65)
 .to('#housing',{rotation:2,duration:.1,yoyo:true,repeat:5,ease:'sine.inOut'},3.05)
 .to('#floor-shadow',{scaleX:1.8,scaleY:1.25,opacity:.4,duration:1.15},3.6);
for(let i=0;i<20;i++){
 const angle=i*Math.PI*2/20;
 tl.fromTo('.p'+i,{x:0,y:0,scale:.3,opacity:0,rotation:0},{x:Math.cos(angle)*(250+(i%4)*80),y:Math.sin(angle)*220-80,scale:1,opacity:1,rotation:i*27,duration:.6,ease:'power3.out'},3.5+(i%3)*.025)
 .to('.p'+i,{x:Math.cos(angle)*80,y:-80,scale:0,opacity:0,duration:.6,ease:'power2.in'},4.05+(i%3)*.025);
}
// The same housing stretches into the actual application; no slide replacement.
tl.to('#crate-face',{scale:.6,opacity:0,duration:.35},3.65)
 .to('#crate-back',{scaleX:.5,scaleY:.1,opacity:0,y:30,duration:.45},3.65)
 .to('#housing',{left:400,top:280,width:1120,height:620,borderRadius:25,backgroundColor:'#fffdf5',rotation:0,duration:1.15,ease:'expo.inOut'},3.75)
 .to('#app',{opacity:1,duration:.45},4.45)
 .from('.chrome',{y:-50,duration:.7,ease:'back.out(1.3)'},4.45)
 .from('.app-nav',{x:-180,duration:.8,ease:'expo.out'},4.5)
 .set('.account',{autoAlpha:1},4.5)
 .from('.account>*',{y:80,scale:.8,opacity:0,stagger:.055,duration:.55,ease:'back.out(1.25)'},4.6)
 .to('#app-cursor',{opacity:1,duration:.2},5.1)
 .to('#app-cursor',{scale:.8,duration:.1,yoyo:true,repeat:1},5.35)
 .to('.account',{x:-80,autoAlpha:0,duration:.26},5.5)
 .fromTo('.team',{x:100,autoAlpha:0},{x:0,autoAlpha:1,duration:.4,ease:'power3.out'},5.55)
 .to('.nav-active',{y:52,duration:.4,ease:'back.out(1.4)'},5.55)
 .to('#app-cursor',{y:-70,duration:.35},5.6)
 .to('#app-cursor',{scale:.8,duration:.1,yoyo:true,repeat:1},5.95)
 .to('.team',{x:-80,autoAlpha:0,duration:.26},6.15)
 .fromTo('.plans',{x:100,autoAlpha:0},{x:0,autoAlpha:1,duration:.4},6.2)
 .to('.nav-active',{y:104,duration:.4,ease:'back.out(1.4)'},6.2)
 .from('.plan-card',{y:60,scale:.85,stagger:.1,duration:.55,ease:'back.out(1.3)'},6.2)
 .to('#app-cursor',{opacity:0,duration:.2},6.3)
 .from('.chrome-check',{scale:0,duration:.5,ease:'back.out(2)'},6.5);
// Change the stage lighting and let the characters take over.
tl.to('#night-bloom',{scale:1,duration:.95,ease:'power3.inOut'},7.15)
 .to('#housing',{scale:.72,y:25,rotation:0,duration:1,ease:'power3.inOut'},7.3)
 .to('#floor-shadow',{opacity:0,duration:.4},7.2);
models.forEach((m,i)=>{
 const start=7.65+(i<3?i*.3:1.05+(i-3)*.08);
 tl.fromTo(m,{scale:0,alpha:0,y:starts[i][1]+150,rot:i%2?-20:20},{scale:m.size,alpha:1,y:starts[i][1],rot:0,duration:i<3?.75:.6,ease:'back.out(1.9)'},start);
 if(i<3){
  tl.fromTo('.label'+i,{y:15,autoAlpha:0},{y:0,autoAlpha:1,duration:.35},start+.55);
  tl.to(m,{rot:i===1?-11:6,y:starts[i][1]-12,duration:i===1?.18:.4,yoyo:true,repeat:i===1?3:1,ease:'sine.inOut'},start+.78);
 }
});
tl.to('.personality-label',{autoAlpha:0,y:-15,duration:.3},9.9)
 .to('#vortex',{opacity:1,duration:.6},10)
 .fromTo('#portal',{autoAlpha:0,scale:.1},{autoAlpha:1,scale:1,duration:.8,ease:'back.out(1.3)'},10.35)
 .to('#portal',{rotation:240,duration:3.5,ease:'none'},10.3)
 .to('.vr1',{rotation:12,strokeDashoffset:-550,transformOrigin:'50% 50%',duration:3.7,ease:'power1.inOut'},10.1)
 .to('.vr2',{rotation:-9,strokeDashoffset:450,transformOrigin:'50% 50%',duration:3.7,ease:'power1.inOut'},10.1)
 .to('.vr3',{rotation:15,strokeDashoffset:-650,transformOrigin:'50% 50%',duration:3.7,ease:'power1.inOut'},10.1);
models.forEach((m,i)=>{
 const start=10.1+i*.055;
 tl.to(m,{swirl:1,duration:3.5-i*.025,ease:'power2.inOut'},start);
});
tl.to('#vortex',{scale:.2,opacity:0,duration:.6,ease:'power3.in'},13.55)
 .to('#portal',{scale:.08,autoAlpha:0,duration:.45,ease:'power3.in'},13.9)
 .to('#housing',{scale:1.1,y:0,duration:1.15,ease:'expo.inOut'},14)
 .to('#night-bloom',{scale:0,duration:1.1,ease:'power3.inOut'},14.05);
// Inside the app: characters physically hesitate and bounce at friction.
tl.fromTo('.runner0',{x:140,y:220,scale:.4,autoAlpha:0},{x:220,y:240,scale:1,autoAlpha:1,duration:.65},14.6)
 .fromTo('.runner1',{x:200,y:200,scale:.4,autoAlpha:0},{x:560,y:350,scale:1,autoAlpha:1,duration:.8},14.75)
 .fromTo('.runner2',{x:150,y:260,scale:.4,autoAlpha:0},{x:800,y:420,scale:.9,autoAlpha:1,duration:1},14.9)
 .to('#bad-route',{opacity:.7,duration:.7},15.3)
 .to('.runner0',{x:420,y:340,rotation:12,duration:.8,ease:'power2.inOut'},15.4)
 .to('.runner0',{x:390,y:315,rotation:-12,duration:.3,ease:'back.out(2)'},16.2)
 .to('.runner1',{x:770,y:350,rotation:-10,duration:.6,ease:'power3.in'},15.9)
 .to('.runner1',{x:710,y:330,rotation:13,duration:.3,ease:'back.out(2)'},16.5)
 .to('.runner2',{x:810,y:415,rotation:-13,duration:.4,yoyo:true,repeat:3,ease:'sine.inOut'},16.2)
 .fromTo('.pin1',{scale:0,opacity:0},{scale:1,opacity:1,duration:.45,ease:'back.out(2)'},16.15)
 .fromTo('.pin2',{scale:0,opacity:0},{scale:1,opacity:1,duration:.45,ease:'back.out(2)'},16.5)
 .fromTo('.pin3',{scale:0,opacity:0},{scale:1,opacity:1,duration:.45,ease:'back.out(2)'},16.8)
 .to('.runner0',{x:410,y:330,rotation:0,duration:.5,yoyo:true,repeat:2,ease:'sine.inOut'},17)
 .to('.runner1',{x:740,y:340,rotation:-5,duration:.3,yoyo:true,repeat:3,ease:'sine.inOut'},17.2);
// Findings become compact edits, then fly directly into the controls they change.
tl.to('#housing',{scale:.9,y:-35,duration:.8,ease:'power3.inOut'},19.05)
 .to('.runner',{scale:.6,autoAlpha:0,duration:.4},19.1)
 .to('#bad-route',{opacity:0,duration:.4},19.1)
 .fromTo('.fix-one',{x:30,y:-90,scale:.6,opacity:0},{x:0,y:0,scale:1,opacity:1,duration:.75,ease:'back.out(1.4)'},19.5)
 .fromTo('.fix-two',{x:-30,y:-90,scale:.6,opacity:0},{x:0,y:0,scale:1,opacity:1,duration:.75,ease:'back.out(1.4)'},19.7)
 .to('#approve',{opacity:1,duration:.4},20.5)
 .to('#approve-pointer',{opacity:1,x:-240,y:-75,duration:.65},20.9)
 .to('#approve',{scale:.94,backgroundColor:'#5a8252',duration:.13,yoyo:true,repeat:1},21.65)
 .to('#approve-pointer',{scale:.8,duration:.13,yoyo:true,repeat:1},21.65)
 .to('.fix-one',{x:10,y:-300,scale:.5,opacity:0,duration:.65,ease:'power3.inOut'},21.95)
 .to('.fix-two',{x:-350,y:-240,scale:.4,opacity:0,duration:.65,ease:'power3.inOut'},22.05)
 .to('.plan-old,.old-cta,.second-old,.free-link',{autoAlpha:0,y:-12,duration:.25},22.3)
 .fromTo('.plan-new,.new-cta,.second-new',{y:12,autoAlpha:0},{y:0,autoAlpha:1,duration:.4},22.4)
 .to('.plan-one',{backgroundColor:'#e6efda',borderColor:'#91af77',scale:1.035,duration:.3,yoyo:true,repeat:1},22.35)
 .to('.plan-one .plan-button',{backgroundColor:'#4f7d45',duration:.4},22.45)
 .to('.plan-two .plan-button',{backgroundColor:'#e9eddf',color:'#819471',duration:.4},22.45)
 .to('.pin1,.pin2',{scale:1.4,backgroundColor:'#aacb8a',opacity:0,duration:.45},22.5)
 .to('#approve,#approve-pointer',{opacity:0,duration:.3},22.65);
// A clean path through the same screen, with the same three testers.
tl.to('#housing',{scale:1,y:-10,duration:.7,ease:'power3.inOut'},23.15)
 .to('.pin3',{scale:.7,opacity:.45,duration:.4},23.2)
 .to('#good-route',{opacity:.6,duration:.5},23.35);
['.runner0','.runner1','.runner2'].forEach((sel,i)=>{
 const start=23.5+i*.22;
 tl.fromTo(sel,{x:120,y:415,scale:.7,autoAlpha:0,rotation:-8},{x:230,y:405,scale:.85,autoAlpha:1,rotation:0,duration:.45},start)
 .to(sel,{x:450,y:300,rotation:10,duration:.65,ease:'sine.inOut'},start+.45)
 .to(sel,{x:760,y:300,rotation:-5,duration:.65,ease:'sine.inOut'},start+1.1)
 .to(sel,{x:880,y:300,scale:.3,autoAlpha:0,duration:.4,ease:'power2.in'},start+1.75);
});
tl.to('#good-route',{strokeDashoffset:-160,duration:3.4,ease:'none'},23.4)
 .fromTo('#success',{autoAlpha:0,scale:.92},{autoAlpha:1,scale:1,duration:.5},26)
 .from('#success>span',{scale:0,duration:.55,ease:'back.out(2)'},26)
 .fromTo('#score',{y:45,scale:.7,opacity:0},{y:0,scale:1,opacity:1,duration:.65,ease:'back.out(1.5)'},25.7)
 .from('.score-after',{scale:1.8,opacity:0,duration:.6},26)
 .to('#demo-note',{opacity:1,duration:.3},25.7);
// The app contracts into the brand's ghost: one final match transformation.
tl.to('#score,#demo-note',{opacity:0,y:20,duration:.3},28)
 .to('#housing',{scale:.05,rotation:9,y:-30,opacity:0,duration:.8,ease:'expo.inOut'},28.25)
 .set('#outro',{autoAlpha:1},28.65)
 .fromTo('.outro-ghost',{scale:.1,y:60,rotation:-15},{scale:1,y:0,rotation:0,duration:.8,ease:'back.out(1.6)'},28.65)
 .fromTo('.outro-word',{y:50,opacity:0},{y:0,opacity:1,duration:.65,ease:'expo.out'},29.05)
 .fromTo('.outro-tag',{y:25,opacity:0},{y:0,opacity:1,duration:.6},29.3)
 .fromTo('.outro-orbit',{scale:.2,opacity:0},{scale:1,opacity:.35,duration:1.1},28.7)
 .to('.outro-ghost',{y:-10,rotation:3,duration:.8,yoyo:true,repeat:1,ease:'sine.inOut'},30.1);
tl.set({}, {},32);
// Swirl: angular motion accelerates while radius and scale contract into the screen.
// Every position derives from timeline-owned model values, so scrubbing and exports match.
function drawSwarm(){
 models.forEach((m,i)=>{
  const p=m.swirl, cx=960,cy=575, aspect=.52;
  let x=m.x,y=m.y,scale=m.scale,rot=m.rot,alpha=m.alpha;
  if(p>0){
   const dx=m.x-cx,dy=(m.y-cy)/aspect;
   const r=Math.hypot(dx,dy),a=Math.atan2(dy,dx);
   const radius=r*Math.pow(1-p,.8),angle=a+p*Math.PI*2*(1.35+(i%3)*.15);
   x=cx+Math.cos(angle)*radius;y=cy+Math.sin(angle)*radius*aspect;
   scale=m.scale*Math.pow(1-p,.65);rot=m.rot+Math.sin(angle)*18+p*35;
   alpha=m.alpha*Math.min(1,(1-p)*8);
  }
  gsap.set('.g'+i,{x:x-100,y:y-105,scale,rotation:rot,opacity:alpha,zIndex:Math.round(y)});
 });
}
const audio=$('#audio'),play=$('#play'),seek=$('#seek'),sound=$('#sound');
function update(){drawSwarm();const t=tl.time();seek.value=t;$('#time').textContent=`0:${String(Math.floor(t)).padStart(2,'0')} / 0:32`;if(t>=32){play.textContent='Play';audio.pause();}}
tl.eventCallback('onUpdate',update);tl.pause(0);update();
function fit(){if(!renderMode)$('#stage').style.transform=`scale(${Math.min(innerWidth/1920,(innerHeight-70)/1080)})`;}
addEventListener('resize',fit);fit();
async function start(){if(tl.time()>=32)tl.time(0);audio.currentTime=tl.time();audio.muted=!sound.checked;if(sound.checked)audio.play().catch(()=>{});tl.play();play.textContent='Pause';}
play.onclick=()=>{if(tl.paused()||tl.time()>=32)start();else{tl.pause();audio.pause();play.textContent='Play';}};
$('#replay').onclick=()=>{tl.pause(0);start();};seek.oninput=()=>{tl.pause(Number(seek.value));audio.pause();audio.currentTime=tl.time();play.textContent='Play';};
sound.onchange=()=>{audio.muted=!sound.checked;if(sound.checked&&!tl.paused()){audio.currentTime=tl.time();audio.play().catch(()=>{});}};
window.seekFilm=t=>{tl.pause(Math.min(32,Math.max(0,t)),false);update();};
window.filmReady=document.fonts.ready.then(()=>true);
