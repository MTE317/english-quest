const {chromium}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox']});
 const base=process.env.BASE_URL??'http://127.0.0.1:8771',key='englishQuest.save.v2',results=[];
 try{for(const width of [320,390]){
  const context=await browser.newContext({viewport:{width,height:844},hasTouch:true,isMobile:true});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/game/index.html');await page.getByRole('link',{name:/パーティーを作る/}).click();
  await page.getByRole('button',{name:'この6人で冒険をはじめる',exact:true}).click();await page.waitForURL('**/game/index.html');
  const initial=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);assert.equal(initial.game.gold,10000);assert.equal(initial.game.items.return_feather,1);assert.ok(initial.game.party.every(m=>m.ap===20));
  // 購入・習得APIを共有する合成支度。実プレイヤーの保存領域は使用しない。
  await page.evaluate(async k=>{const {loadGameData}=await import('/game/js/gamedata.js?v=intro-route-1');const {preparedNewGame}=await import('/game/verification/intro-route/fixture.mjs');const state=JSON.parse(localStorage.getItem(k));state.game=preparedNewGame(await loadGameData()).game;localStorage.setItem(k,JSON.stringify(state));},key);
  await page.goto(base+'/game/dungeon.html');await page.getByRole('button',{name:/^風渡りの原、/}).waitFor();assert.equal(await page.locator('.atlas-destinations button').count(),1);
  assert.match(await page.locator('.route-info').innerText(),/無料/);await page.getByRole('button',{name:'出発する',exact:true}).click();await page.locator('.dungeon-entrance').waitFor({state:'detached'});
  const state=()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
  let questions=0,completed=false,reloaded=false,retries=0;
  for(let step=0;step<1500;step++){
   try {
   if(await page.locator('.battle-answers button:not(:disabled)').first().isVisible()){
    const saved=await state();await page.locator('.battle-answers button').nth(saved.run.battle.pending.question.answerIndex).click();questions++;if(questions%10===0)console.log({width,questions});
   }else if(await page.getByRole('button',{name:'次へ',exact:true}).isVisible())await page.getByRole('button',{name:'次へ',exact:true}).click({timeout:1000});
   else if(await page.getByRole('button',{name:'通常攻撃',exact:true}).isVisible())await page.getByRole('button',{name:'通常攻撃',exact:true}).click();
   else if(await page.locator('.battle-enemy.targetable').first().isVisible())await page.locator('.battle-enemy.targetable').first().click();
   else if(await page.getByRole('button',{name:'次の戦闘へ',exact:true}).isVisible()){
    if(!reloaded){const before=await state();await page.reload();await page.getByRole('button',{name:'次の戦闘へ',exact:true}).waitFor();assert.deepEqual((await state()).run.route,before.run.route);reloaded=true;}
    await page.getByRole('button',{name:'次の戦闘へ',exact:true}).click();await page.locator('.dungeon-entrance').waitFor({state:'detached'});
   }else if(await page.getByRole('button',{name:'町に帰る',exact:true}).isVisible()){
    const saved=await state();assert.equal(saved.run.state,'cleared');assert.equal(saved.run.battlesDone,3);await page.getByRole('button',{name:'町に帰る',exact:true}).click();completed=true;break;
   }else if(await page.getByRole('button',{name:/拾わない/}).isVisible())await page.getByRole('button',{name:/拾わない/}).click();
   else await page.waitForTimeout(50);
   } catch(error) { if(error.name!=='TimeoutError'||++retries>10)throw error; }
   await page.waitForTimeout(150);
   if(questions>200)throw Error('question cap');
  }
  assert.ok(completed,'原の3戦をブラウザの通常操作で完了');const returned=await state();assert.equal(returned.game.cleared.windward_plain,1);assert.equal(returned.game.items.return_feather,1);
  await page.goto(base+'/game/dungeon.html');await page.getByRole('button',{name:/^木漏れ日の森、/}).waitFor();assert.equal(await page.locator('.atlas-destinations button').count(),3);
  await page.screenshot({path:`/tmp/intro-route-${width}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  results.push({width,questions,completed,reloaded,unlocked:3,errors});console.log(results.at(-1));await context.close();
 }}finally{await browser.close();}
 fs.writeFileSync('/tmp/intro-browser-results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exit(1)});
