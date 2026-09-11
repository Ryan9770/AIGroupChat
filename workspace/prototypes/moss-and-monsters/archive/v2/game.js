(() => {
'use strict';
const $ = id => document.getElementById(id);
const canvas = $('world'), ctx = canvas.getContext('2d');
const T = 24, W = 30, H = 20;
const species = [
  {id:'slime',name:'물방울 슬라임',color:'#80cbd1',cost:1,x:10,y:7,description:'농장: 성장 ×2 · 동행: 개울 길 열기'},
  {id:'mole',name:'뿌리 두더지',color:'#bf9676',cost:2,x:20,y:11,description:'농장: 수확 +1 · 동행: 목재 +1 / 바위 깨기'},
  {id:'moth',name:'불씨 나방',color:'#efbd72',cost:3,x:24,y:3,description:'농장: 달빛꽃 재배 · 동행: 허브 +1 / 숲 밝히기'}
];
const plotPositions = [[5,10],[6,10],[7,10],[8,10],[5,12],[6,12],[7,12],[8,12]];
const expandedPositions = [[5,11],[6,11],[7,11],[8,11]];
const SAVE_KEY='moss-and-monsters:v2', SAVE_VERSION=2;
const stations={cottage:{kind:'cottage',x:5,y:7},stove:{kind:'stove',x:9,y:6},board:{kind:'board',x:11,y:14},workbench:{kind:'workbench',x:10,y:12}};
const forageNodes=[{id:'herb-a',kind:'herb',x:8,y:7},{id:'herb-b',kind:'herb',x:11,y:12},{id:'herb-c',kind:'herb',x:17,y:12},{id:'herb-d',kind:'herb',x:22,y:4},{id:'wood-a',kind:'wood',x:3,y:11},{id:'wood-b',kind:'wood',x:10,y:5},{id:'wood-c',kind:'wood',x:11,y:16},{id:'wood-d',kind:'wood',x:19,y:14}];
const freshStats=()=>({harvests:0,foraged:0,cooked:0,income:0,spent:0,orders:0});
const keys = {}, particles = [];
let state, phase='title', last=performance.now(), accumulator=0, sound=false, audioContext, toastTimer=0, uiTimer=0, time=0,saveTimer=0,savedGame=null,saveFailureShown=false,cookingSteam=0,merchantReaction=0;
function reset(){
  state={player:{x:6*T+12,y:14*T+12,facing:1,walk:0},roots:0,flowers:0,herbs:0,wood:0,soup:0,coins:0,xp:0,seed:'root',friends:{},bridge:false,gate:false,lit:false,restored:false,completed:false,elapsed:0,day:1,dayTime:0,dayStats:freshStats(),upgrades:{garden:false,kitchen:false},nodes:forageNodes.map(n=>({...n,pickedDay:0})),path:[],pending:null,harvests:0,interactions:0,plots:plotPositions.map(([x,y],i)=>({x,y,crop:i===0?'root':null,growth:i===0?1:0}))};
  particles.length=0; phase='title';savedGame=null;saveTimer=0;cookingSteam=0;merchantReaction=0;$('start-screen').classList.remove('hidden');$('win-screen').classList.add('hidden');$('day-screen').classList.add('hidden');$('new-game-title').classList.add('hidden');$('start').innerHTML='첫날 시작하기 <span>↗</span>';$('start-description').innerHTML='낮에는 농사와 탐험, 저녁에는 수프 한 그릇.<br>의뢰를 납품해 농장과 부엌을 고치고, 세 친구를 만나요.';$('roster').dataset.state='';uiTimer=0;updateUI();
}
function validateSave(raw){
  if(!raw||raw.version!==SAVE_VERSION||!raw.state||typeof raw.state!=='object')throw Error('지원하지 않는 저장 형식');
  const s=raw.state,isNum=(v,max=1e9)=>Number.isFinite(v)&&v>=0&&v<=max,isInt=(v,max=1e9)=>isNum(v,max)&&Number.isInteger(v);
  for(const key of ['roots','flowers','herbs','wood','soup','coins','xp','harvests','interactions'])if(!isInt(s[key]))throw Error('자원 데이터 오류');
  for(const key of ['bridge','gate','lit','restored','completed'])if(typeof s[key]!=='boolean')throw Error('진행 데이터 오류');
  if(!isInt(s.day,1e7)||s.day<1||!isNum(s.dayTime,420)||!isNum(s.elapsed)||!['root','flower'].includes(s.seed))throw Error('날짜 데이터 오류');
  if(!s.player||!isNum(s.player.x,720)||!isNum(s.player.y,480)||![-1,1].includes(s.player.facing))throw Error('위치 데이터 오류');
  if(!s.friends||typeof s.friends!=='object'||Array.isArray(s.friends)||Object.keys(s.friends).some(id=>!species.some(a=>a.id===id)||!['farm','companion'].includes(s.friends[id]))||Object.values(s.friends).filter(v=>v==='companion').length>1)throw Error('친구 데이터 오류');
  if((s.bridge&&!s.friends.slime)||(s.gate&&!s.friends.mole)||(s.lit&&!s.friends.moth)||(s.seed==='flower'&&!s.lit)||(s.restored&&Object.keys(s.friends).length!==3))throw Error('진행 순서 오류');
  if(!s.upgrades||typeof s.upgrades.garden!=='boolean'||typeof s.upgrades.kitchen!=='boolean')throw Error('시설 데이터 오류');
  const positions=s.upgrades.garden?[...plotPositions,...expandedPositions]:plotPositions;
  if(!Array.isArray(s.plots)||s.plots.length!==positions.length||s.plots.some((p,i)=>!p||p.x!==positions[i][0]||p.y!==positions[i][1]||![null,'root','flower'].includes(p.crop)||!isNum(p.growth,1)))throw Error('밭 데이터 오류');
  if(!Array.isArray(s.nodes)||s.nodes.length!==forageNodes.length||s.nodes.some((n,i)=>!n||n.id!==forageNodes[i].id||n.kind!==forageNodes[i].kind||n.x!==forageNodes[i].x||n.y!==forageNodes[i].y||!isInt(n.pickedDay,s.day)))throw Error('채집 데이터 오류');
  if(!s.dayStats||Object.keys(freshStats()).some(k=>!isInt(s.dayStats[k]))||s.dayStats.orders>2)throw Error('하루 기록 오류');
  if(s.completed&&(!s.restored||!s.upgrades.garden||!s.upgrades.kitchen))throw Error('완료 데이터 오류');
  // Build a known schema instead of spreading untrusted local storage properties.
  const clean={};for(const k of ['roots','flowers','herbs','wood','soup','coins','xp','harvests','interactions','bridge','gate','lit','restored','completed','day','dayTime','elapsed','seed'])clean[k]=s[k];
  clean.player={x:s.player.x,y:s.player.y,facing:s.player.facing,walk:0};clean.friends={};for(const a of species)if(s.friends[a.id])clean.friends[a.id]=s.friends[a.id];clean.upgrades={garden:s.upgrades.garden,kitchen:s.upgrades.kitchen};clean.dayStats=freshStats();for(const k of Object.keys(clean.dayStats))clean.dayStats[k]=s.dayStats[k];clean.plots=s.plots.map(p=>({x:p.x,y:p.y,crop:p.crop,growth:p.growth}));clean.nodes=s.nodes.map(n=>({id:n.id,kind:n.kind,x:n.x,y:n.y,pickedDay:n.pickedDay}));clean.path=[];clean.pending=null;return clean;
}
function readSave(){
  try{const text=localStorage.getItem(SAVE_KEY);if(!text)return;savedGame=validateSave(JSON.parse(text));$('start').innerHTML=`${savedGame.day}일 차 이어서 하기 <span>↗</span>`;$('start-description').textContent=`저장된 섬 · ${savedGame.coins}G · 친구 ${Object.keys(savedGame.friends).length}/3 · 농장 ${savedGame.plots.length}칸`;$('new-game-title').classList.remove('hidden');$('save-status').textContent='저장된 섬을 찾았어요. 이어서 시작할 수 있어요.';}
  catch{savedGame=null;$('save-status').textContent='저장을 읽지 못했어요. 새 게임은 가능하며 저장 상태를 다시 알려드릴게요.';}
}
function saveGame(manual=false){
  if(phase==='title'){if(manual)toast('섬 생활을 시작한 뒤 저장할 수 있어요.');return false;}
  try{const clean=validateSave({version:SAVE_VERSION,state});localStorage.setItem(SAVE_KEY,JSON.stringify({version:SAVE_VERSION,savedAt:Date.now(),state:clean}));saveFailureShown=false;$('save-status').textContent=`${state.day}일 차 · 이 브라우저에 자동 저장됨`;if(manual)toast('지금까지의 섬 생활을 저장했어요.');return true;}
  catch{ $('save-status').textContent='저장할 수 없어요 · 탭을 닫으면 이번 진행이 사라질 수 있어요.';if(manual||!saveFailureShown)toast('브라우저 저장이 차단되었거나 공간이 부족해요. 지금은 이 탭에서 계속 플레이할 수 있어요.');saveFailureShown=true;return false;}
}
function checkMilestone(){
  if(state.completed||!state.restored||!state.upgrades.garden||!state.upgrades.kitchen||Object.keys(state.friends).length<3)return;
  state.completed=true;phase='won';state.path=[];state.pending=null;$('win-summary').textContent=`${state.day}일 차, 농장은 ${state.plots.length}칸으로 넓어지고 부엌에 지붕이 생겼어요. 세 친구와 고목도 돌아왔어요. ${state.harvests}번의 수확으로 되살린 이곳에서 내일도 살아가요.`;$('win-screen').classList.remove('hidden');burst(6*T,10*T,'#f5deb4',50);tone(1040,.4);
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
  list.push(...Object.values(stations),...state.nodes.map(n=>({kind:'forage',id:n.id,x:n.x,y:n.y})));
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
  if(t.kind==='forage'){const n=state.nodes.find(n=>n.id===t.id);return n.pickedDay===state.day?'오늘은 채집했어요 · 내일 다시 자라요':`${n.kind==='herb'?'허브':'목재'} 채집${n.kind==='herb'&&withFriend('moth')||n.kind==='wood'&&withFriend('mole')?' · 동행 보너스 +1':''}`;}
  if(t.kind==='cottage')return '오두막 · 하루 마무리';
  if(t.kind==='stove')return '수프 만들기 · 당근 2 + 허브 1';
  if(t.kind==='board')return `납품대 · 수프 1 → ${state.upgrades.kitchen?18:12}G`;
  if(t.kind==='workbench')return '작업대 · 시설 개선 안내';
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
    else if(p.growth>=1){const n=atFarm('mole')?2:1;if(p.crop==='root')state.roots+=n;else state.flowers+=n;state.harvests++;state.dayStats.harvests+=n;state.xp++;burst(p.x*T+12,p.y*T+12,p.crop==='root'?'#f1bb6a':'#d5c2ec');toast(`${p.crop==='root'?'당근':'달빛꽃'} +${n} · 빈 밭에 다시 심을 수 있어요.`);p.crop=null;p.growth=0;tone(650);}
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
    state.flowers--;state.restored=true;burst(25*T+12,13*T,'#ecddb8',70);toast('고목에 다시 꽃이 피었어요! 농장과 부엌도 고쳐 우리의 생활 터전을 완성해요.');tone(1040,.4);
  }else if(target.kind==='forage'){
    const n=state.nodes.find(n=>n.id===target.id);if(!n||n.pickedDay===state.day){toast('이곳은 오늘 채집했어요. 오두막에서 자고 나면 다시 준비돼요.');return;}
    const bonus=n.kind==='herb'?withFriend('moth'):withFriend('mole'),amount=bonus?2:1;n.pickedDay=state.day;state[n.kind==='herb'?'herbs':'wood']+=amount;state.dayStats.foraged+=amount;burst(n.x*T+12,n.y*T+12,n.kind==='herb'?'#c1d790':'#c9a070');toast(`${n.kind==='herb'?'허브':'목재'} +${amount}${bonus?' · 동행 친구가 더 찾아줬어요!':' · 내일 다시 채집할 수 있어요.'}`);tone(540);
  }else if(target.kind==='stove'||target.kind==='board'||target.kind==='workbench'||target.kind==='cottage'){
    if(target.action)performOperation(target.action);
    else if(target.kind==='stove')performOperation('cook');
    else if(target.kind==='board'){if(state.soup&&state.dayStats.orders<2)performOperation('fulfill');else toast('상인 토리: 수프 의뢰는 하루 2개예요. 당근은 언제든 2G에 사요! 오른쪽 납품대 버튼을 눌러 주세요.');}
    else if(target.kind==='workbench')toast('작업대: 오른쪽에서 밭 확장(24G + 목재 3) 또는 부엌 수리(30G + 목재 4)를 선택해요.');
    else openDaySummary();
  }
  checkMilestone();updateUI();saveGame();
}
function requestOperation(action){
  if(phase!=='playing')return;
  const station=action==='cook'?stations.stove:['fulfill','sell-root'].includes(action)?stations.board:action==='sleep'?stations.cottage:stations.workbench;
  const target={...station,action};state.path=[];state.pending=null;
  if(distance(target)<=39)interact(target);else{pathTo(target.x,target.y,target);toast(`${action==='sleep'?'오두막':station.kind==='stove'?'야외 화덕':station.kind==='board'?'납품대':'작업대'}로 걸어가요. 이동키를 누르면 취소돼요.`);}
  canvas.focus({preventScroll:true});
}
function performOperation(action){
  if(action==='cook'){
    if(state.roots<2||state.herbs<1){toast('수프 한 그릇에는 당근 2개와 허브 1개가 필요해요. 초록 잎 덤불을 채집해 보세요.');return;}
    state.roots-=2;state.herbs--;state.soup++;state.dayStats.cooked++;cookingSteam=3;burst(9*T+12,6*T,'#eee8d1',12);toast('보글보글, 당근 허브 수프 +1! 납품대에서 의뢰를 완료해요.');tone(760,.2);
  }else if(action==='fulfill'){
    if(state.dayStats.orders>=2){toast('토리: 오늘의 수프 의뢰는 모두 채웠어요. 내일 또 부탁해요! 당근은 계속 살게요.');return;}
    if(state.soup<1){toast('토리: 당근 허브 수프 1그릇을 부탁해요. 화덕에서 만들 수 있어요.');return;}
    const price=state.upgrades.kitchen?18:12;state.soup--;state.coins+=price;state.dayStats.income+=price;state.dayStats.orders++;merchantReaction=3;burst(11*T+12,14*T,'#f4d578',12);toast(`토리: 따뜻한 수프, 고마워요! +${price}G · 오늘 남은 의뢰 ${2-state.dayStats.orders}개`);tone(880,.2);
  }else if(action==='sell-root'){
    if(state.roots<1){toast('팔 당근이 없어요. 씨앗은 무료이니 빈 밭에 심어 보세요.');return;}
    state.roots--;state.coins+=2;state.dayStats.income+=2;merchantReaction=2;toast('토리: 싱싱한 당근이네요. +2G');tone(610);
  }else if(action==='upgrade-garden'||action==='upgrade-kitchen'){
    const which=action==='upgrade-garden'?'garden':'kitchen',cost=which==='garden'?24:30,wood=which==='garden'?3:4;
    if(state.upgrades[which]){toast('이미 완성한 시설이에요.');return;}
    if(state.coins<cost||state.wood<wood){toast(`${which==='garden'?'밭 확장':'부엌 수리'}에는 ${cost}G + 목재 ${wood}개가 필요해요. 지금은 ${state.coins}G + 목재 ${state.wood}개예요.`);return;}
    state.coins-=cost;state.wood-=wood;state.dayStats.spent+=cost;state.upgrades[which]=true;
    if(which==='garden'){state.plots.push(...expandedPositions.map(([x,y])=>({x,y,crop:null,growth:0})));burst(6*T,11*T,'#cddc96',30);toast('밭이 12칸으로 넓어졌어요! 가운데 새 밭에도 작물을 심을 수 있어요.');}
    else{burst(9*T,5*T,'#edce92',30);toast('부엌에 지붕을 달았어요! 이제 수프 의뢰 보상이 18G예요.');}tone(900,.25);
  }else if(action==='sleep')openDaySummary();
}
function openDaySummary(){
  phase='summary';state.path=[];state.pending=null;Object.keys(keys).forEach(k=>delete keys[k]);const s=state.dayStats;$('summary-day').textContent=`DAY ${String(state.day).padStart(2,'0')} / 하루의 기록`;$('day-summary-details').innerHTML=`<div><span>수확 / 채집</span><strong>${s.harvests}개 / ${s.foraged}개</strong></div><div><span>완성한 수프 / 의뢰</span><strong>${s.cooked}개 / ${s.orders}건</strong></div><div><span>오늘 수입</span><strong>+${s.income}G</strong></div><div><span>시설에 쓴 돈</span><strong>−${s.spent}G</strong></div><div><span>남은 동전</span><strong>${state.coins}G</strong></div>`;$('day-screen').classList.remove('hidden');saveGame();
}
function nextDay(){
  if(phase!=='summary')return;state.day++;state.dayTime=0;state.dayStats=freshStats();state.player={x:5*T+12,y:7*T+12,facing:1,walk:0};state.path=[];state.pending=null;
  for(const p of state.plots)if(p.crop&&(p.crop!=='flower'||atFarm('moth')))p.growth=1;
  phase='playing';$('day-screen').classList.add('hidden');toast(`${state.day}일 차 아침이에요. 채집물과 의뢰가 돌아왔고, 밭도 자랐어요!`);tone(830,.2);checkMilestone();updateUI();saveGame();canvas.focus({preventScroll:true});
}
function setRole(id,role){if(phase!=='playing'||!state.friends[id])return;if(role==='companion')for(const s of species)if(state.friends[s.id]==='companion')state.friends[s.id]='farm';state.friends[id]=role;state.path=[];state.pending=null;toast(`${species.find(s=>s.id===id).name}${role==='farm'?'이 농장을 돌봐요.':'이 함께 걸어요. 기존 동행은 농장으로 돌아갔어요.'}`);tone(560);updateUI();saveGame();canvas.focus({preventScroll:true});}
function objective(){
  if(state.harvests===0)return [1,'아침: 첫 당근을 수확해요','주황색 당근을 클릭해서 수확해요. 빈 밭에는 무료 씨앗을 심고, 오두막 주변의 허브와 목재도 채집해 보세요.'];
  if(state.coins===0&&!state.upgrades.garden&&!state.upgrades.kitchen&&!state.soup)return [2,'오늘의 수프를 만들어요','당근 2개와 허브 1개를 모아 야외 화덕에서 요리해요. 수프는 납품대에서 12G를 받고, 동전과 목재로 시설을 고쳐요.'];
  if(state.coins===0&&state.soup&&!state.upgrades.garden&&!state.upgrades.kitchen)return [2,'토리에게 수프를 전해요','오른쪽 납품대 의뢰 버튼을 누르면 상인에게 걸어가 수프를 팔아요. 의뢰는 하루 2개, 당근 판매는 제한이 없어요.'];
  if(!state.friends.slime)return state.roots<1?[1,'첫 당근을 수확해요','왼쪽 밭의 주황색 당근 곁에서 E를 눌러요. 빈 밭에도 씨앗을 심어 보세요.']:[1,'슬라임에게 마음을 전해요','밭 북동쪽 물방울 슬라임에게 당근 1개를 선물해요. 친구를 클릭하거나 곁에서 E.'];
  if(!state.bridge)return [2,'개울 너머로 함께 가요','친구 목록에서 슬라임을 동행으로 바꿔요. 개울 중앙 표식 곁에서 E를 눌러 길을 열어요.'];
  if(!state.friends.mole)return [3,state.friends.moth?'두더지도 초대해요':'어떤 친구를 먼저 만날까요?','두더지는 동쪽 들판에서 당근 2개를, 나방은 북쪽 숲에서 3개를 기다려요. 숲은 맨 오른쪽 오솔길로도 갈 수 있어요.'];
  if(!state.friends.moth)return [4,'작은 불씨와 친구가 돼요','북쪽 나방에게 당근 3개를 선물해요. 두더지와 동행해 밝은 바위를 깨면 지름길! 맨 오른쪽 오솔길로 돌아갈 수도 있어요.'];
  if(!state.lit)return [5,'숲의 등불을 밝혀요','불씨 나방을 동행으로 바꾸고 숲 오른쪽 등불 곁에서 E. 달빛꽃 씨앗이 나타날 거예요.'];
  if(!state.flowers&&!state.restored)return [5,'달빛꽃 한 송이를 길러요','나방을 농장에 보내고 달빛꽃 씨앗을 선택해요. 왼쪽 농장의 빈 밭에 심고 수확하세요.'];
  if(!state.restored)return [6,'잠든 고목을 깨워요','동쪽 섬 남쪽 고목에 달빛꽃을 전해요. 세 친구가 함께 만든 작은 기적이에요.'];
  if(!state.upgrades.garden)return [7,'더 넉넉한 밭을 만들어요','작업대에서 24G와 목재 3개로 밭을 12칸으로 넓혀요. 수프 의뢰가 끝났다면 당근을 팔거나 잠들고 내일의 의뢰를 받아요.'];
  if(!state.upgrades.kitchen)return [8,'부엌에 지붕을 올려요','30G와 목재 4개로 부엌을 수리해요. 수프 납품가가 18G로 올라요. 두더지 동행은 목재 +1, 나방 동행은 허브 +1!'];
  return [8,'우리의 생활 터전이 되었어요','고목과 두 시설을 모두 되살렸어요. 내일도 수프를 만들고 농장을 가꿔요. 친구와 동행하면 채집 보너스를 얻을 수 있어요.'];
}
function updateUI(){
  const minutes=Math.min(1320,Math.floor(state.dayTime*2)+480);$('day').textContent=`DAY ${String(state.day).padStart(2,'0')} · ${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}${minutes===1320?' · 편히 쉬어도 좋아요':''}`;
  $('roots').textContent=state.roots;$('flowers').textContent=state.flowers;$('level').textContent=`Lv.${1+Math.floor(state.xp/4)}`;$('xp').textContent=`${state.xp%4} / 4`;
  for(const key of ['herbs','wood','soup','coins'])$(key).textContent=state[key];
  $('order-status').textContent=`수프 1 → ${state.upgrades.kitchen?18:12}G · 남은 의뢰 ${2-state.dayStats.orders} / 2`;$('day-stats').textContent=`오늘 수입 ${state.dayStats.income}G`;
  for(const id of ['cook','fulfill','sell-root','upgrade-garden','upgrade-kitchen','sleep'])$(id).disabled=phase!=='playing'||id==='upgrade-garden'&&state.upgrades.garden||id==='upgrade-kitchen'&&state.upgrades.kitchen;
  $('upgrade-garden').querySelector('small').textContent=state.upgrades.garden?'완료 · 12칸의 밭':'24G + 목재 3';$('upgrade-kitchen').querySelector('small').textContent=state.upgrades.kitchen?'완료 · 수프 납품가 18G':'30G + 목재 4 · 수프 납품가 18G';
  const completed=[state.harvests>0,state.coins>0||state.upgrades.garden||state.upgrades.kitchen,!!state.friends.slime,state.bridge,Object.keys(state.friends).length===3,state.restored,state.upgrades.garden,state.upgrades.kitchen].filter(Boolean).length;
  const [,title,body]=objective();$('goal-title').textContent=title;$('goal-body').textContent=body;$('progress').textContent=`${completed} / 8`;$('progress-bar').style.width=`${completed/8*100}%`;
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
  cookingSteam=Math.max(0,cookingSteam-dt);merchantReaction=Math.max(0,merchantReaction-dt);
  if(toastTimer>0){toastTimer-=dt;if(toastTimer<=0)$('toast').classList.remove('visible');}
  if(phase!=='playing')return;
  state.elapsed+=dt;state.dayTime=Math.min(420,state.dayTime+dt);let dx=(keys.d||keys.arrowright?1:0)-(keys.a||keys.arrowleft?1:0),dy=(keys.s||keys.arrowdown?1:0)-(keys.w||keys.arrowup?1:0);
  if(dx||dy){state.path=[];state.pending=null;}else if(state.path.length){const p=state.path[0],d=Math.hypot(p.x-state.player.x,p.y-state.player.y);if(d<2){state.player.x=p.x;state.player.y=p.y;state.path.shift();}else{dx=(p.x-state.player.x)/d;dy=(p.y-state.player.y)/d;}}
  const mag=Math.hypot(dx,dy);if(mag){dx/=mag;dy/=mag;const speed=91;const nx=state.player.x+dx*speed*dt,ny=state.player.y+dy*speed*dt;if(!blocked(nx,state.player.y))state.player.x=nx;if(!blocked(state.player.x,ny))state.player.y=ny;state.player.walk+=dt*9;if(dx)state.player.facing=Math.sign(dx);}else state.player.walk=0;
  if(!state.path.length&&state.pending){const target=state.pending;state.pending=null;interact(target);}
  if(keys.action){keys.action=false;interact();}
  if(phase!=='playing')return;
  const level=1+Math.floor(state.xp/4);for(const p of state.plots)if(p.crop&&p.growth<1&&(p.crop!=='flower'||atFarm('moth'))){p.growth=Math.min(1,p.growth+dt/(p.crop==='root'?12:25)*(atFarm('slime')?2:1)*(1+Math.min(level-1,5)*.05));}
  const target=nearest();$('prompt').textContent=target?`E · ${actionLabel(target)}`:'';
  const px=state.player.x/T,py=state.player.y/T;$('location').textContent=py<6&&px>18?'불씨의 숨은 숲':px>14?(py>12?'잠든 고목':'뿌리의 들판'):'씨앗 정원';
  const minutes=Math.min(1320,Math.floor(state.dayTime*2)+480);$('day').textContent=`DAY ${String(state.day).padStart(2,'0')} · ${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}${minutes===1320?' · 편히 쉬어도 좋아요':''}`;
  uiTimer+=dt;if(uiTimer>.3){uiTimer=0;updateUI();}
  saveTimer+=dt;if(saveTimer>=2){saveTimer=0;saveGame();}
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
function drawSettlement(){
  // Hand-drawn pixel workstations give the daily routine a physical home.
  const sx=stations.stove.x*T+12,sy=stations.stove.y*T+12;
  rect(ctx,sx-17,sy+7,35,9,'#73846b');rect(ctx,sx-14,sy+4,28,10,'#9f9b7b');rect(ctx,sx-10,sy+2,21,4,'#c1b795');
  for(let i=0;i<4;i++)rect(ctx,sx-11+i*7,sy+12,4,2,'#777e69');rect(ctx,sx-7,sy+5,14,7,'#776955');
  rect(ctx,sx-5,sy+5,10,4,'#d79659');rect(ctx,sx-2,sy+4-Math.floor(Math.sin(time*7)*1.5),4,5,'#efcb7b');
  rect(ctx,sx-12,sy-9,24,10,'#536863');rect(ctx,sx-9,sy-11,18,5,'#7c9180');rect(ctx,sx-7,sy-10,14,2,'#c19d69');rect(ctx,sx-16,sy-7,5,3,'#536863');rect(ctx,sx+11,sy-7,5,3,'#536863');
  for(let i=0;i<(cookingSteam>0?6:2);i++){const rise=(time*13+i*8)%28;rect(ctx,sx-6+(i*7)%13+Math.sin(time*2+i)*2,sy-11-rise,3,3,`rgba(238,236,213,${.5-rise/70})`);}
  if(state.upgrades.kitchen){
    rect(ctx,sx-30,sy-33,4,48,'#8c7653');rect(ctx,sx+26,sy-33,4,48,'#8c7653');rect(ctx,sx-34,sy-41,68,11,'#876c52');rect(ctx,sx-28,sy-47,56,8,'#9e815c');rect(ctx,sx-20,sy-53,40,8,'#b89a6b');
    for(let i=0;i<5;i++)rect(ctx,sx-29+i*13,sy-38,11,3,'#b49364');rect(ctx,sx+25,sy-22,5,9,'#e8c482');
  }else{rect(ctx,sx+22,sy-2,9,15,'#9f885f');rect(ctx,sx+20,sy-5,13,4,'#c3a677');}
  label(sx,sy+29,state.upgrades.kitchen?'지붕 있는 부엌':'야외 화덕');
  const wx=stations.workbench.x*T+12,wy=stations.workbench.y*T+12;
  rect(ctx,wx-16,wy-6,32,11,'#a27f55');rect(ctx,wx-16,wy-7,32,3,'#d0ac72');rect(ctx,wx-13,wy+4,4,10,'#8d7655');rect(ctx,wx+9,wy+4,4,10,'#8d7655');
  rect(ctx,wx-8,wy-12,12,3,'#ddd3a8');rect(ctx,wx+5,wy-15,3,11,'#867c62');rect(ctx,wx+1,wy-17,10,4,'#a6aaa0');rect(ctx,wx-5,wy-3,16,1,'#7e684c');label(wx,wy+29,'작업대');
  const bx=stations.board.x*T+12,by=stations.board.y*T+12;
  rect(ctx,bx-17,by-10,32,28,'#a58459');rect(ctx,bx-20,by-12,38,5,'#c9aa70');rect(ctx,bx-16,by+4,30,2,'#7f6b4a');rect(ctx,bx-12,by-6,9,8,'#ddd0a1');rect(ctx,bx+4,by-6,8,8,'#c3b18a');
  rect(ctx,bx+24,by-19,3,34,'#937c55');rect(ctx,bx+17,by-21,20,20,'#ab8a5e');rect(ctx,bx+20,by-18,14,14,'#e5d8ae');rect(ctx,bx+22,by-14,10,2,'#a79972');rect(ctx,bx+22,by-10,7,2,'#a79972');
  // Tori, the supply merchant: a scarf, linen apron, and a friendly nod.
  const nod=merchantReaction>0?Math.sin(time*9):0;rect(ctx,bx-5,by-28+nod,13,15,'#54777a');rect(ctx,bx-4,by-20+nod,11,7,'#d4cda8');rect(ctx,bx-5,by-37+nod,13,10,'#d6ac88');rect(ctx,bx-7,by-41+nod,17,6,'#947658');rect(ctx,bx-10,by-37+nod,22,3,'#baa175');rect(ctx,bx-3,by-30+nod,2,2,'#4b5547');rect(ctx,bx+4,by-30+nod,2,2,'#4b5547');rect(ctx,bx-7,by-26+nod,16,3,'#b86f5c');
  label(bx,by+31,'토리의 납품대');if(merchantReaction>0)label(bx,by-51,'고마워요!', '#f8dfa4');
  label(5.5*T,7.8*T,'오두막 · 휴식');
  for(const n of state.nodes){
    const x=n.x*T+12,y=n.y*T+12,picked=n.pickedDay===state.day;
    if(n.kind==='herb'){
      rect(ctx,x-9,y+4,19,7,'#819362');
      if(!picked){for(let i=0;i<3;i++){rect(ctx,x-6+i*6,y-7+i%2*3,3,14,'#50795c');rect(ctx,x-9+i*6,y-5+i%2*3,8,4,'#6b9e71');rect(ctx,x-7+i*6,y-9+i%2*3,5,3,'#a0be83');}rect(ctx,x+1,y-10,3,3,'#d9b8d2');}
      else{rect(ctx,x-5,y+1,3,4,'#76905d');rect(ctx,x+3,y+2,3,3,'#76905d');}
    }else{
      rect(ctx,x-12,y+6,25,4,'#56744a33');
      if(!picked){rect(ctx,x-11,y-2,23,9,'#a38359');rect(ctx,x-11,y-2,5,9,'#d3b67f');rect(ctx,x-10,y,3,5,'#b89762');rect(ctx,x-4,y,14,2,'#7f6a4b');rect(ctx,x+4,y-7,4,8,'#91754e');rect(ctx,x+7,y-9,6,3,'#a58a5c');}
      else{rect(ctx,x-5,y+3,8,3,'#9b845c');rect(ctx,x+5,y+4,4,2,'#b69d6c');}
    }
    label(x,y+25,picked?'내일 다시':n.kind==='herb'?`허브 +${withFriend('moth')?2:1}`:`목재 +${withFriend('mole')?2:1}`,picked?'#b1bd9a':n.kind==='herb'?'#d9e9b5':'#e9d4a6');
  }
}
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
  if(!state.upgrades.garden)for(const [x,y]of expandedPositions){rect(ctx,x*T+2,y*T+3,17,13,'#a5af77');for(let i=0;i<3;i++)rect(ctx,x*T+4+i*5,y*T+8,2,3,'#c4c796');}
  for(const p of state.plots){const x=p.x*T,y=p.y*T;rect(ctx,x-1,y-1,23,22,'#846e50');rect(ctx,x+1,y+1,19,17,'#9e7d52');for(let i=0;i<3;i++)rect(ctx,x+3,y+4+i*5,15,1,'#876b4a');if(p.crop){const growth=p.growth,off=Math.sin(time*2+p.x)*.7;if(p.crop==='root'){rect(ctx,x+9,y+10,4,7,'#779048');rect(ctx,x+5,y+8,6,3,'#86a752');rect(ctx,x+12,y+6,5,3,'#729848');if(growth>.5){rect(ctx,x+7,y+11,9,7,growth>=1?'#e7a258':'#baa56a');rect(ctx,x+9,y+17,5,3,'#cc8549');}if(growth>=1){rect(ctx,x+7,y+6+off,3,6,'#528f4c');rect(ctx,x+11,y+4+off,3,8,'#6a9d4c');}}else{rect(ctx,x+10,y+7,2,11,'#5f8c62');rect(ctx,x+6,y+10,4,3,'#6d9e70');if(growth>.4)flower(x+10,y+8+off,growth>=1?'#e7d8f4':'#bba9d0');}if(growth<1){rect(ctx,x+3,y+21,16,2,'#766f4a');rect(ctx,x+3,y+21,Math.floor(growth*16),2,p.crop==='flower'?'#d6c3e6':'#c8d88a');}else if(Math.sin(time*3+p.x)>0)rect(ctx,x+19,y+2,2,2,'#faf0bd');}}
  // Cottage.
  rect(ctx,4*T,5*T,3*T,2*T,'#d6c496');rect(ctx,4*T-6,5*T-10,3*T+12,12,'#697c61');rect(ctx,4*T+4,5*T-20,3*T-8,10,'#7a8a65');rect(ctx,4*T+16,5*T-28,3*T-32,8,'#95a17b');rect(ctx,5*T,6*T,14,24,'#7c8261');rect(ctx,4*T+8,5*T+12,12,12,'#718c7b');rect(ctx,4*T+12,5*T+13,3,10,'#b6c79d');
  const trees=[[3,5],[3,8],[3,15],[6,3],[8,3],[11,4],[12,15],[10,17],[16,4],[16,7],[18,16],[21,16],[27,10],[27,13],[21,3],[27,4]];for(const [x,y]of trees)pine(x*T+12,y*T+12,(x+y)%3===0);
  for(let i=0;i<43;i++){const x=3+(i*7)%24,y=3+(i*11)%14;if(walkable(x,y)&&!(x>=4&&x<=9&&y>=9&&y<=14)&&!(y===10)&&!(x>20&&y<7))flower(x*T+7,y*T+17,i%3===0?'#efe1a6':'#c8d7a2');}
  drawSettlement();
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
  label(6.5*T,8.8*T,`씨앗 정원 · ${state.plots.length}칸`);label(ax,ay+30,state.restored?'다시 피어난 고목':'잠든 고목');
  if(state.path.length){const end=state.path[state.path.length-1];ctx.strokeStyle='#f5efc499';ctx.lineWidth=1;ctx.strokeRect(end.x-6,end.y-4,12,8);}
  const target=phase==='playing'?nearest():null;if(target){ctx.strokeStyle='#fff5c8';ctx.lineWidth=1;ctx.strokeRect(target.x*T-2,target.y*T-2,T+4,T+4);}
  for(const particle of particles)rect(ctx,particle.x,particle.y,3,3,particle.color);
  // Soft shoreline and drifting flecks keep the whole island alive.
  for(let i=0;i<8;i++){const x=(i*93+time*5)%720,y=70+(i*61)%340+Math.sin(time*.4+i)*10;rect(ctx,x,y,2,2,'#edf1c45c');}
  const dusk=Math.max(0,Math.min(1,(state.dayTime-220)/90)),night=Math.max(0,Math.min(1,(state.dayTime-310)/110));
  if(dusk){ctx.fillStyle=`rgba(171,104,67,${dusk*.11})`;ctx.fillRect(0,0,720,480);}if(night){ctx.fillStyle=`rgba(27,41,72,${night*.25})`;ctx.fillRect(0,0,720,480);}
  if(dusk){const lx=4*T+14,ly=5*T+18;ctx.fillStyle=`rgba(245,195,104,${.08+dusk*.1})`;ctx.beginPath();ctx.arc(lx,ly,25,0,Math.PI*2);ctx.fill();rect(ctx,lx-5,ly-6,10,11,'#eacc8b');rect(ctx,lx-1,ly-6,2,11,'#9f8661');rect(ctx,lx-5,ly-1,10,2,'#9f8661');}
}
canvas.addEventListener('pointerdown',e=>{if(phase!=='playing')return;canvas.focus({preventScroll:true});const box=canvas.getBoundingClientRect(),x=Math.floor((e.clientX-box.left)/box.width*W),y=Math.floor((e.clientY-box.top)/box.height*H);const target=targets().find(t=>t.x===x&&t.y===y);pathTo(x,y,target);});
document.addEventListener('keydown',e=>{if(/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;const key=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','e',' '].includes(key)&&phase==='playing'){if(e.target.tagName==='BUTTON'&&key===' ')return;e.preventDefault();if(key==='e'||key===' '){if(!e.repeat)keys.action=true;}else keys[key]=true;}});
document.addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false;});
window.addEventListener('blur',()=>{Object.keys(keys).forEach(k=>delete keys[k]);saveGame();});
window.addEventListener('pagehide',()=>saveGame());
document.addEventListener('visibilitychange',()=>{if(document.hidden){Object.keys(keys).forEach(k=>delete keys[k]);saveGame();}last=performance.now();accumulator=0;});
$('roster').addEventListener('click',e=>{const b=e.target.closest('[data-role]');if(b)setRole(b.dataset.id,b.dataset.role);});
['root','flower'].forEach(id=>$(`seed-${id}`).addEventListener('click',()=>{if(phase!=='playing'||id==='flower'&&!state.lit)return;state.seed=id;updateUI();saveGame();canvas.focus({preventScroll:true});}));
$('start').addEventListener('click',()=>{const resumed=!!savedGame;if(savedGame){state=savedGame;savedGame=null;if(blocked(state.player.x,state.player.y))state.player={x:5*T+12,y:7*T+12,facing:1,walk:0};}phase='playing';$('start-screen').classList.add('hidden');toast(resumed?`${state.day}일 차 섬으로 돌아왔어요. 하던 일을 이어가 볼까요?`:'반가워요! 밭의 익은 당근을 수확하고 빈 밭에도 심어 보세요.');updateUI();saveGame();canvas.focus({preventScroll:true});});
$('continue').addEventListener('click',()=>{phase='playing';$('win-screen').classList.add('hidden');updateUI();saveGame();canvas.focus({preventScroll:true});});
function restartGame(){if(window.confirm('섬을 처음부터 시작할까요? 이 게임의 저장과 지금까지의 진행이 사라져요.')){Object.keys(keys).forEach(k=>delete keys[k]);let removed=true;try{localStorage.removeItem(SAVE_KEY);}catch{removed=false;}reset();$('save-status').textContent=removed?'새로운 섬 · 시작하면 자동 저장돼요.':'기존 저장을 지우지 못했어요. 새 게임을 시작하면 저장을 다시 시도해요.';}}
$('restart').addEventListener('click',restartGame);$('new-game-title').addEventListener('click',restartGame);
for(const action of ['cook','fulfill','sell-root','upgrade-garden','upgrade-kitchen','sleep'])$(action).addEventListener('click',()=>requestOperation(action));
$('next-day').addEventListener('click',nextDay);$('keep-playing').addEventListener('click',()=>{if(phase!=='summary')return;phase='playing';$('day-screen').classList.add('hidden');updateUI();canvas.focus({preventScroll:true});});
$('save').addEventListener('click',()=>saveGame(true));
document.querySelectorAll('.panel-jump').forEach(button=>button.addEventListener('click',()=>{const card=document.querySelector(`.sidebar .${button.dataset.panel}`);if(card)card.scrollIntoView({block:'start',behavior:'smooth'});}));
$('sound').addEventListener('click',()=>{sound=!sound;$('sound').textContent=sound?'소리 켜짐':'소리 꺼짐';$('sound').setAttribute('aria-pressed',String(sound));tone();});
function frame(now){accumulator+=Math.min((now-last)/1000,.1);last=now;while(accumulator>=1/60){update(1/60);accumulator-=1/60;}render();requestAnimationFrame(frame);}
// Read-only inspection for playtest evidence; gameplay can only change through normal input.
window.mossGame={getSnapshot:()=>JSON.parse(JSON.stringify({phase,...state,objective:objective(),saveVersion:SAVE_VERSION,stations}))};
reset();readSave();requestAnimationFrame(frame);
})();
