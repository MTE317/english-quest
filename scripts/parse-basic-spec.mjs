import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const text = fs.readFileSync(new URL('../docs/basic-jobs-skills-v1.md',import.meta.url),'utf8').replace(/\r\n/g,'\n');
export const specs = [...text.matchAll(/^#### (\w+_[APU]\d+) (.+)\n([\s\S]*?)(?=^#### |^## |$(?![\s\S]))/gm)].map((m)=>{
  const rows=m[3].split('\n').filter(l=>l.startsWith('|')).map(l=>l.split('|').slice(1,-1).map(x=>x.trim()));
  const meta=Object.fromEntries(rows.filter(r=>!/^\d+$/.test(r[0]) && r.length===2));
  const levels=rows.filter(r=>/^[1-5]$/.test(r[0])).map(r=>r[1]);
  return {id:m[1],name:m[2],meta,levels};
});
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) console.log(JSON.stringify(specs,null,2));
