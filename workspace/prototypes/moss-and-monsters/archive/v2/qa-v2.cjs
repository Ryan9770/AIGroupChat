// Real-input v2 acceptance playtest. State snapshots are read-only.
// Only malformed-save cases inject localStorage, in separate browser contexts.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out = path.join(__dirname, 'qa-evidence-v2');
fs.mkdirSync(out, { recursive: true });
process.env.TEMP=out;process.env.TMP=out;
const url=process.env.GAME_URL||'http://127.0.0.1:4179';
const saveKey='moss-and-monsters:v2';
const results=[],errors=[];const started=Date.now();
let browser,page,validSave;
const record=(name,details='')=>{results.push({name,details,seconds:Math.round((Date.now()-started)/1000)});console.log('PASS',name,details);};
const snapshot=()=>page.evaluate(()=>window.mossGame.getSnapshot());
const until=(fn,arg,timeout=20000)=>page.waitForFunction(fn,arg,{timeout});
const settle=async()=>{await until(()=>{const s=window.mossGame.getSnapshot();return !s.path.length&&!s.pending;});await page.waitForTimeout(85);};
async function tile(x,y){await page.locator('#world').scrollIntoViewIfNeeded();const b=await page.locator('#world').boundingBox();await page.mouse.click(b.x+(x+.5)/30*b.width,b.y+(y+.5)/20*b.height);await settle();}
async function operation(id){await page.locator('#'+id).click();await settle();}
async function role(id,value){await page.locator(`[data-id="${id}"][data-role="${value}"]`).click();assert.equal((await snapshot()).friends[id],value);}
async function shot(name){await page.locator('.goal-card').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});}
const resources=s=>Object.fromEntries(['roots','flowers','herbs','wood','soup','coins'].map(k=>[k,s[k]]));
const stable=s=>({resources:resources(s),friends:s.friends,upgrades:s.upgrades,day:s.day,dayStats:s.dayStats,bridge:s.bridge,gate:s.gate,lit:s.lit,restored:s.restored,completed:s.completed,plots:s.plots,nodes:s.nodes});
function watch(p){p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});}
async function plantAllRoot(){await page.locator('#seed-root').click();for(const p of (await snapshot()).plots)if(!p.crop)await tile(p.x,p.y);}
async function harvestAllRoot(){await until(()=>window.mossGame.getSnapshot().plots.filter(p=>p.crop==='root').every(p=>p.growth>=1));for(const p of (await snapshot()).plots)if(p.crop==='root')await tile(p.x,p.y);}
async function forage(x,y,key,amount){const before=(await snapshot())[key];await tile(x,y);assert.equal((await snapshot())[key],before+amount);await tile(x,y);assert.equal((await snapshot())[key],before+amount);}
(async()=>{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Users/Admin/.cache/puppeteer/chrome/win64-149.0.7827.22/chrome-win64/chrome.exe'});
  page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});watch(page);
  await page.goto(url);await until(()=>!!window.mossGame);assert.equal((await snapshot()).phase,'title');await shot('01-title');
  await page.locator('#start').click();let s=await snapshot();assert.equal(s.day,1);assert.equal(s.plots.length,8);record('Fresh day 1 loads with eight plots');
  await page.keyboard.down('d');await page.waitForTimeout(220);await page.keyboard.up('d');assert((await snapshot()).player.x>s.player.x+10);
  await tile(5,9);await page.keyboard.press('e');await until(()=>window.mossGame.getSnapshot().roots===1);record('Keyboard movement and E harvest');
  await forage(8,7,'herbs',1);await forage(3,11,'wood',1);record('Herb and wood yield once per node per day');
  s=await snapshot();await operation('cook');assert.deepEqual(resources(await snapshot()),resources(s));record('Insufficient cooking resources leave inventory unchanged');
  await tile(10,7);assert.equal((await snapshot()).friends.slime,'farm');assert.equal((await snapshot()).roots,0);
  await plantAllRoot();await tile(14,10);assert.equal((await snapshot()).bridge,false);await role('slime','companion');await tile(14,10);assert.equal((await snapshot()).bridge,true);await role('slime','farm');
  await harvestAllRoot();assert.equal((await snapshot()).roots,8);record('Carrot planting, normal-time growth, harvest and slime bridge');
  await tile(20,11);assert.equal((await snapshot()).roots,6);assert.equal((await snapshot()).friends.mole,'farm');
  await tile(23,6);assert.equal((await snapshot()).gate,false);await role('mole','companion');await tile(23,6);assert.equal((await snapshot()).gate,true);
  await forage(19,14,'wood',2);await role('mole','farm');await tile(24,3);assert.equal((await snapshot()).roots,3);assert.equal((await snapshot()).friends.moth,'farm');
  await tile(25,4);assert.equal((await snapshot()).lit,false);await role('moth','companion');await tile(25,4);assert.equal((await snapshot()).lit,true);
  await forage(22,4,'herbs',2);await forage(17,12,'herbs',2);await forage(11,12,'herbs',2);
  await role('mole','companion');assert.equal((await snapshot()).friends.moth,'farm');await forage(10,5,'wood',2);await forage(11,16,'wood',2);await role('mole','farm');
  assert.equal((await snapshot()).wood,7);assert.equal((await snapshot()).herbs,7);record('Three recruits, ability gates and repeatable companion forage bonuses');
  await plantAllRoot();await harvestAllRoot();assert.equal((await snapshot()).roots,19);record('Farm mole doubles eight-plot harvest to sixteen carrots');
  await shot('02-playing');
  for(let i=0;i<3;i++){s=await snapshot();await operation('cook');const after=await snapshot();assert.equal(after.roots,s.roots-2);assert.equal(after.herbs,s.herbs-1);assert.equal(after.soup,s.soup+1);}
  record('Soup recipe consumes two carrots and one herb');
  for(let i=0;i<2;i++){s=await snapshot();await operation('fulfill');const after=await snapshot();assert.equal(after.soup,s.soup-1);assert.equal(after.coins,s.coins+12);}
  s=await snapshot();await operation('fulfill');assert.deepEqual(resources(await snapshot()),resources(s));assert.equal((await snapshot()).dayStats.orders,2);record('Orders pay 12G and stop at two per day');
  s=await snapshot();await operation('sell-root');assert.equal((await snapshot()).roots,s.roots-1);assert.equal((await snapshot()).coins,s.coins+2);record('Raw carrot sale remains available after order cap');
  s=await snapshot();await operation('upgrade-garden');let a=await snapshot();assert.equal(a.coins,s.coins-24);assert.equal(a.wood,s.wood-3);assert.equal(a.plots.length,12);assert.equal(a.upgrades.garden,true);record('24G and three wood expand garden from eight to twelve plots');
  s=await snapshot();await operation('upgrade-kitchen');assert.deepEqual(resources(await snapshot()),resources(s));assert.equal((await snapshot()).upgrades.kitchen,false);record('Unaffordable upgrade does not consume resources');
  await page.locator('#seed-flower').click();await tile(5,10);await until(()=>window.mossGame.getSnapshot().plots[0].growth>.05);
  await role('moth','companion');const paused=(await snapshot()).plots[0].growth;await page.waitForTimeout(700);assert.equal((await snapshot()).plots[0].growth,paused);await role('moth','farm');record('Moth role switches pause and resume moonflower growth');
  await page.locator('#seed-root').click();await tile(5,11);await tile(6,11);
  while((await snapshot()).coins<30){if((await snapshot()).roots<1)await harvestAllRoot();await operation('sell-root');}
  await page.locator('#world').screenshot({path:path.join(out,'03-before-kitchen.png')});
  s=await snapshot();await operation('upgrade-kitchen');a=await snapshot();assert.equal(a.coins,s.coins-30);assert.equal(a.wood,s.wood-4);assert.equal(a.upgrades.kitchen,true);assert((await page.locator('#order-status').innerText()).includes('18G'));record('30G and four wood upgrade kitchen and display 18G orders');
  await shot('04-upgraded');await page.locator('#world').screenshot({path:path.join(out,'04-upgraded-world.png')});
  await until(()=>window.mossGame.getSnapshot().plots[0].growth>=1);await tile(5,10);assert.equal((await snapshot()).flowers,2);
  await tile(25,14);s=await snapshot();assert.equal(s.restored,true);assert.equal(s.completed,true);assert.equal(s.phase,'won');assert.equal(s.day,1);await shot('05-milestone');record('Final milestone earned on day 1 with no forced date gate',`${Math.round(s.elapsed)} game seconds`);
  await page.locator('#continue').click();assert.equal((await snapshot()).phase,'playing');record('Completed settlement remains playable');
  await page.locator('#seed-root').click();await tile(5,10);assert((await snapshot()).plots[0].growth<1);await operation('sleep');assert.equal((await snapshot()).phase,'summary');
  const summary=await page.locator('#day-summary-details').innerText();s=await snapshot();assert(summary.includes(`${s.dayStats.income}G`));assert(summary.includes(`${s.dayStats.spent}G`));await shot('06-end-day');record('Cottage opens daily harvest, forage, cooking, income and spending summary');
  await page.locator('#keep-playing').click();assert.equal((await snapshot()).phase,'playing');assert.equal((await snapshot()).day,1);await operation('sleep');
  await page.locator('#next-day').click();s=await snapshot();assert.equal(s.day,2);assert.equal(s.dayStats.orders,0);assert.equal(s.plots[0].growth,1);record('Sleep advances day, resets orders and matures planted crop');
  await role('moth','companion');await forage(8,7,'herbs',2);await role('mole','companion');await forage(3,11,'wood',2);await role('mole','farm');record('Next-day forage returns and companion bonuses apply again');
  s=await snapshot();await operation('fulfill');a=await snapshot();assert.equal(a.soup,s.soup-1);assert.equal(a.coins,s.coins+18);assert.equal(a.dayStats.orders,1);record('New-day kitchen order pays 18G');
  await page.locator('#save').click();validSave=await page.evaluate(key=>localStorage.getItem(key),saveKey);assert(validSave);s=await snapshot();
  await page.reload();await until(()=>!!window.mossGame);assert.equal((await snapshot()).phase,'title');assert.equal(await page.locator('#new-game-title').isVisible(),true);await page.locator('#start').click();
  assert.deepEqual(stable(await snapshot()),stable(s));record('Save and reload preserve resources, both upgrades, day, plots and monsters');
  await shot('07-resumed-day-two');
  for(const viewport of [{width:1440,height:900},{width:1024,height:768}]){await page.setViewportSize(viewport);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await shot(`08-layout-${viewport.width}`);}record('1440x900 and 1024x768 desktop layouts have no horizontal overflow');
  s=await snapshot();page.once('dialog',d=>d.dismiss());await page.locator('#restart').click();assert.deepEqual(stable(await snapshot()),stable(s));record('Restart cancel preserves current settlement');
  page.once('dialog',d=>d.accept());await page.locator('#restart').click();s=await snapshot();assert.equal(s.phase,'title');assert.equal(s.day,1);assert.equal(s.plots.length,8);assert.deepEqual(s.friends,{});assert.deepEqual(resources(s),{roots:0,flowers:0,herbs:0,wood:0,soup:0,coins:0});assert.equal(s.completed,false);assert.deepEqual(s.upgrades,{garden:false,kitchen:false});assert.equal(await page.evaluate(key=>localStorage.getItem(key),saveKey),null);record('Restart confirm resets progression and removes saved settlement');
  await page.locator('#start').click();await tile(5,10);assert.equal((await snapshot()).roots,1);record('New game after restart can harvest again');
  // Deliberately damaged fixtures use separate contexts and cannot affect earned completion.
  const negative=JSON.parse(validSave);negative.state.coins=-1;
  const wrongVersion=JSON.parse(validSave);wrongVersion.version=999;
  for(const [name,value]of [['malformed-json','{'],['invalid-negative-coins',JSON.stringify(negative)],['unsupported-save-version',JSON.stringify(wrongVersion)]]){
    const context=await browser.newContext();const fixture=await context.newPage();watch(fixture);await fixture.goto(url);
    await fixture.evaluate(({key,value})=>localStorage.setItem(key,value),{key:saveKey,value});await fixture.reload();await fixture.waitForFunction(()=>!!window.mossGame);
    assert.equal(await fixture.locator('#new-game-title').isVisible(),false);await fixture.locator('#start').click();const f=await fixture.evaluate(()=>window.mossGame.getSnapshot());assert.equal(f.day,1);assert.equal(f.coins,0);assert.deepEqual(f.friends,{});assert.equal(f.plots.length,8);record('Malformed-save fixture safely falls back: '+name);await context.close();
  }
  assert.equal(errors.length,0,errors.join('\n'));record('Zero browser console and JavaScript errors');
  const hashes=Object.fromEntries(['game.js','index.html','style.css'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,file))).digest('hex')]));
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({status:'PLAYABLE',acceleratedTime:false,gameStateMutations:false,malformedSaveFixtureInjection:'Three separate browser contexts, only after earned normal-input completion',wallSeconds:Math.round((Date.now()-started)/1000),hashes,results,errors},null,2));
})().catch(async e=>{console.error(e);if(page){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});console.log(JSON.stringify(await snapshot().catch(()=>({}))));}fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({status:'FAIL',error:e.message,results,errors},null,2));process.exitCode=1;}).finally(async()=>{await browser?.close();});
