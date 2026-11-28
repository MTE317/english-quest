const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),base='http://127.0.0.1:8798';
const out=path.join(root,'game/verification/fixed-monsters');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const results=[];
 try{for(const width of [320,390,1000]){
  const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==base)return route.abort();
   if(url.pathname==='/fixture')return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><body>Fixture</body>'});
   const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
   const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.csv':'text/csv','.css':'text/css','.png':'image/png','.mp3':'audio/mpeg','.webp':'image/webp'};
   return route.fulfill({status:200,contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  });
  await page.goto(base+'/fixture');
  await page.evaluate(async()=>{
   const {loadGameData}=await import('/game/js/gamedata.js?v=fixed-monsters-1');
   const {createNewGame,defaultPartySpecs}=await import('/game/js/game-state.js?v=fixed-monsters-1');
   const {GameSession}=await import('/game/js/save.js?v=world-journey-1');
   const {maxHp,maxMp}=await import('/game/js/character.js?v=party-wipe-1');
   const data=await loadGameData(),game=createNewGame(data,defaultPartySpecs(data));
   for(const member of game.party){member.lv=20;member.hp=maxHp(data,member);member.mp=maxMp(data,member);}
   new GameSession().startNew(game);
  });
  await page.goto(base+'/game/dungeon.html');
  await page.getByRole('button',{name:'出発する',exact:true}).click();
  await page.locator('.battle-screen').waitFor();
  await page.goto(base+'/fixture');
  await page.evaluate(async()=>{
   const {loadGameData}=await import('/game/js/gamedata.js?v=fixed-monsters-1');
   const {GameSession}=await import('/game/js/save.js?v=world-journey-1');
   const {makeEnemy}=await import('/game/js/battle.js?v=fixed-monsters-1');
   const data=await loadGameData(),session=new GameSession();
   const normal=makeEnemy(data,'slime'),elite=makeEnemy(data,'slime',{eliteId:'elite'});
   normal.name+='A';elite.name+='B';
   session.run.battle.enemies=[normal,elite];
   session.run.battle.log=['スライムA・スライムBが あらわれた！'];
   session.run.battle.queue=[];session.run.battle.turn=null;session.run.battle.pending=null;session.save();
  });
  await page.goto(base+'/game/dungeon.html');
  await page.locator('.battle-enemy').first().waitFor();
  assert.deepEqual(await page.locator('.battle-enemy .battle-unit-name').allTextContents(),['スライムA','スライムB']);
  assert.equal(await page.locator('.battle-enemy-marks').count(),1);
  assert.equal(await page.locator('.battle-enemy-marks').textContent(),'◆');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('englishQuest.save.v2')).run.battle.enemies.map(e=>({lv:e.lv,hp:e.maxHp,elite:e.eliteId})));
  assert.equal(saved[0].lv,1);assert.equal(saved[1].lv,1);assert.ok(saved[1].hp>saved[0].hp);
  await page.reload();await page.locator('.battle-enemy').first().waitFor();
  assert.equal(await page.locator('.battle-enemy-marks').textContent(),'◆');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(out,'battle-'+width+'.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  results.push({width,sameLevel:true,sameSpeciesName:true,eliteMarked:true,stronger:true,reloadPreserved:true,errors});
  await context.close();
 }}finally{await browser.close();}
 fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);process.exitCode=1;});
