const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const base=process.env.BASE_URL||'http://127.0.0.1:8798',out=process.env.RESULT_DIR||path.join(__dirname,'../game/verification/world-journey');
const key='englishQuest.save.v2';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const results=[];
 try{for(const width of [320,390,1000]){
  const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(),errors=[];
  // ローカルファイルをブラウザへ直接渡し、HTTPサーバーや外部ネットワークに依存しない。
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==base)return route.abort();
   if(url.pathname==='/_world-test.html')return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><body>Test fixture</body></html>'});
   const root=path.resolve(__dirname,'..'),file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
   const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.csv':'text/csv','.png':'image/png','.webp':'image/webp','.mp3':'audio/mpeg'};
   return route.fulfill({status:200,contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  });
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/game/index.html');
  await page.evaluate(async()=>{
   const {loadGameData}=await import('/game/js/gamedata.js?v=world-journey-1');
   const {createNewGame,defaultPartySpecs}=await import('/game/js/game-state.js?v=world-journey-1');
   const {GameSession}=await import('/game/js/save.js?v=world-journey-1');
   const {maxHp,maxMp}=await import('/game/js/character.js?v=party-wipe-1');
   const session=new GameSession();const data=await loadGameData(),game=createNewGame(data,defaultPartySpecs(data));
   game.items.return_feather=5;game.items.smoke_ball=5;game.party.forEach(m=>{m.lv=20;m.hp=maxHp(data,m);m.mp=maxMp(data,m);});session.startNew(game);
  });
  await page.goto(base+'/game/dungeon.html');
  await page.getByRole('button',{name:'出発する',exact:true}).waitFor();
  assert.equal(await page.locator('[aria-label="地域の入口"] button').count(),4);
  const entries=page.locator('[aria-label="地域の入口"] button');
  assert.equal(await entries.first().getAttribute('aria-pressed'),'true');
  await entries.nth(1).click();
  assert.equal(await entries.nth(1).getAttribute('aria-pressed'),'true');
  assert.equal(await entries.first().getAttribute('aria-pressed'),'false');
  await entries.first().click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(out,`departure-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:'出発する',exact:true}).click();
  await page.locator('.battle-screen').waitFor();
  await page.goto(base+'/_world-test.html');
  // 戦闘そのものは既存テストが担当。ここでは実際の遠征状態を3戦進め、出口UIを検証する。
  await page.evaluate(async()=>{
   const {loadGameData}=await import('/game/js/gamedata.js?v=world-journey-1');
   const {GameSession}=await import('/game/js/save.js?v=world-journey-1');
   const {startNextBattle,afterBattle,resolveLoot}=await import('/game/js/dungeon.js?v=world-journey-1');
   const data=await loadGameData(),session=new GameSession();
   for(let i=0;i<3;i++){if(!session.run.battle)startNextBattle(data,session);session.run.battle.enemies.forEach(e=>e.hp=0);session.run.battle.result='win';if(i===2){session.save();break;}afterBattle(data,session);while(session.run.pendingLoot.length)resolveLoot(data,session,null);}
  });
  await page.goto(base+'/game/dungeon.html');await page.locator('.journey-exits').waitFor();
  assert.equal(await page.locator('.journey-exits button').count(),3);
  assert.deepEqual(await page.locator('.journey-exits button span').allTextContents(),['？？？','？？？','？？？']);
  assert.equal(await page.locator('.journey-exits').innerText().then(t=>t.includes('敵Lv')||t.includes('帰還')),false);
  const exitsRect=await page.locator('.journey-exits').boundingBox(),rewardsRect=await page.locator('.victory-rewards').boundingBox();
  assert.ok(exitsRect.y+exitsRect.height<=rewardsRect.y);
  assert.ok(exitsRect.y+exitsRect.height<844);
  await page.screenshot({path:path.join(out,`victory-exits-${width}.png`),fullPage:true});
  await page.reload();await page.locator('.journey-exits').waitFor();
  assert.deepEqual(await page.locator('.journey-exits button span').allTextContents(),['？？？','？？？','？？？']);
  const resumedExits=await page.locator('.journey-exits').boundingBox(),partyRect=await page.locator('.expedition-party').boundingBox();
  assert.ok(resumedExits.y+resumedExits.height<=partyRect.y);
  await page.getByText('探索の地図を見る',{exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(out,`exits-${width}.png`),fullPage:true});
  const before=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
  await page.locator('.journey-exits button').first().click();
  await page.getByRole('button',{name:'次の戦闘へ',exact:true}).waitFor();
  const after=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
  assert.equal(after.run.dungeonId,'world_b');assert.deepEqual(after.run.backpack,before.run.backpack);
  await page.reload();await page.getByRole('button',{name:'次の戦闘へ',exact:true}).waitFor();
  // BからAに戻って再踏破。到達済みの町であっても、未選択の方向は伏せる。
  await page.goto(base+'/_world-test.html');
  await page.evaluate(async()=>{
   const {loadGameData}=await import('/game/js/gamedata.js?v=world-journey-1');
   const {GameSession}=await import('/game/js/save.js?v=world-journey-1');
   const {startNextBattle,afterBattle,resolveLoot,chooseWorldExit}=await import('/game/js/dungeon.js?v=world-journey-1');
   const data=await loadGameData(),session=new GameSession();
   for(const dir of ['left',null]){for(let i=0;i<3;i++){startNextBattle(data,session);session.run.battle.enemies.forEach(e=>e.hp=0);session.run.battle.result='win';afterBattle(data,session);while(session.run.pendingLoot.length)resolveLoot(data,session,null);}if(dir)chooseWorldExit(data,session,dir,session.run.worldVisit);}
  });
  await page.goto(base+'/game/dungeon.html');await page.locator('.journey-exits').waitFor();
  assert.deepEqual(await page.locator('.journey-exits button span').allTextContents(),['街道の井戸','？？？','？？？']);
  await page.locator('.journey-exits button').nth(1).click();
  await page.getByText('町に到着した。',{exact:true}).waitFor();
  await page.goto(base+'/_world-test.html');
  await page.evaluate(async()=>{
   const {loadGameData}=await import('/game/js/gamedata.js?v=world-journey-1');
   const {GameSession}=await import('/game/js/save.js?v=world-journey-1');
   const {startRun,startNextBattle,afterBattle,resolveLoot}=await import('/game/js/dungeon.js?v=world-journey-1');
   const data=await loadGameData(),session=new GameSession();
   startRun(data,session,{dungeonId:'world_a',stoneId:'00',quizState:{asked:0},seed:37});
   for(let i=0;i<3;i++){startNextBattle(data,session);session.run.battle.enemies.forEach(e=>e.hp=0);session.run.battle.result='win';afterBattle(data,session);while(session.run.pendingLoot.length)resolveLoot(data,session,null);}
  });
  await page.goto(base+'/game/dungeon.html');await page.locator('.journey-exits').waitFor();
  assert.deepEqual(await page.locator('.journey-exits button span').allTextContents(),['街道の井戸','町へ','？？？']);
  await page.reload();await page.locator('.journey-exits').waitFor();
  assert.deepEqual(await page.locator('.journey-exits button span').allTextContents(),['街道の井戸','町へ','？？？']);
  // 後続の石到達確認は、保存したB入場直後の専用データから再開する。
  await page.goto(base+'/_world-test.html');
  await page.evaluate(({key,saved})=>localStorage.setItem(key,JSON.stringify(saved)),{key,saved:after});
  // G踏破直後を作り、石到着による帰還と再読込後のワープ解放をUIから確認する。
  await page.goto(base+'/_world-test.html');
  await page.evaluate(async()=>{
   const {loadGameData}=await import('/game/js/gamedata.js?v=world-journey-1');const data=await loadGameData();
   const {GameSession}=await import('/game/js/save.js?v=world-journey-1');const session=new GameSession();
   const {startNextBattle,afterBattle,resolveLoot,chooseWorldExit}=await import('/game/js/dungeon.js?v=world-journey-1');
   for(const dir of ['forward','forward',null]){for(let i=0;i<3;i++){startNextBattle(data,session);session.run.battle.enemies.forEach(e=>e.hp=0);session.run.battle.result='win';afterBattle(data,session);while(session.run.pendingLoot.length)resolveLoot(data,session,null);}if(dir)chooseWorldExit(data,session,dir,session.run.worldVisit);}
  });
  await page.goto(base+'/game/dungeon.html');await page.locator('.journey-exits').waitFor();await page.locator('.journey-exits button').nth(1).click();
  await page.getByText('ワールドストーン2に到着した。ワープを解放した。町に帰還した。',{exact:true}).waitFor();
  assert.equal((await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key)).run,null);
  await page.goto(base+'/game/dungeon.html');await page.getByRole('button',{name:'ワールドストーン2',exact:true}).click();
  await page.getByText('この地域の続きは準備中です。ワープの解放記録は保存されています。',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);results.push({width,entryCount:4,exitCount:3,choicesAboveRewards:true,unknownExitsHidden:true,selectedDirectionOnly:true,continued:true,reloaded:true,stoneUnlocked:true,errors});
  await context.close();
 }}finally{await browser.close();}
 fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1;});
