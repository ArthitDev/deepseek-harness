#!/usr/bin/env node
/** Exercise Windows/WSL and Linux/Docker routing without launching tools. */
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(script, platform, {failBoot=false, results=[]}={}) {
  const launches=[], probes=[], writes=[];
  const paths=platform==='win32'?path.win32:path.posix;
  const directory=platform==='win32'?'E:\\harness fixtures\\scripts':'/workspace/harness fixtures/scripts';
  const home=platform==='win32'?'C:\\fixture home\\.dsh':'/fixture home/.dsh';
  const childProcess={
    execFileSync(command,args,options){probes.push({command,args:Array.from(args),options});if(failBoot)throw new Error('fixture unavailable');return Buffer.alloc(0);},
    spawn(command,args,options){
      launches.push({command,args:Array.from(args),options});
      const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
      child.kill=()=>{throw new Error('unexpected timeout');};
      const result=results.shift()??{code:0,stdout:'fixture\n',stderr:'\x1eDSH_ARSENAL_STARTED\x1f'};
      queueMicrotask(()=>{
        if(result.error){child.emit('error',new Error(result.error));return;}
        if(result.stdout)child.stdout.emit('data',Buffer.from(result.stdout));
        if(result.stderr)child.stderr.emit('data',Buffer.from(result.stderr));
        child.emit('close',result.code);
      });return child;
    },
  };
  const modules=new Map();
  function evaluate(name){
    if(modules.has(name))return modules.get(name).exports;
    const module={exports:{}};modules.set(name,module);
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,name),'utf8'),{
      module,__dirname:directory,console,Buffer,setTimeout,clearTimeout,setInterval,clearInterval,
      process:{env:{DSH_HOME:home},cwd:()=>directory},
      require(name){
        if(name==='child_process')return childProcess;
        if(name==='./sb-kali.cjs')return evaluate('sb-kali.cjs');
        if(name==='fs')return {mkdirSync(){},writeFileSync(file,body){writes.push({file,body});},existsSync:()=>false,readFileSync(){throw new Error('fixture has no saved session');}};
        if(name==='os'||name==='node:os')return {platform:()=>platform,homedir:()=>paths.dirname(home),tmpdir:()=>directory};
        if(name==='path'||name==='node:path')return {...paths,win32:path.win32,posix:path.posix};
        return require(name);
      },
    },{filename:name});return module.exports;
  }
  return {api:evaluate(script),launches,probes,writes,home};
}

function assertBackend(launch,platform,home){
  assert.equal(launch.command,platform==='win32'?'wsl.exe':path.posix.join(home,'kali-shell'));
  assert.deepEqual(launch.args.slice(0,-1),platform==='win32'?['-d','kali-linux','-u','root','--exec','/bin/bash','-c']:['-c']);
  assert.equal(launch.options.windowsHide,true);
}

async function main(){
  let cases=0;
  for(const platform of ['win32','linux']){
    for(const language of ['bash','python','c','cpp','other']){
      const f=load('sb-executor.cjs',platform);
      const result=await f.api.execute({language,code:'fixture',hash:'fixture',extension:'.txt'},{environment:'kali'});
      assert.equal(result.success,true);assert.equal(f.launches.length,1);
      assertBackend(f.launches[0],platform,f.home);assertBackend(f.probes[0],platform,f.home);
      const script=f.launches[0].args.at(-1);
      assert.ok(script.includes(platform==='win32'?'/mnt/e/harness fixtures/scripts/exec-workspace/':'/workspace/harness fixtures/scripts/exec-workspace/'));
      assert.ok(!script.includes('Prompt-Jail'));cases++;
    }
    const host=load('sb-executor.cjs',platform);
    assert.equal(host.api.classifyEnvironment('print(42)','python'),platform==='win32'?'windows':'linux');
    await host.api.execute({language:'python',code:'print(42)',hash:'native',extension:'.py'});
    assert.equal(host.launches[0].command,platform==='win32'?'python':'python3');assert.equal(host.probes.length,0);cases++;
    const failed=load('sb-executor.cjs',platform,{failBoot:true});
    assert.equal((await failed.api.execute({language:'bash',code:'fixture',hash:'fixture',extension:'.sh'},{environment:'kali'})).success,false);
    assert.equal(failed.launches.length,0);cases++;
    for(const failBoot of [false,true]){
      const f=load('sb-auto-start.cjs',platform,{failBoot});
      assert.equal(f.api.detectEnvironment().kaliAvailable,!failBoot);
      assertBackend(f.probes[0],platform,f.home);assert.equal(f.launches.length,0);cases++;
    }
    const arsenal=load('sb-arsenal.cjs',platform);
    const result=await arsenal.api.runInKali('printf fixture');
    assert.equal(result.success,true);assert.equal(result.commandStarted,true);
    assert.ok(!result.stderr.includes('DSH_ARSENAL_STARTED'));
    assertBackend(arsenal.launches[0],platform,arsenal.home);assert.equal(arsenal.probes.length,0);cases++;
    const campaign=await arsenal.api.campaign({steps:[{name:'seed',tool:'curl_fetch',params:{url:'http://fixture.invalid'}},{name:'feed',tool:'httpx_probe',feed_from:'seed',params:{list_file:'{{TARGETS_FILE}}'}}]});
    assert.equal(campaign.success,true);
    const feed=arsenal.launches.at(-1).args.at(-1);
    assert.ok(feed.includes(platform==='win32'?'/mnt/e/harness fixtures/runs/arsenal/':'/workspace/harness fixtures/runs/arsenal/'));
    assert.ok(feed.includes('seed.targets.txt'));cases++;
    const started=load('sb-arsenal.cjs',platform,{results:[{code:1,stderr:'\x1eDSH_ARSENAL_STARTED\x1f WSL_E_FIXTURE'}]});
    assert.equal((await started.api.dispatch('curl_fetch',{url:'http://fixture.invalid'})).success,false);
    assert.equal(started.launches.length,1);assert.equal(started.probes.length,0);cases++;
    const launchError=load('sb-arsenal.cjs',platform,{results:[{error:'spawn fixture ENOENT'}]});
    assert.equal((await launchError.api.dispatch('curl_fetch',{url:'http://fixture.invalid'})).success,false);
    assert.equal(launchError.launches.length,1);assert.equal(launchError.probes.length,0);cases++;
    const notStarted=load('sb-arsenal.cjs',platform,{results:[{code:1,stderr:'WSL_E_FIXTURE'}]});
    await notStarted.api.dispatch('curl_fetch',{url:'http://fixture.invalid'});
    assert.equal(notStarted.launches.length,platform==='win32'?2:1);assert.equal(notStarted.probes.length,platform==='win32'?1:0);cases++;
  }
  const unsupported=load('sb-arsenal.cjs','darwin');
  assert.equal((await unsupported.api.runInKali('true')).success,false);assert.equal(unsupported.launches.length,0);cases++;
  console.log(JSON.stringify({passed:cases,realSubprocesses:0,generatedFiles:0}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
