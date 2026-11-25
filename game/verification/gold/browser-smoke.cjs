// 実ユーザーの保存領域とは別のcontext。普段の町→掲示板→報告→買物の画面を通す。
const {chromium}=require('playwright');const assert=require('node:assert/strict');const path=require('node:path');
(async()=>{
 const {loadData}=await import(path.join(__dirname,'../../../sim/balance.mjs'));
 const {createNewGame,defaultPartySpecs}=await import(path.join(__dirname,'../../js/game-state.js'));
 const {fillBoard,acceptQuest}=await import(path.join(__dirname,'../../js/town.js'));
 const data=loadData(),base=process.env.BASE_URL??'http://127.0.0.1:8772',key='englishQuest.save.v2';
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox']});
 for(const width of [320,390]){
  const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const g=createNewGame(data,defaultPartySpecs(data));fillBoard(data,g,()=>.3);
  const q=g.board.find(q=>q.type==='boss');acceptQuest(data,g,q.uid,()=>.3);q.progress=q.count;
  for(const q of [...g.board,...g.quests,g.specialQuest].filter(Boolean))for(const k of ['rewardGold','depositGold','depositPaid'])if(q[k]!=null)q[k]/=10;
  delete g.goldVersion;g.gold=1000;g.loan=111;
  const read=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)).game,key);
  await page.goto(base+'/game/index.html');await page.evaluate(({key,g})=>localStorage.setItem(key,JSON.stringify({version:1,savedAt:1,game:g,run:null})),{key,g});
  await page.goto(base+'/game/index.html?facility=guild');await page.getByRole('heading',{name:'ギルド酒場',exact:true}).waitFor();
  assert.equal((await read()).gold,10000);assert.equal((await read()).loan,1110);await page.reload();await page.getByRole('heading',{name:'ギルド酒場',exact:true}).waitFor();assert.equal((await read()).gold,10000);
  await page.getByRole('button',{name:'受注中 1',exact:true}).click();assert.match(await page.locator('.guild-contract').innerText(),/530 G/);
  await page.screenshot({path:`/tmp/gold-board-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'報告する',exact:true}).click();assert.equal((await read()).gold,10530);assert.equal((await read()).quests.length,0);
  await page.goto(base+'/game/index.html?facility=items');await page.locator('[data-item="potion"]').click();assert.match(await page.locator('.shop-facts').innerText(),/200 G/);
  await page.getByRole('button',{name:'5個買う',exact:true}).click();assert.match(await page.locator('#shop-confirm-summary').innerText(),/1,000 G/);
  await page.getByRole('button',{name:'キャンセル',exact:true}).click();assert.equal((await read()).gold,10530);
  await page.getByRole('button',{name:'5個買う',exact:true}).click();await page.getByRole('button',{name:'確定する',exact:true}).click();assert.equal((await read()).gold,9530);assert.equal((await read()).items.potion,5);
  await page.goto(base+'/game/index.html?facility=manage');await page.getByRole('spinbutton',{name:'金額（G）'}).fill('80');await page.getByRole('button',{name:'返済する',exact:true}).click();assert.equal((await read()).gold,9450);assert.equal((await read()).loan,1030);
  await page.reload();await page.getByRole('spinbutton',{name:'金額（G）'}).waitFor();assert.equal((await read()).gold,9450);assert.equal((await read()).loan,1030);
  assert.deepEqual(errors,[]);console.log(`${width}px: 旧1000G→10000G一度だけ、53G依頼→530G報告、5個1000Gの取消/購入、部分返済80G、再読込: OK`);await context.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
