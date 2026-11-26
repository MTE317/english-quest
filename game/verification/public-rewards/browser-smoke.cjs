const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const rows=[];
try{for(const width of [320,390]){
 const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base=process.env.BASE_URL??'http://127.0.0.1:8773',key='englishQuest.save.v2';const state=()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
 await page.goto(base+'/game/index.html');await page.getByRole('link',{name:/パーティーを作る/}).click();await page.getByRole('button',{name:'この6人で冒険をはじめる',exact:true}).click();await page.waitForURL('**/game/index.html');
 await page.goto(base+'/game/dungeon.html');await page.getByRole('button',{name:'出発する',exact:true}).click();await page.locator('.dungeon-entrance').waitFor({state:'detached'});const before=await state();
 let questions=0,retries=0,done=false;
 for(let n=0;n<500;n++){
  try{
   if(await page.getByRole('button',{name:'次の戦闘へ',exact:true}).isVisible()){done=true;break;}
   if(await page.locator('.battle-answers button:not(:disabled)').first().isVisible()){const s=await state();await page.locator('.battle-answers button').nth(s.run.battle.pending.question.answerIndex).click();questions++;}
   else if(await page.getByRole('button',{name:'次へ',exact:true}).isVisible())await page.getByRole('button',{name:'次へ',exact:true}).click({timeout:1000});
   else if(await page.getByRole('button',{name:'通常攻撃',exact:true}).isVisible())await page.getByRole('button',{name:'通常攻撃',exact:true}).click();
   else if(await page.locator('.battle-enemy.targetable').first().isVisible())await page.locator('.battle-enemy.targetable').first().click();
  }catch(e){if(e.name!=='TimeoutError'||++retries>10)throw e;}
  await page.waitForTimeout(150);
 }
 assert.ok(done);const after=await state();assert.equal(after.run.battlesDone,1);assert.equal(after.run.battle,null);
 assert.deepEqual(after.game.party.map((m,i)=>m.ap-before.game.party[i].ap),[1,1,1,1,1,1]);
 const body=await page.locator('body').innerText();assert.match(body,/AP\s*\+1/);assert.match(body,/経験値/);
 await page.screenshot({path:`/tmp/public-rewards-${width}.png`,fullPage:true});await page.reload();await page.getByRole('button',{name:'次の戦闘へ',exact:true}).waitFor();assert.deepEqual((await state()).game.party,after.game.party);
 // 同じ図鑑コンポーネントの既存解放閾値を合成記録19/20体で確認。
 const catalog=await page.evaluate(async()=>{const {loadGameData}=await import('/game/js/gamedata.js');const {monsterCatalogView}=await import('/game/js/ui/monster-catalog-view.js');const data=await loadGameData();const g={catalog:{monsters:['slime'],defeats:{slime:19},sightings:{slime:{lv:99,hp:10,mp:0,str:1,mag:1,def:1,res:1,spd:1}}}};const locked=monsterCatalogView(data,g,{}).textContent;g.catalog.defeats.slime=20;return {locked,open:monsterCatalogView(data,g,{}).textContent};});
 assert.ok(!catalog.locked.includes('公開ダンジョンの基礎経験値'));assert.match(catalog.open,/公開ダンジョンの基礎経験値 11/);assert.deepEqual(errors,[]);
 rows.push({width,questions,ap:after.game.party.map((m,i)=>m.ap-before.game.party[i].ap),xp:after.game.party.map((m,i)=>m.xp-before.game.party[i].xp),reloadNoDoublePay:true,catalogThreshold:true,errors});await context.close();
}}finally{await browser.close();}fs.writeFileSync('/tmp/public-rewards-browser.json',JSON.stringify(rows,null,2));console.log(rows);
})().catch(e=>{console.error(e);process.exit(1)});
