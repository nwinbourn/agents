import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, utimesSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HOOKS = process.env.AGENTS_HOOKS || join(dirname(fileURLToPath(import.meta.url)), '../plugin/hooks');
const base = mkdtempSync(join(tmpdir(), 'agents-memory-'));
const home = join(base, 'home'); mkdirSync(home);
const env = { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: join(home, 'gitconfig'), GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Test Author', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test Author', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
for (const key of ['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR','CLAUDE_PROJECT_DIR']) delete env[key];
const git = (cwd,...args)=>execFileSync('git',['-c','commit.gpgsign=false','-c','core.autocrlf=false',...args],{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000}).trim();
const write=(dir,name,text)=>{const p=join(dir,name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,text);return p;};
const folder=()=>mkdtempSync(join(base,'project-'));
const state='# State\n\n## Start here\n\n**Do this first:** inspect app.txt\n**Waiting on you:** nothing\n**Mid-flight:** nothing\n';
const save=dir=>{git(dir,'add','.');git(dir,'commit','-m','Fixture');};
function local(memory=true) {
  const dir=folder();git(dir,'init','-b','main');write(dir,'app.txt','initial');
  if(memory){write(dir,'STATE.md',state);write(dir,'CONTEXT.md','project-context-marker');}
  save(dir);return dir;
}
function shared() {
  const writer=local();const origin=join(folder(),'origin.git');git(writer,'init','--bare',origin);
  git(writer,'remote','add','origin',origin);git(writer,'switch','-c','dev');git(writer,'push','-u','origin','dev');
  const client=join(folder(),'client');git(writer,'clone','--branch','dev',origin,client);return {writer,client,origin};
}
function hook(file,cwd,extra={}) {
  const raw=execFileSync(process.execPath,[join(HOOKS,file)],{cwd,env,input:JSON.stringify({cwd,...extra}),encoding:'utf8',timeout:55000});
  return raw.trim()?JSON.parse(raw):null;
}
const load=(cwd,extra={})=>hook('session-start.mjs',cwd,{source:'startup',...extra})?.hookSpecificOutput?.additionalContext || '';
let passed=0;
const test=(name,fn)=>{fn();passed++;console.log(`  PASS ${name}`);};
try {
  test('unadopted projects stay silent and create no memory',()=>{
    const dir=local(false);const before=readdirSync(dir);assert.equal(load(dir),'');assert.deepEqual(readdirSync(dir),before);
  });
  test('subfolder startup loads repository memory rather than nested decoys',()=>{
    const dir=local();const sub=join(dir,'src');mkdirSync(sub);write(sub,'STATE.md','nested-decoy');
    const output=load(sub);assert(output.includes(state));assert(output.includes('project-context-marker'));assert(!output.includes('nested-decoy'));
  });
  test('docs fallback and root precedence agree with verifier',()=>{
    const dir=local();mkdirSync(join(dir,'docs'));git(dir,'mv','STATE.md','docs/STATE.md');save(dir);
    write(dir,'docs/PITFALLS.md','pitfall-marker');write(dir,'DESIGN.md','design-marker');
    let output=load(dir);assert(output.includes(state));assert(output.includes('pitfall-marker'));assert(output.includes('design-marker'));
    write(dir,'STATE.md',state+'root-priority');output=load(dir);assert(output.includes('root-priority'));
    const r=spawnSync(process.execPath,[join(HOOKS,'wrap-up-verify.mjs'),'--project',dir],{env,encoding:'utf8'});
    assert.equal(realpathSync.native(JSON.parse(r.stdout).checks.find(c=>c.id==='handoff').path),realpathSync.native(join(dir,'STATE.md')));
  });
  test('partial adoption names missing required memory without inventing it',()=>{
    const dir=local(false);write(dir,'CONTEXT.md','context-only');assert.match(load(dir),/Missing required memory: STATE.md/);
    rmSync(join(dir,'CONTEXT.md'));write(dir,'STATE.md',state);const output=load(dir);assert.match(output,/Missing required memory: CONTEXT.md/);
    assert(!output.includes('Missing required memory: PITFALLS'));
  });
  test('non-Git folders load their own memory but not ancestor memory',()=>{
    const dir=folder();write(dir,'STATE.md',state);assert(load(dir).includes(state));const sub=join(dir,'child');mkdirSync(sub);assert.equal(load(sub),'');
  });
  test('empty and unreadable memory are explicit',()=>{
    const dir=folder();write(dir,'STATE.md','');mkdirSync(join(dir,'CONTEXT.md'));
    const output=load(dir);assert.match(output,/memory file is empty/);assert.match(output,/Unreadable memory file/);
  });
  test('large memory is bounded and omissions are visible',()=>{
    const dir=local();for(const name of ['STATE','CONTEXT','PITFALLS','DESIGN'])write(dir,name+'.md','界'.repeat(16000));
    const output=load(dir);assert(output.length<37000);assert.match(output,/Excerpt only/);assert.match(output,/Not loaded: startup memory budget reached/);assert(!output.includes('\uFFFD'));
  });
  test('startup, resume and clear read fresh disk contents',()=>{
    const dir=local();for(const source of ['startup','resume','clear']){write(dir,'CONTEXT.md','current-'+source);assert(load(dir,{source}).includes('current-'+source));}
    assert.equal(load(dir,{source:'compact'}),'');
  });
  test('malformed startup events exit silently',()=>{
    const dir=local();for(const input of ['null','[]','{','{"cwd":42}']) {
      const r=spawnSync(process.execPath,[join(HOOKS,'session-start.mjs')],{cwd:dir,env,input,encoding:'utf8'});
      assert.equal(r.status,0);assert.equal(r.stdout,'');assert.equal(r.stderr,'');
    }
  });
  test('sync completes before newly pulled memory is injected',()=>{
    const {writer,client}=shared();write(writer,'CONTEXT.md','fresh-remote-context');write(writer,'STATE.md',state+'fresh-remote-state');save(writer);git(writer,'push','origin','dev');
    mkdirSync(join(client,'src'));const output=load(join(client,'src'));
    assert.equal(git(client,'rev-parse','HEAD'),git(writer,'rev-parse','HEAD'));
    assert(output.includes('fresh-remote-context'));assert(output.includes('fresh-remote-state'));assert(!output.includes('project-context-marker'));
    assert(output.indexOf('[git-sync]')<output.indexOf('[project-memory]'));
  });
  test('dirty startup preserves local memory and includes the sync warning',()=>{
    const {writer,client}=shared();write(writer,'CONTEXT.md','remote-unpulled');save(writer);git(writer,'push','origin','dev');
    write(client,'CONTEXT.md','local-unsaved-memory');const head=git(client,'rev-parse','HEAD');const output=load(client);
    assert.match(output,/did NOT pull/);assert(output.includes('local-unsaved-memory'));assert(!output.includes('remote-unpulled'));assert.equal(git(client,'rev-parse','HEAD'),head);
  });
  test('offline startup loads local memory with stale-remote notice',()=>{
    const {client}=shared();git(client,'remote','set-url','origin',join(base,'missing.git'));const output=load(client);
    assert.match(output,/could not reach the remote/);assert(output.includes('project-context-marker'));
  });
  test('shared projects without memory report what is missing',()=>{
    const {client}=shared();rmSync(join(client,'STATE.md'));rmSync(join(client,'CONTEXT.md'));const output=load(client);
    assert.match(output,/Missing required memory: STATE.md/);assert.match(output,/Missing required memory: CONTEXT.md/);
  });
  test('reminder started in a subfolder inspects sibling changes',()=>{
    const dir=local();const sub=join(dir,'src');mkdirSync(sub);const old=new Date(Date.now()-10000);utimesSync(join(dir,'STATE.md'),old,old);write(dir,'other.txt','changed');
    assert.equal(hook('state-reminder.mjs',sub).decision,'block');
  });
  test('wrap-up armed in a subfolder is consumed at repository root',()=>{
    const dir=local();mkdirSync(join(dir,'src'));write(dir,'STATE.md','line\n'.repeat(710));
    hook('wrap-up-arm.mjs',join(dir,'src'),{tool_name:'Skill',tool_input:{skill:'agents:wrap-up'}});
    assert.equal(hook('wrap-up-bloat-check.mjs',dir).decision,'block');assert.equal(hook('wrap-up-bloat-check.mjs',dir),null);
  });
  test('linked worktrees load their own memory',()=>{
    const dir=local();const tree=join(folder(),'linked');git(dir,'worktree','add','-b','feature',tree);write(tree,'CONTEXT.md','linked-only');mkdirSync(join(tree,'src'));
    const output=load(join(tree,'src'));assert(output.includes('linked-only'));assert(!output.includes('project-context-marker'));
    assert.equal(readFileSync(join(dir,'CONTEXT.md'),'utf8'),'project-context-marker');
  });
  test('startup reports the previous handoff from git, not from prose',()=>{
    const dir=local();assert.match(load(dir),/\[handoff\] The previous handoff passes/);
    write(dir,'app.txt','unsaved');write(dir,'STATE.md',state.replace('inspect app.txt','Continue the redesign'));
    const output=load(dir);assert.match(output,/\[handoff\] The previous handoff is incomplete/);assert.match(output,/uncommitted or untracked changes/);assert.match(output,/Start here block/);
  });
  test('startup notices unpushed shared work',()=>{
    const {client}=shared();write(client,'app.txt','local commit');git(client,'add','.');git(client,'commit','-m','Unpushed');
    assert.match(load(client),/dev does not match origin/);
  });
  test('startup reports memory size and what is over guidance',()=>{
    const dir=local();let output=load(dir);assert.match(output,/\[memory-size\] STATE.md 7 lines, CONTEXT.md 1 line: 1 KB, under 1K tokens when all of it loads\. All within guidance\./);
    write(dir,'CONTEXT.md','fact\n'.repeat(350));output=load(dir);assert.match(output,/Over guidance: CONTEXT.md 350\/300/);
  });
  test('files CLAUDE.md already imports are not loaded twice',()=>{
    const dir=local();write(dir,'AGENTS.md','# Rules\n\n@STATE.md\n');write(dir,'CLAUDE.md','# Project\n\n@AGENTS.md\n');
    const output=load(dir);assert(!output.includes('**Do this first:** inspect app.txt'));assert.match(output,/STATE.md \| [^\n]*\nAlready in context through a CLAUDE.md import/);assert(output.includes('project-context-marker'));
    write(dir,'CLAUDE.md','# Project\n\n@import STATE.md\n');rmSync(join(dir,'AGENTS.md'));assert(load(dir).includes('**Do this first:** inspect app.txt'));
  });
  test('startup lists leftover branches until the repository is down to its working branch',()=>{
    const dir=local();assert(!load(dir).includes('[branches]'));
    git(dir,'branch','old');git(dir,'switch','-c','feature');write(dir,'app.txt','feature');save(dir);git(dir,'switch','main');
    const output=load(dir);
    assert.match(output,/\[branches\] 2 local branches besides main: feature \(1 commit not on main, not named in STATE.md, last commit \d{4}-\d{2}-\d{2}\); old \(merged, safe to delete, last commit \d{4}-\d{2}-\d{2}\)\. This project keeps one working branch \(main\)/);
    assert.match(output,/\[handoff\] The previous handoff is incomplete: a stray branch or worktree/);
    git(dir,'branch','-d','old');git(dir,'branch','-D','feature');assert(!load(dir).includes('[branches]'));
  });
  console.log(`${passed} startup memory checks passed`);
} finally {
  // Only remove this run's newly allocated absolute temporary directory.
  rmSync(base,{recursive:true,force:true});
}
