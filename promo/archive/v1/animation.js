/* GhostLoop product film — all motion is driven by one seekable GSAP timeline. */
const $ = s => document.querySelector(s);
const renderMode = new URLSearchParams(location.search).has('render');
if(renderMode) document.documentElement.classList.add('render');
const colors = {curious:'#c9b9e8', impatient:'#f29788', cautious:'#c2d7a8', neutral:'#fffdf4'};
function ghost(kind='neutral', mood='happy') {
  const body=colors[kind]||colors.neutral;
  const eyes = mood==='confused' ? '<path d="M73 93l13 4m27-4l13-4" stroke="#25392d" stroke-width="5" stroke-linecap="round"/><ellipse cx="81" cy="111" rx="6" ry="8" fill="#25392d"/><ellipse cx="121" cy="108" rx="6" ry="8" fill="#25392d"/><path d="M94 135q8-7 15 0" fill="none" stroke="#25392d" stroke-width="4" stroke-linecap="round"/>' : '<ellipse cx="80" cy="105" rx="7" ry="10" fill="#25392d"/><ellipse cx="121" cy="105" rx="7" ry="10" fill="#25392d"/><circle cx="82" cy="102" r="2" fill="white"/><circle cx="123" cy="102" r="2" fill="white"/><path d="M94 130q8 8 16 0" fill="none" stroke="#25392d" stroke-width="4" stroke-linecap="round"/>';
  let accessory='';
  if(kind==='curious') accessory='<path d="M58 54q42-47 83 0" fill="#6d5b93"/><path d="M40 55h119q3 10-8 10H50q-12 0-10-10" fill="#82709e"/><path d="M96 29v20" stroke="#a896c5" stroke-width="5"/>';
  if(kind==='impatient') accessory='<path d="M41 77q0-49 60-49t60 49" fill="none" stroke="#874a46" stroke-width="10"/><rect x="31" y="72" width="18" height="39" rx="9" fill="#874a46"/><rect x="151" y="72" width="18" height="39" rx="9" fill="#874a46"/><path d="M107 38l-16 21h13l-8 17 22-24h-14l10-14" fill="#f6d377"/>';
  if(kind==='cautious') accessory='<g fill="none" stroke="#496343" stroke-width="4"><circle cx="79" cy="106" r="18"/><circle cx="122" cy="106" r="18"/><path d="M97 104h7M61 101l-14-5m93 5l13-5"/></g>';
  return `<svg viewBox="0 0 200 210" xmlns="http://www.w3.org/2000/svg"><path d="M35 184V103C35 59 60 35 101 35s64 25 64 68v81q-11 14-22 0t-21 0t-22 0t-22 0t-22 0t-21 0Z" fill="${body}" stroke="#243c2d" stroke-width="3"/><path d="M37 132q-27 16-23 34q4 13 23-1m127-33q26 16 22 34q-4 13-22-1" fill="${body}" stroke="#243c2d" stroke-width="3"/><path d="M53 92q4-27 25-34" fill="none" stroke="#ffffff75" stroke-width="8" stroke-linecap="round"/>${eyes}<ellipse cx="62" cy="125" rx="10" ry="7" fill="#ed8380" opacity=".8"/><ellipse cx="140" cy="125" rx="10" ry="7" fill="#ed8380" opacity=".8"/>${accessory}</svg>`;
}
function pointer(color='#172c26'){return `<svg viewBox="0 0 40 48"><path d="M4 3v36l10-10 8 15 8-5-8-14 14-2Z" fill="${color}" stroke="#fffdf4" stroke-width="2.8" stroke-linejoin="round"/></svg>`;}
function gh(cls,kind,x,y,size=160,mood='happy',name=''){return `<div class="ghost ${cls}" style="left:${x}px;top:${y}px;width:${size}px;height:${size}px">${ghost(kind,mood)}${name?`<div class="ghost-name">${name}</div>`:''}</div>`;}
function heading(n,k,title,subtitle=''){return `<div class="heading"><div class="kicker"><span class="number">${n}</span>${k}</div><h1>${title}</h1>${subtitle?`<p>${subtitle}</p>`:''}</div>`;}
function nav(active=2){return `<aside class="app-nav"><div class="app-logo">coor<span class="coral">.</span></div>${['Account','Workspace','Plan','Finish'].map((x,i)=>`<div class="nav-item ${active===i?'active':''}" data-nav="${i}"><span class="nav-num">${i+1}</span>${x}</div>`).join('')}</aside>`;}
function chrome(status='LIVE PREVIEW'){return `<div class="browser-chrome"><i></i><i></i><i></i><span class="browser-url">coor.app / onboarding</span><span class="status">● ${status}</span></div>`;}
function plans(improved=false){return `<div class="app-eyebrow">STEP 03 / YOUR PLAN</div><h3>Make room for your ideas.</h3><p>A workspace that grows with you.</p><div class="plan-row">${improved?`<div class="plan-card free"><h4>Free</h4><strong>$0</strong><small> / forever</small><p>Everything you need to begin.</p><div class="app-button free-cta">Continue with Free <span>→</span></div></div><div class="plan-card"><h4>Pro</h4><strong>$18</strong><small> / month</small><p>More power for growing teams.</p><div class="app-button secondary">Explore Pro <span>↗</span></div></div>`:`<div class="plan-card featured"><h4>Pro</h4><strong>$18</strong><small> / month</small><p>More power for growing teams.</p><div class="app-button vague-cta">Continue <span>→</span></div></div><div class="plan-card"><h4>Business</h4><strong>$39</strong><small> / month</small><p>Built for bigger ambitions.</p><div class="app-button">Continue <span>→</span></div></div>`}</div>${improved?'':'<div class="hidden-free">or keep using the free version</div>'}`;}
function browser(cls,inside,active=2,status='LIVE PREVIEW'){return `<div class="browser ${cls}">${chrome(status)}<div class="app-body">${nav(active)}<div class="app-main">${inside}</div></div></div>`;}
const sceneHTML=[
`<section class="scene" id="intro"><div class="hero-copy"><div class="pill">MEET YOUR PRE-LAUNCH TEST TEAM</div><h1>Your app.<br>A little <span class="coral">haunted.</span><br>A lot better.</h1><p>Meet the ghosts who find friction<br>before your users do.</p></div><div class="hero-art"><div class="orbit one"></div><div class="orbit two"></div>${gh('hero-ghost','neutral',80,80,380)}<span class="star" style="left:12px;top:45px">✳</span><span class="star" style="left:480px;top:310px;font-size:34px">✦</span><div class="mini-badge">Your first user says hello.</div></div></section>`,
`<section class="scene" id="drop">${heading('01','BRING YOUR BUILD','Good testing starts<br>with <span class="coral">your code.</span>')}<div class="code-card"><div class="file-head"><div class="file-icon">&lt;/&gt;</div>signup.tsx</div><div class="code-lines"><i>export default</i> App() {<br>&nbsp; return (<br>&nbsp;&nbsp; &lt;<b>Onboarding</b><br>&nbsp;&nbsp;&nbsp; steps={flow}<br>&nbsp;&nbsp; /&gt;<br>&nbsp; );<br>}</div><div class="file-foot">YOUR FRONTEND · READY TO EXPLORE</div></div><div class="connector">⟶</div><div class="drop-zone"><div class="drop-symbol">↓</div><h2>Drop into GhostLoop</h2><p>From source code to a testable experience.</p><div class="drop-complete"><div>✓</div><strong>Code received.</strong><span>Building your interactive preview</span></div></div><div class="drop-status">✓ Code received. Building your preview.</div><div class="pointer drop-pointer" style="left:515px;top:698px">${pointer()}</div>${gh('drop-ghost','neutral',1630,650,155)}</section>`,
`<section class="scene" id="build">${heading('02','MAKE IT REAL','An app they can<br><span class="coral">actually use.</span>')}<div class="build-notes"><div class="build-note"><span class="tick">✓</span>Frontend assembled</div><div class="build-note"><span class="tick">✓</span>Navigation connected</div><div class="build-note"><span class="tick">✓</span>Ready for real interactions</div></div>${browser('build-browser',`<div class="page-screen account-screen"><div class="app-eyebrow">STEP 01 / YOUR ACCOUNT</div><h3>A fresh start.</h3><p>Good work starts with a little space.</p><div class="app-field">Alex Ghost<span>✓</span></div><div class="app-field">alex@example.com<span>✓</span></div><div class="app-button">Create account <span>→</span></div></div><div class="page-screen workspace-screen"><div class="app-eyebrow">STEP 02 / YOUR WORKSPACE</div><h3>Make it yours.</h3><p>Give your team a place to begin.</p><div class="app-field">The Ghost Studio<span>✓</span></div><div class="app-field">ghost-studio.coor.app<span>↗</span></div><div class="app-button">Create workspace <span>→</span></div></div><div class="page-screen plan-screen">${plans()}</div>`,0)}<div class="build-label"><b>INTERACTIVE PREVIEW</b>Account → Workspace → Plan</div><div class="pointer build-pointer" style="left:1190px;top:790px">${pointer()}</div></section>`,
`<section class="scene" id="swarm">${heading('03','SUMMON THE SWARM','Different minds.<br><span class="coral">One mission.</span>')}<div class="agent-counter"><strong>12</strong><small>AGENTS EXPLORING</small></div><svg class="trail-svg"><path class="trail t1" stroke="#9981c4" d="M315 505C500 330 550 560 765 655S1090 570 1255 800"/><path class="trail t2" stroke="#d8756b" d="M1610 500C1450 600 1430 800 1030 743"/><path class="trail t3" stroke="#7c9c68" d="M1510 900C1260 1000 1040 850 875 700"/></svg>${browser('swarm-browser',plans())}${gh('swarm-ghost curious','curious',210,450,170,'happy','Curious<small>“What does this do?”</small>')}${gh('swarm-ghost impatient','impatient',1510,405,170,'happy','Impatient<small>“Let’s go already.”</small>')}${gh('swarm-ghost cautious','cautious',1480,760,150,'happy','Cautious<small>“Wait. Is this free?”</small>')}<div class="speech speech-one" style="left:170px;top:370px">I’ll try every path.</div><div class="speech speech-two" style="left:1410px;top:330px">Where’s the next step?</div>${[[365,740],[185,795],[410,310],[1450,655],[1700,680],[1570,185],[300,890],[1730,850],[1360,275]].map(([x,y],i)=>gh('mini-ghost extra-'+i,['curious','neutral','impatient','cautious'][i%4],x,y,60)).join('')}<div class="pointer agent-pointer-one" style="left:875px;top:710px">${pointer('#9981c4')}</div><div class="pointer agent-pointer-two" style="left:1200px;top:760px">${pointer('#d8756b')}</div></section>`,
`<section class="scene" id="friction">${heading('04','FOLLOW THE HESITATION','See where they<br><span class="coral">get stuck.</span>')}${browser('report-browser',plans(),2,'FRICTION DETECTED')}<div class="issue-marker mark-one" style="left:993px;top:810px">1</div><div class="issue-marker mark-two" style="left:550px;top:735px">2</div><div class="issue-marker mark-three" style="left:870px;top:735px">3</div>${gh('confused-ghost','cautious',870,260,140,'confused')}<div class="speech friction-speech" style="left:1030px;top:285px">I just want the free plan.</div><div class="report-panel"><div class="panel-eyebrow">FRICTION REPORT<span class="count-badge">3 points found</span></div><div class="issue-row"><span class="issue-num">1</span><div><h4>The free plan is hard to find.</h4><p>The lowest-risk choice gets overlooked.</p><small>CAUTIOUS · PLAN SELECTION</small></div></div><div class="issue-row"><span class="issue-num">2</span><div><h4>“Continue” leaves questions.</h4><p>Agents hesitate before committing.</p><small>CURIOUS · PRIMARY ACTION</small></div></div><div class="issue-row"><span class="issue-num">3</span><div><h4>Two actions compete.</h4><p>Attention splits. The next step gets lost.</p><small>IMPATIENT · DECISION POINT</small></div></div><div class="demo-label">Illustrative demo · sample findings</div></div></section>`,
`<section class="scene" id="recommend">${heading('05','TURN INSIGHT INTO ACTION','Don’t just find friction.<br><span class="coral">Know what to change.</span>')}<div class="recommendations"><article class="rec-card"><div class="rec-top"><div class="rec-icon">◉</div><span class="rec-type">01 / VISIBILITY</span></div><h3>Put Free<br>in plain sight.</h3><p>Bring the free plan into the main comparison.</p><div class="rec-diff"><del>Buried text link</del><strong>↳ A visible Free plan card</strong></div></article><article class="rec-card"><div class="rec-top"><div class="rec-icon">↗</div><span class="rec-type">02 / CLARITY</span></div><h3>Say exactly<br>what comes next.</h3><p>Make the button describe the choice agents are making.</p><div class="rec-diff"><del>“Continue”</del><strong>↳ “Continue with Free”</strong></div></article><article class="rec-card"><div class="rec-top"><div class="rec-icon">✳</div><span class="rec-type">03 / HIERARCHY</span></div><h3>Give one action<br>the spotlight.</h3><p>A clear primary action helps the next step stand out.</p><div class="rec-diff"><del>Two competing actions</del><strong>↳ One confident next step</strong></div></article></div><div class="approve-wrap"><span class="approve-note">You stay in control.</span><div class="approve-button"><span>✓</span>Approve & apply</div></div><div class="pointer approve-pointer" style="left:1750px;top:980px">${pointer()}</div></section>`,
`<section class="scene" id="retest">${heading('06','CLOSE THE LOOP','Small changes.<br><span class="coral">Smoother journeys.</span>')}${browser('retest-browser',`<div class="improved-plans">${plans(true)}</div><div class="plan-chosen"><div class="success-check">✓</div><h3>You’re in. Keep creating.</h3><p>Your Free workspace is ready.</p><div class="pill">NO TRIAL. NO SURPRISES.</div></div>`,2,'<span class="status-running">RETEST IN PROGRESS</span><span class="status-done" style="display:none">RETEST COMPLETE</span>')}<div class="results"><div class="label">FRICTION POINTS</div><div class="result-numbers"><span class="before">3</span><span class="arrow">→</span><span class="after">1</span></div><h3>Less friction. More flow.</h3><div class="bar-label"><span>Before</span><span>3 points</span></div><div class="bar before"><span></span></div><div class="bar-label"><span>After</span><span>1 point</span></div><div class="bar after"><span></span></div><div class="result-verdict">↘ <span>Two friction points resolved</span></div><span class="demo-label">Illustrative demo · sample results</span></div><div class="retest-note"><span></span>Changes applied → same mission → tested again</div>${gh('retest-ghost rg-one','curious',225,770,95)}${gh('retest-ghost rg-two','impatient',335,790,90)}${gh('retest-ghost rg-three','cautious',430,780,100)}<div class="pointer retest-pointer" style="left:700px;top:870px">${pointer('#659160')}</div><div class="speech retest-speech" style="left:930px;top:310px">That’s the one.</div></section>`,
`<section class="scene" id="outro"><div class="orbit end-orbit"></div><div class="end-card"><div class="end-wordmark"><span class="brand-icon"></span>GhostLoop<span class="coral" style="margin-left:-25px">.</span></div><h2>Your first users,<br><span class="coral">before your first real user.</span></h2><div class="end-pill">BUILD. TEST. LEARN. LOOP.</div></div>${gh('end-ghost end-one','curious',340,340,150)}${gh('end-ghost end-two','impatient',1470,355,150)}${gh('end-ghost end-three','cautious',1190,780,125)}<span class="star end-star" style="left:550px;top:770px">✳</span><span class="star end-star" style="left:1320px;top:230px">✦</span></section>`
];
$('#scenes').innerHTML=sceneHTML.join('');
document.querySelectorAll('.brand-icon').forEach(el=>el.innerHTML=ghost());
$('.chapter-dots').innerHTML=Array.from({length:6},(_,i)=>`<span class="chapter-dot d${i}"></span>`).join('');
const tl=gsap.timeline({paused:true,defaults:{ease:'power3.out'}});
window.film=tl; window.FILM_DURATION=40;
const scenes=[['intro',0,3.2],['drop',3.2,8.2],['build',8.2,13.2],['swarm',13.2,19.2],['friction',19.2,24.2],['recommend',24.2,29.2],['retest',29.2,36.2],['outro',36.2,40]];
scenes.forEach(([id,start,end],i)=>{
 tl.set('#'+id,{autoAlpha:1},start);
 if(i)tl.fromTo('#'+id,{opacity:0,y:25},{opacity:1,y:0,duration:.42},start);
 if(i<scenes.length-1)tl.to('#'+id,{opacity:0,y:-18,duration:.24},end-.24).set('#'+id,{visibility:'hidden'},end);
 const heads=document.querySelectorAll('#'+id+' .heading>*');
 if(heads.length)tl.from(heads,{y:30,opacity:0,stagger:.08,duration:.65},start+.12);
 if(i>0&&i<7){tl.to('.chapter-dot',{backgroundColor:'#d6ddd3',width:22,duration:.2},start);tl.to('.d'+(i-1),{backgroundColor:'#d87873',width:40,duration:.2},start);}
});
tl.from('.hero-copy>*',{y:40,opacity:0,stagger:.11,duration:.75},.12)
 .from('.hero-ghost',{y:100,rotation:-12,scale:.65,opacity:0,duration:1.1,ease:'back.out(1.4)'},.15)
 .from('.hero-art .orbit',{scale:.7,opacity:0,stagger:.1,duration:1.2},.2)
 .from('.mini-badge',{y:25,opacity:0,duration:.6},1)
 .to('.hero-ghost',{y:-18,rotation:4,duration:1.3,ease:'sine.inOut'},1.4)
 .from('.hero-art .star',{scale:0,rotation:-90,stagger:.2,duration:.8,ease:'back.out(2)'},.6);
// File hand-off: tangible drag, drop, and confirmation.
tl.from('.code-card',{x:-150,y:80,rotation:-13,opacity:0,duration:.85},3.45)
 .from('.drop-zone',{scale:.93,opacity:0,duration:.65},3.5)
 .from('.connector',{x:-30,opacity:0,duration:.5},3.9)
 .from('.drop-ghost',{y:80,opacity:0,rotation:12,duration:.7},3.7)
 .from('.drop-pointer',{opacity:0,duration:.3},4)
 .to('.code-card',{x:630,y:15,rotation:7,scale:.76,duration:1.5,ease:'power2.inOut'},4.65)
 .to('.drop-pointer',{x:630,y:15,duration:1.5,ease:'power2.inOut'},4.65)
 .to('.drop-zone',{borderColor:'#56834d',backgroundColor:'#e2ecd7',duration:.3},6.1)
 .to('.drop-zone>*',{opacity:0,duration:.2},5.9)
 .to('.code-card',{scale:.35,opacity:0,y:40,duration:.55,ease:'power3.in'},6.25)
 .to('.drop-pointer',{opacity:0,duration:.3},6.3)
 .fromTo('.drop-status',{opacity:0,y:15},{opacity:1,y:0,duration:.5},6.6)
 .fromTo('.drop-complete',{opacity:0,scale:.8},{opacity:1,scale:1,duration:.5},6.7)
 .to('.drop-ghost',{y:-25,rotation:-7,duration:.7},6.6);
// A working navigation sequence, including three distinct pages.
tl.from('.build-browser',{scale:.82,x:100,y:50,opacity:0,duration:.85},8.35)
 .from('.build-note',{x:-35,opacity:0,stagger:.4,duration:.5},8.7)
 .from('.build-label',{opacity:0,duration:.4},9)
 .set('.account-screen',{autoAlpha:1},8.3)
 .from('.build-pointer',{opacity:0,duration:.2},9)
 .to('.build-pointer',{x:-55,y:-65,duration:.55},9.1)
 .to('.build-pointer',{scale:.8,duration:.1,yoyo:true,repeat:1},9.65)
 .set('.account-screen',{autoAlpha:0},9.9).set('.workspace-screen',{autoAlpha:1},9.9)
 .to('.build-browser [data-nav="0"]',{backgroundColor:'transparent',color:'#899182',duration:.2},9.9)
 .to('.build-browser [data-nav="1"]',{backgroundColor:'#e6ecdf',color:'#264e38',duration:.2},9.9)
 .from('.workspace-screen>*',{y:12,opacity:0,stagger:.05,duration:.3},9.9)
 .to('.build-pointer',{x:-30,y:-65,duration:.4},10.6)
 .to('.build-pointer',{scale:.8,duration:.1,yoyo:true,repeat:1},11)
 .set('.workspace-screen',{autoAlpha:0},11.25).set('.plan-screen',{autoAlpha:1},11.25)
 .to('.build-browser [data-nav="1"]',{backgroundColor:'transparent',color:'#899182',duration:.2},11.25)
 .to('.build-browser [data-nav="2"]',{backgroundColor:'#e6ecdf',color:'#264e38',duration:.2},11.25)
 .from('.plan-screen>*',{y:12,opacity:0,stagger:.05,duration:.3},11.25)
 .to('.build-pointer',{opacity:0,duration:.3},12.25);
// Personified testers, each on a different path.
tl.from('.swarm-browser',{y:20,scale:1.04,opacity:0,duration:.6},13.25)
 .from('.swarm-ghost',{scale:0,rotation:-15,opacity:0,stagger:.3,duration:.8,ease:'back.out(1.7)'},13.5)
 .from('.mini-ghost',{scale:0,opacity:0,stagger:.08,duration:.7,ease:'back.out(1.5)'},14.4)
 .from('.agent-counter',{opacity:0,y:15,duration:.5},14)
 .from('.speech-one',{opacity:0,y:15,duration:.4},14.7)
 .from('.speech-two',{opacity:0,y:15,duration:.4},15.4)
 .from('.trail',{opacity:0,duration:1},14)
 .from('.agent-pointer-one,.agent-pointer-two',{opacity:0,duration:.4},14.7)
 .to('.agent-pointer-one',{x:340,y:100,duration:1.5,ease:'power1.inOut'},15)
 .to('.agent-pointer-two',{x:-270,y:-25,duration:1.2,ease:'power1.inOut'},15.2)
 .to('.agent-pointer-one',{x:200,y:-80,duration:1.2,ease:'power1.inOut'},16.6)
 .to('.agent-pointer-two',{x:-40,y:20,duration:1.1,ease:'power1.inOut'},16.5)
 .to('.curious',{y:-20,rotation:5,duration:1.3,yoyo:true,repeat:2,ease:'sine.inOut'},14.5)
 .to('.impatient',{y:15,x:-15,rotation:-8,duration:.55,yoyo:true,repeat:5,ease:'sine.inOut'},15)
 .to('.cautious',{y:-16,rotation:3,duration:1.4,yoyo:true,repeat:1,ease:'sine.inOut'},15.2)
 .to('.mini-ghost',{y:-20,stagger:.08,duration:1.3,yoyo:true,repeat:1,ease:'sine.inOut'},15);
// Trace observations into an actionable friction report.
tl.from('.report-browser',{x:60,opacity:0,duration:.6},19.3)
 .from('.report-panel .panel-eyebrow',{opacity:0,y:15,duration:.4},19.6)
 .from('.issue-row',{x:35,opacity:0,stagger:.55,duration:.55},20)
 .from('.issue-marker',{scale:0,opacity:0,stagger:.55,duration:.55,ease:'back.out(2)'},20)
 .from('.confused-ghost',{y:50,rotation:12,opacity:0,duration:.6},19.65)
 .from('.friction-speech',{y:15,opacity:0,duration:.4},20.3)
 .from('.report-panel .demo-label',{opacity:0,duration:.4},21.6)
 .to('.issue-marker',{boxShadow:'0 0 0 16px #f17d7e08',duration:.7,repeat:1,yoyo:true},22);
// Specific recommendations; approval is an explicit story beat.
tl.from('.rec-card',{y:80,rotation:2,opacity:0,stagger:.18,duration:.7},24.5)
 .from('.rec-diff',{y:10,opacity:0,stagger:.15,duration:.5},25.6)
 .from('.approve-wrap',{y:25,opacity:0,duration:.5},26.6)
 .from('.approve-pointer',{opacity:0,duration:.2},27)
 .to('.approve-pointer',{x:-95,y:-75,duration:.65},27.2)
 .to('.approve-button',{scale:.96,backgroundColor:'#3f6c45',duration:.15,yoyo:true,repeat:1},28)
 .to('.approve-pointer',{scale:.85,duration:.15,yoyo:true,repeat:1},28)
 .to('.rec-icon',{backgroundColor:'#d4e9c4',duration:.4},28.2);
// Same mission, clearer UI, observed improvement (illustrative).
tl.from('.retest-browser',{scale:.96,x:-30,opacity:0,duration:.65},29.35)
 .from('.improved-plans .plan-card',{y:20,opacity:0,stagger:.15,duration:.6},29.7)
 .from('.results .label,.result-numbers .before,.result-numbers .arrow',{opacity:0,y:15,stagger:.12,duration:.5},29.65)
 .from('.retest-ghost',{x:-100,opacity:0,stagger:.15,duration:.7},29.9)
 .from('.retest-note',{opacity:0,duration:.4},30)
 .from('.retest-pointer',{opacity:0,duration:.3},30.1)
 .to('.retest-pointer',{x:-70,y:-120,duration:.85,ease:'power2.inOut'},30.3)
 .from('.retest-speech',{opacity:0,y:10,duration:.4},30.9)
 .to('.free-cta',{scale:.96,duration:.12,yoyo:true,repeat:1},31.3)
 .to('.retest-pointer',{scale:.85,duration:.12,yoyo:true,repeat:1},31.3)
 .to('.improved-plans',{opacity:0,duration:.3},31.65)
 .fromTo('.plan-chosen',{autoAlpha:0,scale:.96},{autoAlpha:1,scale:1,duration:.5},31.8)
 .from('.success-check',{scale:0,duration:.55,ease:'back.out(2)'},31.9)
 .to('.retest-pointer',{opacity:0,duration:.25},31.7)
 .to('.retest-ghost',{x:330,y:15,scale:.85,rotation:8,stagger:.1,duration:1.1,ease:'power2.inOut'},31.9)
 .set('.status-running',{display:'none'},32.3).set('.status-done',{display:'inline'},32.3)
 .to('.retest-browser [data-nav="2"]',{backgroundColor:'transparent',color:'#899182',duration:.2},31.8)
 .to('.retest-browser [data-nav="3"]',{backgroundColor:'#e6ecdf',color:'#264e38',duration:.2},31.8)
 .from('.result-numbers .after',{scale:.6,opacity:0,y:25,duration:.7,ease:'back.out(1.7)'},32.3)
 .from('.results h3,.bar-label,.bar',{opacity:0,y:10,stagger:.08,duration:.45},32.5)
 .from('.bar span',{scaleX:0,duration:1,stagger:.2},32.7)
 .from('.result-verdict',{y:20,opacity:0,duration:.55},33.6)
 .from('.results .demo-label',{opacity:0,duration:.4},29.8)
 .to('.retest-ghost',{y:5,rotation:-4,duration:.8,yoyo:true,repeat:1,ease:'sine.inOut'},33.3);
// Signature hold.
tl.from('.end-wordmark',{y:40,opacity:0,duration:.8},36.4)
 .from('.end-card h2',{y:30,opacity:0,duration:.75},36.65)
 .from('.end-pill',{y:20,opacity:0,duration:.6},37.1)
 .from('.end-ghost',{scale:.3,opacity:0,rotation:-12,stagger:.13,duration:.8,ease:'back.out(1.5)'},36.5)
 .from('.end-orbit',{scale:.8,opacity:0,duration:1},36.4)
 .from('.end-star',{scale:0,rotation:-80,stagger:.2,duration:.7},37)
 .to('.end-ghost',{y:-14,rotation:4,duration:1.2,yoyo:true,repeat:1,ease:'sine.inOut'},37.4);
tl.fromTo('#film-progress',{scaleX:0},{scaleX:1,duration:40,ease:'none'},0);
// Timeline ends on the held end card, exactly at 40 seconds.
tl.set({}, {},40); tl.pause(0);
function fit(){if(!renderMode){const s=Math.min(innerWidth/1920,(innerHeight-70)/1080);$('#stage').style.transform=`scale(${s})`;}}
addEventListener('resize',fit);fit();
const audio=$('#audio'),play=$('#play'),seek=$('#seek'),sound=$('#sound');
function update(){const t=tl.time();seek.value=t;$('#time').textContent=`0:${String(Math.floor(t)).padStart(2,'0')} / 0:40`;if(t>=40){play.textContent='Play';audio.pause();}}
tl.eventCallback('onUpdate',update);
async function start(){if(tl.time()>=40)tl.time(0);audio.currentTime=tl.time();audio.muted=!sound.checked;if(sound.checked)audio.play().catch(()=>{});tl.play();play.textContent='Pause';}
play.onclick=()=>{if(tl.paused()||tl.time()>=40)start();else{tl.pause();audio.pause();play.textContent='Play';}};
$('#replay').onclick=()=>{tl.pause(0);start();};
seek.oninput=()=>{tl.pause(Number(seek.value));audio.pause();audio.currentTime=tl.time();play.textContent='Play';};
sound.onchange=()=>{audio.muted=!sound.checked;if(sound.checked&&!tl.paused()){audio.currentTime=tl.time();audio.play().catch(()=>{});}};
window.seekFilm=t=>{tl.pause(Math.min(40,Math.max(0,t)),false);update();};
window.filmReady=document.fonts.ready.then(()=>true);
