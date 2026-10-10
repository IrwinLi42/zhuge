'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Engine=require('./engine.js'),Config=require('./config.js');
const {createPolicy,publicView}=require('./policy.cjs');
const {runOne,runBatch,wilson,summarize}=require('./simulate.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
function game(seed=17,difficulty='normal'){return new Engine({seed,difficulty});}
function action(g,type,extras={}){const a=g.getView().actions.find(a=>a.allowed&&a.action.type===type&&Object.entries(extras).every(([k,v])=>a.action[k]===v));assert.ok(a,'Expected legal '+type+' '+JSON.stringify(extras));return a.action;}
function step(g,type,extras={},choice='safe'){g.act(action(g,type,extras));return g.choose(choice);}
function expectAtomic(g,fn){const before=g.serialize();assert.throws(fn);assert.equal(g.serialize(),before,'Rejected action mutated full save/RNG');}
function fixture(g,edit){const save=JSON.parse(g.serialize());edit(save.state);return Engine.deserialize(JSON.stringify(save));}
function owned(s,id){Object.assign(s.regions[id],{owner:'shu',troops:0,grain:0,claimed:true});}
function warningFixture(targetId='hanzhong',sourceId='chencang',faction='wei'){
  return fixture(game(),s=>{if(targetId!=='hanzhong')owned(s,targetId);s.warning={id:'warning_fixture',targetId,sourceId,faction,enemy:{troops:40,grain:40,maxTroops:100,maxGrain:100},createdTurn:s.turn};});
}

test('原始十一节点、蜀魏吴归属、两都目标与一套共享兵粮',()=>{
  const v=game().getView();assert.equal(v.regions.length,11);assert.deepEqual(v.regions.filter(r=>r.owner==='shu').map(r=>r.id).sort(),['hanzhong','yongan']);assert.equal(v.regions.filter(r=>r.owner==='wei').length,6);assert.equal(v.regions.filter(r=>r.owner==='wu').length,3);
  assert.equal(v.state.player.health,80);assert.equal(v.state.player.maxHealth,100);assert.deepEqual(v.state.player.stats,{command:90,strategy:95,governance:95});assert.equal(v.state.turn,0);assert.ok(v.state.player.troops>0&&v.state.player.grain>0);assert.equal(v.state.battle,null);
});
test('UMD浏览器入口不依赖Node，默认状态与Node引擎一致',()=>{
  const context=vm.createContext({console});for(const name of ['config.js','engine.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,name),'utf8'),context,{filename:name});
  assert.equal(typeof context.BeifaEngine,'function');const browser=new context.BeifaEngine({seed:9,difficulty:'normal'});assert.deepEqual(clone(browser.getView()),game(9).getView());
});
test('读取view是纯快照；菜单检查不会改变RNG、资源或事件',()=>{
  const g=game(),saved=g.serialize(),v=g.getView();v.state.player.health=0;v.regions[0].owner='wei';for(let i=0;i<10;i++)g.getView();assert.equal(g.serialize(),saved);
});
test('指令只锁定事件，选择恰好结算一次，拒绝双重提交',()=>{
  const g=game(),before=g.getView();g.act(action(g,'gather'));const locked=g.getView();assert.ok(locked.event);assert.equal(locked.state.turn,before.state.turn);assert.deepEqual(locked.state.player,before.state.player);assert.deepEqual(locked.state.regions,before.state.regions);
  expectAtomic(g,()=>g.act({type:'gather'}));expectAtomic(g,()=>g.spendChance('health'));expectAtomic(g,()=>g.choose('not-a-choice'));
  g.choose('safe');assert.equal(g.getView().state.turn,1);assert.equal(g.getView().state.player.maxHealth,98);expectAtomic(g,()=>g.choose('safe'));
});
test('种子决定可复现流程，待选事件和随机流可完整存读',()=>{
  const a=game(314159),b=game(314159);for(const type of ['gather','recruit','develop']){a.act(action(a,type));b.act(action(b,type));assert.deepEqual(a.getView(),b.getView());a.choose('balanced');b.choose('balanced');assert.deepEqual(a.getView(),b.getView());}
  const g=game(88);g.act(action(g,'attack',{regionId:'chencang'}));const restored=Engine.deserialize(g.serialize());assert.deepEqual(restored.getView(),g.getView());g.choose('bold');restored.choose('bold');assert.deepEqual(restored.getView(),g.getView());
});
test('路线与行动资格不能通过直接调用API绕过',()=>{
  const g=game();for(const cmd of [{type:'attack',regionId:'luoyang'},{type:'attack',regionId:'hanzhong'},{type:'attack',regionId:'missing'},{type:'assault'},{type:'retreat'},{type:'yield'},{type:'unknown'}])expectAtomic(g,()=>g.act(cmd));
  expectAtomic(g,()=>g.choose('safe'));expectAtomic(g,()=>g.continueCampaign());expectAtomic(g,()=>g.finishCampaign());
});
test('攻吴宣战与行军一起结算，不能额外空转或产生第二支军队',()=>{
  const g=game(),p=clone(g.getView().state.player);g.act(action(g,'attack',{regionId:'jiangling'}));assert.deepEqual(g.getView().state.player,p);assert.equal(g.getView().state.turn,0);
  g.choose('safe');const v=g.getView();assert.equal(v.state.turn,1);assert.equal(v.state.phase,'battle');assert.equal(v.state.wu.relation,0);assert.equal(v.state.wu.state||v.state.wu.status,'war');assert.equal(v.state.battle.regionId,'jiangling');expectAtomic(g,()=>g.act({type:'attack',regionId:'chencang'}));
});
test('军事阶段无常规地区收入且不能募兵或刷内政',()=>{
  const g=game();step(g,'attack',{regionId:'chencang'});const v=g.getView();assert.equal(v.economy.gold,0);assert.equal(v.economy.grain,0);expectAtomic(g,()=>g.act({type:'gather'}));expectAtomic(g,()=>g.act({type:'recruit'}));expectAtomic(g,()=>g.act({type:'develop'}));
  const before=g.getView();step(g,'cutSupply');const after=g.getView();assert.equal(after.state.turn,before.state.turn+1);assert.ok(after.state.player.grain<before.state.player.grain);assert.equal(after.state.player.maxHealth,before.state.player.maxHealth-2);
});
test('进攻撤退耗时且不占城、不领取首占机缘；敌军不会直接重置',()=>{
  const g=game();step(g,'attack',{regionId:'chencang'});step(g,'cutSupply');const before=g.getView(),enemy=clone(before.state.battle.enemy);step(g,'retreat');const after=g.getView();assert.equal(after.state.turn,before.state.turn+1);assert.equal(after.state.battle,null);assert.equal(after.regions.find(r=>r.id==='chencang').owner,'wei');assert.equal(after.state.player.chance,before.state.player.chance);
  assert.ok(after.state.player.troops<before.state.player.troops);assert.ok(after.state.player.grain<before.state.player.grain);const r=after.regions.find(r=>r.id==='chencang');assert.ok(r.grain<r.maxGrain,'Retreat reset full enemy grain');assert.ok(r.grain>=enemy.grain,'Recovery may heal, but not silently destroy additional enemy grain');
});
test('穿脱装备不恢复健康兵粮或年龄，重复装备及错误槽位拒绝且原子',()=>{
  const g=game(),before=clone(g.getView().state.player);g.unequip(0);g.equip('feather_fan',0);for(let i=0;i<5;i++){g.unequip(1);g.equip('crane_cloak',1);}const after=g.getView().state.player;
  for(const k of ['health','maxHealth','troops','grain','gold','chance'])assert.equal(after[k],before[k],k);assert.equal(g.getView().state.turn,0);
  expectAtomic(g,()=>g.equip('feather_fan',1));expectAtomic(g,()=>g.equip('wooden_ox',0));expectAtomic(g,()=>g.equip('missing',0));expectAtomic(g,()=>g.equip('feather_fan',-1));
});
test('装备影响有效能力但不会污染永久基础属性或读档重复累加',()=>{
  let g=game();const original=g.getView(),base=clone(original.state.player.stats);g.unequip(0);assert.ok(g.getView().stats.strategy<original.stats.strategy);assert.deepEqual(g.getView().state.player.stats,base);g.equip('feather_fan',0);
  for(let i=0;i<8;i++)g=Engine.deserialize(g.serialize());assert.deepEqual(g.getView().stats,original.stats);assert.deepEqual(g.getView().state.player.stats,base);
});
test('前两个内政回合不来袭；预警后禁止出征外交，准备只结算一回合',()=>{
  let warned;
  for(let seed=1;seed<=80&&!warned;seed++){
    const g=game(seed);step(g,'gather');assert.equal(g.getView().state.warning,null);step(g,'gather');assert.equal(g.getView().state.warning,null);step(g,'gather');if(g.getView().state.warning)warned=g;
  }
  assert.ok(warned,'No invasion in 80 independent seed probes');const v=warned.getView();expectAtomic(warned,()=>warned.act({type:'attack',regionId:'chencang'}));expectAtomic(warned,()=>warned.act({type:'envoy'}));
  step(warned,'gather');assert.equal(warned.getView().state.turn,v.state.turn+1);assert.equal(warned.getView().state.battle.type,'defense');assert.equal(warned.getView().state.warning,null);
});
test('存档拒绝非JSON、错误版本、原型污染与非法数字',()=>{
  assert.throws(()=>Engine.deserialize('not json'));const original=JSON.parse(game().serialize());
  const polluted=JSON.stringify(original).replace(/\{/, '{"__proto__":{"polluted":true},');assert.throws(()=>Engine.deserialize(polluted));assert.equal({}.polluted,undefined);
  const fake=clone(original);fake.schema='not-beifa';fake.schemaVersion=999;fake.version=999;assert.throws(()=>Engine.deserialize(JSON.stringify(fake)));
  const invalid=clone(original);assert.ok(invalid.state,'Expected state envelope');invalid.state.player.grain=-1;assert.throws(()=>Engine.deserialize(JSON.stringify(invalid)));
  const nonfinite=clone(original);nonfinite.state.player.stats.command='100';assert.throws(()=>Engine.deserialize(JSON.stringify(nonfinite)));
});
test('空机缘、非法升级、未达主胜不能继续，失败不能留下部分修改',()=>{
  const g=game();expectAtomic(g,()=>g.spendChance('health'));expectAtomic(g,()=>g.spendChance('maxHealth'));expectAtomic(g,()=>g.spendChance('__proto__'));expectAtomic(g,()=>g.continueCampaign());
});
test('机缘恢复当前健康最多6且不越当前上限；能力+5封顶120，不消耗回合',()=>{
  const g=fixture(game(),s=>{s.turn=20;s.player.maxHealth=60;s.player.health=58;s.player.chance=5;s.player.stats.command=118;});
  g.spendChance('health');let v=g.getView();assert.equal(v.state.player.health,60);assert.equal(v.state.player.maxHealth,60);assert.equal(v.state.turn,20);assert.equal(v.state.player.chance,4);expectAtomic(g,()=>g.spendChance('health'));
  g.spendChance('command');v=g.getView();assert.equal(v.state.player.stats.command,120);assert.equal(v.state.player.chance,3);expectAtomic(g,()=>g.spendChance('command'));
});
test('第50回合必败，休整/机缘/装备都不能越过寿命硬限，死后不能花机缘',()=>{
  const g=fixture(game(),s=>{s.turn=49;s.player.maxHealth=2;s.player.health=1;s.player.chance=99;s.player.gold=10000;});g.spendChance('health');assert.equal(g.getView().state.player.health,2);step(g,'rest');const v=g.getView();assert.equal(v.state.turn,50);assert.equal(v.state.player.maxHealth,0);assert.equal(v.state.ending.reason,'lifespan');expectAtomic(g,()=>g.spendChance('health'));expectAtomic(g,()=>g.unequip(0));expectAtomic(g,()=>g.act({type:'gather'}));assert.deepEqual(Engine.deserialize(g.serialize()).getView(),v);
});
test('军粮/兵力/当前健康归零与敌方归零同回合发生时，先失败，不发攻占奖励',()=>{
  for(const key of ['troops','grain','health']){let g=game();step(g,'attack',{regionId:'chencang'});g=fixture(g,s=>{s.player[key]=1;s.battle.enemy.troops=1;s.battle.enemy.grain=1;});const before=g.getView().state.player.chance;step(g,'assault');const v=g.getView();assert.equal(v.state.ending.reason,key);assert.equal(v.regions.find(r=>r.id==='chencang').owner,'wei');assert.equal(v.state.player.chance,before);assert.equal(v.state.mainVictory,false);}
});
test('国库和四方支持度归零不直接判败',()=>{
  const g=fixture(game(),s=>{s.player.gold=0;for(const k of Object.keys(s.player.factions))s.player.factions[k]=0;});step(g,'gather');assert.equal(g.getView().state.ending,null);assert.ok(g.getView().state.player.grain>0);
});
test('退让汉中在兵粮仍正时立即失败；蜀中内线不能充当敌侵略边',()=>{
  const g=warningFixture();step(g,'yield');const v=g.getView();assert.equal(v.state.ending.reason,'hanzhong');assert.ok(v.state.player.troops>0&&v.state.player.grain>0);assert.equal(v.regions.find(r=>r.id==='hanzhong').owner,'wei');
  const save=JSON.parse(game().serialize());save.state.regions.yongan.owner='wu';save.state.warning={id:'bad_internal',sourceId:'yongan',targetId:'hanzhong',faction:'wu',enemy:{troops:100,grain:100,maxTroops:100,maxGrain:100},createdTurn:0};assert.throws(()=>Engine.deserialize(JSON.stringify(save)),/入侵/);
});
test('防守胜利不夺敌源区、不发首次奖励，随后恰有两个完整内政冷却',()=>{
  const g=warningFixture();step(g,'gather');const before=g.getView().state.player.chance;step(g,'assault');let v=g.getView();assert.equal(v.state.battle,null);assert.equal(v.state.invasionCooldown,2);assert.equal(v.regions.find(r=>r.id==='chencang').owner,'wei');assert.equal(v.state.player.chance,before);
  step(g,'gather');v=g.getView();assert.equal(v.state.invasionCooldown,1);assert.equal(v.state.warning,null);step(g,'gather');v=g.getView();assert.equal(v.state.invasionCooldown,0);assert.equal(v.state.warning,null);
});
test('主动出征撤退不赠送或重置防守冷却，军事回合不消耗内政冷却',()=>{
  const g=fixture(game(),s=>{s.invasionCooldown=1;});step(g,'attack',{regionId:'chencang'});assert.equal(g.getView().state.invasionCooldown,1);step(g,'retreat');assert.equal(g.getView().state.invasionCooldown,1);step(g,'gather');assert.equal(g.getView().state.invasionCooldown,0);
});
test('退守丢城后收复不能再次领取该城首次机缘',()=>{
  let g=warningFixture('chencang','changan');step(g,'yield');assert.equal(g.getView().regions.find(r=>r.id==='chencang').owner,'wei');g=fixture(g,s=>{s.regions.chencang.troops=1;s.regions.chencang.grain=1;});const before=g.getView().state.player.chance;step(g,'attack',{regionId:'chencang'});step(g,'assault');const v=g.getView();assert.equal(v.regions.find(r=>r.id==='chencang').owner,'shu');assert.equal(v.state.player.chance,before);
});
test('占领机缘按魏1/吴2、2、3发放；新地收入仅下一内政结算进入库存',()=>{
  for(const [id,reward]of [['chencang',1],['jiangling',2],['wuchang',2],['jianye',3]]){
    let g=fixture(game(),s=>{if(id==='wuchang'||id==='jianye')owned(s,'jiangling');if(id==='jianye')owned(s,'wuchang');s.regions[id].troops=1;s.regions[id].grain=1;});step(g,'attack',{regionId:id});const before=g.getView();step(g,'assault');const after=g.getView();assert.equal(after.state.player.chance-before.state.player.chance,reward,id);assert.equal(after.state.player.gold,before.state.player.gold,'No monthly income in conquest round');assert.equal(after.regions.find(r=>r.id===id).owner,'shu');
  }
});
test('失去汉中连通的己控地区无收入且不能从飞地继续出征，重新连接无补发',()=>{
  const base=game(),g=fixture(base,s=>{owned(s,'changan');owned(s,'longyou');});const detached=g.getView();assert.ok(!detached.connected.includes('changan'));assert.equal(detached.economy.grossGrain,base.getView().economy.grossGrain);assert.equal(detached.regions.find(r=>r.id==='tongguan').attackable,false);
  const restored=fixture(g,s=>owned(s,'chencang')),v=restored.getView();assert.ok(v.connected.includes('changan'));assert.ok(v.economy.grossGrain>detached.economy.grossGrain);assert.equal(v.state.player.grain,detached.state.player.grain,'Reconnection may not retroactively grant stocks');
});
test('主胜要求两都当前同时持有，记录后失城或死亡仍保留且可存读',()=>{
  let g=game();step(g,'attack',{regionId:'chencang'});g=fixture(g,s=>{for(const id of ['chencang','changan','tongguan'])owned(s,id);Object.assign(s.battle,{regionId:'luoyang',sourceId:'luoyang',stagingId:'tongguan'});s.battle.enemy.troops=1;s.battle.enemy.grain=1;});step(g,'assault');let v=g.getView();assert.equal(v.state.mainVictory,true);assert.equal(v.state.phase,'victory');const wonAt=v.state.mainVictoryTurn;g.continueCampaign();g=fixture(g,s=>{s.turn=49;s.player.maxHealth=2;s.player.health=2;s.regions.changan.owner='wei';});step(g,'rest');v=g.getView();assert.equal(v.state.ending.reason,'lifespan');assert.equal(v.state.mainVictory,true);assert.equal(v.state.mainVictoryTurn,wonAt);assert.equal(v.state.ending.mainVictory,true);assert.equal(Engine.deserialize(g.serialize()).getView().state.mainVictory,true);
  const one=fixture(game(),s=>owned(s,'luoyang'));step(one,'gather');assert.equal(one.getView().state.mainVictory,false);
});
test('吴本土三城失去仍有吴控永安时不算灭国；最后一处失去才永久灭国',()=>{
  let g=fixture(game(),s=>{for(const id of ['jiangling','wuchang','jianye'])owned(s,id);s.regions.yongan.owner='wu';s.regions.yongan.troops=1;s.regions.yongan.grain=1;s.wu.status='war';s.wu.relation=0;});step(g,'gather');assert.notEqual(g.getView().state.wu.status,'eliminated');g=fixture(g,s=>{s.regions.yongan.troops=1;s.regions.yongan.grain=1;});step(g,'attack',{regionId:'yongan'});step(g,'assault');assert.equal(g.getView().state.wu.status,'eliminated');assert.equal(g.getView().invasion.wu,0);expectAtomic(g,()=>g.act({type:'envoy'}));
});
test('吴援助全局限一次；议和不消耗其后3个停战回合，送礼不自动止战',()=>{
  let g=game(43);step(g,'envoy');step(g,'aid',{resource:'grain'});assert.equal(g.getView().state.wu.aidUsed,true);expectAtomic(g,()=>g.act({type:'aid',resource:'troops'}));
  g=fixture(g,s=>{s.wu.status='war';s.wu.relation=0;s.invasionCooldown=2;});step(g,'envoy');assert.equal(g.getView().state.wu.status,'war');step(g,'peace');assert.equal(g.getView().state.wu.truceRemaining,3);assert.equal(g.getView().invasion.wu,0);
  g=fixture(g,s=>{s.warning=null;s.invasionCooldown=2;});step(g,'alliance');assert.equal(g.getView().state.wu.status,'allied');assert.equal(g.getView().state.wu.aidUsed,true);expectAtomic(g,()=>g.act({type:'aid',resource:'grain'}));
  g=fixture(g,s=>{s.wu.status='war';s.wu.relation=0;s.warning=null;s.invasionCooldown=2;});step(g,'peace');step(g,'gather');assert.equal(g.getView().state.wu.truceRemaining,2);step(g,'gather');assert.equal(g.getView().state.wu.truceRemaining,1);step(g,'gather');assert.equal(g.getView().state.wu.truceRemaining,0);assert.equal(g.getView().state.wu.status,'war');
});
test('模拟代理只读取公开字段；游戏与策略随机流分离',()=>{
  const view=game().getView(),visible=publicView(view);assert.equal(visible.state.rng,undefined);assert.equal(visible.state.seed,undefined);assert.equal(visible.state.pendingEvent,undefined);
  for(const name of ['casual','novice','wu-first','all-map','heal-only','stats-first']){const a=createPolicy(name,{seed:5}),b=createPolicy(name,{seed:5}),altered=clone(view);altered.state.rng=0;altered.state.seed=99999;assert.deepEqual(a(view),b(altered));}
});
test('代理统计区分主胜前失败和主胜后死亡，Wilson区间不伪造精度',()=>{
  const interval=wilson(1000,2000);assert.equal(interval.rate,.5);assert.ok(interval.lower>.47&&interval.upper<.53);
  const base={turns:30,domesticTurns:6,battleTurns:20,defenseTurns:2,defenseBattles:1,chanceSpent:{health:0,command:0,strategy:0,governance:0},captured:[],error:null};
  const stats=summarize([{...base,seed:1,reason:'health',mainVictory:false,fullVictory:false},{...base,seed:2,reason:'health',mainVictory:true,mainTurn:24,fullVictory:false}]);assert.equal(stats.mainVictory.rate,.5);assert.deepEqual(stats.mainFailureReasons,{health:1});assert.deepEqual(stats.postVictoryEndReasons,{health:1});
});
test('六种策略的小样本均能通过公开API推进，没有非法动作或无限菜单循环',()=>{
  const report=runBatch({runs:3,seedStart:2001,split:'calibration',difficulties:['normal']});
  for(const [key,result]of Object.entries(report.cells)){assert.equal(result.errors.length,0,key+': '+JSON.stringify(result.errors[0]));assert.ok(result.finalTurns.max<=50,key);assert.equal(result.runs,3);}
});
test('主胜后继续攻取最后一地得到十一节点全胜，结局与存档保留双重胜利',()=>{
  let g=game();step(g,'attack',{regionId:'jiangling'});g=fixture(g,s=>{for(const id of Object.keys(s.regions))if(id!=='jianye')owned(s,id);s.mainVictory=true;s.mainVictoryTurn=1;Object.assign(s.battle,{regionId:'jianye',sourceId:'jianye',stagingId:'wuchang'});s.battle.enemy.troops=1;s.battle.enemy.grain=1;});step(g,'assault');const v=g.getView();assert.equal(v.state.mainVictory,true);assert.equal(v.state.fullVictory,true);assert.equal(v.state.ending.reason,'full');assert.equal(v.regions.filter(r=>r.owner==='shu').length,11);assert.equal(v.state.wu.status,'eliminated');assert.deepEqual(Engine.deserialize(g.serialize()).getView(),v);
});
test('一次性机缘无论选择治疗或成长都会用尽事件资格，不能通过存档重领',()=>{
  let g=game();
  for(const [id,choice]of [['opportunity_1','balanced'],['opportunity_2','bold']]){g.act(action(g,'gather'));g=fixture(g,s=>{Object.assign(s.pendingEvent,{id:'event_'+(s.turn+1)+'_opportunity',kind:'opportunity',opportunityId:id});});g.choose(choice);assert.ok(g.getView().state.usedOpportunities.includes(id));}
  assert.equal(g.getView().state.usedOpportunities.length,2);g.act(action(g,'gather'));const save=JSON.parse(g.serialize());Object.assign(save.state.pendingEvent,{id:'event_'+(save.state.turn+1)+'_opportunity',kind:'opportunity',opportunityId:'opportunity_1'});assert.throws(()=>Engine.deserialize(JSON.stringify(save)),/机缘/);
});
test('等价action对象字段顺序不影响语义，事件来源跨阶段伪造应拒绝',()=>{
  const g=game();g.act({regionId:'chencang',type:'attack'});assert.ok(g.getView().event);const save=JSON.parse(g.serialize());save.state.pendingEvent.kind='opportunity';save.state.pendingEvent.opportunityId='opportunity_1';save.state.pendingEvent.id='event_1_opportunity';assert.throws(()=>Engine.deserialize(JSON.stringify(save)));
});
test('存档不能伪造退隐胜利、失败原因或结束回合',()=>{
  let g=fixture(game(),s=>{s.turn=49;s.player.maxHealth=2;s.player.health=2;});step(g,'rest');const ended=JSON.parse(g.serialize());const wrongTurn=clone(ended);wrongTurn.state.ending.turn=49;assert.throws(()=>Engine.deserialize(JSON.stringify(wrongTurn)));const wrongReason=clone(ended);wrongReason.state.ending.reason='troops';assert.throws(()=>Engine.deserialize(JSON.stringify(wrongReason)));const fakeVictory=clone(ended);fakeVictory.state.ending.type='retired';fakeVictory.state.ending.reason='retired';assert.throws(()=>Engine.deserialize(JSON.stringify(fakeVictory)));
});
test('三档公开补给倍率的行动费用预览与实际行军/战斗扣粮相符',()=>{
  for(const d of ['easy','normal','hard']){const g=game(19,d),initial=g.getView();assert.equal(initial.difficultyRules.supplyCostMultiplier,Config.difficulties[d].supplyCostMultiplier);const row=initial.actions.find(a=>a.allowed&&a.action.type==='attack'&&a.action.regionId==='chencang'),cost=Number(row.description.match(/军粮(\d+)/)[1]);g.act(row.action);const effect=g.getView().event.choices.find(c=>c.id==='safe').preview.success;g.choose('safe');assert.equal(initial.state.player.grain-g.getView().state.player.grain,cost-(effect.grain||0));const before=g.getView(),tacticalCost=before.battlePreview.cutSupply.grain;g.act(action(g,'cutSupply'));const tactical=g.getView().event.choices.find(c=>c.id==='safe').preview.success;g.choose('safe');assert.equal(before.state.player.grain-g.getView().state.player.grain,tacticalCost-(tactical.grain||0));}
});
test('防守准备后军队转驻被袭战线，东线防守再北伐显示跨线费用',()=>{
  const g=warningFixture('yongan','jiangling','wu'),normalCost=Number(game().getView().actions.find(a=>a.id==='attack_chencang').description.match(/军粮(\d+)/)[1]);step(g,'gather');assert.equal(g.getView().state.location,'yongan');assert.equal(g.getView().state.lastFront,'east');step(g,'assault');const v=g.getView();assert.equal(v.state.location,'yongan');const next=v.actions.find(a=>a.id==='attack_chencang');assert.match(next.description,/跨战线/);assert.ok(Number(next.description.match(/军粮(\d+)/)[1])>normalCost);
});
test('从汉中尝试收复永安再撤军，落点与战线同步，不重复收北线跨区费',()=>{
  const fresh=game(),normalCost=Number(fresh.getView().actions.find(a=>a.id==='attack_chencang').description.match(/军粮(\d+)/)[1]);const g=fixture(fresh,s=>{s.regions.yongan.owner='wu';s.regions.yongan.troops=400;s.regions.yongan.grain=400;});step(g,'attack',{regionId:'yongan'});assert.equal(g.getView().state.lastFront,'east');step(g,'retreat');const v=g.getView();assert.equal(v.state.location,'hanzhong');assert.equal(v.state.lastFront,'north');assert.equal(Number(v.actions.find(a=>a.id==='attack_chencang').description.match(/军粮(\d+)/)[1]),normalCost);
});
