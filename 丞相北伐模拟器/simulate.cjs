'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {POLICY_VERSION,NAMES,DEFINITIONS,createPolicy}=require('./policy.cjs');
function quantile(xs,p){if(!xs.length)return null;const sorted=[...xs].sort((a,b)=>a-b);return sorted[Math.floor((sorted.length-1)*p)];}
function describe(xs){return xs.length?{count:xs.length,mean:xs.reduce((a,b)=>a+b,0)/xs.length,min:Math.min(...xs),p10:quantile(xs,.1),median:quantile(xs,.5),p90:quantile(xs,.9),p95:quantile(xs,.95),max:Math.max(...xs)}:{count:0,mean:null,min:null,p10:null,median:null,p90:null,p95:null,max:null};}
function wilson(wins,n){if(!n)return {rate:null,lower:null,upper:null};const z=1.959963984540054,p=wins/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return {wins,n,rate:p,lower:c-h,upper:c+h,confidence:.95,method:'Wilson'};}
function runOne({Engine,difficulty='normal',policy='novice',seed=1,trace=false,maxCommands=700}={}){
  Engine=Engine||require('./engine.js');const engine=new Engine({difficulty,seed}),decide=createPolicy(policy,{seed});
  const result={difficulty,policy,seed,mainVictory:false,fullVictory:false,mainTurn:null,fullTurn:null,turns:0,reason:null,error:null,defenseTurns:0,defensePreparationTurns:0,forcedDefenseTurns:0,mainForcedDefenseTurns:null,defenseBattles:0,marchTurns:0,domesticTurns:0,battleTurns:0,retreatTurns:0,chanceSpent:{health:0,command:0,strategy:0,governance:0},captured:[],trace:trace?[]:undefined};
  let v=engine.getView(),lastBattle=null,commands=0;const captured=new Set();
  while(commands++<maxCommands){
    const before=v,s=before.state;
    if(s.mainVictory&&!result.mainVictory){result.mainVictory=true;result.mainTurn=s.turn;result.mainForcedDefenseTurns=result.forcedDefenseTurns;}
    if(s.fullVictory&&!result.fullVictory){result.fullVictory=true;result.fullTurn=s.turn;}
    if(s.ending||s.phase==='ended')break;
    let command;
    try{
      command=decide(v);if(command.method==='stop')break;
      if(trace)result.trace.push({turn:s.turn,phase:s.phase,command,health:s.player.health,troops:s.player.troops,grain:s.player.grain,battle:s.battle?{type:s.battle.type,regionId:s.battle.regionId,round:s.battle.round}:null});
      if(command.method==='spendChance')result.chanceSpent[command.args[0]]++;
      v=engine[command.method](...command.args);
      if(!v?.state)v=engine.getView();
      const after=v.state;
      if(after.turn>s.turn){
        const actionType=s.pendingEvent?.action?.type||s.pendingEvent?.actionType||s.pendingEvent?.command?.type;
        if(s.battle?.type==='defense'){result.defenseTurns++;result.forcedDefenseTurns++;if(lastBattle!==s.battle.id){result.defenseBattles++;lastBattle=s.battle.id;}}
        if(s.warning){result.defensePreparationTurns++;result.forcedDefenseTurns++;}
        if(s.battle&&['assault','cutSupply','steady'].includes(actionType))result.battleTurns++;
        if(s.phase==='march')result.marchTurns++;
        if(actionType==='retreat'||actionType==='yield')result.retreatTurns++;
      }
      for(const r of v.regions)if(r.owner==='shu'&&!['hanzhong','yongan'].includes(r.id))captured.add(r.id);
    }catch(error){result.error={message:error.message,command,phase:s.phase,turn:s.turn};break;}
  }
  const s=v.state;result.mainVictory=!!s.mainVictory||result.mainVictory;result.fullVictory=!!s.fullVictory||result.fullVictory;
  if(result.mainVictory&&result.mainTurn===null){result.mainTurn=s.turn;result.mainForcedDefenseTurns=result.forcedDefenseTurns;}if(result.fullVictory&&result.fullTurn===null)result.fullTurn=s.turn;
  result.turns=s.turn;result.domesticTurns=s.domesticTurns;result.captured=[...captured];result.finalHealth=s.player.health;result.finalMaxHealth=s.player.maxHealth;
  result.reason=s.ending?.reason||s.ending?.id||s.ending?.type||s.ending?.cause||(typeof s.ending==='string'?s.ending:null)||(result.fullVictory?'fullVictory':result.error?'exception':commands>=maxCommands?'command_guard':'stopped');
  if(commands>=maxCommands&&!result.error)result.error={message:'Policy command guard exceeded'};
  return result;
}
function summarize(results){const main=results.filter(r=>r.mainVictory),full=results.filter(r=>r.fullVictory),reasonCounts={},mainFailureReasons={},postVictoryEndReasons={};for(const r of results){reasonCounts[r.reason]=(reasonCounts[r.reason]||0)+1;const table=r.mainVictory?postVictoryEndReasons:mainFailureReasons;table[r.reason]=(table[r.reason]||0)+1;}
  return {runs:results.length,mainVictory:wilson(main.length,results.length),fullVictory:wilson(full.length,results.length),mainVictoryTurns:describe(main.map(r=>r.mainTurn)),fullVictoryTurns:describe(full.map(r=>r.fullTurn)),finalTurns:describe(results.map(r=>r.turns)),defenseTurns:describe(results.map(r=>r.defenseTurns)),defensePreparationTurns:describe(results.map(r=>r.defensePreparationTurns||0)),forcedDefenseTurns:describe(results.map(r=>r.forcedDefenseTurns||0)),mainVictoryForcedDefenseTurns:describe(main.map(r=>r.mainForcedDefenseTurns||0)),defenseBattles:describe(results.map(r=>r.defenseBattles)),domesticTurns:describe(results.map(r=>r.domesticTurns)),battleTurns:describe(results.map(r=>r.battleTurns)),reasonCounts,mainFailureReasons,postVictoryEndReasons,errors:results.filter(r=>r.error),chanceSpent:Object.fromEntries(['health','command','strategy','governance'].map(k=>[k,describe(results.map(r=>r.chanceSpent[k]))])),captureCounts:results.reduce((out,r)=>{for(const id of r.captured)out[id]=(out[id]||0)+1;return out;},{}),examples:{mainWin:main[0]?.seed,fullWin:full[0]?.seed,loss:results.find(r=>!r.mainVictory)?.seed}};
}
function runBatch({Engine,runs=2000,difficulties=['easy','normal','hard'],policies=NAMES,seedStart=10000001,split='holdout',includeRuns=false,onProgress}={}){
  if(!Number.isInteger(runs)||runs<1||!Number.isInteger(seedStart)||seedStart<0||seedStart+runs>4294967295)throw Error('Invalid simulation seed range or run count');
  const report={schema:'beifa-proxy-simulation-v1',policyVersion:POLICY_VERSION,split,seedRange:{first:seedStart,last:seedStart+runs-1,count:runs},independence:'每个单元使用不同种子开局；不同难度/策略共用种子区间用于成对比较。策略随机流与游戏随机流分离。',disclaimer:'固定公开信息代理的模拟结果，不是实际玩家通关率；现实用时不能从回合直接认定。所有策略主胜后继续尝试余下地区。',policies:DEFINITIONS,cells:{}};
  for(const difficulty of difficulties)for(const policy of policies){const results=[];for(let i=0;i<runs;i++)results.push(runOne({Engine,difficulty,policy,seed:seedStart+i}));const key=difficulty+'/'+policy;report.cells[key]=summarize(results);if(includeRuns)report.cells[key].results=results;onProgress?.(key,report.cells[key]);}
  return report;
}
function hashFile(name){const p=path.join(__dirname,name);return fs.existsSync(p)?crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'):null;}
if(require.main===module){
  const args=process.argv.slice(2),get=(key,fallback)=>{const i=args.indexOf('--'+key);return i<0?fallback:args[i+1];},split=get('split','holdout');
  const sourceNames=['engine.js','config.js','policy.cjs','simulate.cjs'],startHashes=Object.fromEntries(sourceNames.map(n=>[n,hashFile(n)]));
  const report=runBatch({runs:Number(get('runs','2000')),seedStart:Number(get('seed-start',split==='calibration'?'1001':'10000001')),split,difficulties:get('difficulties','easy,normal,hard').split(','),policies:get('policies',NAMES.join(',')).split(','),includeRuns:args.includes('--include-runs'),onProgress:(key,s)=>process.stderr.write(key+': '+s.mainVictory.wins+'/'+s.runs+' main; '+s.fullVictory.wins+' full; '+s.errors.length+' errors\n')});
  report.hashes=startHashes;report.sourceChangedDuringRun=sourceNames.filter(n=>hashFile(n)!==startHashes[n]);const json=JSON.stringify(report,null,2),out=get('out',null);if(out){fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.writeFileSync(out,json+'\n');process.stdout.write(path.resolve(out)+'\n');}else process.stdout.write(json+'\n');if(Object.values(report.cells).some(c=>c.errors.length)||report.sourceChangedDuringRun.length)process.exitCode=1;
}
module.exports={runOne,runBatch,summarize,wilson,describe};
