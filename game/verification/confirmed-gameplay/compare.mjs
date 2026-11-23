import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const before = JSON.parse(readFileSync(new URL('./before.json', import.meta.url)));
const after = JSON.parse(readFileSync(new URL('./after.json', import.meta.url)));
assert.equal(before.scenarios.length, after.scenarios.length);
const key = r => [r.dungeonId,r.profile,r.preparation,r.accuracy,r.season,r.seed,r.runs].join('/');
const earlier = new Map(before.scenarios.map(r => [key(r),r]));
let rows = ['| ★ | 編成 | 準備 | 踏破数（前→後） | 成功時平均問数（前→後） | 問数差 |', '| --- | --- | --- | ---: | ---: | ---: |'];
const results = after.scenarios.map(a => {
  const b = earlier.get(key(a)); assert.ok(b); assert.deepEqual(b.fixture, a.fixture);
  const delta = a.clearQuestions - b.clearQuestions;
  rows.push(`| ${a.star} | ${a.profile} | ${a.preparation} | ${b.wins}→${a.wins} / ${a.runs} | ${b.clearQuestions.toFixed(3)}→${a.clearQuestions.toFixed(3)} | ${delta.toFixed(3)} |`);
  return {condition:key(a),beforeWins:b.wins,afterWins:a.wins,beforeQuestions:b.clearQuestions,afterQuestions:a.clearQuestions,delta};
});
const result={beforeSourceSha256:before.sourceSha256,afterSourceSha256:after.sourceSha256,fixtureIdentical:true,results};
writeFileSync(new URL('./comparison.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(rows.join('\n'));
