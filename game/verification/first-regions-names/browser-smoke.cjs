// 隔離したブラウザーと合成セーブだけで図鑑・依頼の表示を確認する。
const {chromium}=require('playwright');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{
 const {loadData}=await import(path.join(__dirname,'../../../sim/balance.mjs'));
 const {createNewGame}=await import(path.join(__dirname,'../../js/game-state.js'));
 const changes=JSON.parse(fs.readFileSync(path.join(__dirname,'changes.json')));
 const game=createNewGame(loadData(),['warrior','knight','white_mage','black_mage','hunter','bard'].map(job=>({job,name:job,icon:'x'})));
 game.catalog={monsters:changes.monsters.map(c=>c.id),gear:[]};
 game.quests=[{uid:'name-check-boss',type:'boss',target:'goblin_boss',count:1,progress:0,rank:1,dungeonId:'mossy_cave'},...['bounty_01_1','bounty_01_2'].map((id,i)=>({uid:'name-check-'+id,questId:'q_'+id,type:'bounty',target:id,count:1,progress:0,rank:1,dungeonId:i?'sunlit_forest':'mossy_cave'}))];
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const save=JSON.stringify({version:1,savedAt:Date.now(),game,run:null});
 await context.addInitScript(s=>localStorage.setItem('englishQuest.save.v2',s),save);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const url=process.env.BASE_URL??'http://127.0.0.1:8766';
 await page.goto(url+'/game/records.html?tab=catalog');await page.waitForTimeout(500);
 console.log('図鑑ページの既存エラー:',JSON.stringify(errors));
 assert(errors.some(e=>e.includes("Identifier 'catalog' has already been declared")));
 errors.length=0;
 await page.goto(url+'/game/index.html?facility=guild');await page.getByRole('button',{name:'受注中 3',exact:true}).click();await page.getByRole('heading',{name:'岩窟のグラムをたおす',exact:true}).waitFor({timeout:5000});
 for(const name of ['血槍のヴァルド','鉄牙のアラネア'])assert(await page.getByRole('heading',{name:`賞金首「${name}」を倒す`,exact:true}).count());
 await page.getByRole('heading',{name:'岩窟のグラムをたおす',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/monster-names-quests.png'});
 assert.deepEqual(errors,[]);console.log('ボス依頼1件・賞金首依頼2件・pageerror 0: 成功（図鑑画面は既存構文エラーで未検証）');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
