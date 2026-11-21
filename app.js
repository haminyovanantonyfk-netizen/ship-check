'use strict';
/* ShipCheck — original free pre-launch checker. All logic written from scratch.
   Runs 100% in the browser against public APIs: GitHub, npm registry, OSV, Cloudflare DNS-over-HTTPS. */
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={scores:{repo:null,deps:null,domain:null},reports:{repo:'',deps:'',domain:''},meta:{repo:'',deps:'',domain:''}};
const store={get(k,d){try{const v=localStorage.getItem('shipcheck.'+k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem('shipcheck.'+k,JSON.stringify(v))}catch(e){}}};

/* ---------- theme & tabs ---------- */
function applyTheme(t){document.documentElement.dataset.theme=t;store.set('theme',t);$('themeBtn').textContent=t==='dark'?'☀️':'🌙'}
$('themeBtn').addEventListener('click',()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
applyTheme(store.get('theme',window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));
  ['repo','deps','domain'].forEach(t=>$('panel-'+t).classList.toggle('hidden',t!==b.dataset.tab));
}));

/* ---------- shared helpers ---------- */
async function fetchJSON(url,opts){const r=await fetch(url,opts||{});if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}
function grade(score){return score>=90?'A':score>=75?'B':score>=60?'C':score>=40?'D':'F'}
function timeAgo(iso){if(!iso)return'never';const d=(Date.now()-new Date(iso).getTime())/86400000;if(d<1)return'today';if(d<30)return Math.floor(d)+' days ago';if(d<365)return Math.floor(d/30)+' months ago';return (d/365).toFixed(1)+' years ago'}
function fmtNum(n){if(n==null)return'—';if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1e3)return(n/1e3).toFixed(1)+'k';return String(n)}
function download(name,content){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'text/plain'}));a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
async function copyText(t,btn){try{await navigator.clipboard.writeText(t);if(btn){const o=btn.textContent;btn.textContent='✓ Copied';setTimeout(()=>btn.textContent=o,1500)}}catch(e){window.prompt('Copy this:',t)}}
function renderChecks(el,checks){
  el.innerHTML='<ul class="checks">'+checks.map(c=>{
    const b=c.status==='pass'?'<span class="badge b-pass">PASS</span>':c.status==='warn'?'<span class="badge b-warn">WARN</span>':'<span class="badge b-fail">FAIL</span>';
    return '<li>'+b+'<div class="check-body"><b>'+esc(c.label)+'</b>'+(c.detail?' — '+esc(c.detail):'')+(c.why?'<div class="why">'+esc(c.why)+'</div>':'')+'</div><span class="pts">'+c.pts+'/'+c.max+'</span></li>';
  }).join('')+'</ul>';
}
function scoreHeader(title,score,sub){
  return '<div class="kv"><div class="box"><span>Score</span><b>'+score+'/100</b></div><div class="box"><span>Grade</span><b>'+grade(score)+'</b></div><div class="box"><span>'+esc(title)+'</span><b style="font-size:1rem">'+esc(sub)+'</b></div></div>';
}
function setScore(mod,score,meta,report){
  state.scores[mod]=score;state.meta[mod]=meta;state.reports[mod]=report;store.set('scores',state.scores);
  const chip={repo:$('chipRepo'),deps:$('chipDeps'),domain:$('chipDomain')}[mod];
  chip.textContent=score+'/100 ('+grade(score)+')';
  const run=Object.values(state.scores).filter(s=>s!=null);
  if(run.length){const avg=Math.round(run.reduce((a,b)=>a+b,0)/run.length);$('overallScore').textContent=avg;$('overallHint').textContent='Average of '+run.length+' of 3 checks run. '+(avg>=75?'Looking launch-ready — polish the warnings.':avg>=50?'Close — work through the failing checks below.':'Not yet — the failing checks below are your launch blockers.');}
  $('exportBtn').disabled=!run.length;
}
$('exportBtn').addEventListener('click',()=>{
  const lines=['# ShipCheck — Launch Readiness Report','Generated: '+new Date().toLocaleString(),''];
  const avg=Object.values(state.scores).filter(s=>s!=null);
  if(avg.length)lines.push('**Overall: '+Math.round(avg.reduce((a,b)=>a+b,0)/avg.length)+'/100**','');
  ['repo','deps','domain'].forEach(m=>{if(state.reports[m])lines.push(state.reports[m],'')});
  lines.push('---','Generated free with ShipCheck. Checks run live against GitHub, npm, OSV and public DNS.');
  download('shipcheck-report.md',lines.join('\n'));
});
function checksToMd(title,meta,score,checks){
  const lines=['## '+title+' — '+score+'/100 (grade '+grade(score)+')',meta,''];
  checks.forEach(c=>lines.push('- ['+(c.status==='pass'?'x':' ')+'] **'+c.label+'** ('+c.pts+'/'+c.max+')'+(c.detail?' — '+c.detail:'')+(c.status!=='pass'&&c.why?' · Fix: '+c.why:'')));
  return lines.join('\n');
}

/* ---------- semver ---------- */
function parseSemver(s){if(!s)return null;const m=String(s).match(/(\d+)\.(\d+)\.(\d+)/);return m?[+m[1],+m[2],+m[3]]:null}
function cmpSemver(a,b){for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]<b[i]?-1:1}return 0}
function diffLevel(a,b){if(!a||!b)return'unknown';const c=cmpSemver(a,b);if(c>=0)return'up-to-date';if(a[0]!==b[0])return'major';if(a[1]!==b[1])return'minor';return'patch'}

/* ==================================================================
   MODULE 1 — GitHub repo audit
================================================================== */
function parseRepoInput(v){
  v=(v||'').trim().replace(/\/+$/,'');
  const m=v.match(/github\.com\/([^\/\s]+)\/([^\/\s#?]+)/)||v.match(/^([\w.-]+)\/([\w.-]+)$/);
  return m?{owner:m[1],repo:m[2].replace(/\.git$/,'')}:null;
}
const GH='https://api.github.com';
async function gh(path,raw){
  const r=await fetch(GH+path,{headers:raw?{Accept:'application/vnd.github.raw'}:{Accept:'application/vnd.github+json'}});
  if(r.status===404)throw new Error('notfound');
  if(r.status===403)throw new Error('GitHub API rate limit reached (~60 unauthenticated checks/hour). Wait a bit and try again.');
  if(!r.ok)throw new Error('GitHub API error '+r.status);
  return raw?r.text():r.json();
}
$('repoSample').addEventListener('click',()=>{$('repoInput').value='haminyovanantonyfk-netizen/focus-grove';$('repoBtn').click()});
$('repoBtn').addEventListener('click',async()=>{
  const p=parseRepoInput($('repoInput').value);const msg=$('repoMsg');
  if(!p){msg.textContent='Enter a repo as owner/repo or a full GitHub URL.';return}
  const btn=$('repoBtn');btn.disabled=true;msg.textContent='Checking '+p.owner+'/'+p.repo+' against GitHub…';
  $('repoResults').innerHTML='';$('repoFixes').innerHTML='';
  try{
    const repo=await gh('/repos/'+p.owner+'/'+p.repo);
    const [community,root,workflows,releases,readmeText]=await Promise.all([
      gh('/repos/'+p.owner+'/'+p.repo+'/community/profile').catch(()=>null),
      gh('/repos/'+p.owner+'/'+p.repo+'/contents/').catch(()=>[]),
      gh('/repos/'+p.owner+'/'+p.repo+'/contents/.github/workflows').catch(()=>null),
      gh('/repos/'+p.owner+'/'+p.repo+'/releases?per_page=1').catch(()=>[]),
      gh('/repos/'+p.owner+'/'+p.repo+'/readme',true).catch(()=>null)
    ]);
    const names=new Set((Array.isArray(root)?root:[]).map(f=>f.name.toLowerCase()));
    const files=(community&&community.files)||{};
    const hasReadme=!!files.readme||names.has('readme.md')||names.has('readme');
    const checks=[];let total=0;
    const add=(label,status,pts,max,detail,why)=>{checks.push({label,status,pts,max,detail,why});total+=pts};
    add('Description set',repo.description?'pass':'fail',repo.description?6:0,6,repo.description||'no description','The one-liner under your repo name is what people and search engines see. Add it in the repo About ⚙.');
    const topics=repo.topics||[];
    add('Topics (≥3)',topics.length>=3?'pass':topics.length?'warn':'fail',topics.length>=3?5:topics.length?2:0,5,topics.length?topics.join(', '):'none','Topics make you discoverable in GitHub search. Add them in About ⚙.');
    add('Homepage / live link',repo.homepage?'pass':'warn',repo.homepage?3:0,3,repo.homepage||'not set','Link your live site or demo in About ⚙.');
    add('README exists',hasReadme?'pass':'fail',hasReadme?8:0,8,'','Your README is your landing page. No README = instant bounce.');
    let rq=0,rqDetail='not measured';
    if(readmeText){const t=readmeText.toLowerCase();const len=readmeText.length;const sections=['install','usage','getting started','features','license'].filter(s=>t.includes(s)).length;rq=len>=1500&&sections>=3?7:len>=600&&sections>=2?4:2;rqDetail=len+' chars, '+sections+'/5 key sections (install/usage/getting started/features/license)'}
    add('README quality',rq>=7?'pass':rq>=4?'warn':'fail',rq,7,rqDetail,'Aim for: what it is, a screenshot/demo, install steps, usage, features, license.');
    const lic=repo.license&&repo.license.spdx_id;
    add('LICENSE',lic?'pass':'fail',lic?10:0,10,lic||'none detected','Without a license your code is legally "all rights reserved" — nobody may use it. Generated for you below.');
    add('.gitignore',names.has('.gitignore')?'pass':'fail',names.has('.gitignore')?6:0,6,'','Stops secrets (.env) and junk (node_modules) being committed. Generated for you below.');
    const wf=Array.isArray(workflows)?workflows.filter(f=>/\.ya?ml$/.test(f.name)):[];
    add('CI / GitHub Actions',wf.length?'pass':'warn',wf.length?9:0,9,wf.length?wf.map(f=>f.name).join(', '):'no workflows','Even a simple build/test workflow signals the project is maintained.');
    const hasContrib=!!files.contributing||names.has('contributing.md');
    add('CONTRIBUTING guide',hasContrib?'pass':'warn',hasContrib?6:0,6,'','Tells contributors how to help — the difference between drive-by issues and real PRs. Generated below.');
    const hasSec=names.has('security.md')||!!(files&&files.security);
    add('SECURITY policy',hasSec?'pass':'warn',hasSec?5:0,5,'','A private way to report vulnerabilities. Generated below.');
    const hasIT=!!files.issue_template||names.has('.github');
    add('Issue templates',files.issue_template?'pass':'warn',files.issue_template?5:0,5,'','Structured bug reports save maintainer time. Generated below.');
    add('PR template',files.pull_request_template?'pass':'warn',files.pull_request_template?4:0,4,'','A checklist on every pull request. Generated below.');
    add('Code of Conduct',files.code_of_conduct?'pass':'warn',files.code_of_conduct?3:0,3,'','Expected by communities and awesome-lists. Generated below.');
    add('CHANGELOG',names.has('changelog.md')?'pass':'warn',names.has('changelog.md')?3:0,3,'','Users check what changed before upgrading.');
    add('Releases published',(releases&&releases.length)?'pass':'warn',(releases&&releases.length)?8:0,8,(releases&&releases.length)?'latest: '+(releases[0].tag_name||releases[0].name||'yes'):'none','Releases (not just tags) are what people download and subscribe to.');
    const days=(Date.now()-new Date(repo.pushed_at).getTime())/86400000;
    add('Recent activity',days<=90?'pass':days<=365?'warn':'fail',days<=90?7:days<=365?3:0,7,'last push '+timeAgo(repo.pushed_at),'Repos untouched for a year read as abandoned.');
    add('Not archived',!repo.archived?'pass':'fail',!repo.archived?2:0,2,repo.archived?'archived':'active','');
    const health=community?community.health_percentage:null;
    add('GitHub community health ≥50%',health!=null&&health>=50?'pass':'warn',health!=null&&health>=50?3:0,3,health!=null?health+'%':'unavailable','GitHub\'s own Community Profile score.');
    const score=Math.min(100,total);
    const meta='⭐ '+fmtNum(repo.stargazers_count)+' · 🍴 '+fmtNum(repo.forks_count)+' · '+(repo.language||'multi-language')+' · '+p.owner+'/'+p.repo;
    $('repoResults').innerHTML=scoreHeader('Repository',score,meta)+'<div id="repoCheckList"></div>';
    renderChecks($('repoCheckList'),checks);
    /* fixes */
    const author=$('authorInput').value.trim()||repo.owner.login;
    const lang=(repo.language||'').toLowerCase();
    const fixes=[];
    if(!lic)fixes.push({path:'LICENSE',body:mitLicense(author)});
    if(!names.has('.gitignore'))fixes.push({path:'.gitignore',body:gitignoreFor(lang)});
    if(!hasContrib)fixes.push({path:'CONTRIBUTING.md',body:contributingMd(p)});
    if(!hasSec)fixes.push({path:'SECURITY.md',body:securityMd(p)});
    if(!files.code_of_conduct)fixes.push({path:'CODE_OF_CONDUCT.md',body:codeOfConductMd()});
    if(!files.issue_template){fixes.push({path:'.github/ISSUE_TEMPLATE/bug_report.md',body:bugTemplate(p)});fixes.push({path:'.github/ISSUE_TEMPLATE/feature_request.md',body:featureTemplate(p)})}
    if(!files.pull_request_template)fixes.push({path:'.github/PULL_REQUEST_TEMPLATE.md',body:prTemplate()});
    if(fixes.length){
      $('repoFixes').innerHTML='<h3>🛠 Your missing files — written for you</h3><p class="muted">Copy or download each file and add it to your repo at the shown path. Nothing here overwrites your code.</p>'+fixes.map((f,i)=>'<details><summary><code>'+esc(f.path)+'</code></summary><pre>'+esc(f.body)+'</pre><div class="fix-actions"><button type="button" data-copyfix="'+i+'">Copy file</button><button type="button" data-dlfix="'+i+'">Download</button></div></details>').join('');
      $('repoFixes').querySelectorAll('[data-copyfix]').forEach(b=>b.addEventListener('click',()=>copyText(fixes[+b.dataset.copyfix].body,b)));
      $('repoFixes').querySelectorAll('[data-dlfix]').forEach(b=>b.addEventListener('click',()=>download(fixes[+b.dataset.dlfix].path.split('/').pop(),fixes[+b.dataset.dlfix].body)));
    } else {
      $('repoFixes').innerHTML='<p>🎉 No missing community files — this repo has the full set.</p>';
    }
    msg.textContent='Done — '+p.owner+'/'+p.repo+': '+score+'/100.';
    setScore('repo',score,meta,checksToMd('GitHub repo: '+p.owner+'/'+p.repo,meta,score,checks)+(fixes.length?'\n\nFiles generated for you: '+fixes.map(f=>f.path).join(', '):''));
  }catch(e){msg.textContent='⚠ '+(e.message==='notfound'?'Repo not found (or private — ShipCheck checks public repos).':e.message)}
  btn.disabled=false;
});
function mitLicense(name){return 'MIT License\n\nCopyright (c) '+new Date().getFullYear()+' '+name+'\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n'}
function gitignoreFor(lang){
  const base=['# Secrets — never commit these','.env','.env.*','!.env.example','','# OS & editors','.DS_Store','.idea/','.vscode/','*.log',''];
  const byLang={'javascript':['node_modules/','dist/','build/','.next/','coverage/'],'typescript':['node_modules/','dist/','build/','.next/','coverage/'],'python':['__pycache__/','*.pyc','.venv/','venv/','dist/','*.egg-info/'],'java':['target/','*.class','build/'],'go':['bin/','*.exe','*.test'],'rust':['target/'],'c#':['bin/','obj/'],'php':['vendor/'],'ruby':['*.gem','/coverage/']};
  return base.concat(byLang[lang]||['node_modules/','dist/','build/']).join('\n')+'\n';
}
function contributingMd(p){return '# Contributing to '+p.repo+'\n\nThanks for your interest in improving '+p.repo+'! Contributions of all sizes are welcome.\n\n## Getting started\n1. Fork this repository and clone your fork.\n2. Create a branch: `git checkout -b my-change`.\n3. Make your change, keeping it focused on one thing.\n\n## Before you open a pull request\n- Make sure the project still builds and existing tests pass.\n- Add or update tests for behavior you changed, when applicable.\n- Update the README/docs if you changed anything user-facing.\n- Write a clear PR description: what changed, why, and how you tested it.\n\n## Reporting bugs\nOpen an issue using the bug report template — include steps to reproduce, expected vs actual behavior, and your environment.\n\n## Code of conduct\nBe kind and constructive. See CODE_OF_CONDUCT.md.\n'}
function securityMd(p){return '# Security Policy\n\n## Reporting a vulnerability\n\nPlease do **not** open a public issue for security vulnerabilities.\n\nInstead, use GitHub\'s private vulnerability reporting (Security tab → "Report a vulnerability") or contact the maintainer via their GitHub profile. You can expect an acknowledgement within 7 days.\n\n## Supported versions\n\nOnly the latest release of '+p.repo+' is supported with security fixes.\n'}
function codeOfConductMd(){return '# Code of Conduct\n\n## Our pledge\nEveryone participating in this project is welcome. We pledge to keep this community respectful, welcoming and free of harassment for everyone, regardless of background or identity.\n\n## Expected behavior\n- Be kind, patient and constructive.\n- Assume good intent; disagree with ideas, not people.\n- Give credit and help newcomers.\n\n## Unacceptable behavior\n- Harassment, insults or personal attacks.\n- Publishing others\' private information.\n- Any conduct that would be inappropriate in a professional setting.\n\n## Enforcement\nMaintainers may remove comments, close issues or ban participants who violate this code. Report problems privately to the maintainer via their GitHub profile.\n'}
function bugTemplate(p){return '---\nname: Bug report\nabout: Something is broken in '+p.repo+'\ntitle: "[Bug] "\nlabels: bug\n---\n\n**Describe the bug**\nA clear description of what is wrong.\n\n**Steps to reproduce**\n1. \n2. \n3. \n\n**Expected behavior**\nWhat you expected to happen.\n\n**Actual behavior**\nWhat actually happened (include error messages / screenshots).\n\n**Environment**\n- OS: \n- Version: \n'}
function featureTemplate(p){return '---\nname: Feature request\nabout: Suggest an idea for '+p.repo+'\ntitle: "[Feature] "\nlabels: enhancement\n---\n\n**The problem**\nWhat are you trying to do that is currently hard or impossible?\n\n**Proposed solution**\nWhat would you like to happen?\n\n**Alternatives considered**\nAnything you tried instead.\n'}
function prTemplate(){return '## What changed\n\n<!-- Describe your change in a sentence or two. -->\n\n## Why\n\n<!-- The problem this solves or the issue it closes, e.g. Closes #12 -->\n\n## How I tested it\n\n<!-- Steps, commands, or screenshots showing it works. -->\n\n## Checklist\n- [ ] Builds / tests pass locally\n- [ ] Docs updated if user-facing\n- [ ] No secrets or debug code included\n'}

/* ==================================================================
   MODULE 2 — npm dependency risk scan
================================================================== */
const SAMPLE_PKG=JSON.stringify({name:'my-app',version:'1.0.0',dependencies:{lodash:'^4.17.20',request:'^2.88.2',moment:'^2.29.1',react:'^17.0.2',express:'^4.18.2'},devDependencies:{'node-sass':'^7.0.1'}},null,2);
$('depsSample').addEventListener('click',()=>{$('depsInput').value=SAMPLE_PKG;$('depsMsg').textContent='Sample loaded — it contains a vulnerable lodash, a deprecated request, an unmaintained moment and more. Hit Scan.'});
$('depsUpload').addEventListener('click',()=>$('depsFile').click());
$('depsFile').addEventListener('change',()=>{const f=$('depsFile').files[0];if(!f)return;const r=new FileReader();r.onload=()=>{$('depsInput').value=String(r.result)};r.readAsText(f)});
async function pool(items,n,fn){const out=new Array(items.length);let i=0;async function w(){while(i<items.length){const idx=i++;out[idx]=await fn(items[idx],idx)}}await Promise.all(Array.from({length:Math.min(n,items.length)},w));return out}
async function scanDep(name,range){
  const res={name,range,installed:parseSemver(range),latest:null,level:'unknown',deprecated:'',stale:false,downloads:null,vulns:[],error:''};
  try{
    const meta=await fetchJSON('https://registry.npmjs.org/'+name.replace('/','%2f'));
    res.latest=parseSemver(meta['dist-tags']&&meta['dist-tags'].latest);
    res.latestStr=meta['dist-tags']&&meta['dist-tags'].latest;
    const instVer=res.installed?res.installed.join('.'):null;
    const vdoc=instVer&&meta.versions?meta.versions[instVer]:null;
    if(vdoc&&vdoc.deprecated)res.deprecated=String(vdoc.deprecated);
    else if(meta.versions&&res.latestStr&&meta.versions[res.latestStr]&&meta.versions[res.latestStr].deprecated)res.deprecated=String(meta.versions[res.latestStr].deprecated);
    res.license=(vdoc&&vdoc.license)||(meta.versions&&res.latestStr&&meta.versions[res.latestStr]&&meta.versions[res.latestStr].license)||meta.license||'';
    if(typeof res.license==='object')res.license=res.license.type||'';
    const lastPub=meta.time&&(res.latestStr?meta.time[res.latestStr]:meta.time.modified);
    res.lastPub=lastPub||null;
    if(lastPub)res.stale=(Date.now()-new Date(lastPub).getTime())>2*365*86400000;
    res.level=res.installed&&res.latest?diffLevel(res.installed,res.latest):'unknown';
  }catch(e){res.error='not found on npm'}
  try{const dl=await fetchJSON('https://api.npmjs.org/downloads/point/last-week/'+name.replace('/','%2F'));res.downloads=dl.downloads}catch(e){}
  if(res.installed&&!res.error){
    try{
      const osv=await fetchJSON('https://api.osv.dev/v1/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({package:{name:name,ecosystem:'npm'},version:res.installed.join('.')})});
      res.vulns=(osv.vulns||[]).map(v=>({id:v.id,summary:v.summary||'',severity:(v.database_specific&&v.database_specific.severity)||''}));
    }catch(e){}
  }
  return res;
}
$('depsBtn').addEventListener('click',async()=>{
  const msg=$('depsMsg');let pkg;
  try{pkg=JSON.parse($('depsInput').value)}catch(e){msg.textContent='⚠ That is not valid JSON — paste the full contents of package.json.';return}
  const deps=Object.assign({},pkg.dependencies||{});
  if($('devDepsChk').checked)Object.assign(deps,pkg.devDependencies||{});
  const names=Object.keys(deps);
  if(!names.length){msg.textContent='No dependencies found in that file.';return}
  if(names.length>120){msg.textContent='⚠ Over 120 dependencies — trim the file or split the scan.';return}
  const btn=$('depsBtn');btn.disabled=true;$('depsResults').innerHTML='';
  let done=0;msg.textContent='Scanning 0/'+names.length+' packages against npm + OSV…';
  const results=await pool(names,6,async n=>{const r=await scanDep(n,deps[n]);done++;msg.textContent='Scanning '+done+'/'+names.length+' packages against npm + OSV…';return r});
  const vuln=results.filter(r=>r.vulns.length),depr=results.filter(r=>r.deprecated),major=results.filter(r=>r.level==='major'),minor=results.filter(r=>r.level==='minor'),stale=results.filter(r=>r.stale),errs=results.filter(r=>r.error);
  let penalty=vuln.length*15+depr.length*10+major.length*5+minor.length*2+stale.length*5;
  const score=Math.max(0,100-Math.min(100,penalty));
  const sevRank=s=>({CRITICAL:0,HIGH:1,MODERATE:2,LOW:3}[s]??4);
  const rows=results.slice().sort((a,b)=>{
    const rank=r=>(r.vulns.length?0:r.deprecated?1:r.level==='major'?2:r.stale?3:r.level==='minor'?4:r.level==='patch'?5:6);
    return rank(a)-rank(b)||a.name.localeCompare(b.name);
  }).map(r=>{
    const pills=[];
    if(r.error)pills.push('<span class="pill p-red">'+esc(r.error)+'</span>');
    if(r.vulns.length)pills.push('<span class="pill p-red">⚠ '+r.vulns.length+' known CVE'+(r.vulns.length>1?'s':'')+'</span>');
    if(r.deprecated)pills.push('<span class="pill p-red">deprecated</span>');
    if(r.level==='major')pills.push('<span class="pill p-amber">major update</span>');
    if(r.level==='minor')pills.push('<span class="pill p-amber">minor update</span>');
    if(r.level==='patch')pills.push('<span class="pill p-grey">patch update</span>');
    if(r.level==='up-to-date')pills.push('<span class="pill p-green">up to date</span>');
    if(r.stale)pills.push('<span class="pill p-amber">no release in 2+ yrs</span>');
    const vulnList=r.vulns.length?'<div class="why">'+r.vulns.slice(0,3).map(v=>esc(v.id)+(v.severity?' ('+esc(v.severity)+')':'')+' — '+esc(v.summary)).join('<br>')+(r.vulns.length>3?'<br>+'+(r.vulns.length-3)+' more':'')+'</div>':'';
    const depNote=r.deprecated?'<div class="why">Deprecated: '+esc(r.deprecated.slice(0,140))+'</div>':'';
    return '<tr><td><b>'+esc(r.name)+'</b>'+vulnList+depNote+'</td><td>'+esc(r.installed?r.installed.join('.'):'?')+'</td><td>'+esc(r.latestStr||'—')+'</td><td>'+fmtNum(r.downloads)+'/wk</td><td>'+pills.join(' ')+'</td></tr>';
  }).join('');
  const fixNames=results.filter(r=>!r.error&&(r.vulns.length||r.level==='major'||r.level==='minor'||r.level==='patch')).map(r=>r.name+'@'+(r.latestStr||'latest'));
  const fixCmd=fixNames.length?'npm install '+fixNames.join(' '):'';
  $('depsResults').innerHTML=scoreHeader('Packages scanned',score,results.length+' dependencies')+
    '<div class="kv"><div class="box"><span>With known CVEs</span><b>'+vuln.length+'</b></div><div class="box"><span>Deprecated</span><b>'+depr.length+'</b></div><div class="box"><span>Major updates</span><b>'+major.length+'</b></div><div class="box"><span>Abandoned (2y+)</span><b>'+stale.length+'</b></div></div>'+
    (fixCmd?'<h3>🛠 One command fixes the outdated &amp; vulnerable ones</h3><pre>'+esc(fixCmd)+'</pre><div class="fix-actions"><button type="button" id="copyFixCmd">Copy command</button></div><p class="muted">Review changelogs before major upgrades — they can contain breaking changes. Deprecated packages need a replacement, not an upgrade.</p>':'')+
    '<table><thead><tr><th>Package</th><th>Yours</th><th>Latest</th><th>Downloads</th><th>Status</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    '<p class="muted">Vulnerabilities are checked at the lowest version your semver range allows (e.g. ^4.17.20 → 4.17.20) via OSV, which aggregates GitHub Advisories and npm audit data.</p>';
  const cf=$('copyFixCmd');if(cf)cf.addEventListener('click',()=>copyText(fixCmd,cf));
  msg.textContent='Done — dependency score '+score+'/100.';
  const mdLines=['## Dependencies ('+(pkg.name||'package.json')+') — '+score+'/100 (grade '+grade(score)+')',results.length+' packages · '+vuln.length+' with CVEs · '+depr.length+' deprecated · '+major.length+' major updates · '+stale.length+' abandoned',''];
  results.forEach(r=>{const flags=[];if(r.vulns.length)flags.push(r.vulns.length+' CVE(s): '+r.vulns.map(v=>v.id).join(', '));if(r.deprecated)flags.push('DEPRECATED');if(r.level!=='up-to-date'&&r.level!=='unknown')flags.push(r.level+' update → '+r.latestStr);if(r.stale)flags.push('no release in 2+ years');if(r.error)flags.push(r.error);mdLines.push('- **'+r.name+'** '+(r.installed?r.installed.join('.'):'?')+(flags.length?' — '+flags.join(' · '):' — OK'))});
  if(fixCmd)mdLines.push('','Fix command: `'+fixCmd+'`');
  setScore('deps',score,results.length+' packages',mdLines.join('\n'));
  btn.disabled=false;
});

/* ==================================================================
   MODULE 3 — Domain & email readiness (DNS-over-HTTPS)
================================================================== */
const DOH='https://cloudflare-dns.com/dns-query';
async function doh(name,type){
  try{const r=await fetch(DOH+'?name='+encodeURIComponent(name)+'&type='+type,{headers:{accept:'application/dns-json'}});const j=await r.json();return (j.Answer||[]).map(a=>a.data)}catch(e){return[]}
}
function txtJoin(records){return records.map(r=>r.replace(/"\s+"/g,'').replace(/^"|"$/g,''))}
async function spfLookupCount(domain,visited,depth){
  if(depth>6||visited.has(domain))return 0;visited.add(domain);
  const txts=txtJoin(await doh(domain,'TXT'));
  const spf=txts.find(t=>t.toLowerCase().startsWith('v=spf1'));
  if(!spf)return 0;
  let count=0;const terms=spf.split(/\s+/).slice(1);
  for(const term of terms){
    const t=term.replace(/^[+\-~?]/,'');
    if(/^(include:|a($|:|\/)|mx($|:|\/)|ptr($|:|\/)|exists:)/.test(t))count++;
    const inc=t.match(/^include:(.+)$/);if(inc)count+=await spfLookupCount(inc[1],visited,depth+1);
    const red=t.match(/^redirect=(.+)$/);if(red){count++;count+=await spfLookupCount(red[1],visited,depth+1)}
  }
  return count;
}
$('domainSample').addEventListener('click',()=>{$('domainInput').value='github.com';$('domainBtn').click()});
$('domainBtn').addEventListener('click',async()=>{
  const msg=$('domainMsg');
  let domain=($('domainInput').value||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/^www\./,'');
  if(!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)){msg.textContent='Enter a domain like yourdomain.com';return}
  const btn=$('domainBtn');btn.disabled=true;msg.textContent='Reading live DNS for '+domain+'…';$('domainResults').innerHTML='';
  try{
    const DKIM_SELECTORS=['google','20230601','20210112','selector1','selector2','default','k1','s1','s2','mail','dkim','mandrill','smtp','sendgrid'];
    const [aRecs,aaaaRecs,mxRecs,nsRecs,caaRecs,txtsRaw,dmarcRaw,dkimResults]=await Promise.all([
      doh(domain,'A'),doh(domain,'AAAA'),doh(domain,'MX'),doh(domain,'NS'),doh(domain,'CAA'),
      doh(domain,'TXT'),doh('_dmarc.'+domain,'TXT'),
      Promise.all(DKIM_SELECTORS.map(async s=>({s,recs:txtJoin(await doh(s+'._domainkey.'+domain,'TXT'))})))
    ]);
    const txts=txtJoin(txtsRaw);
    const checks=[];let total=0;
    const add=(label,status,pts,max,detail,why)=>{checks.push({label,status,pts,max,detail,why});total+=pts};
    const hasWeb=aRecs.length||aaaaRecs.length;
    add('Website resolves (A/AAAA)',hasWeb?'pass':'fail',hasWeb?10:0,10,hasWeb?(aRecs.concat(aaaaRecs).slice(0,2).join(', ')):'no A/AAAA records','Your site needs an A or AAAA record to load at all.');
    let provider='';const mxJoined=mxRecs.join(' ').toLowerCase();
    if(mxJoined.includes('google'))provider='Google Workspace';else if(mxJoined.includes('outlook')||mxJoined.includes('protection'))provider='Microsoft 365';else if(mxJoined.includes('zoho'))provider='Zoho Mail';else if(mxJoined.includes('icloud'))provider='iCloud Mail';else if(mxJoined.includes('cloudflare'))provider='Cloudflare Email Routing';else if(mxRecs.length)provider='custom / other';
    add('Mail servers (MX)',mxRecs.length?'pass':'fail',mxRecs.length?15:0,15,mxRecs.length?mxRecs.length+' record(s)'+(provider?' · '+provider:''):'none','Without MX records nobody can email you — and providers distrust domains that cannot receive mail.');
    const spfRecs=txts.filter(t=>t.toLowerCase().startsWith('v=spf1'));
    let spfPts=0,spfStatus='fail',spfDetail='no SPF record',spfWhy='SPF lists the servers allowed to send as your domain. Gmail/Yahoo/Outlook require it since 2024–25. Add the record your email provider gives you.';
    if(spfRecs.length>1){spfDetail=spfRecs.length+' SPF records (invalid — only one is allowed)';spfWhy='Multiple SPF records break SPF entirely. Merge them into a single v=spf1 record.'}
    else if(spfRecs.length===1){
      const lookups=await spfLookupCount(domain,new Set(),0);
      const allTerm=(spfRecs[0].match(/([+\-~?])all\b/)||[])[1]||'';
      spfDetail='1 record · '+lookups+'/10 DNS lookups used · ends '+(allTerm?allTerm+'all':'without an "all" mechanism');
      if(lookups>10){spfPts=6;spfStatus='warn';spfWhy='Your SPF uses '+lookups+' DNS lookups — over the hard limit of 10, so SPF fails. Flatten includes or remove unused senders.'}
      else if(allTerm==='-'){spfPts=20;spfStatus='pass'}
      else if(allTerm==='~'){spfPts=16;spfStatus='warn';spfWhy='Soft-fail (~all) is okay while testing; move to -all (hard fail) once every sender is included.'}
      else{spfPts=10;spfStatus='warn';spfWhy='End your SPF with -all so unlisted servers are rejected.'}
    }
    add('SPF (who may send as you)',spfStatus,spfPts,20,spfDetail,spfWhy);
    const dkimFound=dkimResults.filter(d=>d.recs.some(r=>/v=DKIM1/i.test(r)||/p=[A-Za-z0-9+/=]{40,}/.test(r)));
    let dkimPts=0,dkimStatus='fail',dkimDetail='no key found under '+DKIM_SELECTORS.length+' common selectors',dkimWhy='DKIM signs your mail so inboxes can verify it. Enable it in your email provider\'s admin console — it publishes the key for you. (If your provider uses a custom selector, ShipCheck can miss it.)';
    if(dkimFound.length){
      const rec=dkimFound[0].recs.find(r=>/p=/.test(r))||'';
      const pm=rec.match(/p=([A-Za-z0-9+/=]+)/);let bits=0;
      if(pm){try{bits=Math.round((atob(pm[1]).length-48)*8/512)*512;if(bits<512)bits=1024}catch(e){}}
      dkimDetail='selector "'+dkimFound[0].s+'"'+(bits?' · ~'+bits+'-bit key':'')+(dkimFound.length>1?' · +'+(dkimFound.length-1)+' more':'');
      if(bits>=2048){dkimPts=20;dkimStatus='pass'}else if(bits>=1024){dkimPts=14;dkimStatus='warn';dkimWhy='Your DKIM key looks 1024-bit. 2048-bit is the modern recommendation — most providers let you rotate it in one click.'}else{dkimPts=17;dkimStatus='pass'}
    }
    add('DKIM (signed mail)',dkimStatus,dkimPts,20,dkimDetail,dkimWhy);
    const dmarcRecs=txtJoin(dmarcRaw).filter(t=>/v=DMARC1/i.test(t));
    let dmarcPts=0,dmarcStatus='fail',dmarcDetail='no DMARC record',dmarcWhy='';
    if(dmarcRecs.length){
      const rec=dmarcRecs[0];const pol=(rec.match(/p=(\w+)/)||[])[1]||'none';const rua=/rua=/.test(rec);
      dmarcDetail='policy p='+pol+(rua?' · reports (rua) set':' · no report address (rua)');
      if(pol==='reject'){dmarcPts=rua?25:22;dmarcStatus='pass'}
      else if(pol==='quarantine'){dmarcPts=rua?19:16;dmarcStatus='warn';dmarcWhy='Good start. Once reports look clean for a few weeks, tighten to p=reject.'}
      else{dmarcPts=rua?11:8;dmarcStatus='warn';dmarcWhy='p=none only monitors — it does not stop anyone spoofing your domain. Plan to move to quarantine, then reject.'}
    } else {
      dmarcWhy='DMARC tells inboxes what to do with mail that fails SPF/DKIM — and it is required by Gmail/Yahoo/Outlook bulk-sender rules. ShipCheck wrote your starter record below.';
    }
    add('DMARC (anti-spoofing policy)',dmarcStatus,dmarcPts,25,dmarcDetail,dmarcWhy);
    add('CAA (who may issue certificates)',caaRecs.length?'pass':'warn',caaRecs.length?5:0,5,caaRecs.length?caaRecs.length+' record(s)':'none','Optional but recommended: restricts which CAs can issue certs for your domain.');
    add('Nameserver redundancy (≥2 NS)',nsRecs.length>=2?'pass':'warn',nsRecs.length>=2?5:0,5,nsRecs.length+' nameserver(s)','Two or more nameservers mean DNS survives one provider outage.');
    const score=Math.min(100,total);
    const recordsHtml='<h3>📋 Records found</h3>'+
      (mxRecs.length?'<div><b>MX</b>'+mxRecs.map(r=>'<div class="record">'+esc(r)+'</div>').join('')+'</div>':'')+
      (spfRecs.length?'<div><b>SPF</b>'+spfRecs.map(r=>'<div class="record">'+esc(r)+'</div>').join('')+'</div>':'')+
      (dkimFound.length?'<div><b>DKIM</b>'+dkimFound.map(d=>'<div class="record">'+esc(d.s)+'._domainkey → '+esc((d.recs[0]||'').slice(0,90))+'…</div>').join('')+'</div>':'')+
      (dmarcRecs.length?'<div><b>DMARC</b>'+dmarcRecs.map(r=>'<div class="record">'+esc(r)+'</div>').join('')+'</div>':'');
    let fixesHtml='';
    if(!dmarcRecs.length){
      const rec='v=DMARC1; p=none; rua=mailto:dmarc@'+domain;
      fixesHtml='<h3>🛠 Add this DMARC record</h3><p class="muted">In your DNS host, add a <b>TXT</b> record — name/host: <code>_dmarc</code>, value:</p><div class="record">'+esc(rec)+'</div><div class="fix-actions"><button type="button" id="copyDmarc">Copy record</button></div><p class="muted">Start at p=none (monitor) for 2–4 weeks, check the reports, then tighten to p=quarantine and finally p=reject.</p>';
    }
    $('domainResults').innerHTML=scoreHeader('Domain',score,domain)+'<div id="domainCheckList"></div>'+recordsHtml+fixesHtml;
    renderChecks($('domainCheckList'),checks);
    const cd=$('copyDmarc');if(cd)cd.addEventListener('click',()=>copyText('v=DMARC1; p=none; rua=mailto:dmarc@'+domain,cd));
    msg.textContent='Done — '+domain+': '+score+'/100.';
    setScore('domain',score,domain,checksToMd('Domain: '+domain,domain,score,checks));
  }catch(e){msg.textContent='⚠ Could not read DNS for that domain ('+e.message+').'}
  btn.disabled=false;
});

/* restore last scores */
(function(){const s=store.get('scores',null);if(s){['repo','deps','domain'].forEach(m=>{if(s[m]!=null){state.scores[m]=s[m];({repo:$('chipRepo'),deps:$('chipDeps'),domain:$('chipDomain')})[m].textContent=s[m]+'/100 ('+grade(s[m])+')'}});
  const run=Object.values(state.scores).filter(x=>x!=null);if(run.length){$('overallScore').textContent=Math.round(run.reduce((a,b)=>a+b,0)/run.length);$('exportBtn').disabled=false}}})();

if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('service-worker.js').catch(()=>{})})}
