(() => {
'use strict';
const $ = id => document.getElementById(id);
const canvas = $('world'), ctx = canvas.getContext('2d');
const T = 24, W = 30, H = 20;
const species = [
  {id:'slime',name:'물방울 슬라임',color:'#80cbd1',cost:1,x:10,y:7,description:'농장: 당근 수확 +1 · 동행: 개울 길 열기'},
  {id:'mole',name:'뿌리 두더지',color:'#bf9676',cost:2,x:20,y:11,description:'농장: 수확 +1 · 동행: 목재 +1 / 바위 깨기'},
  {id:'moth',name:'불씨 나방',color:'#efbd72',cost:3,x:24,y:3,description:'농장: 달빛꽃 재배 · 동행: 허브 +1 / 숲 밝히기'}
];
const plotPositions = [[5,10],[6,10],[7,10],[8,10],[5,12],[6,12],[7,12],[8,12]];
const expandedPositions = [[5,11],[6,11],[7,11],[8,11]];
const SAVE_KEY='moss-and-monsters:v3', SAVE_VERSION=3;
const stations={cottage:{kind:'cottage',x:5,y:7},stove:{kind:'stove',x:9,y:6},board:{kind:'board',x:11,y:14},workbench:{kind:'workbench',x:10,y:12},cave:{kind:'cave',x:12,y:4},research:{kind:'research',x:8,y:16}};
const homeTargets=[{kind:'bed',x:10,y:6},{kind:'home-exit',x:15,y:14},{kind:'seed-aid',x:20,y:7}];
const RESEARCH=[{ore:4,wood:3,coins:12},{relic:2,flowers:1,coins:20},{crystal:3,roots:4,coins:30}];
const RECIPES={soup:{roots:2,herbs:1,energy:1},ration:{roots:2,energy:1},seeds:{roots:1,energy:1},feed:{roots:2,energy:1}};
const CONTRACTS=[{item:'ore',amount:3,reward:12,supply:'rootSeeds',count:2},{item:'relic',amount:1,reward:18,supply:'herbs',count:2},{item:'crystal',amount:1,reward:24,supply:'flowerSeeds',count:1}];
const forageNodes=[{id:'herb-a',kind:'herb',x:8,y:7},{id:'herb-b',kind:'herb',x:11,y:12},{id:'herb-c',kind:'herb',x:17,y:12},{id:'herb-d',kind:'herb',x:22,y:4},{id:'wood-a',kind:'wood',x:3,y:11},{id:'wood-b',kind:'wood',x:10,y:5},{id:'wood-c',kind:'wood',x:11,y:16},{id:'wood-d',kind:'wood',x:19,y:14}];
const freshStats=()=>({harvests:0,foraged:0,cooked:0,income:0,spent:0,orders:0});
const keys = {}, particles = [];
let state, phase='title', last=performance.now(), accumulator=0, sound=false, audioContext, toastTimer=0, uiTimer=0, time=0,saveTimer=0,savedGame=null,saveFailureShown=false,cookingSteam=0,merchantReaction=0,attackCooldown=0,attackFlash=0,hurtFlash=0;
function reset(){
  state={scene:'home',player:{x:15*T+12,y:12*T+12,facing:1,walk:0},roots:0,flowers:0,herbs:0,wood:0,soup:0,coins:0,xp:0,rootSeeds:8,flowerSeeds:0,rations:0,ore:0,relic:0,crystal:0,hp:100,energy:40,mealsEaten:0,aidDay:0,feedDay:0,bonds:{slime:0,mole:0,moth:0},research:0,selectedDepth:1,journal:[false,false,false],clears:[0,0,0],contracts:0,dungeon:null,evacuated:false,seed:'root',friends:{},bridge:false,gate:false,lit:false,restored:false,completed:false,elapsed:0,day:1,dayTime:0,dayStats:freshStats(),upgrades:{garden:false,kitchen:false},nodes:forageNodes.map(n=>({...n,pickedDay:0})),path:[],pending:null,harvests:0,interactions:0,plots:plotPositions.map(([x,y],i)=>({x,y,crop:i<2?'root':null,growth:i<2?1:0,plantedDay:0}))};
  particles.length=0; phase='title';savedGame=null;saveTimer=0;cookingSteam=0;merchantReaction=0;attackCooldown=0;attackFlash=0;hurtFlash=0;$('start-screen').classList.remove('hidden');$('win-screen').classList.add('hidden');$('day-screen').classList.add('hidden');$('new-game-title').classList.add('hidden');$('start').innerHTML='새 생활 시작하기 <span>↗</span>';$('start-description').innerHTML='씨앗과 기력을 나눠 쓰고, 수확으로 탐험을 준비해요.<br>집에서 쉬고, 지하 3층의 유물로 연구를 이어가요.<br>v3는 새로 시작하며 이전 v2 저장은 보존돼요.';$('roster').dataset.state='';uiTimer=0;updateUI();
}
function validateSave(raw){
  if(!raw||raw.version!==SAVE_VERSION||!raw.state||typeof raw.state!=='object')throw Error('지원하지 않는 저장 형식');
  const s=raw.state,isNum=(v,max=1e9)=>Number.isFinite(v)&&v>=0&&v<=max,isInt=(v,max=1e9)=>isNum(v,max)&&Number.isInteger(v);
  for(const key of ['roots','flowers','herbs','wood','soup','coins','xp','harvests','interactions','rootSeeds','flowerSeeds','rations','ore','relic','crystal','contracts'])if(!isInt(s[key]))throw Error('자원 데이터 오류');
  for(const key of ['bridge','gate','lit','restored','completed'])if(typeof s[key]!=='boolean')throw Error('진행 데이터 오류');
  if(!isInt(s.day,1e7)||s.day<1||!isNum(s.dayTime,420)||!isNum(s.elapsed)||!['root','flower'].includes(s.seed))throw Error('날짜 데이터 오류');
  if(!s.player||!isNum(s.player.x,720)||!isNum(s.player.y,480)||![-1,1].includes(s.player.facing))throw Error('위치 데이터 오류');
  if(!s.friends||typeof s.friends!=='object'||Array.isArray(s.friends)||Object.keys(s.friends).some(id=>!species.some(a=>a.id===id)||!['farm','companion'].includes(s.friends[id]))||Object.values(s.friends).filter(v=>v==='companion').length>1)throw Error('친구 데이터 오류');
  if((s.bridge&&!s.friends.slime)||(s.gate&&!s.friends.mole)||(s.lit&&!s.friends.moth)||(s.seed==='flower'&&!s.lit)||(s.restored&&Object.keys(s.friends).length!==3))throw Error('진행 순서 오류');
  if(!s.upgrades||typeof s.upgrades.garden!=='boolean'||typeof s.upgrades.kitchen!=='boolean')throw Error('시설 데이터 오류');
  const positions=s.upgrades.garden?[...plotPositions,...expandedPositions]:plotPositions;
  if(!Array.isArray(s.plots)||s.plots.length!==positions.length||s.plots.some((p,i)=>!p||p.x!==positions[i][0]||p.y!==positions[i][1]||![null,'root','flower'].includes(p.crop)||![0,1].includes(p.growth)||!isInt(p.plantedDay,s.day)))throw Error('밭 데이터 오류');
  if(!Array.isArray(s.nodes)||s.nodes.length!==forageNodes.length||s.nodes.some((n,i)=>!n||n.id!==forageNodes[i].id||n.kind!==forageNodes[i].kind||n.x!==forageNodes[i].x||n.y!==forageNodes[i].y||!isInt(n.pickedDay,s.day)))throw Error('채집 데이터 오류');
  if(!s.dayStats||Object.keys(freshStats()).some(k=>!isInt(s.dayStats[k]))||s.dayStats.orders>2)throw Error('하루 기록 오류');
  if(!['home','farm'].includes(s.scene)||s.dungeon!==null||!isInt(s.research,3)||!isInt(s.selectedDepth,Math.min(3,s.research+1))||s.selectedDepth<1||!isNum(s.hp,100)||!isNum(s.energy,s.research>=2?50:40)||!isInt(s.mealsEaten,2)||!isInt(s.aidDay,s.day)||!isInt(s.feedDay,s.day)||typeof s.evacuated!=='boolean')throw Error('탐험 상태 오류');
  if(!s.bonds||species.some(a=>!isInt(s.bonds[a.id],3))||!Array.isArray(s.journal)||s.journal.length!==3||s.journal.some(v=>typeof v!=='boolean')||!Array.isArray(s.clears)||s.clears.length!==3||s.clears.some(v=>!isInt(v)))throw Error('연구 기록 오류');
  if(s.completed&&s.research!==3)throw Error('완료 데이터 오류');
  // Build a known schema instead of spreading untrusted local storage properties.
  const clean={};for(const k of ['roots','flowers','herbs','wood','soup','coins','xp','harvests','interactions','bridge','gate','lit','restored','completed','day','dayTime','elapsed','seed','scene','rootSeeds','flowerSeeds','rations','ore','relic','crystal','hp','energy','mealsEaten','aidDay','feedDay','research','selectedDepth','contracts','evacuated'])clean[k]=s[k];
  clean.player={x:s.player.x,y:s.player.y,facing:s.player.facing,walk:0};clean.friends={};for(const a of species)if(s.friends[a.id])clean.friends[a.id]=s.friends[a.id];clean.upgrades={garden:s.upgrades.garden,kitchen:s.upgrades.kitchen};clean.dayStats=freshStats();for(const k of Object.keys(clean.dayStats))clean.dayStats[k]=s.dayStats[k];clean.plots=s.plots.map(p=>({x:p.x,y:p.y,crop:p.crop,growth:p.growth,plantedDay:p.plantedDay}));clean.nodes=s.nodes.map(n=>({id:n.id,kind:n.kind,x:n.x,y:n.y,pickedDay:n.pickedDay}));clean.bonds={slime:s.bonds.slime,mole:s.bonds.mole,moth:s.bonds.moth};clean.journal=[...s.journal];clean.clears=[...s.clears];clean.dungeon=null;clean.path=[];clean.pending=null;return clean;
}
function readSave(){
  try{const text=localStorage.getItem(SAVE_KEY);if(!text){if(localStorage.getItem('moss-and-monsters:v2'))$('save-status').textContent='이전 v2 저장은 그대로 보존됩니다. v3는 새로운 생활로 시작해요.';return;}savedGame=validateSave(JSON.parse(text));$('start').innerHTML=`${savedGame.day}일 차 이어서 하기 <span>↗</span>`;$('start-description').textContent=`저장된 생활 · 연구 ${savedGame.research}/3 · ${savedGame.coins}G${savedGame.evacuated?' · 지난 탐험은 안전 귀가 처리되며 미반환 전리품은 사라져요.':''}`;$('new-game-title').classList.remove('hidden');$('save-status').textContent='저장된 v3 생활을 찾았어요. 이어서 시작할 수 있어요.';}
  catch{savedGame=null;$('save-status').textContent='저장을 읽지 못했어요. 새 게임은 가능하며 저장 상태를 다시 알려드릴게요.';}
}
function saveGame(manual=false){
  if(phase==='title'){if(manual)toast('섬 생활을 시작한 뒤 저장할 수 있어요.');return false;}
  try{const snapshot={...state};if(state.scene==='dungeon'){snapshot.scene='home';snapshot.player={x:15*T+12,y:12*T+12,facing:1,walk:0};snapshot.dungeon=null;snapshot.evacuated=true;}const clean=validateSave({version:SAVE_VERSION,state:snapshot});localStorage.setItem(SAVE_KEY,JSON.stringify({version:SAVE_VERSION,savedAt:Date.now(),state:clean}));saveFailureShown=false;$('save-status').textContent=state.scene==='dungeon'?'탐험 중 저장 · 재접속하면 귀가하며 미반환 전리품은 사라져요.':`${state.day}일 차 · v3 자동 저장됨`;if(manual)toast(state.scene==='dungeon'?'저장했어요. 지금 귀환해야 전리품이 보관돼요. 재접속 시 전리품 없이 집에서 시작해요.':'지금까지의 생활을 저장했어요.');return true;}
  catch{ $('save-status').textContent='저장할 수 없어요 · 탭을 닫으면 이번 진행이 사라질 수 있어요.';if(manual||!saveFailureShown)toast('브라우저 저장이 차단되었거나 공간이 부족해요. 지금은 이 탭에서 계속 플레이할 수 있어요.');saveFailureShown=true;return false;}
}
function checkMilestone(){
  if(state.completed||state.research<3)return;
  state.completed=true;phase='won';state.path=[];state.pending=null;$('win-summary').textContent=`${state.day}일 차, 지하 3층의 결정으로 탐사 등대를 복원했어요. 연구 3단계를 완료했습니다. 이후에는 유물 도감 3종, 각 층 클리어 기록과 순환 탐사 의뢰를 이어갈 수 있어요. 이 프로토타입의 던전은 고정 3층입니다.`;$('win-screen').classList.remove('hidden');burst(8*T,16*T,'#f5deb4',50);tone(1040,.4);
}
const atFarm = id => state.friends[id]==='farm';
const withFriend = id => state.friends[id]==='companion';
function terrain(x,y){
  if(state.scene==='home')return x>=7&&x<=22&&y>=4&&y<=15?'floor':'wall';
  if(state.scene==='dungeon')return dungeonTerrain(x,y,state.dungeon.floor);
  if(x<0||y<0||x>=W||y>=H)return 'sea';
  if(x<2||x>27||y<2||y>17||((x<4||x>25)&&(y<4||y>15)))return 'sea';
  if(x===14&&y>=2&&y<=17)return y===10&&state.bridge?'bridge':'river';
  if(y===6&&x>=18&&x<=27)return x===26||(x===23&&state.gate)?'path':'rock';
  if((x===18||x===19)&&y<6)return 'rock';
  return 'grass';
}
function walkable(x,y){return ['grass','bridge','path','floor'].includes(terrain(x,y));}
function blocked(px,py){for(const dx of [-6,6])for(const dy of [-4,4])if(!walkable(Math.floor((px+dx)/T),Math.floor((py+dy)/T)))return true;return false;}
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');toastTimer=4.2;}
function tone(f=480,d=.09){if(!sound)return;try{audioContext??=new (window.AudioContext||window.webkitAudioContext)();audioContext.resume();const o=audioContext.createOscillator(),g=audioContext.createGain();o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(.045,audioContext.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+d);o.connect(g);g.connect(audioContext.destination);o.start();o.stop(audioContext.currentTime+d);}catch{}}
function burst(x,y,color,n=10){for(let i=0;i<n;i++)particles.push({x,y,vx:(Math.random()-.5)*55,vy:-20-Math.random()*30,life:.7+Math.random()*.4,color});}
const maxEnergy=()=>state.research>=2?50:40;
const maxDepth=()=>Math.min(3,state.research+1);
const attackPower=()=>12+(state.research>=1?4:0)+species.reduce((sum,s)=>sum+(withFriend(s.id)?state.bonds[s.id]*2:0),0);
function spendEnergy(amount){if(state.energy<amount){toast(`기력이 ${amount} 필요해요. 집의 침대에서 쉬거나 수프를 먹어요. 이동과 귀환은 무료예요.`);return false;}state.energy-=amount;return true;}
function changeScene(scene,x,y){state.scene=scene;state.player={x:x*T+12,y:y*T+12,facing:1,walk:0};state.path=[];state.pending=null;Object.keys(keys).forEach(k=>delete keys[k]);particles.length=0;attackCooldown=0;updateUI();}
function dungeonTerrain(x,y,floor){
  if(x<3||x>26||y<3||y>16)return 'wall';
  if(floor===1&&x===13&&y>=5&&y<=12&&y!==9)return 'wall';
  if(floor===2&&((x===10&&y>=5&&y<=14&&y!==8)||(x===19&&y>=4&&y<=13&&y!==11)))return 'wall';
  if(floor===3&&y===9&&x>=7&&x<=23&&x!==12&&x!==20)return 'wall';
  return 'floor';
}
function populateFloor(floor){
  const run=state.dungeon;run.floor=floor;const positions=floor===1?[[10,8],[20,11]]:floor===2?[[8,7],[15,12],[23,6]]:[[9,6],[18,13],[23,5]];
  run.enemies=positions.map(([x,y],i)=>({id:`${floor}-${i}`,x:x*T+12,y:y*T+12,hp:floor===1?24:floor===2?36:44,maxHp:floor===1?24:floor===2?36:44,mode:'idle',timer:0,aimX:x*T+12,aimY:y*T+12}));
  const items=floor===1?[['ore',2,9,6],['ore',2,21,13]]:floor===2?[['ore',2,8,13],['relic',1,17,6],['relic',1,24,13]]:[['crystal',1,8,6],['crystal',1,17,13],['crystal',1,24,6]];
  run.loot=items.map(([item,count,x,y],i)=>({id:`${floor}-loot-${i}`,item,count,x,y,taken:false}));run.loot.push({id:`${floor}-journal`,item:'journal',count:1,x:24,y:15,taken:false});
  changeScene('dungeon',4,15);toast(`지하 ${floor}층 · J / Space로 공격, 붉은 예고 범위에서 물러나요. 귀환은 언제든 가능해요.`);
}
function enterDungeon(){
  if(state.rations<1){toast('탐험에 도시락 1개가 필요해요. 화덕에서 당근 2개로 만들어요.');return;}
  state.rations--;state.dungeon={floor:state.selectedDepth,enemies:[],loot:[],carried:{ore:0,relic:0,crystal:0},journals:[],clearedFloors:[]};state.evacuated=false;populateFloor(state.selectedDepth);saveGame();
}
function returnFromDungeon(knockedOut=false){
  if(state.scene!=='dungeon'||!state.dungeon)return;
  const run=state.dungeon;
  if(!knockedOut){for(const item of ['ore','relic','crystal'])state[item]+=run.carried[item];for(const floor of run.journals)state.journal[floor-1]=true;for(const floor of run.clearedFloors)state.clears[floor-1]++;}
  state.dungeon=null;state.evacuated=false;if(knockedOut){state.hp=35;state.energy=0;changeScene('home',15,12);toast('눈을 뜨니 집이에요. 탐험 중 얻은 미보관 전리품만 잃었어요. 침대에서 쉬면 회복돼요.');}else{changeScene('farm',12,5);toast(`무사히 귀환했어요! 광석 ${run.carried.ore}, 유물 ${run.carried.relic}, 결정 ${run.carried.crystal}을 보관했어요.`);}updateUI();saveGame();
}
function attack(){
  if(phase!=='playing'||state.scene!=='dungeon'||attackCooldown>0)return;
  attackCooldown=.48;if(!spendEnergy(1))return;attackFlash=.2;
  let hit=false;for(const enemy of state.dungeon.enemies)if(enemy.hp>0&&Math.hypot(enemy.x-state.player.x,enemy.y-state.player.y)<54){enemy.hp=Math.max(0,enemy.hp-attackPower());burst(enemy.x,enemy.y,'#e8cb91',5);hit=true;}
  tone(hit?270:410,.07);const run=state.dungeon;if(run.enemies.every(e=>e.hp===0)&&!run.clearedFloors.includes(run.floor)){run.clearedFloors.push(run.floor);toast('이 층이 조용해졌어요. 광물과 유물을 챙기고 계단 또는 귀환을 선택해요.');}updateUI();saveGame();
}
function updateCombat(dt){
  attackCooldown=Math.max(0,attackCooldown-dt);attackFlash=Math.max(0,attackFlash-dt);hurtFlash=Math.max(0,hurtFlash-dt);
  const tapped=keys.attack;keys.attack=false;
  if(state.scene!=='dungeon')return;
  if(tapped||keys.j||keys[' '])attack();
  for(const enemy of state.dungeon.enemies){
    if(enemy.hp<=0)continue;
    const dx=state.player.x-enemy.x,dy=state.player.y-enemy.y,dist=Math.hypot(dx,dy);
    if(enemy.mode==='windup'){
      enemy.timer-=dt;if(enemy.timer<=0){if(Math.hypot(state.player.x-enemy.aimX,state.player.y-enemy.aimY)<29&&hurtFlash<=0){state.hp=Math.max(0,state.hp-(state.dungeon.floor===1?10:state.dungeon.floor===2?14:18));hurtFlash=.6;burst(state.player.x,state.player.y,'#d78573');tone(150,.13);if(state.hp<=0){returnFromDungeon(true);return;}}enemy.mode='cooldown';enemy.timer=1.2;}
    }else if(enemy.mode==='cooldown'){enemy.timer-=dt;if(enemy.timer<=0)enemy.mode='idle';}
    else if(dist<42){enemy.mode='windup';enemy.timer=.95;enemy.aimX=state.player.x;enemy.aimY=state.player.y;}
    else if(dist<180&&dist>0){const speed=23+state.dungeon.floor*2,nx=enemy.x+dx/dist*speed*dt,ny=enemy.y+dy/dist*speed*dt;if(!blocked(nx,enemy.y))enemy.x=nx;if(!blocked(enemy.x,ny))enemy.y=ny;}
  }
}
function performResearch(){
  if(state.research>=3){toast('3단계 연구를 마쳤어요. 이제 탐사 의뢰와 유물 도감을 이어가요.');return;}
  const cost=RESEARCH[state.research];if(Object.entries(cost).some(([key,value])=>state[key]<value)){toast(`연구 재료가 부족해요. ${researchCostLabel()}`);return;}
  for(const [key,value]of Object.entries(cost))state[key]-=value;state.dayStats.spent+=cost.coins;state.research++;toast(state.research===1?'연구 1단계: 공격력 +4, 지하 2층 출발이 열렸어요.':state.research===2?'연구 2단계: 최대 기력 50, 지하 3층 출발이 열렸어요. 잠들면 기력을 채워요.':'지하 결정으로 탐사 등대를 복원했어요!');tone(960,.3);checkMilestone();
}
function researchCostLabel(){const names={ore:'광석',wood:'목재',coins:'G',relic:'유물',flowers:'달빛꽃',crystal:'결정',roots:'당근'};return state.research>=3?'연구 완료 · 고정 3층 탐사와 의뢰를 계속할 수 있어요.':Object.entries(RESEARCH[state.research]).map(([k,v])=>k==='coins'?`${v}G`:`${names[k]} ${v}`).join(' + ');}
function targets(){
  if(state.scene==='home')return homeTargets;
  if(state.scene==='dungeon')return [{kind:'dungeon-exit',x:4,y:15},{kind:'stairs',x:25,y:15},...state.dungeon.loot.filter(l=>!l.taken).map(l=>({kind:'loot',id:l.id,x:l.x,y:l.y}))];
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
  const basic={'bed':'침대에서 잠들기 · 체력 / 기력 회복','home-exit':'문을 열고 농장으로','seed-aid':'비상 씨앗 꾸러미 확인','cave':`지하 ${state.selectedDepth}층 탐험 · 도시락 1`,'research':'탐사 연구대','dungeon-exit':'전리품을 챙겨 귀환','stairs':'다음 층으로 · 추가 도시락 없음','loot':'탐험 전리품 수집'};if(basic[t.kind])return basic[t.kind];
  if(t.kind==='plot'){const p=state.plots[t.index];return !p.crop?`${state.seed==='root'?'당근':'달빛꽃'} 심기 · 씨앗 1 / 기력 2`:p.growth>=1?`${p.crop==='root'?'당근':'달빛꽃'} 수확 · 기력 1`:'내일 아침 수확 · 집에서 잠들면 성장';}
  if(t.kind==='friend'){const s=species.find(s=>s.id===t.id);return `${s.name}에게 당근 ${s.cost}개 선물`;}
  if(t.kind==='bridge')return '슬라임과 개울 길 열기';
  if(t.kind==='gate')return '두더지와 바위 깨기';
  if(t.kind==='lantern')return '나방과 숲 등불 밝히기';
  if(t.kind==='forage'){const n=state.nodes.find(n=>n.id===t.id);return n.pickedDay===state.day?'오늘은 채집했어요 · 내일 다시 자라요':`${n.kind==='herb'?'허브':'목재'} 채집${n.kind==='herb'&&withFriend('moth')||n.kind==='wood'&&withFriend('mole')?' · 동행 보너스 +1':''}`;}
  if(t.kind==='cottage')return '오두막 문 열고 집으로';
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
  if(target.kind==='home-exit'){changeScene('farm',5,8);toast('농장에 나왔어요. 수확과 채집, 요리와 탐험에 오늘의 기력을 나눠 써요.');saveGame();return;}
  if(target.kind==='bed'){openDaySummary();return;}
  if(target.kind==='seed-aid'){
    if(state.roots||state.rootSeeds||state.plots.some(p=>p.crop==='root'))toast('아직 당근, 씨앗 또는 자라는 당근이 있어요. 당근 1개를 씨앗 2개로 바꿀 수도 있어요.');
    else if(state.aidDay===state.day)toast('오늘의 비상 씨앗은 이미 받았어요. 잠든 뒤 다시 확인해요.');
    else{state.rootSeeds+=2;state.aidDay=state.day;toast('비상 당근 씨앗 2개를 받았어요. 기력 없이도 받을 수 있어요.');}updateUI();saveGame();return;
  }
  if(target.kind==='cave'){enterDungeon();return;}
  if(target.kind==='dungeon-exit'){returnFromDungeon();return;}
  if(target.kind==='stairs'){
    const run=state.dungeon;if(run.enemies.some(e=>e.hp>0)){toast('이 층의 적을 먼저 정리해야 계단을 사용할 수 있어요. 귀환은 언제든 가능해요.');return;}
    if(run.floor>=3){toast('가장 깊은 층이에요. 유물과 결정을 챙겨 귀환하세요.');return;}if(run.floor>=maxDepth()){toast('연구대에서 다음 연구를 완료하면 더 깊은 층으로 갈 수 있어요.');return;}populateFloor(run.floor+1);saveGame();return;
  }
  if(target.kind==='loot'){
    const run=state.dungeon,item=run.loot.find(l=>l.id===target.id);if(!item||item.taken)return;if(run.enemies.some(e=>e.hp>0)){toast('적을 모두 정리하면 안전하게 전리품을 챙길 수 있어요.');return;}
    item.taken=true;if(item.item==='journal'){if(!run.journals.includes(run.floor))run.journals.push(run.floor);toast(`지하 ${run.floor}층 유물 기록을 찾았어요. 귀환하면 도감에 남아요.`);}else{run.carried[item.item]+=item.count;toast(`탐험 가방에 ${item.item==='ore'?'광석':item.item==='relic'?'유물':'결정'} +${item.count}. 귀환해야 보관돼요.`);}tone(710);updateUI();saveGame();return;
  }
  if(target.kind==='plot'){
    const p=state.plots[target.index];
    if(!p.crop){if(state.seed==='flower'&&!atFarm('moth')){toast('달빛꽃은 불씨 나방이 농장에 있어야 자라요.');return;}const seedKey=state.seed==='root'?'rootSeeds':'flowerSeeds';if(state[seedKey]<1){toast('씨앗이 없어요. 당근 1개를 씨앗 2개로 바꾸거나 집의 비상 꾸러미를 확인해요.');return;}if(!spendEnergy(2))return;state[seedKey]--;p.crop=state.seed;p.growth=0;p.plantedDay=state.day;tone(420);burst(p.x*T+12,p.y*T+14,'#c7d87c',5);}
    else if(p.growth>=1){if(!spendEnergy(1))return;const n=p.crop==='root'?2+(atFarm('slime')?1:0)+(atFarm('mole')?1:0):1;if(p.crop==='root')state.roots+=n;else{state.flowers+=n;state.flowerSeeds++;}state.harvests++;state.dayStats.harvests+=n;state.xp++;burst(p.x*T+12,p.y*T+12,p.crop==='root'?'#f1bb6a':'#d5c2ec');toast(`${p.crop==='root'?'당근':'달빛꽃'} +${n}${p.crop==='flower'?' · 꽃 씨앗 1개를 다시 얻었어요.':' · 씨앗·음식·도시락·간식에 나눠 써요.'}`);p.crop=null;p.growth=0;tone(650);}
    else{toast(p.crop==='flower'&&!atFarm('moth')?'불씨 나방을 농장에 두고 잠들면 자라요.':'작물은 집에서 하룻밤 자고 나면 익어요. 기다리는 동안 탐험이나 채집을 해봐요.');}
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
    state.lit=true;state.flowerSeeds+=2;burst(25*T+12,4*T+12,'#f9e499',30);toast('달빛꽃 씨앗 2개를 발견했어요! 나방을 농장에 보내고 심은 뒤 잠들어요.');tone(980,.25);
  }else if(target.kind==='tree'){
    if(state.restored){toast('고목이 바람에 잎을 흔들어요. 오늘도 좋은 하루!');return;}
    if(Object.keys(state.friends).length<3||state.flowers<1){toast('고목을 깨우려면 친구 3종과 달빛꽃 1개가 필요해요.');return;}
    state.flowers--;state.restored=true;burst(25*T+12,13*T,'#ecddb8',70);toast('고목에 다시 꽃이 피었어요! 농장과 부엌도 고쳐 우리의 생활 터전을 완성해요.');tone(1040,.4);
  }else if(target.kind==='forage'){
    const n=state.nodes.find(n=>n.id===target.id);if(!n||n.pickedDay===state.day){toast('이곳은 오늘 채집했어요. 오두막에서 자고 나면 다시 준비돼요.');return;}
    if(!spendEnergy(2))return;
    const bonus=n.kind==='herb'?withFriend('moth'):withFriend('mole'),amount=bonus?2:1;n.pickedDay=state.day;state[n.kind==='herb'?'herbs':'wood']+=amount;state.dayStats.foraged+=amount;burst(n.x*T+12,n.y*T+12,n.kind==='herb'?'#c1d790':'#c9a070');toast(`${n.kind==='herb'?'허브':'목재'} +${amount}${bonus?' · 동행 친구가 더 찾아줬어요!':' · 내일 다시 채집할 수 있어요.'}`);tone(540);
  }else if(target.kind==='stove'||target.kind==='board'||target.kind==='workbench'||target.kind==='cottage'||target.kind==='research'){
    if(target.kind==='cottage'){changeScene('home',15,12);toast('집으로 돌아왔어요. 침대에서 쉬거나 비상 씨앗을 확인할 수 있어요.');saveGame();return;}
    if(target.action)performOperation(target.action);
    else if(target.kind==='research')performResearch();
    else if(target.kind==='stove')performOperation('cook');
    else if(target.kind==='board'){if(state.soup&&state.dayStats.orders<2)performOperation('fulfill');else toast('상인 토리: 수프 의뢰는 하루 2개예요. 당근은 언제든 2G에 사요! 오른쪽 납품대 버튼을 눌러 주세요.');}
    else if(target.kind==='workbench')toast('작업대: 오른쪽에서 밭 확장(24G + 목재 3) 또는 부엌 수리(30G + 목재 4)를 선택해요.');
    else openDaySummary();
  }
  checkMilestone();updateUI();saveGame();
}
function requestOperation(action){
  if(phase!=='playing')return;
  if(action==='retreat'){returnFromDungeon();return;}
  if(action==='eat-soup'||action==='feed-companion'){performOperation(action);updateUI();saveGame();return;}
  if(action==='go-home'&&state.scene==='dungeon')returnFromDungeon();
  if(action==='go-home'&&state.scene==='home'){toast('이미 집이에요. 침대에서 쉬어 가요.');return;}
  if(action==='sleep'&&state.scene!=='home'){toast('잠은 집 안의 침대에서 자요. 집으로 돌아가기 버튼을 눌러요.');return;}
  if(state.scene==='dungeon'){toast('먼저 귀환해서 전리품을 보관해요.');return;}
  if(state.scene==='home'&&action!=='sleep'){toast('아래쪽 문을 열고 농장으로 나가면 작업장을 이용할 수 있어요.');return;}
  const station=action==='sleep'?homeTargets[0]:action==='go-home'?stations.cottage:action==='enter-dungeon'?stations.cave:['research','contract'].includes(action)?stations.research:['cook','craft-ration'].includes(action)?stations.stove:['fulfill','sell-root'].includes(action)?stations.board:stations.workbench;
  const target={...station,action};state.path=[];state.pending=null;
  if(distance(target)<=39)interact(target);else{pathTo(target.x,target.y,target);toast(`${action==='sleep'?'오두막':station.kind==='stove'?'야외 화덕':station.kind==='board'?'납품대':'작업대'}로 걸어가요. 이동키를 누르면 취소돼요.`);}
  canvas.focus({preventScroll:true});
}
function performOperation(action){
  if(action==='eat-soup'){
    if(state.soup<1){toast('먹을 수프가 없어요. 화덕에서 당근 2 + 허브 1로 만들어요.');return;}if(state.mealsEaten>=2){toast('오늘은 두 끼를 모두 먹었어요. 더 회복하려면 집에서 쉬어요.');return;}if(state.hp>=100&&state.energy>=maxEnergy()){toast('이미 체력과 기력이 가득해요. 수프를 아껴 두세요.');return;}
    state.soup--;state.mealsEaten++;state.hp=Math.min(100,state.hp+30);state.energy=Math.min(maxEnergy(),state.energy+6);toast('따뜻한 수프 한 그릇. 체력 +30, 기력 +6을 회복했어요.');tone(820,.15);
  }else if(action==='craft-ration'||action==='save-seeds'){
    const need=action==='craft-ration'?2:1;if(state.roots<need){toast(`당근 ${need}개가 필요해요.`);return;}if(!spendEnergy(1))return;state.roots-=need;if(action==='craft-ration'){state.rations++;toast('탐험 도시락 +1 · 던전 입장 한 번에 하나를 사용해요.');}else{state.rootSeeds+=2;toast('당근에서 씨앗 2개를 받았어요. 내일 수확을 준비해요.');}tone(600);
  }else if(action==='feed-companion'){
    if(state.scene==='dungeon'){toast('훈련 간식은 탐험 전에 준비해요.');return;}const friend=species.find(s=>withFriend(s.id));if(!friend){toast('함께 훈련할 친구를 동행으로 선택해요.');return;}if(state.feedDay===state.day){toast('오늘의 훈련 간식은 이미 나눴어요.');return;}if(state.bonds[friend.id]>=3){toast('이 친구와의 유대는 최대 3단계예요.');return;}if(state.roots<2){toast('훈련 간식에는 당근 2개가 필요해요.');return;}if(!spendEnergy(1))return;state.roots-=2;state.feedDay=state.day;state.bonds[friend.id]++;toast(`${friend.name} 유대 ${state.bonds[friend.id]}/3 · 동행 중 공격력 +${state.bonds[friend.id]*2}`);
  }else if(action==='research'){performResearch();
  }else if(action==='contract'){
    if(state.research<3){toast('3단계 연구 후 탐사 의뢰가 열려요.');return;}const c=CONTRACTS[state.contracts%3];if(state[c.item]<c.amount){toast('이번 의뢰의 탐험 재료가 부족해요. 연구 카드에서 품목을 확인해요.');return;}state[c.item]-=c.amount;state.coins+=c.reward;state[c.supply]+=c.count;state.contracts++;state.dayStats.income+=c.reward;toast(`탐사 의뢰 완료! ${c.reward}G와 보급품을 받았어요. 다음 의뢰로 바뀌었어요.`);tone(840,.2);
  }else if(action==='cook'){
    if(state.roots<2||state.herbs<1){toast('수프 한 그릇에는 당근 2개와 허브 1개가 필요해요. 초록 잎 덤불을 채집해 보세요.');return;}
    if(!spendEnergy(1))return;
    state.roots-=2;state.herbs--;state.soup++;state.dayStats.cooked++;cookingSteam=3;burst(9*T+12,6*T,'#eee8d1',12);toast('보글보글, 당근 허브 수프 +1! 납품대에서 의뢰를 완료해요.');tone(760,.2);
  }else if(action==='fulfill'){
    if(state.dayStats.orders>=2){toast('토리: 오늘의 수프 의뢰는 모두 채웠어요. 내일 또 부탁해요! 당근은 계속 살게요.');return;}
    if(state.soup<1){toast('토리: 당근 허브 수프 1그릇을 부탁해요. 화덕에서 만들 수 있어요.');return;}
    const price=state.upgrades.kitchen?18:12;state.soup--;state.coins+=price;state.dayStats.income+=price;state.dayStats.orders++;merchantReaction=3;burst(11*T+12,14*T,'#f4d578',12);toast(`토리: 따뜻한 수프, 고마워요! +${price}G · 오늘 남은 의뢰 ${2-state.dayStats.orders}개`);tone(880,.2);
  }else if(action==='sell-root'){
    if(state.roots<1){toast('팔 당근이 없어요. 씨앗을 심고 하룻밤 자면 자라요.');return;}
    state.roots--;state.coins+=2;state.dayStats.income+=2;merchantReaction=2;toast('토리: 싱싱한 당근이네요. +2G');tone(610);
  }else if(action==='upgrade-garden'||action==='upgrade-kitchen'){
    const which=action==='upgrade-garden'?'garden':'kitchen',cost=which==='garden'?24:30,wood=which==='garden'?3:4;
    if(state.upgrades[which]){toast('이미 완성한 시설이에요.');return;}
    if(state.coins<cost||state.wood<wood){toast(`${which==='garden'?'밭 확장':'부엌 수리'}에는 ${cost}G + 목재 ${wood}개가 필요해요. 지금은 ${state.coins}G + 목재 ${state.wood}개예요.`);return;}
    state.coins-=cost;state.wood-=wood;state.dayStats.spent+=cost;state.upgrades[which]=true;
    if(which==='garden'){state.plots.push(...expandedPositions.map(([x,y])=>({x,y,crop:null,growth:0,plantedDay:state.day})));burst(6*T,11*T,'#cddc96',30);toast('밭이 12칸으로 넓어졌어요! 가운데 새 밭에도 작물을 심을 수 있어요.');}
    else{burst(9*T,5*T,'#edce92',30);toast('부엌에 지붕을 달았어요! 이제 수프 의뢰 보상이 18G예요.');}tone(900,.25);
  }else if(action==='sleep')openDaySummary();
}
function openDaySummary(){
  if(state.scene!=='home'){toast('집 안의 침대에서 잠들 수 있어요.');return;}
  phase='summary';state.path=[];state.pending=null;Object.keys(keys).forEach(k=>delete keys[k]);const s=state.dayStats;$('summary-day').textContent=`DAY ${String(state.day).padStart(2,'0')} / 하루의 기록`;$('day-summary-details').innerHTML=`<div><span>수확 / 채집</span><strong>${s.harvests}개 / ${s.foraged}개</strong></div><div><span>완성한 수프 / 의뢰</span><strong>${s.cooked}개 / ${s.orders}건</strong></div><div><span>오늘 수입</span><strong>+${s.income}G</strong></div><div><span>시설에 쓴 돈</span><strong>−${s.spent}G</strong></div><div><span>남은 동전</span><strong>${state.coins}G</strong></div>`;$('day-screen').classList.remove('hidden');saveGame();
}
function nextDay(){
  if(phase!=='summary')return;state.day++;state.dayTime=0;state.dayStats=freshStats();state.hp=100;state.energy=maxEnergy();state.mealsEaten=0;state.scene='home';state.player={x:10*T+12,y:7*T+12,facing:1,walk:0};state.path=[];state.pending=null;
  for(const p of state.plots)if(p.crop&&(p.crop!=='flower'||atFarm('moth')))p.growth=1;
  phase='playing';$('day-screen').classList.add('hidden');toast(`${state.day}일 차 아침이에요. 채집물과 의뢰가 돌아왔고, 밭도 자랐어요!`);tone(830,.2);checkMilestone();updateUI();saveGame();canvas.focus({preventScroll:true});
}
function setRole(id,role){if(phase!=='playing'||!state.friends[id])return;if(state.scene==='dungeon'){toast('친구 역할은 귀환한 뒤 바꿀 수 있어요.');return;}if(role==='companion')for(const s of species)if(state.friends[s.id]==='companion')state.friends[s.id]='farm';state.friends[id]=role;state.path=[];state.pending=null;toast(`${species.find(s=>s.id===id).name}${role==='farm'?'이 농장을 돌봐요.':'이 함께 걸어요. 기존 동행은 농장으로 돌아갔어요.'}`);tone(560);updateUI();saveGame();canvas.focus({preventScroll:true});}
function objective(){
  if(state.scene==='dungeon')return [state.research+1,`지하 ${state.dungeon.floor}층 · 싸우고 돌아와요`,'J / Space로 공격해요. 적의 붉은 예고 범위에서 물러나세요. 적을 정리한 뒤 전리품을 챙겨 귀환하면 재료가 보관돼요.'];
  if(state.energy<3)return [state.research+1,'오늘 쓴 기력을 회복해요','이동과 귀가는 기력이 없어도 가능해요. 집 안의 침대에서 잠들면 체력·기력이 회복되고 작물이 자라요.'];
  if(state.scene==='home'&&state.harvests===0)return [1,'문을 열고 생활을 시작해요','집 아래쪽 문을 클릭해 농장으로 나가요. 익은 당근 두 칸과 씨앗 8개가 있어요. 씨앗·음식·도시락 중 어디에 쓸지 나눠 보세요.'];
  if(state.research===0)return [1,'첫 탐험으로 광석을 가져와요','당근 2개로 도시락을 만들고 농장 북동쪽 동굴로 가요. 1층 광석 4 + 목재 3 + 12G로 연구하면 공격력과 2층이 열려요.'];
  if(state.research===1&&!state.lit)return [2,'탐험과 농장을 함께 키워요','2층 유물 2 + 달빛꽃 1 + 20G가 필요해요. 슬라임으로 개울을 열고 나방과 친구가 되어 숲의 등불을 밝히면 꽃 씨앗을 얻어요.'];
  if(state.research===1)return [2,'유물과 달빛꽃으로 연구해요','나방을 농장에 두고 꽃을 심은 뒤 잠들어요. 2층 유물 2 + 달빛꽃 1 + 20G로 최대 기력 50과 3층을 열 수 있어요.'];
  if(state.research===2)return [3,'깊은 층의 결정으로 등대를 고쳐요','3층 결정 3 + 당근 4 + 30G를 연구대에 가져가요. 동행 친구에게 하루 한 번 간식을 주면 유대에 따라 공격력이 올라요.'];
  return [3,'유물 도감과 탐사 기록을 남겨요','3단계 연구를 마쳤어요. 고정 3층의 유물 도감을 완성하고 층별 클리어와 순환 의뢰를 이어가요. 농장·부엌·고목 개선도 자유롭게 할 수 있어요.'];
}
function updateUI(){
  const minutes=Math.min(1320,Math.floor(state.dayTime*2)+480);$('day').textContent=`DAY ${String(state.day).padStart(2,'0')} · ${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}${minutes===1320?' · 편히 쉬어도 좋아요':''}`;
  $('roots').textContent=state.roots;$('flowers').textContent=state.flowers;$('level').textContent=`Lv.${1+Math.floor(state.xp/4)}`;$('xp').textContent=`${state.xp%4} / 4`;
  for(const key of ['herbs','wood','soup','coins'])$(key).textContent=state[key];
  $('order-status').textContent=`수프 1 → ${state.upgrades.kitchen?18:12}G · 남은 의뢰 ${2-state.dayStats.orders} / 2`;$('day-stats').textContent=`오늘 수입 ${state.dayStats.income}G`;
  for(const id of ['cook','fulfill','sell-root','upgrade-garden','upgrade-kitchen','sleep','eat-soup','craft-ration','save-seeds','feed-companion','go-home','retreat','enter-dungeon','research','contract'])$(id).disabled=phase!=='playing'||id==='upgrade-garden'&&state.upgrades.garden||id==='upgrade-kitchen'&&state.upgrades.kitchen||id==='retreat'&&state.scene!=='dungeon'||id==='sleep'&&state.scene!=='home';
  $('upgrade-garden').querySelector('small').textContent=state.upgrades.garden?'완료 · 12칸의 밭':'24G + 목재 3';$('upgrade-kitchen').querySelector('small').textContent=state.upgrades.kitchen?'완료 · 수프 납품가 18G':'30G + 목재 4 · 수프 납품가 18G';
  const [,title,body]=objective();$('goal-title').textContent=title;$('goal-body').textContent=body;$('progress').textContent=`연구 ${state.research} / 3`;$('progress-bar').style.width=`${state.research/3*100}%`;
  $('hp').textContent=`${state.hp} / 100`;$('energy').textContent=`${state.energy} / ${maxEnergy()}`;$('field-vitals').textContent=`HP ${state.hp} · 기력 ${state.energy}/${maxEnergy()}`;
  const zone=state.scene==='home'?'오두막 내부':state.scene==='dungeon'?`지하 ${state.dungeon.floor}층`:'농장과 이끼섬';$('zone').textContent=zone;
  for(const [id,key]of [['root-seeds','rootSeeds'],['flower-seeds','flowerSeeds'],['rations','rations'],['ore','ore'],['relic','relic'],['crystal','crystal']])$(id).textContent=state[key];
  $('meals-status').textContent=`식사 ${2-state.mealsEaten}회 남음`;$('trip-status').textContent=state.dungeon?`미보관: 광석 ${state.dungeon.carried.ore} / 유물 ${state.dungeon.carried.relic} / 결정 ${state.dungeon.carried.crystal} · 공격력 ${attackPower()}`:`공격력 ${attackPower()} · 전리품은 귀환해야 보관돼요.`;
  const companion=species.find(s=>withFriend(s.id));$('bond-status').textContent=companion?`${companion.name} 유대 ${state.bonds[companion.id]}/3 · 공격 +${state.bonds[companion.id]*2} · ${state.feedDay===state.day?'오늘 훈련 완료':'당근 2 + 기력 1'}`:'동행 친구 선택 · 당근 2 + 기력 1 · 하루 1회';
  $('research-level').textContent=`${state.research} / 3`;$('research-cost').textContent=researchCostLabel();$('journal-status').textContent=`유물 도감 ${state.journal.filter(Boolean).length}/3 · ${state.journal.map((v,i)=>`${i+1}층 ${v?'발견':'미발견'}`).join(' / ')}`;$('clear-status').textContent=`층별 귀환 클리어 ${state.clears.join(' / ')} · 의뢰 완료 ${state.contracts}`;
  const contract=CONTRACTS[state.contracts%3];$('contract-status').textContent=state.research<3?'연구 3단계 후 개방':`${{ore:'광석',relic:'유물',crystal:'결정'}[contract.item]} ${contract.amount} → ${contract.reward}G + 보급품`;
  document.querySelectorAll('.depth-choice').forEach(b=>{const depth=Number(b.dataset.depth);b.disabled=phase!=='playing'||state.scene==='dungeon'||depth>maxDepth();b.classList.toggle('active',depth===state.selectedDepth);b.setAttribute('aria-pressed',String(depth===state.selectedDepth));});
  $('friend-count').textContent=`${Object.keys(state.friends).length} / 3`;
  $('seed-flower').disabled=!state.lit;$('seed-flower').querySelector('small').textContent=state.lit?'하룻밤 · 나방 필요':'숲에서 발견';
  ['root','flower'].forEach(id=>{$(`seed-${id}`).classList.toggle('active',state.seed===id);$(`seed-${id}`).setAttribute('aria-pressed',String(state.seed===id));});
  const buffs=[];if(atFarm('slime'))buffs.push('당근 +1');if(atFarm('mole'))buffs.push('당근 +1');if(atFarm('moth'))buffs.push('달빛꽃 재배');$('farm-buff').textContent=buffs.length?`농장 효과 · ${buffs.join(' / ')}`:'당근 기본 수확 2개 · 심고 집에서 하룻밤 쉬어요.';
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
  updateCombat(dt);
  const target=nearest();$('prompt').textContent=target?`E · ${actionLabel(target)}`:'';
  const px=state.player.x/T,py=state.player.y/T;$('location').textContent=state.scene==='home'?'오두막 · 침대와 비상 씨앗':state.scene==='dungeon'?`지하 ${state.dungeon.floor}층 · J / Space 공격`:py<6&&px>18?'불씨의 숨은 숲':px>14?(py>12?'잠든 고목':'뿌리의 들판'):'씨앗 정원';
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
  if(state.scene!=='farm'){renderInterior();return;}
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
  const caveX=12*T+12,caveY=4*T+12;rect(ctx,caveX-19,caveY-22,38,35,'#788671');rect(ctx,caveX-13,caveY-17,26,29,'#293e39');rect(ctx,caveX-7,caveY-23,14,6,'#9ea789');rect(ctx,caveX-17,caveY+9,34,5,'#b4b28c');label(caveX,caveY+28,'동굴 · 도시락 1');
  const researchX=8*T+12,researchY=16*T+12;rect(ctx,researchX-16,researchY-5,32,15,'#9e815c');rect(ctx,researchX-13,researchY-10,24,6,'#d8c9a1');rect(ctx,researchX-2,researchY-18,8,10,state.research>=3?'#b2e3dc':'#7599a2');rect(ctx,researchX-1,researchY-22,6,5,state.research>=3?'#f3e6b5':'#d6c39a');label(researchX,researchY+27,`탐사 연구대 ${state.research}/3`);
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
function drawScenePlayer(){
  const p=state.player,bob=Math.sin(p.walk)*1.3;rect(ctx,p.x-8,p.y+6,16,4,'#172c3044');rect(ctx,p.x-6,p.y-8+bob,12,13,'#e4dbb0');rect(ctx,p.x-5,p.y+3,4,6,'#606e61');rect(ctx,p.x+2,p.y+3,4,6,'#606e61');rect(ctx,p.x-7,p.y-14+bob,14,10,'#e8b997');rect(ctx,p.x-8,p.y-20+bob,16,8,'#567454');rect(ctx,p.x-11,p.y-14+bob,22,3,'#81975d');rect(ctx,p.x+3*p.facing,p.y-10+bob,2,2,'#42533e');
  const friend=species.find(s=>withFriend(s.id));if(friend)drawMonster(ctx,friend.id,p.x-p.facing*21,p.y+12,time*3);
}
function renderInterior(){
  const home=state.scene==='home';ctx.clearRect(0,0,720,480);rect(ctx,0,0,720,480,home?'#253f3d':'#152329');
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const type=terrain(x,y);if(type==='floor'){rect(ctx,x*T,y*T,T,T,home?(y%2?'#b49a73':'#bba07a'):((x+y)%3?'#405455':'#445958'));rect(ctx,x*T,y*T+22,T,2,home?'#988263':'#314746');if(home)rect(ctx,x*T+((y%2)*12),y*T,1,22,'#ad916c');else if((x*11+y)%5===0){rect(ctx,x*T+4,y*T+7,7,2,'#516663');rect(ctx,x*T+10,y*T+9,2,6,'#314746');}}
    else if(x>1&&x<28&&y>1&&y<18&&!home){rect(ctx,x*T,y*T,T,T,'#2a3c40');rect(ctx,x*T+2,y*T+2,20,7,'#405052');rect(ctx,x*T+4,y*T+11,17,8,'#35484a');}}
  if(home){
    rect(ctx,7*T,3*T,16*T,T,'#927755');rect(ctx,7*T,3*T+4,16*T,4,'#b89a6d');for(let i=0;i<16;i++)rect(ctx,(7+i)*T,3*T+17,21,3,'#78664f');
    rect(ctx,12*T,9*T,6*T,3*T,'#aa7865');rect(ctx,12*T+5,9*T+5,6*T-10,3*T-10,'#c39b7e');for(let i=0;i<6;i++)rect(ctx,(12+i)*T+6,10*T,10,9,'#cdb597');
    const bx=10*T+12,by=6*T+12;rect(ctx,bx-17,by-20,35,51,'#82654d');rect(ctx,bx-14,by-17,29,12,'#eee3c6');rect(ctx,bx-14,by-3,29,29,'#879977');rect(ctx,bx-12,by,25,3,'#a7b292');rect(ctx,bx-18,by+26,4,10,'#735c45');rect(ctx,bx+14,by+26,4,10,'#735c45');label(bx,by+47,'침대 · 잠들기');
    const ax=20*T+12,ay=7*T+12;rect(ctx,ax-18,ay-14,36,29,'#9a7a50');rect(ctx,ax-18,ay-15,36,5,'#c1a573');rect(ctx,ax-15,ay+2,30,2,'#785e43');rect(ctx,ax-9,ay-11,18,13,'#d9c59b');rect(ctx,ax-3,ay-8,6,6,'#78905e');label(ax,ay+32,'비상 씨앗 꾸러미');
    const ex=15*T+12,ey=14*T+12;rect(ctx,ex-18,ey-20,36,42,'#725d45');rect(ctx,ex-14,ey-17,28,36,'#465e4d');rect(ctx,ex+7,ey,3,4,'#d5b876');label(ex,ey+34,'문 · 농장으로');
    rect(ctx,16*T,4*T,2*T,2*T,'#786349');rect(ctx,16*T+5,4*T+4,2*T-10,2*T-9,'#e4c78a');rect(ctx,17*T-2,4*T+4,4,2*T-9,'#91734e');rect(ctx,16*T+5,5*T-2,2*T-10,4,'#91734e');
    label(15*T,2*T+10,'우리 집 · 잠은 침대에서, 작업은 문 밖에서');
  }else{
    const run=state.dungeon;
    for(const enemy of run.enemies)if(enemy.hp>0&&enemy.mode==='windup'){ctx.fillStyle='rgba(216,105,84,.28)';ctx.beginPath();ctx.arc(enemy.aimX,enemy.aimY,29,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#ed9c78';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#ffd7a3';ctx.fillRect(enemy.aimX-11,enemy.aimY-3,22*(1-enemy.timer/.95),3);}
    for(const item of run.loot)if(!item.taken){const x=item.x*T+12,y=item.y*T+12,color=item.item==='ore'?'#99afbd':item.item==='relic'?'#d6b882':item.item==='crystal'?'#9dd7da':'#dbcfc0';rect(ctx,x-10,y-5,20,14,'#667470');rect(ctx,x-7,y-10,14,13,color);rect(ctx,x-4,y-14,7,6,color);rect(ctx,x-3,y-9,3,6,'#ecedcd');label(x,item.item==='journal'?y-25:y+25,item.item==='journal'?`${run.floor}층 도감`:item.item==='ore'?`광석 ${item.count}`:item.item==='relic'?`유물 ${item.count}`:`결정 ${item.count}`);}
    for(const enemy of run.enemies)if(enemy.hp>0){const x=enemy.x,y=enemy.y+Math.sin(time*3+enemy.id.length);rect(ctx,x-11,y+8,22,4,'#13272977');rect(ctx,x-9,y-8,18,18,run.floor===1?'#918b75':run.floor===2?'#938087':'#768e99');rect(ctx,x-6,y-13,12,7,'#b3ad8b');rect(ctx,x-5,y-4,3,3,enemy.mode==='windup'?'#f3c084':'#dccba1');rect(ctx,x+3,y-4,3,3,enemy.mode==='windup'?'#f3c084':'#dccba1');rect(ctx,x-12,y-22,24,3,'#25343a');rect(ctx,x-12,y-22,24*enemy.hp/enemy.maxHp,3,'#cd9480');}
    for(const [x,y,name]of [[4,15,'귀환'],[25,15,run.floor<3?'다음 층':'가장 깊은 층']]){rect(ctx,x*T+1,y*T+2,22,20,'#a19c7d');for(let i=0;i<4;i++)rect(ctx,x*T+3,y*T+4+i*4,18-i*2,2,'#596d68');label(x*T+12,y*T+38,name);}
    label(15*T,2*T+9,`지하 ${run.floor}층 · 남은 적 ${run.enemies.filter(e=>e.hp>0).length} · J / Space 공격`);
  }
  drawScenePlayer();
  if(attackFlash>0){ctx.strokeStyle='#f5e0a0';ctx.lineWidth=4;ctx.beginPath();ctx.arc(state.player.x,state.player.y,48,-.8+time*2,2.8+time*2);ctx.stroke();}
  if(hurtFlash>0){ctx.fillStyle=`rgba(167,63,56,${hurtFlash*.15})`;ctx.fillRect(0,0,720,480);}
  const target=phase==='playing'?nearest():null;if(target){ctx.strokeStyle='#f2e2b2';ctx.lineWidth=1;ctx.strokeRect(target.x*T-2,target.y*T-2,T+4,T+4);}
  for(const particle of particles)rect(ctx,particle.x,particle.y,3,3,particle.color);
}
canvas.addEventListener('pointerdown',e=>{if(phase!=='playing')return;canvas.focus({preventScroll:true});const box=canvas.getBoundingClientRect(),x=Math.floor((e.clientX-box.left)/box.width*W),y=Math.floor((e.clientY-box.top)/box.height*H);const target=targets().find(t=>t.x===x&&t.y===y);pathTo(x,y,target);});
document.addEventListener('keydown',e=>{if(/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;const key=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','e','j',' '].includes(key)&&phase==='playing'){if(e.target.tagName==='BUTTON'&&key===' ')return;e.preventDefault();if(key==='e'){if(!e.repeat)keys.action=true;}else{keys[key]=true;if((key==='j'||key===' ')&&!e.repeat)keys.attack=true;}}});
document.addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false;});
window.addEventListener('blur',()=>{Object.keys(keys).forEach(k=>delete keys[k]);saveGame();});
window.addEventListener('pagehide',()=>saveGame());
document.addEventListener('visibilitychange',()=>{if(document.hidden){Object.keys(keys).forEach(k=>delete keys[k]);saveGame();}last=performance.now();accumulator=0;});
$('roster').addEventListener('click',e=>{const b=e.target.closest('[data-role]');if(b)setRole(b.dataset.id,b.dataset.role);});
['root','flower'].forEach(id=>$(`seed-${id}`).addEventListener('click',()=>{if(phase!=='playing'||id==='flower'&&!state.lit)return;state.seed=id;updateUI();saveGame();canvas.focus({preventScroll:true});}));
$('start').addEventListener('click',()=>{const resumed=!!savedGame;if(savedGame){state=savedGame;savedGame=null;if(blocked(state.player.x,state.player.y))state.player=state.scene==='home'?{x:15*T+12,y:12*T+12,facing:1,walk:0}:{x:5*T+12,y:8*T+12,facing:1,walk:0};}phase='playing';$('start-screen').classList.add('hidden');toast(state.evacuated?'탐험을 중단해 집에서 다시 시작해요. 미반환 전리품은 사라졌고, 소모한 도시락은 복구되지 않아요.':resumed?`${state.day}일 차 생활로 돌아왔어요.`:'집 아래쪽 문을 열고 농장으로 나가 보세요.');state.evacuated=false;updateUI();saveGame();canvas.focus({preventScroll:true});});
$('continue').addEventListener('click',()=>{phase='playing';$('win-screen').classList.add('hidden');updateUI();saveGame();canvas.focus({preventScroll:true});});
function restartGame(){if(window.confirm('섬을 처음부터 시작할까요? 이 게임의 저장과 지금까지의 진행이 사라져요.')){Object.keys(keys).forEach(k=>delete keys[k]);let removed=true;try{localStorage.removeItem(SAVE_KEY);}catch{removed=false;}reset();$('save-status').textContent=removed?'새로운 섬 · 시작하면 자동 저장돼요.':'기존 저장을 지우지 못했어요. 새 게임을 시작하면 저장을 다시 시도해요.';}}
$('restart').addEventListener('click',restartGame);$('new-game-title').addEventListener('click',restartGame);
for(const action of ['cook','fulfill','sell-root','upgrade-garden','upgrade-kitchen','sleep','eat-soup','craft-ration','save-seeds','feed-companion','go-home','retreat','enter-dungeon','research','contract'])$(action).addEventListener('click',()=>requestOperation(action));
document.querySelectorAll('.depth-choice').forEach(button=>button.addEventListener('click',()=>{const depth=Number(button.dataset.depth);if(phase!=='playing'||state.scene==='dungeon'||depth>maxDepth())return;state.selectedDepth=depth;updateUI();saveGame();}));
$('next-day').addEventListener('click',nextDay);$('keep-playing').addEventListener('click',()=>{if(phase!=='summary')return;phase='playing';$('day-screen').classList.add('hidden');updateUI();canvas.focus({preventScroll:true});});
$('save').addEventListener('click',()=>saveGame(true));
document.querySelectorAll('.panel-jump').forEach(button=>button.addEventListener('click',()=>{const card=document.querySelector(`.sidebar .${button.dataset.panel}`);if(card)card.scrollIntoView({block:'start',behavior:'smooth'});}));
$('sound').addEventListener('click',()=>{sound=!sound;$('sound').textContent=sound?'소리 켜짐':'소리 꺼짐';$('sound').setAttribute('aria-pressed',String(sound));tone();});
function frame(now){accumulator+=Math.min((now-last)/1000,.1);last=now;while(accumulator>=1/60){update(1/60);accumulator-=1/60;}render();requestAnimationFrame(frame);}
// Read-only inspection for playtest evidence; gameplay can only change through normal input.
window.mossGame={getSnapshot:()=>JSON.parse(JSON.stringify({phase,...state,objective:objective(),saveVersion:SAVE_VERSION,stations,targets:targets(),recipes:RECIPES,researchCosts:RESEARCH,contractTable:CONTRACTS,maxEnergy:maxEnergy(),maxDepth:maxDepth(),attackPower:attackPower(),attackCooldown}))};
reset();readSave();requestAnimationFrame(frame);
})();
