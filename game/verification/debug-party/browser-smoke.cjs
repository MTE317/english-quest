// 実セーブを使わず、隔離context内の合成セーブで確認する。
const {chromium}=require('playwright');const assert=require('node:assert/strict');const path=require('node:path');
(async()=>{
 const {loadData}=await import(path.join(__dirname,'../../../sim/balance.mjs'));
 const {createNewGame}=await import(path.join(__dirname,'../../js/game-state.js'));
 const data=loadData(),game=createNewGame(data,['warrior','knight','black_mage','white_mage','thief','bard'].map(job=>({job,name:job,icon:'x'})));
 game.party.forEach((m,i)=>{m.ap[m.job]=i===2?1500:i;m.ap.other_job=25+i;});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base=process.env.BASE_URL??'http://127.0.0.1:8767',key='englishQuest.save.v2';
 await page.goto(base+'/game/debug.html');
 const raw=JSON.stringify({version:1,savedAt:1,game,run:null});await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key,raw});await page.reload();
 const button=page.getByRole('button',{name:'全員をLv99・現職AP999に設定',exact:true});await button.waitFor();await page.waitForFunction(()=>!document.getElementById('debug-party-max').disabled);
 const read=()=>page.evaluate(key=>localStorage.getItem(key),key);assert.equal(await read(),raw);
 page.once('dialog',d=>{assert.match(d.message(),/現在のセーブに保存/);d.dismiss();});await button.click();assert.equal(await read(),raw);
 page.once('dialog',d=>d.accept());await button.click();await page.getByText('全員をLv99・現職AP999に設定し、現在のセーブに保存しました。',{exact:true}).waitFor();
 const boosted=JSON.parse(await read());for(const [i,m]of boosted.game.party.entries()){assert.equal(m.lv,99);assert.equal(m.xp,0);assert.equal(m.ap[m.job],999);assert.equal(m.ap.other_job,25+i);}
 await page.screenshot({path:'/tmp/debug-party-button.png'});await page.reload();assert.deepEqual(JSON.parse(await read()).game,boosted.game);
 for(const battle of [null,{}]){await page.evaluate(({key,battle})=>{const s=JSON.parse(localStorage.getItem(key));s.run={dungeonId:'mossy_cave',battle};localStorage.setItem(key,JSON.stringify(s));},{key,battle});await page.reload();await page.waitForTimeout(300);assert(await button.isDisabled());}
 await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key,raw});
 for(const route of ['index.html','party.html']){await page.goto(base+'/game/'+route);await page.waitForTimeout(300);assert.equal(await page.getByRole('button',{name:'全員をLv99・現職AP999に設定',exact:true}).count(),0);}
 assert.deepEqual(errors,[]);console.log('全6人・現職/他職AP・キャンセル・非自動実行・再読込・遠征/戦闘中禁止・通常画面非表示: 成功');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
