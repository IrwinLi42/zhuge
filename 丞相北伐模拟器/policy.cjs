'use strict';
// Frozen, public-information proxy policies. These are not measurements of humans.
const POLICY_VERSION='1.0.1';
const NAMES=['casual','novice','wu-first','all-map','heal-only','stats-first'];
const NORTH=['chencang','changan','tongguan','luoyang'];
const WEST=['wudu','longyou'];
const WU=['jiangling','wuchang','jianye'];
const DEFINITIONS={
  casual:'有北伐推进意图的随手代理：合法内政加权随机；出征目标偏向北线但允许支线和攻吴；战术及事件选项随机；危急时可退兵。不是全部按钮等概率，也不预知结果。',
  novice:'固定公开资源阈值筹粮募兵，优先陈仓—长安—潼关—洛阳；比较当前敌兵粮估算强攻/截粮回合；普通选择balanced，危急选择safe。',
  'wu-first':'采用新手资源与战术规则，先江陵—武昌—建业，再北伐。',
  'all-map':'采用新手资源与战术规则，先西路两区，再吴三城，最后补全北线，以全图为目标。',
  'heal-only':'与novice同一行程、补给和战术，机缘只恢复当前健康，不提升能力。',
  'stats-first':'与novice同一行程、补给和战术，机缘先把统兵/谋略/治政提升到110，再治疗；危及存亡时允许先治疗。'
};
function makeRng(seed){let n=seed>>>0;return ()=>{n=(n+0x6D2B79F5)>>>0;let x=n;x=Math.imul(x^(x>>>15),x|1);x^=x+Math.imul(x^(x>>>7),x|61);return ((x^(x>>>14))>>>0)/4294967296;};}
function weighted(items,weight,rng){const weights=items.map(weight),total=weights.reduce((a,b)=>a+b,0);let n=rng()*total;for(let i=0;i<items.length;i++){n-=weights[i];if(n<0)return items[i];}return items.at(-1);}
function publicView(view){
  // Deliberately whitelist. The engine's seed, RNG, hidden event payload and log are absent.
  const s=view.state,p=s.player;
  return {state:{turn:s.turn,domesticTurns:s.domesticTurns,phase:s.phase,player:p,wu:s.wu,battle:s.battle,warning:s.warning,mainVictory:s.mainVictory,fullVictory:s.fullVictory,ending:s.ending},
    stats:view.stats,economy:view.economy,connected:view.connected,regions:view.regions,actions:view.actions,event:view.event,equipment:view.equipment,battlePreview:view.battlePreview};
}
function createPolicy(name='novice',{seed=1}={}){
  if(!NAMES.includes(name))throw Error('Unknown policy: '+name);
  const rng=makeRng((seed^0xA5F1523D)>>>0);
  return function decide(input){
    const v=publicView(input),s=v.state,p=s.player,legal=(v.actions||[]).filter(a=>a.allowed),find=type=>legal.find(a=>a.action.type===type),command=a=>({method:'act',args:[a.action]});
    if(s.ending||s.phase==='ended')return {method:'stop',args:[]};
    if(v.event){
      const choices=v.event.choices.filter(c=>c.allowed!==false),critical=p.health<18||p.grain<350||p.troops<250;
      const chosen=name==='casual'?choices[Math.floor(rng()*choices.length)]:(choices.find(c=>c.id===(critical?'safe':'balanced'))||choices[0]);
      if(!chosen)throw Error('No public legal event choice');return {method:'choose',args:[chosen.id]};
    }
    if(s.phase==='victory')return {method:'continueCampaign',args:[]};
    if(p.chance>0){
      const gap=p.maxHealth-p.health,base=p.stats;
      let spend;
      if(name==='heal-only'){if(gap>=6||p.health<12&&gap>0)spend='health';}
      else if(name==='stats-first'){
        if(p.health<12&&gap>0)spend='health';else spend=['command','strategy','governance'].find(k=>base[k]<110)||(gap>=6?'health':null);
      }else if(name==='casual'){
        const candidates=['command','strategy','governance'].filter(k=>base[k]<110);if(gap>=6)candidates.push('health','health');
        if(candidates.length)spend=candidates[Math.floor(rng()*candidates.length)];
      }else if(p.health<26&&gap>0||p.health<50&&gap>=12)spend='health';
      else spend=['command','strategy'].find(k=>base[k]<110)||(gap>=6?'health':null);
      if(spend)return {method:'spendChance',args:[spend]};
    }
    if(s.battle){
      const retreat=find('retreat'),tactics=legal.filter(a=>['assault','cutSupply','steady'].includes(a.action.type));
      if(name==='casual'){
        const pool=[...tactics];if(retreat&&(p.troops<250||p.grain<350))pool.push(retreat);
        if(pool.length)return command(pool[Math.floor(rng()*pool.length)]);
      }
      if(retreat&&(p.troops<100||p.grain<170)&&s.battle.regionId!=='hanzhong')return command(retreat);
      const enemy=s.battle.enemy,preview=v.battlePreview||{};
      const attackRounds=Math.ceil(enemy.troops/Math.max(1,preview.assault?.enemyTroops||1)),supplyRounds=Math.ceil(enemy.grain/Math.max(1,preview.cutSupply?.enemyGrain||1));
      const preferred=find(supplyRounds<=attackRounds?'cutSupply':'assault');
      if(preferred)return command(preferred);if(tactics.length)return command(tactics[0]);if(retreat)return command(retreat);
    }
    if(s.warning){
      const target=v.regions.find(r=>r.id===s.warning.targetId||r.id===s.warning.target),yieldAction=find('yield');
      if(target?.connected===false&&yieldAction)return command(yieldAction);
      if(p.grain<700&&find('gather'))return command(find('gather'));
      if(p.troops<700&&find('recruit'))return command(find('recruit'));
      if(p.health<24&&find('rest'))return command(find('rest'));
      const preparation=find('gather')||find('recruit')||find('rest');if(preparation)return command(preparation);if(yieldAction)return command(yieldAction);
    }
    const attacks=legal.filter(a=>a.action.type==='attack');
    if(name==='casual'){
      const pool=legal.filter(a=>['attack','gather','recruit','develop','rest','envoy','aid','peace','alliance'].includes(a.action.type));
      if(pool.length)return command(weighted(pool,a=>{
        const t=a.action.type;
        if(t==='attack')return NORTH.includes(a.action.regionId)?3:1;
        if(t==='gather')return p.grain<900?5:1.5;
        if(t==='recruit')return p.troops<700?5:1.5;
        if(t==='rest')return p.health<30?3:.5;
        if(t==='develop')return s.turn<12?1:.25;
        return .5;
      },rng));
    }
    const route=name==='wu-first'?[...WU,...NORTH,...WEST]:name==='all-map'?[...WEST,...WU,...NORTH]:[...NORTH,...WEST,...WU];
    const next=attacks.sort((a,b)=>route.indexOf(a.action.regionId)-route.indexOf(b.action.regionId))[0];
    const target=next&&v.regions.find(r=>r.id===next.action.regionId);
    const neededGrain=Math.max(800,(target?.grain||650)*.65+350),neededTroops=Math.max(600,(target?.troops||650)*.85+180);
    if(p.health<18&&p.maxHealth-p.health>=4&&find('rest'))return command(find('rest'));
    if(p.grain<neededGrain&&find('gather')&&(p.grain/neededGrain<p.troops/neededTroops||!find('recruit')))return command(find('gather'));
    if(p.troops<neededTroops&&find('recruit'))return command(find('recruit'));
    if(p.grain<neededGrain&&find('gather'))return command(find('gather'));
    if(next)return command(next);
    const fallback=find('gather')||find('recruit')||find('rest')||legal[0];
    if(fallback)return command(fallback);throw Error('No public legal action at '+s.phase);
  };
}
module.exports={POLICY_VERSION,NAMES,DEFINITIONS,createPolicy,publicView,makeRng};
