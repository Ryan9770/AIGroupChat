(() => {
'use strict';
const $ = id => document.getElementById(id);
const canvas = $('world'), ctx = canvas.getContext('2d');
const T = 24, W = 30, H = 20;
const species = [
  {id:'slime',name:'물방울 슬라임',color:'#80cbd1',cost:1,x:10,y:7,description:'농장: 성장 ×2 · 동행: 개울 길 열기'},
  {id:'mole',name:'뿌리 두더지',color:'#bf9676',cost:2,x:20,y:11,description:'농장: 수확 +1 · 동행: 바위 깨기'},
  {id:'moth',name:'불씨 나방',color:'#efbd72',cost:3,x:24,y:3,description:'농장: 달빛꽃 재배 · 동행: 숲 밝히기'}
];
const plotPositions = [[5,10],[6,10],[7,10],[8,10],[5,12],[6,12],[7,12],[8,12]];
const keys = {}, particles = [];
let state, phase='title', last=performance.now(), accumulator=0, sound=false, audioContext, toastTimer=0, uiTimer=0, time=0;
function reset(){
  state={player:{x:6*T+12,y:14*T+12,facing:1,walk:0},roots:0,flowers:0,xp:0,seed:'root',friends:{},bridge:false,gate:false,lit:false,restored:false,elapsed:0,path:[],pending:null,harvests:0,interactions:0,plots:plotPositions.map(([x,y],i)=>({x,y,crop:i===0?'root':null,growth:i===0?1:0}))};
  particles.length=0; phase='title';$('start-screen').classList.remove('hidden');$('win-screen').classList.add('hidden');uiTimer=0;updateUI();
}
const atFarm = id => state.friends[id]==='farm';
const withFriend = id => state.friends[id]==='companion';
function terrain(x,y){
  if(x<0||y<0||x>=W||y>=H)return 'sea';
  if(x<2||x>27||y<2||y>17||((x<4||x>25)&&(y<4||y>15)))return 'sea';
  if(x===14&&y>=2&&y<=17)return y===10&&state.bridge?'bridge':'river';
  if(y===6&&x>=18&&x<=27)return x===26||(x===23&&state.gate)?'path':'rock';
  if((x===18||x===19)&&y<6)return 'rock';
  return 'grass';
}
function walkable(x,y){return ['grass','bridge','path'].includes(terrain(x,y));}
function blocked(px,py){for(const dx of [-6,6])for(const dy of [-4,4])if(!walkable(Math.floor((px+dx)/T),Math.floor((py+dy)/T)))return true;return false;}
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');toastTimer=4.2;}
function tone(f=480,d=.09){if(!sound)return;try{audioContext??=new (window.AudioContext||window.webkitAudioContext)();audioContext.resume();const o=audioContext.createOscillator(),g=audioContext.createGain();o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(.045,audioContext.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+d);o.connect(g);g.connect(audioContext.destination);o.start();o.stop(audioContext.currentTime+d);}catch{}}
function burst(x,y,color,n=10){for(let i=0;i<n;i++)particles.push({x,y,vx:(Math.random()-.5)*55,vy:-20-Math.random()*30,life:.7+Math.random()*.4,color});}
function targets(){
  const list=state.plots.map((p,i)=>({kind:'plot',index:i,x:p.x,y:p.y}));
  for(const s of species)if(!state.friends[s.id])list.push({kind:'friend',id:s.id,x:s.x,y:s.y});
  if(!state.bridge)list.push({kind:'bridge',x:14,y:10});
  if(!state.gate)list.push({kind:'gate',x:23,y:6});
  if(!state.lit)list.push({kind:'lantern',x:25,y:4});
  list.push({kind:'tree',x:25,y:14});
  return list;
}
function distance(target){return Math.hypot(state.player.x-(target.x*T+12),state.player.y-(target.y*T+12));}
function nearest(){return targets().filter(t=>distance(t)<39).sort((a,b)=>distance(a)-distance(b))[0];}
function actionLabel(t){
  if(!t)return '';
  if(t.kind==='plot'){const p=state.plots[t.index];return !p.crop?`${state.seed==='root'?'당근':'달빛꽃'} 심기`:p.growth>=1?`${p.crop==='root'?'당근':'달빛꽃'} 수확하기`:`자라는 중 · ${Math.floor(p.growth*100)}%`;}
  if(t.kind==='friend'){const s=species.find(s=>s.id===t.id);return `${s.name}에게 당근 ${s.cost}개 선물`;}
  if(t.kind==='bridge')return '슬라임과 개울 길 열기';
  if(t.kind==='gate')return '두더지와 바위 깨기';
  if(t.kind==='lantern')return '나방과 숲 등불 밝히기';
  return state.restored?'깨어난 고목과 인사':'달빛꽃 1개로 고목 깨우기';
}
function interact(target=nearest()){
  if(phase!=='playing')return;
  if(!target){toast('밭이나 친구 곁으로 한 걸음 더 다가가요.');return;}
  if(distance(target)>39){toast('조금 더 가까이 다가가요.');return;}
  state.interactions++;
  if(target.kind==='plot'){
    const p=state.plots[target.index];
    if(!p.crop){if(state.seed==='flower'&&!atFarm('moth')){toast('달빛꽃은 불씨 나방이 농장에 있어야 자라요. 오른쪽에서 농장을 선택해요.');return;}p.crop=state.seed;p.growth=0;tone(420);burst(p.x*T+12,p.y*T+14,'#c7d87c',5);}
    else if(p.growth>=1){const n=atFarm('mole')?2:1;if(p.crop==='root')state.roots+=n;else state.flowers+=n;state.harvests++;state.xp++;burst(p.x*T+12,p.y*T+12,p.crop==='root'?'#f1bb6a':'#d5c2ec');toast(`${p.crop==='root'?'당근':'달빛꽃'} +${n} · 빈 밭에 다시 심을 수 있어요.`);p.crop=null;p.growth=0;tone(650);}
    else{toast(p.crop==='flower'&&!atFarm('moth')?'불씨 나방을 농장에 배치하면 다시 자라요.':`쑥쑥 자라는 중! ${Math.ceil((1-p.growth)*(p.crop==='root'?12:25)/(atFarm('slime')?2:1))}초 정도 남았어요.`);}
  }else if(target.kind==='friend'){
    const s=species.find(s=>s.id===target.id);
    if(state.friends[s.id])return;
    if(state.roots<s.cost){toast(`${s.name}은 당근 ${s.cost}개를 좋아해요. 지금은 ${state.roots}개 있어요.`);return;}
    state.roots-=s.cost;state.friends[s.id]='farm';burst(s.x*T+12,s.y*T+12,s.color,24);toast(`${s.name}과 친구가 되었어요! 오른쪽에서 동행을 선택해요.`);tone(820,.2);
  }else if(target.kind==='bridge'){
    if(!withFriend('slime')){toast('물방울 슬라임을 동행으로 바꾸면 개울을 건널 수 있어요.');return;}
    state.bridge=true;burst(14*T+12,10*T+12,'#b6f2e8',25);toast('슬라임이 징검다리를 만들었어요. 언제든 건널 수 있어요!');tone(720,.2);
  }else if(target.kind==='gate'){
    if(!withFriend('mole')){toast('뿌리 두더지를 동행으로 선택하고 바위 앞에서 E를 눌러요.');return;}
    state.gate=true;burst(23*T+12,6*T+12,'#c7bd9d',24);toast('두더지가 바위를 깼어요. 북쪽 숨은 숲으로 가볼까요?');tone(320,.2);
  }else if(target.kind==='lantern'){
    if(!withFriend('moth')){toast('불씨 나방과 동행하면 이 등불을 밝힐 수 있어요.');return;}
    state.lit=true;burst(25*T+12,4*T+12,'#f9e499',30);toast('달빛꽃 씨앗을 발견했어요! 나방을 농장에 보내고 달빛꽃을 심어요.');tone(980,.25);
  }else if(target.kind==='tree'){
    if(state.restored){toast('고목이 바람에 잎을 흔들어요. 오늘도 좋은 하루!');return;}
    if(Object.keys(state.friends).length<3||state.flowers<1){toast('고목을 깨우려면 친구 3종과 달빛꽃 1개가 필요해요.');return;}
    state.flowers--;state.restored=true;phase='won';burst(25*T+12,13*T,'#ecddb8',70);$('win-summary').textContent=`세 친구와 함께 고목을 깨웠어요. ${Math.floor(state.elapsed/60)}분 ${Math.floor(state.elapsed%60)}초 동안 ${state.harvests}번의 수확, 그리고 세 번의 만남. 섬의 이야기는 계속돼요.`;$('win-screen').classList.remove('hidden');tone(1040,.4);
  }
  updateUI();
}
function setRole(id,role){if(phase!=='playing'||!state.friends[id])return;if(role==='companion')for(const s of species)if(state.friends[s.id]==='companion')state.friends[s.id]='farm';state.friends[id]=role;state.path=[];state.pending=null;toast(`${species.find(s=>s.id===id).name}${role==='farm'?'이 농장을 돌봐요.':'이 함께 걸어요. 기존 동행은 농장으로 돌아갔어요.'}`);tone(560);updateUI();canvas.focus({preventScroll:true});}
function objective(){
  if(!state.friends.slime)return state.roots<1?[1,'첫 당근을 수확해요','왼쪽 밭의 주황색 당근 곁에서 E를 눌러요. 빈 밭에도 씨앗을 심어 보세요.']:[1,'슬라임에게 마음을 전해요','밭 북동쪽 물방울 슬라임에게 당근 1개를 선물해요. 친구를 클릭하거나 곁에서 E.'];
  if(!state.bridge)return [2,'개울 너머로 함께 가요','친구 목록에서 슬라임을 동행으로 바꿔요. 개울 중앙 표식 곁에서 E를 눌러 길을 열어요.'];
  if(!state.friends.mole)return [3,state.friends.moth?'두더지도 초대해요':'어떤 친구를 먼저 만날까요?','두더지는 동쪽 들판에서 당근 2개를, 나방은 북쪽 숲에서 3개를 기다려요. 숲은 맨 오른쪽 오솔길로도 갈 수 있어요.'];
  if(!state.friends.moth)return [4,'작은 불씨와 친구가 돼요','북쪽 나방에게 당근 3개를 선물해요. 두더지와 동행해 밝은 바위를 깨면 지름길! 맨 오른쪽 오솔길로 돌아갈 수도 있어요.'];
  if(!state.lit)return [5,'숲의 등불을 밝혀요','불씨 나방을 동행으로 바꾸고 숲 오른쪽 등불 곁에서 E. 달빛꽃 씨앗이 나타날 거예요.'];
  if(!state.flowers&&!state.restored)return [5,'달빛꽃 한 송이를 길러요','나방을 농장에 보내고 달빛꽃 씨앗을 선택해요. 왼쪽 농장의 빈 밭에 심고 수확하세요.'];
  if(!state.restored)return [6,'잠든 고목을 깨워요','동쪽 섬 남쪽 고목에 달빛꽃을 전해요. 세 친구가 함께 만든 작은 기적이에요.'];
  return [6,'우리의 섬에 꽃이 피었어요','고목이 깨어났어요! 이제 자유롭게 씨앗을 심고 친구들과 섬에서 쉬어 가세요.'];
}
function updateUI(){
  $('roots').textContent=state.roots;$('flowers').textContent=state.flowers;$('level').textContent=`Lv.${1+Math.floor(state.xp/4)}`;$('xp').textContent=`${state.xp%4} / 4`;
  const [step,title,body]=objective();$('goal-title').textContent=title;$('goal-body').textContent=body;$('progress').textContent=`0${step} / 06`;$('progress-bar').style.width=`${state.restored?100:(step-1)/6*100+8}%`;
  $('friend-count').textContent=`${Object.keys(state.friends).length} / 3`;
  $('seed-flower').disabled=!state.lit;$('seed-flower').querySelector('small').textContent=state.lit?'기본 25초':'숲에서 발견';
  ['root','flower'].forEach(id=>{$(`seed-${id}`).classList.toggle('active',state.seed===id);$(`seed-${id}`).setAttribute('aria-pressed',String(state.seed===id));});
  const buffs=[];if(atFarm('slime'))buffs.push('성장 ×2');if(atFarm('mole'))buffs.push('수확 +1');if(atFarm('moth'))buffs.push('달빛꽃 재배');$('farm-buff').textContent=buffs.length?`농장 효과 · ${buffs.join(' / ')}`:'친구가 밭에 머물면 농사가 달라져요.';
  const rosterKey=JSON.stringify(state.friends);
  if($('roster').dataset.state!==rosterKey){$('roster').dataset.state=rosterKey;$('roster').innerHTML=species.map(s=>`<div class="friend ${state.friends[s.id]?'':'locked'}"><canvas class="friend-icon" width="34" height="34" data-species="${s.id}" aria-hidden="true"></canvas><div><div class="friend-name">${s.name}</div><div class="friend-detail">${state.friends[s.id]?s.description:`아직 만나지 못했어요 · 당근 ${s.cost}개`}</div></div>${state.friends[s.id]?`<div class="roles"><button class="role-button ${atFarm(s.id)?'active':''}" data-id="${s.id}" data-role="farm" aria-pressed="${atFarm(s.id)}">농장</button><button class="role-button ${withFriend(s.id)?'active':''}" data-id="${s.id}" data-role="companion" aria-pressed="${withFriend(s.id)}">동행</button></div>`:''}</div>`).join('');$('roster').querySelectorAll('canvas').forEach(c=>drawMonster(c.getContext('2d'),c.dataset.species,17,20,0));}
}
function pathTo(tx,ty,interaction){
  const start={x:Math.floor(state.player.x/T),y:Math.floor(state.player.y/T)};const q=[start],seen=new Map([[`${start.x},${start.y}`,null]]);let end=null;
  for(let i=0;i<q.length;i++){const p=q[i];if(interaction?Math.hypot(p.x-tx,p.y-ty)<=1.05:p.x===tx&&p.y===ty){end=p;break;}for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const x=p.x+dx,y=p.y+dy,k=`${x},${y}`;if(!seen.has(k)&&walkable(x,y)){seen.set(k,p);q.push({x,y});}}}
  if(!end){toast('아직 닿을 수 없는 곳이에요. 친구의 힘으로 길을 열어요.');return;}
  const path=[];let p=end;while(p){path.unshift({x:p.x*T+12,y:p.y*T+12});p=seen.get(`${p.x},${p.y}`);}state.path=path;state.pending=interaction||null;
}
function update(dt){
  time+=dt;particles.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=70*dt;p.life-=dt;});for(let i=particles.length-1;i>=0;i--)if(particles[i].life<=0)particles.splice(i,1);
  if(toastTimer>0){toastTimer-=dt;if(toastTimer<=0)$('toast').classList.remove('visible');}
  if(phase!=='playing')return;
  state.elapsed+=dt;let dx=(keys.d||keys.arrowright?1:0)-(keys.a||keys.arrowleft?1:0),dy=(keys.s||keys.arrowdown?1:0)-(keys.w||keys.arrowup?1:0);
  if(dx||dy){state.path=[];state.pending=null;}else if(state.path.length){const p=state.path[0],d=Math.hypot(p.x-state.player.x,p.y-state.player.y);if(d<2){state.player.x=p.x;state.player.y=p.y;state.path.shift();}else{dx=(p.x-state.player.x)/d;dy=(p.y-state.player.y)/d;}}
  const mag=Math.hypot(dx,dy);if(mag){dx/=mag;dy/=mag;const speed=91;const nx=state.player.x+dx*speed*dt,ny=state.player.y+dy*speed*dt;if(!blocked(nx,state.player.y))state.player.x=nx;if(!blocked(state.player.x,ny))state.player.y=ny;state.player.walk+=dt*9;if(dx)state.player.facing=Math.sign(dx);}else state.player.walk=0;
  if(!state.path.length&&state.pending){const target=state.pending;state.pending=null;interact(target);}
  if(keys.action){keys.action=false;interact();}
  const level=1+Math.floor(state.xp/4);for(const p of state.plots)if(p.crop&&p.growth<1&&(p.crop!=='flower'||atFarm('moth'))){p.growth=Math.min(1,p.growth+dt/(p.crop==='root'?12:25)*(atFarm('slime')?2:1)*(1+Math.min(level-1,5)*.05));}
  const target=nearest();$('prompt').textContent=target?`E · ${actionLabel(target)}`:'';
  const px=state.player.x/T,py=state.player.y/T;$('location').textContent=py<6&&px>18?'불씨의 숨은 숲':px>14?(py>12?'잠든 고목':'뿌리의 들판'):'씨앗 정원';
  const minutes=Math.floor(state.elapsed/2)+480;$('day').textContent=`DAY ${String(Math.floor(minutes/1440)+1).padStart(2,'0')} · ${String(Math.floor(minutes/60)%24).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
  uiTimer+=dt;if(uiTimer>.3){uiTimer=0;updateUI();}
}
function rect(c,x,y,w,h,color){c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),w,h);}
function drawMonster(c,id,x,y,anim){
  y+=Math.sin(anim)*1.5;rect(c,x-10,y+6,20,4,'#254c4833');
  if(id==='slime'){rect(c,x-9,y-5,18,12,'#67b8c5');rect(c,x-6,y-9,12,6,'#86d3d6');rect(c,x-10,y,20,6,'#67b8c5');rect(c,x-5,y-7,5,3,'#c5eeee');rect(c,x-5,y-1,2,3,'#284953');rect(c,x+4,y-1,2,3,'#284953');rect(c,x-1,y+3,3,1,'#427480');}
  if(id==='mole'){rect(c,x-8,y-6,16,15,'#b48d6f');rect(c,x-10,y-9,5,6,'#9a765b');rect(c,x+5,y-9,5,6,'#9a765b');rect(c,x-5,y-8,10,4,'#cba080');rect(c,x-5,y-1,2,2,'#3f403c');rect(c,x+4,y-1,2,2,'#3f403c');rect(c,x-2,y+2,5,3,'#e6b798');rect(c,x-12,y+6,6,3,'#d9bb8c');rect(c,x+6,y+6,6,3,'#d9bb8c');rect(c,x-3,y-11,3,5,'#709458');}
  if(id==='moth'){const flap=Math.sin(anim*2)>0?1:0;rect(c,x-13,y-8+flap*3,10,13-flap*2,'#ddb26d');rect(c,x+3,y-8+flap*3,10,13-flap*2,'#ddb26d');rect(c,x-10,y-5,5,5,'#f3d693');rect(c,x+5,y-5,5,5,'#f3d693');rect(c,x-3,y-7,6,15,'#a98664');rect(c,x-3,y-9,6,6,'#f6dea0');rect(c,x-2,y-6,1,2,'#50413a');rect(c,x+1,y-6,1,2,'#50413a');rect(c,x-5,y-12,2,4,'#886e51');rect(c,x+3,y-12,2,4,'#886e51');}
}
function pine(x,y,small=false){const s=small?.7:1;ctx.save();ctx.translate(x,y);ctx.scale(s,s);rect(ctx,-3,1,6,16,'#7c7756');rect(ctx,-17,-10,34,16,'#46764c');rect(ctx,-13,-20,26,17,'#4e8052');rect(ctx,-8,-29,16,17,'#64905b');rect(ctx,-4,-34,8,10,'#759963');rect(ctx,-12,-8,6,3,'#658e53');ctx.restore();}
function flower(x,y,color){rect(ctx,x,y,2,5,'#668656');rect(ctx,x-2,y-3,6,3,color);rect(ctx,x,y-5,2,7,color);rect(ctx,x,y-2,2,2,'#e5d695');}
function label(x,y,text,color='#f7f2d4'){ctx.font='9px "Malgun Gothic",sans-serif';ctx.textAlign='center';const width=ctx.measureText(text).width;rect(ctx,x-width/2-5,y-10,width+10,15,'#2b4934cc');ctx.fillStyle=color;ctx.fillText(text,x,y+1);}
function render(){
  ctx.clearRect(0,0,720,480);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const type=terrain(x,y),noise=(x*17+y*31)%7;const px=x*T,py=y*T;
    if(type==='sea'||type==='river'){rect(ctx,px,py,T,T,type==='river'?'#72aaa2':noise<3?'#3b777c':'#39747b');if((x+y)%3===0){const drift=Math.floor(time*3)%7;rect(ctx,px+3+drift,py+9,8,1,type==='river'?'#a0cec0':'#65979a');rect(ctx,px+12-drift/2,py+18,5,1,'#65979a');}}
    else{rect(ctx,px,py,T,T,noise<2?'#91b77b':noise<4?'#98bc81':'#9cbf83');if(noise===0){rect(ctx,px+4,py+7,2,4,'#81a96c');rect(ctx,px+7,py+5,1,5,'#81a96c');}if(['sea','river'].includes(terrain(x,y+1)))rect(ctx,px,py+21,24,3,'#b7c28a');if(['sea','river'].includes(terrain(x-1,y)))rect(ctx,px,py,3,24,'#b7c28a');if(type==='bridge'){rect(ctx,px,py,24,24,'#81b6a9');for(let k=0;k<3;k++){rect(ctx,px+k*8,py+7,7,12,'#b9c0a1');rect(ctx,px+k*8+1,py+7,6,3,'#d7d6b0');}}if(type==='rock'){rect(ctx,px+1,py+6,22,18,'#778976');rect(ctx,px+4,py+2,16,17,'#a3ae93');rect(ctx,px+6,py+2,11,4,'#bcc3a6');rect(ctx,px+5,py+18,16,3,'#687d67');}}
  }
  // A gently worn route connects the places worth visiting.
  for(const [x,y,w,h] of [[9,10,5,1],[15,10,9,1],[22,7,1,4],[23,7,1,1],[23,11,1,4],[4,14,7,1],[26,4,1,6],[24,4,3,1],[23,9,4,1]]){rect(ctx,x*T,y*T,w*T,h*T,'#bdc28b');for(let i=0;i<w*h*2;i++)rect(ctx,x*T+(i*31)%(w*T),y*T+(i*13)%(h*T),3,2,'#aeb681');}
  // Farm fence and little home are visual landmarks, not collision traps.
  rect(ctx,4*T-9,9*T-10,5*T+18,5*T+14,'#839961');rect(ctx,4*T-5,9*T-6,5*T+10,5*T+6,'#b3bb80');
  for(let x=4;x<=9;x++){rect(ctx,x*T,9*T-10,3,13,'#ddd0a0');rect(ctx,x*T,13*T+19,3,13,'#ddd0a0');}rect(ctx,4*T,9*T-6,5*T,3,'#c7bd91');rect(ctx,4*T,13*T+23,5*T,3,'#c7bd91');
  for(const p of state.plots){const x=p.x*T,y=p.y*T;rect(ctx,x-1,y-1,23,22,'#846e50');rect(ctx,x+1,y+1,19,17,'#9e7d52');for(let i=0;i<3;i++)rect(ctx,x+3,y+4+i*5,15,1,'#876b4a');if(p.crop){const growth=p.growth,off=Math.sin(time*2+p.x)*.7;if(p.crop==='root'){rect(ctx,x+9,y+10,4,7,'#779048');rect(ctx,x+5,y+8,6,3,'#86a752');rect(ctx,x+12,y+6,5,3,'#729848');if(growth>.5){rect(ctx,x+7,y+11,9,7,growth>=1?'#e7a258':'#baa56a');rect(ctx,x+9,y+17,5,3,'#cc8549');}if(growth>=1){rect(ctx,x+7,y+6+off,3,6,'#528f4c');rect(ctx,x+11,y+4+off,3,8,'#6a9d4c');}}else{rect(ctx,x+10,y+7,2,11,'#5f8c62');rect(ctx,x+6,y+10,4,3,'#6d9e70');if(growth>.4)flower(x+10,y+8+off,growth>=1?'#e7d8f4':'#bba9d0');}if(growth<1){rect(ctx,x+3,y+21,16,2,'#766f4a');rect(ctx,x+3,y+21,Math.floor(growth*16),2,p.crop==='flower'?'#d6c3e6':'#c8d88a');}else if(Math.sin(time*3+p.x)>0)rect(ctx,x+19,y+2,2,2,'#faf0bd');}}
  // Cottage.
  rect(ctx,4*T,5*T,3*T,2*T,'#d6c496');rect(ctx,4*T-6,5*T-10,3*T+12,12,'#697c61');rect(ctx,4*T+4,5*T-20,3*T-8,10,'#7a8a65');rect(ctx,4*T+16,5*T-28,3*T-32,8,'#95a17b');rect(ctx,5*T,6*T,14,24,'#7c8261');rect(ctx,4*T+8,5*T+12,12,12,'#718c7b');rect(ctx,4*T+12,5*T+13,3,10,'#b6c79d');
  const trees=[[3,5],[3,8],[3,15],[6,3],[8,3],[11,4],[12,15],[10,17],[16,4],[16,7],[18,16],[21,16],[27,10],[27,13],[21,3],[27,4]];for(const [x,y]of trees)pine(x*T+12,y*T+12,(x+y)%3===0);
  for(let i=0;i<43;i++){const x=3+(i*7)%24,y=3+(i*11)%14;if(walkable(x,y)&&!(x>=4&&x<=9&&y>=9&&y<=14)&&!(y===10)&&!(x>20&&y<7))flower(x*T+7,y*T+17,i%3===0?'#efe1a6':'#c8d7a2');}
  if(!state.bridge){rect(ctx,13*T+15,10*T+3,3,20,'#7f8260');rect(ctx,13*T+10,10*T+3,12,10,'#d9cb96');ctx.fillStyle='#627c64';ctx.font='10px sans-serif';ctx.textAlign='center';ctx.fillText('≈',13*T+16,10*T+12);}
  if(!state.gate){rect(ctx,23*T+3,6*T+3,18,16,'#c9c49b');rect(ctx,23*T+11,6*T+4,2,12,'#8b9275');rect(ctx,23*T+8,6*T+10,5,2,'#8b9275');}
  // Grove lantern.
  rect(ctx,25*T+9,4*T+7,6,17,'#91896b');rect(ctx,25*T+5,4*T+3,14,10,state.lit?'#efd594':'#7b8171');rect(ctx,25*T+8,4*T,8,5,state.lit?'#fff0af':'#8f9980');if(state.lit){ctx.fillStyle='#f4e4a322';ctx.beginPath();ctx.arc(25*T+12,4*T+9,25+Math.sin(time*2)*2,0,Math.PI*2);ctx.fill();}
  // Ancient tree.
  const ax=25*T+12,ay=14*T+14;rect(ctx,ax-14,ay+8,33,7,'#637b5b55');rect(ctx,ax-8,ay-24,16,34,'#928264');rect(ctx,ax-14,ay+4,28,7,'#928264');rect(ctx,ax-19,ay-32,13,8,'#928264');rect(ctx,ax+6,ay-40,19,8,'#928264');rect(ctx,ax-24,ay-44,7,19,'#928264');rect(ctx,ax+19,ay-51,6,19,'#928264');rect(ctx,ax-5,ay-54,10,35,'#928264');
  if(state.restored){rect(ctx,ax-36,ay-62,71,25,'#789d66');rect(ctx,ax-27,ay-75,55,24,'#8bb278');rect(ctx,ax-12,ay-81,28,14,'#aac18a');for(let i=0;i<9;i++)flower(ax-28+(i*13)%55,ay-62-(i*7)%17,i%2?'#eddbdb':'#eee4bc');}
  else{rect(ctx,ax-8,ay-9,16,9,'#5f6f56');rect(ctx,ax-5,ay-8,3,3,'#d4c293');rect(ctx,ax+3,ay-8,3,3,'#d4c293');}
  for(const s of species){if(!state.friends[s.id]){drawMonster(ctx,s.id,s.x*T+12,s.y*T+13,time*3);label(s.x*T+12,s.y*T-6,`당근 ${s.cost}개`);}else if(atFarm(s.id)){const i=species.indexOf(s);drawMonster(ctx,s.id,(5+i*1.5)*T,13.7*T,time*3+i);}}
  const p=state.player;const companion=species.find(s=>withFriend(s.id));if(companion)drawMonster(ctx,companion.id,p.x-p.facing*20,p.y+9,time*4);
  const bob=Math.sin(p.walk)*1.3;rect(ctx,p.x-8,p.y+5,16,4,'#355f4b44');rect(ctx,p.x-6,p.y-8+bob,12,13,'#e4dbb0');rect(ctx,p.x-5,p.y+3,4,5+(Math.sin(p.walk)>0?1:0),'#606e61');rect(ctx,p.x+2,p.y+3,4,5+(Math.sin(p.walk)<0?1:0),'#606e61');rect(ctx,p.x-7,p.y-14+bob,14,10,'#e8b997');rect(ctx,p.x-8,p.y-20+bob,16,8,'#567454');rect(ctx,p.x-11,p.y-14+bob,22,3,'#81975d');rect(ctx,p.x+3*p.facing,p.y-10+bob,2,2,'#42533e');rect(ctx,p.x-8*p.facing,p.y-4+bob,5,8,'#a88360');
  if(!state.lit){ctx.fillStyle='#254a5d35';ctx.fillRect(20*T,2*T,8*T,4*T);for(let i=0;i<8;i++)rect(ctx,20*T+(i*29)%170,2*T+20+(i*17)%65,2,2,`rgba(239,214,138,${.25+.2*Math.sin(time+i)})`);}
  label(6.5*T,8.8*T,'씨앗 정원');label(ax,ay+30,state.restored?'다시 피어난 고목':'잠든 고목');
  if(state.path.length){const end=state.path[state.path.length-1];ctx.strokeStyle='#f5efc499';ctx.lineWidth=1;ctx.strokeRect(end.x-6,end.y-4,12,8);}
  const target=phase==='playing'?nearest():null;if(target){ctx.strokeStyle='#fff5c8';ctx.lineWidth=1;ctx.strokeRect(target.x*T-2,target.y*T-2,T+4,T+4);}
  for(const particle of particles)rect(ctx,particle.x,particle.y,3,3,particle.color);
  // Soft shoreline and drifting flecks keep the whole island alive.
  for(let i=0;i<8;i++){const x=(i*93+time*5)%720,y=70+(i*61)%340+Math.sin(time*.4+i)*10;rect(ctx,x,y,2,2,'#edf1c45c');}
}
canvas.addEventListener('pointerdown',e=>{if(phase!=='playing')return;canvas.focus({preventScroll:true});const box=canvas.getBoundingClientRect(),x=Math.floor((e.clientX-box.left)/box.width*W),y=Math.floor((e.clientY-box.top)/box.height*H);const target=targets().find(t=>t.x===x&&t.y===y);pathTo(x,y,target);});
document.addEventListener('keydown',e=>{if(/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;const key=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','e',' '].includes(key)&&phase==='playing'){if(e.target.tagName==='BUTTON'&&key===' ')return;e.preventDefault();if(key==='e'||key===' '){if(!e.repeat)keys.action=true;}else keys[key]=true;}});
document.addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false;});
window.addEventListener('blur',()=>{Object.keys(keys).forEach(k=>delete keys[k]);});
document.addEventListener('visibilitychange',()=>{if(document.hidden){Object.keys(keys).forEach(k=>delete keys[k]);}last=performance.now();accumulator=0;});
$('roster').addEventListener('click',e=>{const b=e.target.closest('[data-role]');if(b)setRole(b.dataset.id,b.dataset.role);});
['root','flower'].forEach(id=>$(`seed-${id}`).addEventListener('click',()=>{if(id==='flower'&&!state.lit)return;state.seed=id;updateUI();canvas.focus({preventScroll:true});}));
$('start').addEventListener('click',()=>{phase='playing';$('start-screen').classList.add('hidden');toast('반가워요! 밭의 다 자란 당근을 클릭해 첫 수확을 해봐요.');canvas.focus({preventScroll:true});});
$('continue').addEventListener('click',()=>{phase='playing';$('win-screen').classList.add('hidden');canvas.focus({preventScroll:true});});
$('restart').addEventListener('click',()=>{if(window.confirm('섬을 처음부터 시작할까요? 지금까지의 진행은 사라져요.')){Object.keys(keys).forEach(k=>delete keys[k]);reset();}});
$('sound').addEventListener('click',()=>{sound=!sound;$('sound').textContent=sound?'소리 켜짐':'소리 꺼짐';$('sound').setAttribute('aria-pressed',String(sound));tone();});
function frame(now){accumulator+=Math.min((now-last)/1000,.1);last=now;while(accumulator>=1/60){update(1/60);accumulator-=1/60;}render();requestAnimationFrame(frame);}
// Read-only inspection for playtest evidence; gameplay can only change through normal input.
window.mossGame={getSnapshot:()=>JSON.parse(JSON.stringify({phase,...state,objective:objective()}))};
reset();requestAnimationFrame(frame);
})();
