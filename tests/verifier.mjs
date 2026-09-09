import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const HOOKS = process.env.AGENTS_HOOKS || join(dirname(fileURLToPath(import.meta.url)), '../plugin/hooks');
const base = mkdtempSync(join(tmpdir(), 'agents-verifier-'));
const home = join(base, 'home'); mkdirSync(home);
const env = { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: join(home, 'gitconfig'), GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Test Author', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test Author', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
for (const key of ['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR']) delete env[key];
const git = (cwd, ...args) => execFileSync('git', ['-c','commit.gpgsign=false','-c','core.autocrlf=false',...args],
  { cwd, env, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 15000 }).trim();
const state = '# State\n\n## Start here\n\n**Do this first:** review app.txt\n**Waiting on you:** nothing\n**Mid-flight:** nothing\n';
const write = (dir, name, text) => writeFileSync(join(dir,name),text);
const save = dir => { git(dir,'add','.'); git(dir,'commit','-m','Fixture'); };
function local() {
  const dir = mkdtempSync(join(base,'repo-'));
  git(dir,'init','-b','main'); write(dir,'STATE.md',state); write(dir,'app.txt','original\n'); save(dir);
  return dir;
}
function shared() {
  const dir = local(); const remote = join(mkdtempSync(join(base,'remote-')),'origin.git');
  git(dir,'init','--bare',remote); git(dir,'remote','add','origin',remote); git(dir,'switch','-c','dev'); git(dir,'push','-u','origin','dev');
  return { dir, remote };
}
function verify(dir, remote = true, extra = []) {
  const r = spawnSync(process.execPath,[join(HOOKS,'wrap-up-verify.mjs'),'--project',dir,...(remote?['--check-remote']:[]),...extra],
    { cwd:base, env, encoding:'utf8',timeout:25000 });
  assert.equal(r.stderr,''); assert(!r.error, r.error?.message);
  const report=JSON.parse(r.stdout);
  assert.equal(r.status,report.status==='passed'?0:report.status==='incomplete'?1:2);
  return report;
}
const check = (r,id) => r.checks.find(c=>c.id===id);
let passed=0;
const test=(name,fn)=>{fn();passed++;console.log(`  PASS ${name}`);};
try {
  test('clean shared checkout passes live remote verification',()=>{
    const {dir}=shared();const r=verify(dir);
    assert.equal(r.status,'passed');assert.equal(r.scope,'shared-dev');assert.equal(check(r,'remote').required,true);
  });
  test('default local inspection cannot declare shared work published',()=>{
    const {dir}=shared();const r=verify(dir,false);
    assert.equal(r.status,'unknown');assert.equal(check(r,'remote').status,'unknown');
  });
  test('wrong branch remains incomplete even when HEAD matches remote',()=>{
    const {dir}=shared();git(dir,'switch','main');const r=verify(dir);
    assert.equal(check(r,'branch').status,'incomplete');assert.equal(r.status,'incomplete');assert.equal(git(dir,'branch','--show-current'),'main');
  });
  test('staged, unstaged and untracked work all prevent completion',()=>{
    const dir=local();write(dir,'app.txt','unsaved\n');assert.equal(check(verify(dir),'worktree').status,'incomplete');
    git(dir,'add','app.txt');assert.equal(check(verify(dir),'worktree').status,'incomplete');git(dir,'commit','-m','Save');
    write(dir,'unrelated.txt','user-owned');assert.equal(check(verify(dir),'worktree').status,'incomplete');
    assert.equal(readFileSync(join(dir,'unrelated.txt'),'utf8'),'user-owned');
  });
  test('unresolved merge conflicts prevent completion',()=>{
    const dir=local();git(dir,'switch','-c','other');write(dir,'app.txt','other\n');save(dir);
    git(dir,'switch','main');write(dir,'app.txt','main\n');save(dir);
    assert.throws(()=>git(dir,'merge','other'));
    assert.equal(check(verify(dir),'conflicts').status,'incomplete');
  });
  test('unpushed commits are incomplete',()=>{
    const {dir}=shared();write(dir,'app.txt','unshared\n');save(dir);
    assert.equal(check(verify(dir),'remote').status,'incomplete');
  });
  test('unfinished merge cannot pass just because the worktree is clean',()=>{
    const dir=local();writeFileSync(join(dir,'.git','MERGE_HEAD'),git(dir,'rev-parse','HEAD')+'\n');
    const r=verify(dir);assert.equal(check(r,'worktree').status,'passed');assert.equal(check(r,'operation').status,'incomplete');
  });
  test('fresh remote comparison detects behind state without fetching',()=>{
    const {dir,remote}=shared();const peer=join(base,'peer-'+passed);git(base,'clone','--branch','dev',remote,peer);
    write(peer,'app.txt','peer changes\n');save(peer);git(peer,'push','origin','dev');
    const tracking=git(dir,'rev-parse','origin/dev');const index=readFileSync(join(dir,'.git','index'));
    const r=verify(dir);assert.equal(check(r,'remote').status,'incomplete');
    assert.equal(git(dir,'rev-parse','origin/dev'),tracking);assert.deepEqual(readFileSync(join(dir,'.git','index')),index);
  });
  test('live remote equality passes even with stale tracking reference',()=>{
    const {dir,remote}=shared();const tracking=git(dir,'rev-parse','origin/dev');write(dir,'app.txt','new\n');save(dir);
    git(dir,'push',remote,'dev');assert.equal(git(dir,'rev-parse','origin/dev'),tracking);
    assert.equal(verify(dir).status,'passed');assert.equal(git(dir,'rev-parse','origin/dev'),tracking);
  });
  test('remote failure stays unknown and does not disclose its URL',()=>{
    const {dir}=shared();git(dir,'remote','set-url','origin',join(base,'secret-value-missing.git'));
    const r=verify(dir);assert.equal(r.status,'unknown');assert.equal(check(r,'remote').status,'unknown');
    assert(!JSON.stringify(r).includes('secret-value'));
  });
  test('deleted remote dev is incomplete, not silently a local workflow',()=>{
    const {dir,remote}=shared();git(remote,'update-ref','-d','refs/heads/dev');
    const r=verify(dir);assert.equal(r.scope,'shared-dev');assert.equal(check(r,'remote').status,'incomplete');
  });
  test('local projects pass without making a publication claim',()=>{
    const dir=local();const r=verify(dir);assert.equal(r.status,'passed');assert.equal(r.scope,'local');
    assert.equal(check(r,'remote').required,false);
  });
  test('project root is resolved from a nested working directory',()=>{
    const dir=local();mkdirSync(join(dir,'src'));const r=verify(join(dir,'src'));
    assert.equal(r.status,'passed');assert.equal(realpathSync.native(r.project),realpathSync.native(dir));
  });
  test('docs handoff is supported',()=>{
    const dir=local();mkdirSync(join(dir,'docs'));git(dir,'mv','STATE.md','docs/STATE.md');save(dir);
    const r=verify(dir);assert.equal(r.status,'passed');assert(check(r,'handoff').path.endsWith('STATE.md'));
  });
  test('missing, duplicate, empty and placeholder handoff fields fail',()=>{
    const dir=local();
    for(const body of [state.replace('**Mid-flight:** nothing',''),state+'**Mid-flight:** nothing\n',state.replace('review app.txt',''),state.replace('review app.txt','<next action>'),state+'\n## Start here\n']) {
      write(dir,'STATE.md',body);assert.equal(check(verify(dir),'handoff').status,'incomplete');
    }
    rmSync(join(dir,'STATE.md'));assert.equal(check(verify(dir),'handoff').status,'incomplete');
  });
  test('code examples and comments do not masquerade as a handoff',()=>{
    const dir=local();for(const body of ['```markdown\n'+state+'```','<!--\n'+state+'-->',state.split('\n').map(line=>'    '+line).join('\n')]) {
      write(dir,'STATE.md',body);assert.equal(check(verify(dir),'handoff').status,'incomplete');
    }
  });
  test('ignored handoff file cannot pass shared-memory check',()=>{
    const {dir}=shared();git(dir,'rm','--cached','STATE.md');write(dir,'.gitignore','STATE.md\n');save(dir);git(dir,'push','origin','dev');
    const r=verify(dir);assert.equal(check(r,'worktree').status,'passed');assert.equal(check(r,'shared-memory').status,'incomplete');
  });
  test('detached checkout is incomplete',()=>{
    const dir=local();git(dir,'checkout','--detach');assert.equal(check(verify(dir),'branch').status,'incomplete');
  });
  test('empty repository is incomplete and nonrepository is unknown',()=>{
    const dir=mkdtempSync(join(base,'empty-'));write(dir,'STATE.md',state);
    assert.equal(verify(dir).status,'unknown');git(dir,'init','-b','main');
    assert.equal(check(verify(dir),'commits').status,'incomplete');
  });
  test('invalid CLI arguments return unknown without side effects',()=>{
    const dir=local();const before=readdirSync(dir);assert.equal(verify(dir,false,['--unexpected']).status,'unknown');assert.deepEqual(readdirSync(dir),before);
  });
  test('a vague first step is incomplete, a concrete one passes',()=>{
    const dir=local();write(dir,'STATE.md',state.replace('review app.txt','Continue the redesign'));save(dir);
    const r=verify(dir);assert.equal(check(r,'handoff').status,'incomplete');assert.equal(check(r,'handoff').vague,true);
    write(dir,'STATE.md',state.replace('review app.txt','run `npm test` and fix the first failure'));save(dir);assert.equal(verify(dir).status,'passed');
  });
  test('tracking mode compares against the last fetch without the network',()=>{
    const {dir,remote}=shared();const peer=join(base,'peer-tracking');git(base,'clone','--branch','dev',remote,peer);
    write(peer,'app.txt','peer changes\n');save(peer);git(peer,'push','origin','dev');
    const tracking=verify(dir,false,['--remote','tracking']);assert.equal(tracking.status,'passed');assert.match(check(tracking,'remote').message,/as of the last fetch/);
    assert.equal(check(verify(dir),'remote').status,'incomplete');
    git(dir,'fetch','origin','dev');assert.equal(check(verify(dir,false,['--remote','tracking']),'remote').status,'incomplete');
  });
  test('handoff fields may continue on the lines below their label',()=>{
    const dir=local();
    const body='# State\n\n## Start here\n\n**Do this first:** A testing pass, in order:\n1. open `app.txt` and read it\n2. say what you see\n**Waiting on you:**\n- the wording of the retry message\n**Mid-flight:**\nnothing\n\n## Phases\n';
    write(dir,'STATE.md',body);save(dir);const r=verify(dir);assert.equal(r.status,'passed');
    const h=check(r,'handoff');assert.equal(h.extraLines,0);assert.match(h.fields['Waiting on you'],/retry message/);assert.match(h.fields['Do this first'],/say what you see/);
    write(dir,'STATE.md',body.replace('- the wording of the retry message\n',''));save(dir);
    const again=check(verify(dir),'handoff');assert.equal(again.status,'incomplete');assert.deepEqual(again.invalidFields,['Waiting on you']);
  });
  test('content beyond the three fields is reported without failing the handoff',()=>{
    const dir=local();write(dir,'STATE.md',state+'\n> ALL WORK HAPPENS ON dev\n\n```bash\nnpm run dev\n```\n\nAlso: delete .next/ after a crash.\n\n## Phases\n');save(dir);
    const r=verify(dir);assert.equal(r.status,'passed');const h=check(r,'handoff');assert.equal(h.extraLines,3);assert.equal(h.lines,6);
  });
  test('a stray branch with unrecorded commits is incomplete until STATE.md names it',()=>{
    const dir=local();git(dir,'switch','-c','feature');write(dir,'app.txt','feature work\n');save(dir);git(dir,'switch','main');git(dir,'branch','old');
    let r=verify(dir);const b=check(r,'branches');assert.equal(b.status,'incomplete');assert.match(b.message,/'feature' has 1 commit not on main/);assert.deepEqual(b.leftovers,['old']);
    write(dir,'STATE.md',state.replace('**Mid-flight:** nothing','**Mid-flight:** branch `feature` holds the retry work, unmerged; the user decides'));save(dir);
    r=verify(dir);assert.equal(r.status,'passed');assert.match(check(r,'branches').message,/safe to delete: old/);
    git(dir,'branch','-d','old');git(dir,'branch','-D','feature');assert.equal(check(verify(dir),'branches').leftovers.length,0);
  });
  test('a worktree with commits not on the working branch is unrecorded work',()=>{
    const dir=local();const tree=join(base,'tree-'+passed);git(dir,'worktree','add','--detach',tree);
    assert.equal(check(verify(dir),'branches').status,'passed');
    write(tree,'app.txt','worktree work\n');git(tree,'add','.');git(tree,'commit','-m','In the worktree');
    const r=verify(dir);assert.equal(check(r,'branches').status,'incomplete');assert.match(check(r,'branches').message,/worktree at .* has 1 commit not on main/);
  });
  console.log(`${passed} wrap-up verifier checks passed`);
} finally {
  // The only deletion target is this run's freshly allocated absolute temp root.
  rmSync(base,{recursive:true,force:true});
}
