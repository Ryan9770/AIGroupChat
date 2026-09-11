// Layout evidence through normal browser controls. Gameplay state is read-only.
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out = path.join(__dirname, 'qa-evidence-v3-layout');
fs.mkdirSync(out, {recursive:true});
process.env.TEMP=out; process.env.TMP=out;
(async()=>{
  const browser = await chromium.launch({executablePath:'C:/Users/Admin/.cache/puppeteer/chrome/win64-149.0.7827.22/chrome-win64/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4179');
  await page.locator('#start').click();
  await page.waitForTimeout(300);
  await page.screenshot({path:path.join(out,'home-desktop.png'),fullPage:true});
  const b=await page.locator('#world').boundingBox();
  await page.mouse.click(b.x+15.5/30*b.width,b.y+14.5/20*b.height);
  await page.waitForFunction(()=>window.mossGame.getSnapshot().scene==='farm');
  await page.waitForTimeout(200);
  await page.screenshot({path:path.join(out,'farm-desktop.png'),fullPage:true});
  const settle=()=>page.waitForFunction(()=>{const s=window.mossGame.getSnapshot();return !s.path.length&&!s.pending;});
  async function tile(x,y){const box=await page.locator('#world').boundingBox();await page.mouse.click(box.x+(x+.5)/30*box.width,box.y+(y+.5)/20*box.height);await settle();}
  await tile(5,10);await tile(6,10);
  await page.locator('#craft-ration').click();await settle();
  await page.locator('#enter-dungeon').click();
  await page.waitForFunction(()=>window.mossGame.getSnapshot().scene==='dungeon');
  const energy=await page.evaluate(()=>window.mossGame.getSnapshot().energy);
  await page.keyboard.press('j');
  await page.waitForFunction(e=>window.mossGame.getSnapshot().energy===e-1,energy);
  await page.waitForFunction(()=>window.mossGame.getSnapshot().attackCooldown===0);
  await page.keyboard.press('Space');
  await page.waitForFunction(e=>window.mossGame.getSnapshot().energy===e-2,energy);
  await page.locator('.survival-card').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,'dungeon-desktop.png'),fullPage:true});
  await page.locator('#retreat').click();await settle();
  const metrics=[];
  for(const [width,height] of [[1440,900],[1280,720],[760,900],[390,844]]){
    await page.setViewportSize({width,height});
    await page.waitForTimeout(100);
    metrics.push(await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,canvas:document.querySelector('canvas').getBoundingClientRect().toJSON(),survival:document.querySelector('.survival-card').getBoundingClientRect().toJSON()})));
    if(width===390)await page.screenshot({path:path.join(out,'farm-mobile.png'),fullPage:true});
  }
  fs.writeFileSync(path.join(out,'layout.json'),JSON.stringify({errors,quickAttackTaps:['J','Space'],metrics},null,2));
  console.log(JSON.stringify({errors,quickAttackTaps:['J','Space'],metrics},null,2));
  await browser.close();
  if(errors.length||metrics.some(m=>m.scrollWidth>m.width))process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
