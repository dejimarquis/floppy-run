import { chromium } from 'playwright';
const browser = await chromium.launch({ headless:false, args:['--ignore-gpu-blocklist','--enable-gpu-rasterization','--autoplay-policy=no-user-gesture-required']});
const page = await browser.newPage({ viewport:{width:1100,height:640} });
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.goto('http://localhost:5173/play/pinball/', { waitUntil:'domcontentloaded', timeout:60000 });
await page.waitForFunction('window.__READY__===true',null,{timeout:60000});
await page.keyboard.press('Space');
await page.waitForTimeout(2500);
const out = await page.evaluate(()=>{
  const r = window.__GAME__.renderer;
  const progs = r.info.programs.map(p=>{
    // cacheKey is a giant string; pull the interesting bits
    return { name: p.name, usedTimes: p.usedTimes, key: p.cacheKey };
  });
  return progs;
});
console.log('total programs', out.length);
const byName = {};
for (const p of out) byName[p.name] = (byName[p.name]||0)+1;
console.log(JSON.stringify(byName,null,1));
console.log('errors', errs.length, errs.slice(0,4));
// dump keys grouped by name for the biggest offenders
const top = Object.entries(byName).sort((a,b)=>b[1]-a[1]).slice(0,4).map(e=>e[0]);
for (const n of top){
  const ks = out.filter(p=>p.name===n).map(p=>p.key);
  // find differing tokens
  const sets = ks.map(k=>new Set(k.split(',')));
  const all = new Set(); sets.forEach(s=>s.forEach(v=>all.add(v)));
  const varying = [...all].filter(v=>sets.some(s=>!s.has(v)));
  console.log('---', n, ks.length, 'varying tokens:', JSON.stringify(varying.slice(0,80)));
}
await browser.close();
