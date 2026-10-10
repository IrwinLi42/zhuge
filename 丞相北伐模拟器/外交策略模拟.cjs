'use strict';
// Independent supplement. The four calibrated runtime/policy files stay byte-for-byte frozen.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Engine=require('./engine.js');
const {createPolicy,publicView}=require('./policy.cjs');
const {describe,wilson}=require('./simulate.cjs');
const VERSION='1.0.0';
const NAMES=['stable-alliance','low-relation'];
const CORE=['engine.js','config.js','policy.cjs','simulate.cjs'];
const EXPECTED={
  'engine.js':'29e65d7bdc0249bf71807ebbdce5e8bfc0918f30b6f3affc75d6016ac28c046a',
  'config.js':'8920bd127d4dd5b5e4327508771eece3c3b6d50e54e3ffe90a43149f11cf10b0',
  'policy.cjs':'78c55cedc99389b63e865b7d3618650369f5fe1060d5c1a35e622a62fc33b31c',
  'simulate.cjs':'db16b227e8e7d223ceb41db091e5c862e1fbac0442b72d0fd4924f39f4a700e1'
};
const DEFINITIONS={
  'stable-alliance':'包装固定 novice：外交事件选履行约定；仍处盟约、关系低于80，且健康至少20、军粮至少350、兵力至少250、国库至少240时遣使（保留一次募兵的国库余量）。一次吴援助可用即领取军粮。危急休整、机缘、入侵准备与战斗仍优先依照 novice。主胜后继续同一全图路线；主动攻吴后不反复修盟或送礼。',
  'low-relation':'包装固定 novice：外交事件优先本军；不遣使、不取援助、不议和、不修盟。其他行动、战术、机缘和主胜后全图路线全部照 novice。不改初始关系70，不额外拖延内政以强制造成关系下降。'
};
const clone=x=>JSON.parse(JSON.stringify(x));
const diplomacyEvent=v=>(v.event?.choices||[]).some(c=>typeof c.preview?.success?.wuRelation==='number');
function createDiplomacyPolicy(name,{seed=1}={}){
  if(!NAMES.includes(name))throw Error('Unknown diplomacy policy: '+name);
  const base=createPolicy('novice',{seed});
  return input=>{
    const v=publicView(input),s=v.state,p=s.player;
    if(diplomacyEvent(v)){
      const id=name==='stable-alliance'?'safe':'bold',choice=v.event.choices.find(c=>c.id===id&&c.allowed!==false);
      if(!choice)throw Error('Public diplomacy choice unavailable');
      return {method:'choose',args:[choice.id]};
    }
    const ordinary=base(v);
    if(name!=='stable-alliance'||ordinary.method!=='act'||v.event||s.phase!=='domestic'||s.warning||s.battle||s.wu.status!=='allied'||ordinary.args[0].type==='rest')return ordinary;
    const legal=(v.actions||[]).filter(a=>a.allowed),command=a=>({method:'act',args:[clone(a.action)]});
    const aid=legal.find(a=>a.action.type==='aid'&&a.action.resource==='grain');
    if(aid)return command(aid);
    const envoy=legal.find(a=>a.action.type==='envoy');
    if(s.wu.relation<80&&p.health>=20&&p.grain>=350&&p.troops>=250&&p.gold>=240&&envoy)return command(envoy);
    return ordinary;
  };
}
function runOne({difficulty='normal',policy='stable-alliance',seed=1,trace=false,maxCommands=700}={}){
  const engine=new Engine({difficulty,seed}),decide=createDiplomacyPolicy(policy,{seed});
  let v=publicView(engine.getView()),queuedAction=null,commands=0;
  if(v.state.wu.relation!==70||v.state.wu.status!=='allied')throw Error('Unexpected initial diplomacy state');
  const row={difficulty,policy,seed,mainVictory:false,fullVictory:false,mainTurn:null,fullTurn:null,turns:0,reason:null,error:null,wuInvasions:0,preMainWuInvasions:0,diplomacyTurns:0,preMainDiplomacyTurns:0,diplomacyEvents:0,preMainDiplomacyEvents:0,preMainDomesticTurns:0,preMainEverRelationBelow60:false,preMainMinRelation:70,relationAtMain:null,envoyTurns:0,aidTurns:0,peaceTurns:0,allianceTurns:0,trace:trace?[]:undefined};
  const warnings=new Set();
  while(commands++<maxCommands){
    const before=v,s=before.state;
    if(s.ending||s.phase==='ended')break;
    let command;
    try{
      command=decide(v);if(command.method==='stop')break;
      if(trace)row.trace.push({turn:s.turn,phase:s.phase,wu:clone(s.wu),event:v.event?.title||null,command:clone(command)});
      if(command.method==='act')queuedAction=clone(command.args[0]);
      const result=engine[command.method](...command.args);
      v=publicView(result?.state?result:engine.getView());
      const after=v.state;
      if(after.turn>s.turn){
        if(after.turn!==s.turn+1||command.method!=='choose'||!queuedAction)throw Error('Unexpected timed transition');
        const preMain=!s.mainVictory,type=queuedAction.type;
        if(diplomacyEvent(before)){row.diplomacyEvents++;if(preMain)row.preMainDiplomacyEvents++;}
        if(['envoy','aid','peace','alliance'].includes(type)){row.diplomacyTurns++;row[type+'Turns']++;if(preMain)row.preMainDiplomacyTurns++;}
        if(preMain){
          row.preMainDomesticTurns+=after.domesticTurns-s.domesticTurns;
          row.preMainMinRelation=Math.min(row.preMainMinRelation,after.wu.relation);
          row.preMainEverRelationBelow60 ||= after.wu.relation<60;
        }
        queuedAction=null;
      }
      if(after.warning?.faction==='wu'&&!warnings.has(after.warning.id)){
        warnings.add(after.warning.id);row.wuInvasions++;if(!s.mainVictory)row.preMainWuInvasions++;
      }
      if(after.mainVictory&&!row.mainVictory){row.mainVictory=true;row.mainTurn=after.turn;row.relationAtMain=after.wu.relation;}
      if(after.fullVictory&&!row.fullVictory){row.fullVictory=true;row.fullTurn=after.turn;}
    }catch(error){row.error={message:error.message,command,turn:s.turn,phase:s.phase};break;}
  }
  const s=v.state;row.turns=s.turn;row.domesticTurns=s.domesticTurns;row.finalRelation=s.wu.relation;
  row.reason=s.ending?.reason||(row.error?'exception':commands>=maxCommands?'command_guard':'stopped');
  if(commands>=maxCommands&&!row.error)row.error={message:'Policy command guard exceeded'};
  return row;
}
function summarize(rows){
  const main=rows.filter(r=>r.mainVictory),full=rows.filter(r=>r.fullVictory),mainFailureReasons={},postVictoryEndReasons={};
  for(const row of rows){const counts=row.mainVictory?postVictoryEndReasons:mainFailureReasons;counts[row.reason]=(counts[row.reason]||0)+1;}
  const fields=['turns','domesticTurns','wuInvasions','preMainWuInvasions','diplomacyTurns','preMainDiplomacyTurns','diplomacyEvents','preMainDiplomacyEvents','preMainDomesticTurns','preMainMinRelation','envoyTurns','aidTurns','peaceTurns','allianceTurns'];
  return {runs:rows.length,mainVictory:wilson(main.length,rows.length),fullVictory:wilson(full.length,rows.length),mainVictoryTurns:describe(main.map(r=>r.mainTurn)),fullVictoryTurns:describe(full.map(r=>r.fullTurn)),...Object.fromEntries(fields.map(f=>[f,describe(rows.map(r=>r[f]))])),
    preMainDiplomacyEventExposure:wilson(rows.filter(r=>r.preMainDiplomacyEvents>0).length,rows.length),preMainLowRelationExposure:wilson(rows.filter(r=>r.preMainEverRelationBelow60).length,rows.length),preMainWuInvasionExposure:wilson(rows.filter(r=>r.preMainWuInvasions>0).length,rows.length),wuInvasionExposure:wilson(rows.filter(r=>r.wuInvasions>0).length,rows.length),
    mainWinners:{preMainDiplomacyEvents:describe(main.map(r=>r.preMainDiplomacyEvents)),preMainDiplomacyTurns:describe(main.map(r=>r.preMainDiplomacyTurns)),preMainWuInvasions:describe(main.map(r=>r.preMainWuInvasions)),relationAtMain:describe(main.map(r=>r.relationAtMain))},mainFailureReasons,postVictoryEndReasons,errors:rows.filter(r=>r.error),examples:{mainWin:main[0]?.seed,fullWin:full[0]?.seed,wuInvasion:rows.find(r=>r.preMainWuInvasions>0)?.seed,loss:rows.find(r=>!r.mainVictory)?.seed}};
}
function hashFile(name){return crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,name))).digest('hex');}
function runBatch({runs=2000,seedStart=10020001,difficulties=['easy','normal','hard'],onProgress}={}){
  if(!Number.isInteger(runs)||runs<1||!Number.isInteger(seedStart)||seedStart<0||seedStart+runs-1>0xffffffff)throw Error('Invalid run count/seed range');
  const hashes=Object.fromEntries([...CORE,path.basename(__filename)].map(n=>[n,hashFile(n)]));
  for(const name of CORE)if(hashes[name]!==EXPECTED[name])throw Error('Frozen source changed: '+name);
  const report={schema:'beifa-diplomacy-supplement-v1',policyVersion:VERSION,split:'new-holdout',seedRange:{first:seedStart,last:seedStart+runs-1,count:runs},definitions:DEFINITIONS,disclaimer:'固定公开信息代理的独立补充，不是实际玩家样本。与前36,000局种子不重叠；各难度/策略共享本次种子段作成对比较。主胜后继续全图，吴入侵应区分主胜前与主动攻吴后的继续征服。外交事件只是该内政回合的一个选项，不另加外交回合；外交回合专指遣使、援助、议和、修盟。',hashes,cells:{}};
  for(const difficulty of difficulties)for(const policy of NAMES){
    const rows=[];for(let i=0;i<runs;i++)rows.push(runOne({difficulty,policy,seed:seedStart+i}));
    const key=difficulty+'/'+policy;report.cells[key]=summarize(rows);onProgress?.(key,report.cells[key]);
  }
  report.sourceChangedDuringRun=Object.keys(hashes).filter(n=>hashFile(n)!==hashes[n]);
  return report;
}
if(require.main===module){
  const args=process.argv.slice(2),get=(name,fallback)=>{const index=args.indexOf('--'+name);return index<0?fallback:args[index+1];};
  const report=runBatch({runs:Number(get('runs',2000)),seedStart:Number(get('seed-start',10020001)),difficulties:get('difficulties','easy,normal,hard').split(','),onProgress:(key,c)=>process.stderr.write(key+': '+c.mainVictory.wins+'/'+c.runs+' main; '+c.fullVictory.wins+' full; '+c.errors.length+' errors\n')});
  const out=get('out',null),json=JSON.stringify(report,null,2)+'\n';
  if(out){fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.writeFileSync(out,json);process.stdout.write(path.resolve(out)+'\n');}else process.stdout.write(json);
  if(report.sourceChangedDuringRun.length||Object.values(report.cells).some(c=>c.errors.length))process.exitCode=1;
}
module.exports={VERSION,NAMES,DEFINITIONS,createDiplomacyPolicy,runOne,summarize,runBatch,hashFile};
