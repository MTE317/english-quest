const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),base='http://127.0.0.1:8799';
const out=path.join(root,'game/verification/monster-skills');
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
  const count=await page.evaluate(async()=>{
   const {loadGameData}=await import('/game/js/gamedata.js?v=enemy-skills-1');
   const {createNewGame,defaultPartySpecs}=await import('/game/js/game-state.js?v=enemy-skills-1');
   const {GameSession}=await import('/game/js/save.js?v=enemy-skills-1');
   const {maxHp,maxMp}=await import('/game/js/character.js?v=enemy-skills-1');
   const data=await loadGameData(),game=createNewGame(data,defaultPartySpecs(data));
   for(const m of game.party){m.lv=20;m.hp=maxHp(data,m);m.mp=maxMp(data,m);}
   new GameSession().startNew(game);return Object.keys(data.monsterSkills.monsters).length;
  });
  assert.equal(count,39);
  await page.goto(base+'/game/dungeon.html');
  await page.getByRole('button',{name:'出発する',exact:true}).click();
  await page.locator('.battle-screen').waitFor();
  await page.goto(base+'/fixture');
  const state=await page.evaluate(async()=>{
   const {loadGameData}=await import('/game/js/gamedata.js?v=enemy-skills-1');
   const {GameSession}=await import('/game/js/save.js?v=enemy-skills-1');
   const {makeEnemy,createBattle,nextTurn}=await import('/game/js/battle.js?v=enemy-skills-1');
   const data=await loadGameData(),session=new GameSession();
   const owl=makeEnemy(data,'owl_sage'),slime=makeEnemy(data,'slime',{eliteId:'elite'}),boss=makeEnemy(data,'stone_giant');
   slime.hp=Math.floor(slime.maxHp*.2);const hp=slime.hp,mp=owl.mp;
   const b=createBattle(data,session.game,{enemies:[owl,slime,boss],seed:123});
   b.round=1;b.queue=[{side:'enemy',i:0},{side:'ally',i:0}];nextTurn(data,session.game,b);
   b.round=2;session.run.battle=b;session.save();
   return {healed:slime.hp>hp,mpPaid:owl.mp===mp-3,ready:owl.skillReadyRound.owl_sage_2};
  });
  assert.deepEqual(state,{healed:true,mpPaid:true,ready:4});
  await page.goto(base+'/game/dungeon.html');
  await page.locator('.battle-enemy').first().waitFor();
  assert.ok((await page.locator('body').textContent()).includes('癒やしの羽'));
  assert.ok((await page.locator('body').textContent()).includes('大地震'));
  assert.equal(await page.locator('.battle-enemy-marks').first().textContent(),'◆');
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('englishQuest.save.v2')).run.battle);
  const before=await saved();await page.reload();await page.locator('.battle-enemy').first().waitFor();
  const after=await saved();assert.deepEqual(after.enemies,before.enemies);assert.equal(after.rng,before.rng);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(out,'battle-'+width+'.png'),fullPage:true});
  results.push({width,profiles:count,healLog:true,bossWarning:true,eliteMarked:true,reloadPreserved:true,overflow:false,errors});
  await context.close();
 }}finally{await browser.close();}
 fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);process.exitCode=1;});
