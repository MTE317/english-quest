const {chromium}=require('playwright');const assert=require('node:assert/strict');const path=require('node:path');
(async()=>{
 const {loadData}=await import(path.join(__dirname,'../../../sim/balance.mjs'));
 const {createNewGame}=await import(path.join(__dirname,'../../js/game-state.js'));
 const data=loadData(),game=createNewGame(data,['warrior','knight','black_mage','white_mage','hunter','bard'].map(job=>({job,name:job,icon:'x'})));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base=process.env.BASE_URL??'http://127.0.0.1:8768',key='englishQuest.save.v2';
 await page.goto(base+'/game/index.html');await page.evaluate(({key,game})=>localStorage.setItem(key,JSON.stringify({version:1,savedAt:Date.now(),game,run:null})),{key,game});await page.reload();
 await page.getByText('冒険者の町',{exact:true}).waitFor();console.log('町 起動');
 for(const [mode,label] of [['phrases','通常の英作文'],['chunks','チャンク集中']]){
  await page.goto(base+'/game/study.html?mode='+mode);await page.locator('.training-start-button').click();await page.getByRole('button',{name:'答えを見る',exact:true}).waitFor();
  assert((await page.locator('body').innerText()).includes(label));assert.equal(await page.locator('.chant-card').getByText(/^チャンク：/).count(),mode==='chunks'?1:0);
  await page.getByRole('button',{name:'答えを見る',exact:true}).click();await page.getByRole('button',{name:'○　言えた',exact:true}).click();console.log(mode+'を独立モードで1問回答');
 }
 await page.goto(base+'/game/dungeon.html');await page.getByRole('button',{name:/^苔むした洞窟、/}).click();
 await page.getByRole('button',{name:'出発する',exact:true}).click();await page.getByRole('button',{name:/通常攻撃/}).waitFor();console.log('戦闘 起動');
 await page.getByRole('button',{name:/通常攻撃/}).click();
 if(await page.locator('.battle-targets button').count())await page.locator('.battle-targets button').first().click();
 await page.locator('.battle-answers button').first().waitFor();
 const pending=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).run.battle.pending,key);
 await page.locator('.battle-answers button').nth(pending.question.answerIndex).click();console.log('戦闘で出題・正答');
 const state=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);assert.equal(state.run.dungeonId,'mossy_cave');assert(state.game.catalog.monsters.length>0);
 await page.goto(base+'/game/records.html?tab=catalog');await page.getByText(/^モンスター図鑑/).waitFor();
 for(const id of state.game.catalog.monsters)assert(await page.locator('summary').filter({hasText:data.monsters.get(id).name}).count());
 await page.getByText(/^モンスター図鑑/).click();await page.screenshot({path:'/tmp/records-catalog.png'});console.log('遭遇した魔物の図鑑 起動');
 await page.getByRole('button',{name:'学習記録',exact:true}).click();await page.getByRole('heading',{name:'英語学習の統計',exact:true}).waitFor();assert((await page.locator('body').innerText()).includes('1,600')||(await page.locator('body').innerText()).includes('1600'));assert((await page.locator('body').innerText()).includes('単語 1問 / 英作文 2問'));console.log('学習統計 起動・単語1問/英作文2問');
 await page.getByRole('button',{name:'設定',exact:true}).click();await page.locator('label').filter({hasText:'翻訳の方向'}).locator('select').selectOption('ja2en');await page.reload();assert.equal(await page.locator('label').filter({hasText:'翻訳の方向'}).locator('select').inputValue(),'ja2en');console.log('設定 保存・再読込');
 assert.deepEqual(errors,[]);await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
