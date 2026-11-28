const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),base='http://127.0.0.1:8799';
const out=path.join(root,'game/verification/playtest-balance');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const results=[];
 try{for(const width of [320,390,1000]){
  const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==base)return route.abort();
   if(url.pathname==='/fixture')return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><body>Fixture</body>'});
   const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
   const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.csv':'text/csv','.css':'text/css','.png':'image/png','.mp3':'audio/mpeg','.webp':'image/webp'};
   return route.fulfill({status:200,contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  });
  const cases=width===390?[['slime',0],['slime',1],['slime',19],['slime',20],['stone_giant',0],['stone_giant',1],['stone_giant',3],['stone_giant',4],['slime',0,true],['slime',20,true]]:[['slime',0],['slime',20]];
  for(const [id,defeats,elite=false] of cases){
   await page.goto(base+'/fixture');
   await page.evaluate(async({id,defeats,elite})=>{
    const {loadGameData}=await import('/game/js/gamedata.js?v=playtest-balance-1');
    const {createNewGame,defaultPartySpecs}=await import('/game/js/game-state.js?v=playtest-balance-1');
    const {GameSession}=await import('/game/js/save.js?v=playtest-balance-1');
    const {startRun,startNextBattle}=await import('/game/js/dungeon.js?v=playtest-balance-1');
    const {makeEnemy,createBattle}=await import('/game/js/battle.js?v=playtest-balance-1');
    const data=await loadGameData(),game=createNewGame(data,defaultPartySpecs(data)),session=new GameSession();
    (game.catalog??={}).defeats={[id]:defeats};session.startNew(game);
    startRun(data,session,{dungeonId:'world_a',stoneId:'00',quizState:{asked:0},seed:123});startNextBattle(data,session);
    const b=createBattle(data,session.game,{enemies:[makeEnemy(data,id,{eliteId:elite?'elite':null})],seed:123});
    b.round=1;b.turn={side:'ally',i:0};session.run.battle=b;session.save();
   },{id,defeats,elite});
   await page.goto(base+'/game/dungeon.html');const enemy=page.locator('.battle-enemy').first();await enemy.waitFor();
   const hp=defeats>=1,mp=defeats>=(id==='stone_giant'?4:20);
   assert.equal(await enemy.locator('.battle-resource.hp').count(),Number(hp));
   assert.equal(await enemy.locator('.battle-resource.mp').count(),Number(mp));
   const label=await enemy.getAttribute('aria-label');assert.equal(label.includes('、HP '),hp);assert.equal(label.includes('、MP '),mp);
   assert.equal(await page.locator('.battle-ally .battle-resource.hp').count(),6);
   await enemy.click();const panel=page.locator('dialog[open] .battle-encyclopedia-body');await panel.waitFor();
   assert.equal(await panel.locator('.battle-resource.hp').count(),Number(hp));assert.equal(await panel.locator('.battle-resource.mp').count(),Number(mp));
   await panel.getByRole('button',{name:'閉じる',exact:true}).click();
   await page.reload();await page.locator('.battle-enemy').first().waitFor();
   assert.equal(await page.locator('.battle-enemy .battle-resource.hp').count(),Number(hp));
   assert.equal(await page.locator('.battle-enemy .battle-resource.mp').count(),Number(mp));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(id==='slime'&&!elite&&[0,20].includes(defeats))await page.screenshot({path:path.join(out,`visibility-${width}-${defeats}.png`),fullPage:true});
   results.push({width,id,defeats,elite,hp,mp,dialog:true,aria:true,reload:true});
  }
  assert.deepEqual(errors,[]);await context.close();
 }}finally{await browser.close();}
 fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1;});
