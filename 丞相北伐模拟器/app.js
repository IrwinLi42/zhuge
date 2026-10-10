/* Browser presentation only. All game rules and legal actions come from BeifaEngine. */
(() => {
  'use strict';
  const STORAGE_KEY = 'beifa.system.v1';
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const labels = {health:'健康',maxHealth:'健康上限',troops:'兵力',grain:'粮食',gold:'国库',chance:'机缘',command:'统兵',strategy:'谋略',governance:'治政',court:'朝廷',army:'将士',gentry:'士族',people:'民心',strainReduction:'劳损减免',transport:'转运减耗',gather:'筹粮加成',incomeGrain:'粮产加成',recruit:'募兵加成',cutSupply:'截粮加成'};
  const ownerNames = {shu:'蜀汉',wei:'曹魏',wu:'东吴'};
  const phaseNames = {domestic:'内政',battle:'战役',march:'行军',retreat:'撤军',victory:'北伐主胜',ended:'此局已定',ending:'此局已定'};
  const wuNames = {allied:'盟约',war:'交战',truce:'停战',eliminated:'已灭国'};
  let game = null, view = null, selectedDifficulty = 'normal', selectedRegion = 'hanzhong', toastTimer, busy = false, endingShown = '', confirmAction = null;
  const number = x => Number.isFinite(Number(x)) ? Number(x) : 0;
  const fmt = x => new Intl.NumberFormat('zh-CN',{maximumFractionDigits:1}).format(number(x));
  const factor = x => new Intl.NumberFormat('zh-CN',{maximumFractionDigits:3}).format(number(x));
  const percent = (value,total) => Math.max(0,Math.min(100,number(value)/Math.max(1,number(total))*100));
  function el(tag,text,cls) {const element=document.createElement(tag);if(text!==undefined&&text!==null)element.textContent=String(text);if(cls)element.className=cls;return element;}
  function svgEl(tag,attrs={}) {const element=document.createElementNS(NS,tag);for(const [key,value] of Object.entries(attrs))element.setAttribute(key,String(value));return element;}
  function text(id,value) {if($(id))$(id).textContent=value??'';}
  function show(id,visible=true) {if($(id))$(id).hidden=!visible;}
  function clear(id) {const element=typeof id==='string'?$(id):id;element?.replaceChildren();return element;}
  function listen(id,event,handler) {$(id)?.addEventListener(event,handler);}
  function toast(message,error=false) {text('toast',message);$('toast').classList.toggle('error',error);$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3800);}
  function safe(fn) {return (...args)=>{try{const result=fn(...args);if(result?.catch)result.catch(error=>toast(error.message||'操作未完成',true));return result;}catch(error){console.error(error);toast(error.message||'操作未完成',true);}};}
  function stored() {try{return localStorage.getItem(STORAGE_KEY);}catch{return null;}}
  function autosave(announce=false) {
    if(!game)return;
    try{localStorage.setItem(STORAGE_KEY,game.serialize());text('autosave-status','已自动存档 · 本机');if(announce)toast('当前征程已保存');}
    catch(error){text('autosave-status','存储不可用，请导出存档');if(announce)toast('浏览器无法保存，请导出存档文件',true);}
    refreshContinue();
  }
  function refreshContinue() {show('continue-game',Boolean(stored()));}
  function openDialog(id) {const d=$(id);if(d&&!d.open)d.showModal();}
  function closeDialog(id) {$(id)?.close();}
  function closeDialogs() {for(const d of document.querySelectorAll('dialog[open]'))d.close();}
  function confirm(message,action,title='另启一局') {confirmAction=action;text('confirm-title',title);text('confirm-text',message);openDialog('confirm-dialog');$('confirm-cancel').focus();}
  function showGame() {show('start-screen',false);show('app');$('app').inert=false;window.scrollTo({top:0,behavior:'instant'});}
  function showStart() {autosave();closeDialogs();show('start-screen');show('app',false);$('app').inert=true;refreshContinue();window.scrollTo({top:0,behavior:'instant'});$('start-game').focus({preventScroll:true});}
  function newGame() {
    if(typeof window.BeifaEngine!=='function')throw new Error('游戏文件尚未加载完整，请保留 config.js、engine.js 和 app.js 后重新打开。');
    const raw=$('seed-input').value.trim();let seed;
    if(raw){seed=Number(raw);if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw new Error('种子须为 0 到 4294967295 的整数');}
    else seed=(Date.now()^Math.floor(Math.random()*4294967295))>>>0;
    game=new window.BeifaEngine({difficulty:selectedDifficulty,seed});selectedRegion='hanzhong';endingShown='';show('result-strip',false);showGame();render();autosave();$('command-heading').focus({preventScroll:true});
  }
  function restore(raw) {
    const candidate=window.BeifaEngine.deserialize(raw);
    if(game)try{localStorage.setItem(STORAGE_KEY+'.backup',game.serialize());}catch{}
    game=candidate;endingShown='';show('result-strip',false);showGame();render();autosave();toast('征程已恢复，待选事件保持不变');
  }
  function mutate(operation,{result=false}={}) {
    if(busy||!game)return;
    busy=true;let before,after;
    try {before=game.getView();operation();after=game.getView();autosave();}
    finally {busy=false;}
    render();if(result)renderResult(before,after);
  }
  function act(action) {mutate(()=>game.act(action));if(view?.event)$('event-title').focus({preventScroll:true});$('command-heading').scrollIntoView({behavior:'smooth',block:'nearest'});}
  function choose(id) {mutate(()=>game.choose(id),{result:true});if(!view?.state?.ending&&view?.state?.phase!=='victory')$('command-heading').focus({preventScroll:true});}
  function deltaChips(container,delta) {
    container.replaceChildren();
    for(const [key,value] of Object.entries(delta||{}))if(typeof value==='number'&&value){container.append(el('span',(labels[key]||key)+' '+(value>0?'+':'')+fmt(value),'effect-chip '+(value>0?'positive':'negative')));}
  }
  function renderResult(before,after) {
    const a=before.state?.player||{},b=after.state?.player||{},delta={};
    for(const key of ['health','maxHealth','troops','grain','gold','chance'])if(number(a[key])!==number(b[key]))delta[key]=number(b[key])-number(a[key]);
    for(const key of ['command','strategy','governance'])if(number(a.stats?.[key])!==number(b.stats?.[key]))delta[key]=number(b.stats?.[key])-number(a.stats?.[key]);
    const entry=(after.state?.log||[]).at(-1);
    text('result-message',entry?.text||entry?.title||'此回合已记入军记。');deltaChips($('result-effects'),delta);show('result-strip');
  }
  function regionById(id) {return (view?.regions||[]).find(region=>region.id===id);}
  function orderLabel(action) {
    if(!action)return '';
    if(action.type==='attack')return '出征'+(regionById(action.regionId)?.name||'目标地区');
    if(action.type==='yield')return '让出'+(regionById(view.state.warning?.targetId)?.name||'被袭地区');
    if(action.type==='aid')return action.resource==='grain'?'请求吴军粮':'请求吴兵力';
    return {gather:'筹粮',recruit:'募兵',develop:'营建',rest:'休整',envoy:'遣使东吴',peace:'与吴议和',alliance:'修复吴盟',assault:'强攻',cutSupply:'截粮',steady:'稳进',retreat:view.state.battle?.type==='defense'?'撤退让城':'主动撤军'}[action.type]||'本回合指令';
  }
  function actionButton(descriptor,compact=false) {
    const button=el('button',null,'action-card'+(['retreat','concede','yield'].includes(descriptor.action?.type)?' danger':''));button.type='button';button.disabled=!descriptor.allowed||busy;
    button.dataset.actionId=descriptor.id||'';button.append(el('strong',descriptor.label||'执行指令'));
    if(descriptor.description)button.append(el('span',descriptor.description));
    if(!descriptor.allowed&&descriptor.reason)button.append(el('span',descriptor.reason,'action-reason'));
    const preview=descriptor.preview;
    if(typeof preview==='string')button.append(el('span',preview,'action-preview'));
    else if(preview&&typeof preview==='object'){const parts=[];for(const [k,v]of Object.entries(preview))if(typeof v==='number'&&labels[k])parts.push(labels[k]+' '+(v>0?'+':'')+fmt(v));if(parts.length)button.append(el('span',parts.join(' · '),'action-preview'));}
    const tactical=view?.battlePreview?.[descriptor.action?.type];
    if(tactical){
      button.append(el('span','本军预计消耗：兵力 '+fmt(tactical.troops)+' · 军粮 '+fmt(tactical.grain)+'；事件另计。','action-preview'));
      const risks=[];
      if(tactical.troops>=view.state.player.troops)risks.push('预计兵损可能耗尽现有兵力');
      if(tactical.grain>=view.state.player.grain)risks.push('预计粮耗可能耗尽现有军粮');
      if(risks.length){button.classList.add('has-resource-risk');button.append(el('span','资源风险：'+risks.join('；')+'。事件可能改变最终结果。','resource-risk'));}
    }
    button.addEventListener('click',safe(()=>act(descriptor.action)));return button;
  }
  function renderStatus() {
    const state=view.state,p=state.player,stats=view.stats||p.stats,economy=view.economy||{};
    text('turn-label','第 '+fmt(state.turn)+' 回合');text('phase-label',state.ending?'此局已定':phaseNames[state.phase]||(state.battle?'战役':'内政'));
    text('difficulty-label',window.BEIFA_CONFIG?.difficulties?.[state.difficulty]?.label||({easy:'简单',normal:'普通',hard:'困难'}[state.difficulty]));
    text('health-value',fmt(p.health));text('health-cap',fmt(p.maxHealth));text('chance-value',fmt(p.chance));
    $('health-fill').style.width=percent(p.health,100)+'%';$('health-cap-fill').style.width=percent(p.maxHealth,100)+'%';$('health-fill').classList.toggle('is-low',p.health<=20);
    text('health-remaining','上限余 '+Math.ceil(number(p.maxHealth)/2)+' 回合');
    const chanceActions=view.chanceActions||[];
    const abilities=clear('ability-list');
    for(const key of ['command','strategy','governance']) {
      const row=el('div',null,'ability-row'),values=el('span',null,'ability-values');values.append(el('small',fmt(p.stats?.[key])),el('span',fmt(stats[key])));
      const action=chanceActions.find(a=>a.key===key),button=el('button','＋');button.type='button';button.title=action?.reason||'消耗 1 机缘，永久提升'+labels[key]+' 5';button.setAttribute('aria-label','用机缘提升'+labels[key]);button.disabled=action?action.allowed!==true:!p.chance||!!view.event||!!state.ending||state.phase==='victory';
      button.addEventListener('click',safe(()=>{mutate(()=>game.spendChance(key));toast(labels[key]+'已精进');}));row.append(el('span',labels[key]),values,button);abilities.append(row);
    }
    const healthAction=chanceActions.find(a=>a.key==='health');$('chance-health').disabled=healthAction?healthAction.allowed!==true:!p.chance||p.health>=p.maxHealth||!!view.event||!!state.ending||state.phase==='victory';$('chance-health').title=healthAction?.reason||'消耗 1 机缘，恢复当前健康 6，上限不变';
    const supports=clear('support-list');for(const key of ['court','army','gentry','people']){const row=el('div',null,'support-row'+(number(p.factions?.[key])<25?' is-low':''));row.append(el('span',labels[key]),el('strong',fmt(p.factions?.[key])));supports.append(row);}
    for(const key of ['troops','grain','gold']){text(key+'-value',fmt(p[key]));const value=economy[key];text(key+'-income',typeof value==='number'?(value===0?'常规收入 —':(value>0?'+':'')+fmt(value)+' / 内政回合'):'');}
    const owned=view.regions.filter(r=>r.owner==='shu');text('ownership-count','已控 '+owned.length+' / '+view.regions.length);
    for(const id of ['changan','luoyang'])$('goal-'+id).classList.toggle('held',regionById(id)?.owner==='shu');
    text('connected-summary',(view.connected||[]).length+' 处与汉中连通');
    const location=state.armyRegionId||state.armyLocation||state.location||state.armyAt;
    text('army-location',location&&regionById(location)?'驻军 · '+regionById(location).name:'一军两线 · 兵粮共用');
    text('save-description','第 '+state.turn+' 回合 · '+(window.BEIFA_CONFIG?.difficulties?.[state.difficulty]?.label||'')+' · 种子 '+state.seed);
  }
  function renderMap() {
    const svg=clear('strategy-map'),regions=view.regions;
    const backdrop=svgEl('g',{'aria-hidden':'true'});
    const contours=['M-25 175Q85 95 162 186T340 122T500 166','M-20 184Q85 106 162 194T340 134T498 178','M-18 193Q85 118 162 204T340 148T497 190','M-15 203Q85 130 162 215T340 159T495 201','M70 350Q154 264 227 345T413 292T630 335T840 265','M67 362Q150 276 224 356T413 304T630 347T840 277'];
    for(const d of contours)backdrop.append(svgEl('path',{d,class:'map-contour'}));
    const river='M90 410Q150 365 240 373T400 359T570 332T770 316';backdrop.append(svgEl('path',{d:river,class:'map-river'}),svgEl('path',{d:river,class:'map-river-inner'}));
    svg.append(backdrop);
    const position=region=>({x:44+number(region.x)*7.15,y:33+number(region.y)*4.55});
    const edges=new Set(),edgeLayer=svgEl('g',{'aria-hidden':'true'});
    for(const region of regions)for(const neighborId of region.neighbors||[]) {
      const other=regions.find(r=>r.id===neighborId);if(!other)continue;
      const key=[region.id,neighborId].sort().join('|');if(edges.has(key))continue;edges.add(key);
      const a=position(region),b=position(other),internal=key===['hanzhong','yongan'].sort().join('|');
      edgeLayer.append(svgEl('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:'map-route'+(region.owner==='shu'&&other.owner==='shu'?' friendly':'')+(internal?' interior':'')}));
      if(internal){const label=svgEl('text',{x:(a.x+b.x)/2-19,y:(a.y+b.y)/2+4,class:'map-route-label',transform:'rotate(63 '+((a.x+b.x)/2-19)+' '+((a.y+b.y)/2+4)+')'});label.textContent='蜀中内线';edgeLayer.append(label);}
    }
    svg.append(edgeLayer);
    for(const region of regions) {
      const point=position(region),disconnected=region.owner==='shu'&&!region.connected;
      const group=svgEl('g',{class:'map-node '+region.owner+(region.id===selectedRegion?' selected':'')+(region.attackable?' attackable':'')+(disconnected?' disconnected':''),tabindex:0,role:'button','aria-label':region.name+'，'+(ownerNames[region.owner]||region.owner)+(disconnected?'，与汉中断联':''),'aria-pressed':String(region.id===selectedRegion),'data-region-id':region.id});
      group.append(svgEl('circle',{cx:point.x,cy:point.y,r:42,class:'node-hit'}),svgEl('circle',{cx:point.x,cy:point.y,r:21,class:'node-halo'}),svgEl('circle',{cx:point.x,cy:point.y,r:12,class:'node-core'}));
      if(['hanzhong','changan','luoyang','jianye'].includes(region.id)){const symbol=svgEl('text',{x:point.x,y:point.y+3,class:'node-symbol'});symbol.textContent=region.id==='hanzhong'?'本':'◆';group.append(symbol);}
      const name=svgEl('text',{x:point.x,y:point.y+33});name.textContent=region.name;group.append(name);
      const status=svgEl('text',{x:point.x,y:point.y+48,class:'node-status'});status.textContent=disconnected?'断联':region.owner==='shu'?'已控':region.terrain||'';group.append(status);
      group.addEventListener('click',()=>selectRegion(region.id));group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectRegion(region.id);}});svg.append(group);
    }
    if(!regions.some(r=>r.id===selectedRegion))selectedRegion=regions[0]?.id;renderRegion();
  }
  function selectRegion(id) {selectedRegion=id;for(const node of $('strategy-map').querySelectorAll('.map-node')){const selected=node.dataset.regionId===id;node.classList.toggle('selected',selected);node.setAttribute('aria-pressed',String(selected));}renderRegion();}
  function fact(container,label,value) {const item=el('span',label);item.append(el('strong',value));container.append(item);}
  function renderRegion() {
    const region=regionById(selectedRegion);if(!region)return;
    text('region-name',region.name);text('region-owner',ownerNames[region.owner]||region.owner);$('region-owner').className='region-owner '+region.owner;
    text('region-description',region.description||'');const facts=clear('region-facts');
    if(region.owner!=='shu'){fact(facts,'守军',fmt(region.troops));fact(facts,'军粮',fmt(region.grain));}
    else fact(facts,'转运',region.connected?'与汉中连通':'断联，暂停收益');
    if(region.terrain)fact(facts,'地势',region.terrain);
    if(region.income){if(region.income.grain!==undefined)fact(facts,'粮产',fmt(region.income.grain));if(region.income.gold!==undefined)fact(facts,'财赋',fmt(region.income.gold));}
    if(region.maintenance!==undefined)fact(facts,'守备维护',fmt(region.maintenance));
    fact(facts,'募兵效能','×'+factor(region.recruit??1));fact(facts,'运输效率',fmt((region.transport??1)*100)+'%');
    const actions=clear('region-actions');
    const matching=(view.actions||[]).filter(a=>a.action?.regionId===region.id);
    for(const action of matching)actions.append(actionButton(action,true));
    if(!matching.length&&region.owner!=='shu')actions.append(el('p',view.event?'先处理当前事件，再选择进军方向。':view.state.battle?'当前战役结束后，再选择新的目标。':'需经己方连通地区抵达相邻前线，方可出征。','muted-note'));
  }
  function renderBattle() {
    const battle=view.state.battle,p=view.state.player;show('battle-panel',Boolean(battle));if(!battle)return;
    const enemy=battle.enemy||{};text('battle-type',battle.type==='defense'?'防守':'进攻');text('battle-name',regionById(battle.regionId)?.name||'当前战区');text('battle-round','第 '+(number(battle.round)+1)+' 轮');
    text('our-battle-troops',fmt(p.troops));text('our-battle-grain',fmt(p.grain));text('enemy-battle-troops',fmt(enemy.troops));text('enemy-battle-grain',fmt(enemy.grain));
    $('our-troops-fill').style.width=percent(p.troops,battle.playerStartTroops||battle.startTroops||Math.max(p.troops,window.BEIFA_CONFIG?.initial?.troops||1250))+'%';
    $('our-grain-fill').style.width=percent(p.grain,battle.playerStartGrain||battle.startGrain||Math.max(p.grain,window.BEIFA_CONFIG?.initial?.grain||2100))+'%';
    $('enemy-troops-fill').style.width=percent(enemy.troops,enemy.maxTroops)+'%';$('enemy-grain-fill').style.width=percent(enemy.grain,enemy.maxGrain)+'%';
    text('battle-rule',battle.type==='defense'?'敌兵或敌粮归零即击退入侵；防守撤退将让出此地。':'敌兵或敌粮归零即占领；撤退保留剩余兵粮，目标归属不变。');
  }
  function renderCommands() {
    const state=view.state,event=view.event,terminal=Boolean(state.ending)||state.phase==='victory';
    text('command-heading',event?'此刻决断':state.battle?'临阵指挥':state.warning?'备战迎敌':terminal?'此局已定':'案前筹划');
    text('command-kicker',state.battle?'战阵':state.warning?'急务':'决断');text('command-meta',event?'选择后结算 1 回合':state.battle?'兵粮共用 · 可撤军':'一次指令，一次事件');
    text('event-order',event?'当前指令 · '+orderLabel(state.pendingEvent?.action):'');
    show('event-panel',Boolean(event));show('orders-panel',!event);renderBattle();
    if(event){text('event-title',event.title||'本回合事件');const body=clear('event-text');String(event.text||'').split(/\n+/).filter(Boolean).forEach(line=>body.append(el('p',line)));const choices=clear('event-choices');
      for(const choice of event.choices||[]){const button=el('button',null,'event-choice');button.type='button';button.dataset.choiceId=choice.id;button.disabled=choice.allowed===false;button.append(el('strong',choice.label||'继续'));if(choice.description)button.append(el('span',choice.description));if(typeof choice.probability==='number'&&choice.probability<1&&!String(choice.description).includes('成功率'))button.append(el('span','成功率约 '+fmt(choice.probability*100)+'%','choice-probability'));if(choice.allowed===false&&choice.reason)button.append(el('span',choice.reason));button.addEventListener('click',safe(()=>choose(choice.id)));choices.append(button);}
    }
    const list=clear('action-list');
    if(terminal){text('command-intro',state.phase==='victory'?'长安与洛阳已在掌握，可就此结束，或继续全图征服。':'打开战局结论，回顾本局成果。');const button=el('button','查看战局结论','secondary-button');button.type='button';button.addEventListener('click',()=>openDialog('ending-dialog'));list.append(button);}
    else {text('command-intro',state.battle?'选择战术，兼顾敌方兵粮与自己的余力。':state.warning?'入侵已至。完成一个准备回合后进入防守，也可以付出代价让地。':'先整备军需，或在地图上选择进军方向。');
      const actions=(view.actions||[]).filter(a=>state.battle||state.warning||!a.action?.regionId);for(const action of actions)list.append(actionButton(action));
      if(!actions.length&&!event)list.append(el('p','请在地图上选择一个可进军的地区。','empty-note'));
    }
  }
  function renderWarning() {
    const warning=view.state.warning;show('warning-panel',Boolean(warning));if(!warning)return;
    const source=regionById(warning.sourceId),target=regionById(warning.targetId),enemy=warning.enemy||{};
    text('warning-title',(ownerNames[warning.faction]||'敌军')+'入侵预警');text('warning-text',(source?.name||'敌境')+' → '+(target?.name||'边境')+'。'+(target?.connected?'可用一个内政回合准备迎击。':'目标与汉中断联，无法迎击，只能让地。'));
    text('warning-resources','敌兵 '+fmt(enemy.troops)+' · 敌粮 '+fmt(enemy.grain)+(warning.targetId==='hanzhong'?' · 让出汉中将结束本局。':' · 退守将失去目标地区及其后续收入。'));
    const actions=clear('warning-actions');for(const action of (view.actions||[]).filter(a=>['concede','abandon','yield','retreat'].includes(a.action?.type)))actions.append(actionButton(action,true));
  }
  function renderWu() {
    const wu=view.state.wu||{},status=wu.state||wu.status||'allied';text('wu-state',wuNames[status]||'东吴');$('wu-state').className='relation-badge '+status;text('wu-relation-value',fmt(wu.relation));$('wu-relation-fill').style.width=percent(wu.relation,100)+'%';text('wu-relation-label',status==='eliminated'?'吴方已无控制地区':'双方关系');
    let note=status==='allied'?'关系稳固时可争取一次援助；关系不足 60 会增加吴方入侵风险。':status==='war'?'双方交战，可主动攻吴；无待处理入侵时也可议和。':status==='truce'?'停战期间吴方不入侵，恢复盟约需要再次遣使。':'吴方已无领土，本局不再复国。';
    const left=wu.truceRemaining??wu.truceTurns??wu.truceRemainingDomesticTurns;if(status==='truce'&&left!==undefined)note='停战剩余 '+left+' 个内政回合。'+note;
    if(wu.aidUsed)note+=' 本局援助已使用。';text('wu-note',note);
  }
  function effectSummary(effects) {return Object.entries(effects||{}).filter(([,v])=>typeof v==='number'&&v).map(([key,value])=>(labels[key]||key)+' '+(value>0?'+':'')+(Math.abs(value)>0&&Math.abs(value)<1?fmt(value*100)+'%':fmt(value))).join(' · ');}
  function renderEquipment() {
    const equipment=view.equipment||{},canChange=equipment.canChange??(!view.event&&!view.state.ending&&view.state.phase!=='victory'),slots=equipment.slots||[],items=equipment.items||[];
    const slotContainer=clear('equipment-slots');
    for(const slot of slots){const card=el('div',null,'equipment-slot'+(slot.itemId?' filled':''));card.dataset.slotIndex=slot.index;card.dataset.itemId=slot.itemId||'';const kind=slot.kind||((slot.index??0)<2?'personal':'military');card.append(el('span',(kind==='personal'?'个人':'军政')+'栏位 '+((slot.index??0)%2+1)),el('strong',slot.item?.name||items.find(i=>i.id===slot.itemId)?.name||'尚未装配'));
      if(slot.itemId){const button=el('button','卸下');button.type='button';button.disabled=!canChange;button.addEventListener('click',safe(()=>mutate(()=>game.unequip(slot.index))));card.append(button);}slotContainer.append(card);}
    text('inventory-count',items.length+' 件');const list=clear('inventory-list');
    for(const item of items){const card=el('article',null,'inventory-item');card.dataset.itemId=item.id;card.append(el('h3',item.name||item.id),el('p',item.description||''));const summary=effectSummary(item.effects);if(summary)card.append(el('div',summary,'item-effects'));
      if(item.equipped){card.append(el('span','已装配于第 '+(number(item.slot)+1)+' 栏','equipped-label'));}
      else {const controls=el('div',null,'inventory-controls'),select=el('select');select.setAttribute('aria-label','为'+(item.name||item.id)+'选择栏位');const kind=item.kind||window.BEIFA_CONFIG?.equipment?.find(i=>i.id===item.id)?.kind;
        const availableSlots=slots.filter(s=>!kind||s.kind===kind);for(const slot of availableSlots){const option=el('option',(slot.kind==='personal'?'个人':'军政')+' '+(slot.index%2+1)+(slot.itemId?' · 替换 '+(slot.item?.name||'已装物品'):' · 空位'));option.value=slot.index;select.append(option);}const empty=availableSlots.find(s=>!s.itemId);if(empty)select.value=empty.index;
        const button=el('button','装配');button.type='button';button.disabled=!canChange||!availableSlots.length;select.disabled=button.disabled;button.addEventListener('click',safe(()=>mutate(()=>game.equip(item.id,Number(select.value)))));controls.append(select,button);card.append(controls);}
      list.append(card);
    }
    if(!items.length)list.append(el('p','行囊尚空。','empty-note'));
  }
  function renderLogs() {
    const list=clear('log-list'),logs=[...(view.state.log||[])].reverse();
    if(!logs.length){list.append(el('p','征程将从第一项指令开始。','empty-note'));return;}
    for(const entry of logs.slice(0,200)){const row=el('article',null,'log-entry');row.append(el('small','第 '+fmt(entry.turn)+' 回合'),el('h3',entry.title||'军务记录'));if(entry.text)row.append(el('p',entry.text));if(entry.delta){const effects=el('div',null,'effect-list');deltaChips(effects,entry.delta);row.append(effects);}list.append(row);}
  }
  function renderTerritory() {
    const list=clear('territory-list'),owned=view.regions.filter(r=>r.owner==='shu');
    for(const region of owned){const row=el('article',null,'territory-row'),name=el('div'),content=el('div');name.append(el('h3',region.name),el('p',region.connected?'与汉中连通':'断联，暂停贡献'));const facts=el('div',null,'region-facts');for(const [key,value]of Object.entries(region.income||{}))if(typeof value==='number')fact(facts,labels[key]||key,fmt(value));if(region.maintenance!==undefined)fact(facts,'守备维护',fmt(region.maintenance));fact(facts,'募兵效能','×'+factor(region.recruit??1));fact(facts,'运输效率',fmt((region.transport??1)*100)+'%');content.append(facts);if(region.description)content.append(el('p',region.description));row.append(name,content);list.append(row);}
    if(!owned.length)list.append(el('p','当前没有控制的地区。','empty-note'));
  }
  function renderEnding() {
    const state=view.state,ending=state.ending,paused=state.phase==='victory';if(!ending&&!paused)return;
    const key=JSON.stringify([state.turn,state.phase,ending?.type,ending?.reason]);
    const failure=ending?.type==='defeat',full=ending?.type==='full'||state.fullVictory;
    text('ending-seal',failure?'止':full?'定':'捷');text('ending-kicker',failure?'此局止于此':full?'山河一统':'北伐主胜');
    text('ending-title',ending?.title||(full?'全境归汉':'两京在握'));
    text('ending-text',ending?.text||(paused?'长安与洛阳已同时归蜀。可以结束本局，或继续征服全部战区。':'这段征程已记入军记。'));
    const summary=clear('ending-summary');for(const [label,value]of [['回合',state.turn],['已控地区',view.regions.filter(r=>r.owner==='shu').length],['健康',state.player.health]]){const item=el('span',label);item.append(el('strong',fmt(value)));summary.append(item);}
    const actions=clear('ending-actions');
    if(paused&&!ending){const next=el('button','继续，争取全图','primary-button');next.type='button';next.addEventListener('click',safe(()=>{closeDialog('ending-dialog');mutate(()=>game.continueCampaign());toast('继续征程，主胜记录已经保留');}));const finish=el('button','就此封卷，保留主胜','secondary-button');finish.type='button';finish.addEventListener('click',safe(()=>{closeDialog('ending-dialog');mutate(()=>game.finishCampaign());}));actions.append(next,finish);}
    else {const restart=el('button','再启一局','primary-button');restart.type='button';restart.addEventListener('click',showStart);actions.append(restart);}
    const exportButton=el('button','导出本局存档','text-button');exportButton.type='button';exportButton.addEventListener('click',safe(exportSave));actions.append(exportButton);
    if(key!==endingShown){endingShown=key;closeDialogs();openDialog('ending-dialog');}
  }
  function render() {
    if(!game)return;view=game.getView();
    renderStatus();renderMap();renderWarning();renderCommands();renderWu();renderEquipment();renderLogs();renderTerritory();renderEnding();
    document.title=(view.state.battle?(regionById(view.state.battle.regionId)?.name||'战役')+' · ':'')+'丞相北伐模拟器';
  }
  function exportSave() {
    if(!game)throw new Error('请先开始一局游戏');
    const state=game.getView().state,url=URL.createObjectURL(new Blob([game.serialize()],{type:'application/json;charset=utf-8'})),link=el('a');
    link.href=url;link.download='丞相北伐_第'+state.turn+'回合_'+state.seed+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('存档文件已导出');
  }
  function initialize() {
    for(const button of document.querySelectorAll('[data-difficulty]')){
      const difficulty=window.BEIFA_CONFIG?.difficulties?.[button.dataset.difficulty]||{},description=button.querySelector('small');
      if(description){description.replaceChildren();for(const [key,label]of [['enemyMultiplier','敌军兵粮'],['supplyCostMultiplier','补给消耗'],['battleLossMultiplier','预计兵损']])description.append(el('span',label+' ×'+factor(difficulty[key]??1)));}
    }
    for(const button of document.querySelectorAll('[data-difficulty]'))button.addEventListener('click',()=>{selectedDifficulty=button.dataset.difficulty;for(const option of document.querySelectorAll('[data-difficulty]')){const active=option===button;option.setAttribute('aria-pressed',String(active));option.classList.toggle('selected',active);}});
    listen('start-game','click',safe(()=>{if(game||stored())confirm('新征程将替换当前自动存档。已导出的存档文件不受影响。',newGame);else newGame();}));
    listen('continue-game','click',safe(()=>{const raw=stored();if(!raw)throw new Error('当前浏览器没有可继续的存档');restore(raw);}));
    listen('chance-health','click',safe(()=>{mutate(()=>game.spendChance('health'));toast('已用机缘调养');}));
    listen('equipment-button','click',()=>openDialog('equipment-dialog'));listen('log-button','click',()=>openDialog('log-dialog'));listen('save-button','click',()=>openDialog('save-dialog'));listen('help-button','click',()=>openDialog('help-dialog'));listen('territory-button','click',()=>openDialog('territory-dialog'));
    for(const button of document.querySelectorAll('[data-close]'))button.addEventListener('click',()=>closeDialog(button.dataset.close));
    listen('save-now','click',()=>autosave(true));listen('export-save','click',safe(exportSave));
    for(const id of ['import-save','start-import'])listen(id,'click',()=>$('import-input').click());
    listen('import-input','change',safe(async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;if(file.size>2500000)throw new Error('存档文件过大，请选择本游戏导出的 JSON 存档。');const raw=await file.text();closeDialogs();restore(raw);}));
    listen('restart-button','click',showStart);listen('dismiss-result','click',()=>show('result-strip',false));
    listen('confirm-cancel','click',()=>{confirmAction=null;closeDialog('confirm-dialog');});listen('confirm-ok','click',safe(()=>{const action=confirmAction;confirmAction=null;closeDialog('confirm-dialog');action?.();}));
    listen('confirm-dialog','close',()=>{confirmAction=null;});
    window.addEventListener('beforeunload',()=>autosave());
    refreshContinue();
    if(typeof window.BeifaEngine!=='function'){text('start-note','游戏引擎尚未加载，请保持整个游戏文件夹完整后重新打开。');$('start-game').disabled=true;}
    window.BeifaWeb=Object.freeze({version:'1.0.0',getState:()=>game?game.getView().state:null,getView:()=>game?game.getView():null,storageKey:STORAGE_KEY});
  }
  initialize();
})();
