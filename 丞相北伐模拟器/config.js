/* 北伐机制样机配置；数值和叙事分离。 */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BEIFA_CONFIG=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const regions=[
    {id:'hanzhong',name:'汉中',owner:'shu',x:15,y:46,front:'north',terrain:'盆地',troops:600,grain:800,income:{gold:85,grain:180},maintenance:20,recruit:1.1,transport:1,description:'北伐根本，失守即结束本局。'},
    {id:'yongan',name:'永安',owner:'shu',x:25,y:78,front:'east',terrain:'山地',troops:440,grain:620,income:{gold:60,grain:135},maintenance:15,recruit:1,transport:1,description:'东线门户，与汉中保持蜀中内线。'},
    {id:'chencang',name:'陈仓',owner:'wei',x:26,y:29,front:'north',terrain:'险隘',troops:740,grain:980,income:{gold:50,grain:110},maintenance:15,recruit:1,transport:.9,defense:.92,chance:1,description:'北线直道，取此可进长安。'},
    {id:'wudu',name:'武都阴平',owner:'wei',x:5,y:26,front:'north',terrain:'山地',troops:420,grain:520,income:{gold:35,grain:110},maintenance:10,recruit:1.05,transport:.85,defense:.95,chance:1,description:'较薄弱的西路据点，可扩充粮源。'},
    {id:'longyou',name:'陇右',owner:'wei',x:11,y:9,front:'north',terrain:'平原',troops:510,grain:640,income:{gold:55,grain:145},maintenance:15,recruit:1.15,transport:1,defense:1,chance:1,description:'西路粮兵之地，可由侧翼接近长安。'},
    {id:'changan',name:'长安',owner:'wei',x:43,y:19,front:'north',terrain:'坚城',troops:870,grain:1040,income:{gold:90,grain:150},maintenance:25,recruit:1.1,transport:1,defense:1,chance:1,description:'主线目标之一，同时控制长安与洛阳即获北伐主胜。'},
    {id:'tongguan',name:'潼关',owner:'wei',x:61,y:19,front:'north',terrain:'险隘',troops:760,grain:930,income:{gold:50,grain:100},maintenance:20,recruit:1,transport:.9,defense:.94,chance:1,description:'连接关中和洛阳的门户。'},
    {id:'luoyang',name:'洛阳',owner:'wei',x:81,y:19,front:'north',terrain:'坚城',troops:960,grain:1160,income:{gold:110,grain:170},maintenance:25,recruit:1.15,transport:1,defense:1,chance:1,description:'主线目标之二。主胜后可继续统一全图。'},
    {id:'jiangling',name:'江陵',owner:'wu',x:46,y:73,front:'east',terrain:'江岸',troops:550,grain:720,income:{gold:70,grain:160},maintenance:20,recruit:1.05,transport:.92,defense:1,chance:2,description:'吴线第一要地，首次占领获得2机缘。'},
    {id:'wuchang',name:'武昌',owner:'wu',x:66,y:68,front:'east',terrain:'江岸',troops:640,grain:840,income:{gold:80,grain:175},maintenance:20,recruit:1.1,transport:.92,defense:1,chance:2,description:'吴线中枢，首次占领获得2机缘。'},
    {id:'jianye',name:'建业',owner:'wu',x:89,y:62,front:'east',terrain:'坚城',troops:840,grain:1040,income:{gold:120,grain:200},maintenance:25,recruit:1.15,transport:1,defense:1,chance:3,description:'吴都，首次占领获得3机缘；吴无任何领土后永久灭国。'}
  ];
  const roads=[['hanzhong','chencang'],['chencang','changan'],['changan','tongguan'],['tongguan','luoyang'],['hanzhong','wudu'],['wudu','longyou'],['longyou','changan'],['yongan','jiangling'],['jiangling','wuchang'],['wuchang','jianye'],['hanzhong','yongan']];
  for(const r of regions)r.neighbors=roads.filter(e=>e.includes(r.id)).map(e=>e[0]===r.id?e[1]:e[0]);
  const equipment=[
    {id:'feather_fan',name:'羽扇',kind:'personal',description:'谋略+8，统兵+4。',effects:{strategy:8,command:4}},
    {id:'crane_cloak',name:'鹤氅',kind:'personal',description:'每回合当前健康劳损减少1；不能阻止寿命上限衰减。',effects:{strainReduction:1}},
    {id:'campaign_notes',name:'行军札记',kind:'personal',description:'统兵+10，治政+4。',effects:{command:10,governance:4}},
    {id:'wooden_ox',name:'木牛流马',kind:'military',description:'行军与战斗粮耗减少18%。',effects:{transport:.18}},
    {id:'farm_register',name:'屯田簿',kind:'military',description:'筹粮指令产出增加25%，内政地区粮产增加10%。',effects:{gather:.25,incomeGrain:.1}},
    {id:'muster_register',name:'军籍簿',kind:'military',description:'募兵指令人数增加25%。',effects:{recruit:.25}},
    {id:'supply_map',name:'粮道图',kind:'military',description:'截粮指令对敌军粮的效果增加15%。',effects:{cutSupply:.15}}
  ];
  const events={
    pools:{domestic:[{id:'supplies',weight:3},{id:'support',weight:2},{id:'fatigue',weight:2},{id:'opportunity',weight:1},{id:'routine',weight:3},{id:'diplomacy',weight:2}],march:[{id:'supplies',weight:1},{id:'fatigue',weight:1}],battle:[{id:'tactical',weight:6},{id:'supplies',weight:2},{id:'fatigue',weight:1},{id:'support',weight:1}]},
    finiteOpportunities:['opportunity_1','opportunity_2'],probability:{base:.48,strategyPerPoint:.002,max:.85,boldPenalty:.18},
    definitions:{
      diplomacy:{title:'吴蜀物资约定',text:'此事只改变关系与资源，不自动签订或解除盟约。吴关系不会每回合自行下降。',choices:[
        {id:'safe',label:'履行约定',description:'军粮-40，吴关系+8，朝廷支持+2。',success:{grain:-40,wuRelation:8,factions:{court:2}}},
        {id:'balanced',label:'各顾当前',description:'军粮+35，吴关系-5。',success:{grain:35,wuRelation:-5}},
        {id:'bold',label:'优先本军',description:'军粮+100，吴关系-15，士族支持+2。',success:{grain:100,wuRelation:-15,factions:{gentry:2}}}
      ]},
      tactical:{title:'战场变数',text:'基础战术照常执行，再选择如何应对本回合的局部战机。',choices:[
        {id:'safe',label:'依令推进',description:'额外削减敌兵15，保持原定损耗。',success:{enemyTroops:-15}},
        {id:'balanced',label:'协同突击',description:'成功率约{probability}%；成功多削减敌兵60、敌粮45，失败增加兵损35。',probability:'skill',success:{enemyTroops:-60,enemyGrain:-45},failure:{troops:-35}},
        {id:'bold',label:'争取战机',description:'成功多削减敌兵135、敌粮110；失败损失兵力85、军粮60、当前健康2。',probability:'boldSkill',success:{enemyTroops:-135,enemyGrain:-110},failure:{troops:-85,grain:-60,health:-2}}
      ]},
      supplies:{title:'军需查验',text:'物资调度出现少量偏差，可稳妥核定，也可尝试扩大调配。',choices:[
        {id:'safe',label:'按册验收',description:'获得军粮20。',success:{grain:20}},
        {id:'balanced',label:'协调调配',description:'成功率约{probability}%；成功军粮+90，失败军粮-45。',probability:'skill',success:{grain:90},failure:{grain:-45}},
        {id:'bold',label:'扩大调配',description:'成功军粮+165，失败军粮-100、当前健康-1。',probability:'boldSkill',success:{grain:165},failure:{grain:-100,health:-1}}
      ]},
      support:{title:'各方诉求',text:'本回合的组织工作需要作出取舍；支持度影响效率，但归零不直接判败。',choices:[
        {id:'safe',label:'安抚地方',description:'民心+3、士族+2。',success:{factions:{people:3,gentry:2}}},
        {id:'balanced',label:'优先前线',description:'将士+5、士族-2。',success:{factions:{army:5,gentry:-2}}},
        {id:'bold',label:'整顿公务',description:'朝廷+5、军粮+70、士族-4。',success:{factions:{court:5,gentry:-4},grain:70}}
      ]},
      fatigue:{title:'案牍与劳损',text:'选择本回合的工作节奏。所有选项仍会承受寿命上限减少2。',choices:[
        {id:'safe',label:'量力安排',description:'减轻当前健康劳损1。',success:{health:1}},
        {id:'balanced',label:'照常办理',description:'获得军粮45。',success:{grain:45}},
        {id:'bold',label:'加紧调度',description:'当前健康-2，获得军粮110。',success:{health:-2,grain:110}}
      ]},
      opportunity:{title:'一次性机缘',text:'本局有限的额外机缘；本次处理后不会再次出现同一机会。',choices:[
        {id:'safe',label:'留作机缘',description:'机缘+1，稍后可用于健康或能力。',success:{chance:1}},
        {id:'balanced',label:'调养当下',description:'当前健康恢复6，不增加寿命上限。',success:{health:6}},
        {id:'bold',label:'整理所得',description:'治政永久+3。',success:{stats:{governance:3}}}
      ]},
      routine:{title:'调度回报',text:'本回合常规工作有少量余裕。',choices:[
        {id:'safe',label:'顾全军心',description:'将士+2。',success:{factions:{army:2}}},
        {id:'balanced',label:'补充军需',description:'军粮+35。',success:{grain:35}},
        {id:'bold',label:'整理账目',description:'国库+30、民心-1。',success:{gold:30,factions:{people:-1}}}
      ]}
    }
  };
  const config={version:1,title:'丞相北伐模拟器',regions,roads,internalRoad:['hanzhong','yongan'],equipment,events,
    difficulties:{easy:{label:'简单',enemyMultiplier:.94,supplyCostMultiplier:1,battleLossMultiplier:1},normal:{label:'普通',enemyMultiplier:1,supplyCostMultiplier:3.19,battleLossMultiplier:1},hard:{label:'困难',enemyMultiplier:1.2,supplyCostMultiplier:3.48,battleLossMultiplier:1}},
    initial:{health:80,maxHealth:100,troops:1250,grain:2100,gold:600,chance:0,stats:{command:90,strategy:95,governance:95},factions:{court:65,army:65,gentry:60,people:65},equipped:['feather_fan','crane_cloak','wooden_ox','farm_register']},
    costs:{recruitGold:130,developGold:120,restGold:35,envoyGold:110,peaceGold:210,allianceGold:150,marchGrain:180,crossFrontGrain:90,retreatGrain:110,retreatTroops:55},
    actions:{gatherGrain:350,recruitTroops:280,developGrain:35,developGold:20,restRecovery:3,aidGrain:600,aidTroops:330},
    battle:{assaultDamage:255,assaultCommand:.75,assaultLoss:74,cutDamage:225,cutStrategy:.9,cutLoss:42,steadyDamage:165,steadyGrainDamage:105,steadyLoss:42,grainCost:140,enemyGrainCost:65,enemyAttack:28,reinforceRound:3,reinforceTroops:65,reinforceGrain:80},
    health:{maxDecay:2,domesticStrain:2,marchStrain:2,battleStrain:3,retreatStrain:2,chanceHeal:6,chanceStat:5},
    invasion:{weiProbability:.12,wuProbability:.12,initialProtectedDomesticTurns:2,defenseCooldown:2,truceTurns:3,troopFraction:.58,grainFraction:.62},
    recovery:{troopsFraction:.06,grainFraction:.08},limits:{stat:120,resources:1000000,log:500,saveBytes:2000000}}
  ;
  function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const v of Object.values(value))freeze(v);}return value;}
  return freeze(config);
});
