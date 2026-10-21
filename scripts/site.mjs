// Renders docs/index.html (GitHub Pages) from dist/. Self-contained, no CDN.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('..', import.meta.url).pathname;
const data = JSON.parse(readFileSync(join(root, 'dist/launchpads.json'), 'utf8'));
const chains = JSON.parse(readFileSync(join(root, 'dist/chains.json'), 'utf8'));
const repo = process.env.REPO_URL || 'https://github.com/OWNER/launchpad-registry';
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Launchpad Registry</title>
<meta name="description" content="Open registry of token launchpads: program IDs, factories, hooks and launch events on Solana and EVM chains.">
<style>
:root{--bg:#0f1115;--card:#171a21;--line:#262b36;--fg:#e6e8ee;--mut:#8b93a7;--acc:#7c9cff;--ok:#3ddc97;--warn:#ffb454;--bad:#ff6b6b}
@media(prefers-color-scheme:light){:root{--bg:#f6f7fb;--card:#fff;--line:#e3e6ee;--fg:#141622;--mut:#5f6677;--acc:#3457d5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{padding:28px 16px 12px;max-width:1100px;margin:0 auto}h1{margin:0 0 6px;font-size:26px}h1 small{color:var(--mut);font-weight:400;font-size:14px;margin-left:8px}
p{margin:4px 0;color:var(--mut)}a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}
.bar{display:flex;gap:8px;flex-wrap:wrap;max-width:1100px;margin:10px auto;padding:0 16px}
input,select{background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:inherit}input{flex:1;min-width:200px}
main{max-width:1100px;margin:0 auto;padding:8px 16px 40px;display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px}
.c{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:6px}
.t{display:flex;justify-content:space-between;align-items:baseline;gap:8px}.t b{font-size:16px}.chip{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);color:var(--mut);white-space:nowrap}
.s-active{color:var(--ok);border-color:var(--ok)}.s-inactive{color:var(--bad);border-color:var(--bad)}.s-unknown,.s-test{color:var(--warn);border-color:var(--warn)}
.m{color:var(--mut);font-size:13px}.a{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;display:flex;gap:6px;align-items:flex-start}
.a span{color:var(--mut);min-width:90px;font-family:system-ui;font-size:11px;padding-top:2px}.a button{background:none;border:1px solid var(--line);color:var(--mut);border-radius:6px;cursor:pointer;font-size:11px;padding:0 6px}
.l{display:flex;gap:10px;flex-wrap:wrap;font-size:13px;margin-top:4px}.n{font-size:12px;color:var(--mut);border-top:1px solid var(--line);padding-top:6px;margin-top:2px}
footer{text-align:center;color:var(--mut);font-size:13px;padding:20px}
</style></head><body>
<header><h1>Launchpad Registry <small>${data.count} launchpads · ${chains.length} chains · built ${data.generated}</small></h1>
<p>Program IDs, factories, hooks and launch events a bot needs to detect token launches. Open data, MIT. <a href="${repo}">GitHub</a> · <a href="${repo}/blob/main/dist/launchpads.json">launchpads.json</a> · <a href="${repo}/blob/main/CONTRIBUTING.md">add one</a></p></header>
<div class="bar"><input id="q" placeholder="search name, id, address, tag…"><select id="ch"><option value="">all chains</option>${chains.map(c => `<option value="${c.dir}">${c.name}</option>`).join('')}</select>
<select id="st"><option value="">any status</option><option>active</option><option>inactive</option><option>test</option><option>unknown</option></select>
<select id="mo"><option value="">any model</option><option>bonding-curve</option><option>direct-pool</option><option>funding-round</option><option>meta-launchpad</option><option>other</option></select></div>
<main id="list"></main>
<footer>Listing ≠ endorsement. Data is community-maintained; verify before you trade.</footer>
<script>
const L=${JSON.stringify(data.launchpads)},C=${JSON.stringify(chains)};
const dirOf=l=>C.find(c=>c.family===l.chain.family&&String(c.id)===String(l.chain.id))?.dir||'';
const exp=(l,a)=>{const c=C.find(c=>c.dir===dirOf(l));if(!c?.explorer)return'#';return c.family==='solana'?c.explorer+'/account/'+a:c.explorer+'/address/'+a};
const esc=s=>String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const q=document.getElementById('q'),ch=document.getElementById('ch'),st=document.getElementById('st'),mo=document.getElementById('mo'),list=document.getElementById('list');
function card(l){const c=C.find(c=>c.dir===dirOf(l));return '<div class="c"><div class="t"><b>'+esc(l.name)+'</b><span class="chip s-'+l.status+'">'+l.status+'</span></div>'+
'<div class="m">'+esc(c?.name||'')+' · '+l.model+(l.builtOn?' · on <a href="#'+l.builtOn+'">'+l.builtOn+'</a>':'')+(l.firstSeen?' · since '+l.firstSeen:'')+'</div>'+
l.contracts.map(k=>'<div class="a"><span>'+esc(k.role)+'</span><a href="'+exp(l,k.address)+'" target="_blank" rel="noopener" title="'+esc(k.label||'')+'">'+k.address+'</a><button onclick="navigator.clipboard.writeText(\\''+k.address+'\\')" title="copy">⧉</button></div>').join('')+
(l.launch?'<div class="n"><b>launch:</b> '+esc(l.launch.kind)+(l.launch.name?' · '+esc(l.launch.name):'')+(l.launch.topic0?' · topic0 <code>'+l.launch.topic0.slice(0,10)+'…</code>':'')+(l.launch.discriminator?' · disc <code>'+l.launch.discriminator+'</code>':'')+(l.launch.notes?'<br>'+esc(l.launch.notes):'')+'</div>':'')+
'<div class="l">'+(l.website?'<a href="'+esc(l.website)+'" target="_blank" rel="noopener">website</a>':'')+(l.socials?.x?'<a href="https://x.com/'+esc(l.socials.x)+'" target="_blank" rel="noopener">@'+esc(l.socials.x)+'</a>':'')+(l.graduation?.target?'<span class="m">→ '+esc(l.graduation.target)+'</span>':'')+(l.tags||[]).map(t=>'<span class="chip">'+esc(t)+'</span>').join('')+'</div></div>'}
function render(){const s=q.value.trim().toLowerCase();const out=L.filter(l=>(!ch.value||dirOf(l)===ch.value)&&(!st.value||l.status===st.value)&&(!mo.value||l.model===mo.value)&&(!s||JSON.stringify([l.id,l.name,l.tags,l.contracts.map(k=>k.address),l.builtOn]).toLowerCase().includes(s)));
list.innerHTML=out.map(card).join('')||'<p>nothing matches</p>'}
[q,ch,st,mo].forEach(e=>e.addEventListener('input',render));if(location.hash){q.value=location.hash.slice(1)}render();
</script></body></html>
`;
mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs/index.html'), html);
console.log(`docs/index.html: ${(html.length / 1024).toFixed(0)} KB`);
