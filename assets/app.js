/* Official TEC snapshot: MOEA first; Ricoh follows certificate-holder priority. */
const SNAPSHOT_DATE = TEC_DATA.checkedAt;
const RICOH_SOURCE_POLICY = 'Ricoh 同型號優先採互盛有效節能標章，互盛沒有有效標章才採台灣理光；互盛實測 TEC 缺漏或衝突則列待核實，不自動改採其他來源。';
const TECH_LABEL = { EP: '雷射', HPIJ: '高效能噴墨', IJ: '噴墨' };
const DEFAULTS = {
  units: 1, price: 4, years: 5, cf: 0.466, goal: 30,
  baseTec: 1.6, baseName: '5 年傳統彩色雷射事務機・30 張/分（情境假設）',
  targetTec: 0, targetName: '', s: 20, ej1: 4, ej: 1.2, ef: 1, ps: 0.5
};
const S = { ...DEFAULTS };
let compare = [], primaryKey = null, baseKey = null, results = [], shown = 60;
let calcMode = 'single';
let fleetOld = [], fleetNew = [];
const keyOf = m => m.id;
const brandRank = () => 0;
const MASTER_MAP = new Map(TEC_DATA.models.map(m => [m.id, m]));
const PRESETS = [
  {id:'scenario-7c', model:'7 年傳統彩色雷射事務機（情境假設）', color:'Color', tec:2.2},
  {id:'scenario-5c', model:DEFAULTS.baseName, color:'Color', tec:1.6, speed:30},
  {id:'scenario-3c', model:'3 年傳統彩色雷射事務機（情境假設）', color:'Color', tec:0.8},
  {id:'scenario-7m', model:'7 年傳統黑白雷射事務機（情境假設）', color:'Monochrome', tec:1.8},
  {id:'scenario-5m', model:'5 年傳統黑白雷射事務機（情境假設）', color:'Monochrome', tec:1.1}
].map(m => ({...m, brand:'PRESET', source:'scenario', src:'人工情境假設，非官方實測', standard:null, speed:m.speed??null}));
const LEGACY_MODELS = { PRESET: PRESETS };
for (const m of MASTER_MAP.values()) (LEGACY_MODELS[m.brand] ||= []).push(m);
for (const [brand, models] of Object.entries(LEGACY_MODELS)) {
  if (brand !== 'PRESET') models.sort((a,b) => a.model.localeCompare(b.model, 'zh-TW') || a.id.localeCompare(b.id));
}
function findModel(id) { return MASTER_MAP.get(id) || PRESETS.find(m => m.id === id); }
function sourceName(m) {
  return m.source === 'moea' ? '經濟部能源署' : m.source === 'energystar' ? (m.archived ? 'ENERGY STAR（舊版認證資料）' : 'ENERGY STAR（備援）') : m.source === 'scenario' ? '情境假設' : '使用者自訂';
}
function companyText(m) {
  return m.source === 'moea' && m.company ? `獲證公司：${m.company}` : '';
}
function withValue(record, tec, name, units) {
  const row = {...record, model:name || record?.model || '自訂機型', tec, units};
  if (!record || Math.abs(record.tec - tec) > 1e-9) {
    row.reference = record;
    row.source = 'custom';
    row.sourceUrl = null;
    row.certificate = null;
    row.standard = null;
  }
  return row;
}
function currentRows() {
  if (calcMode === 'fleet') return {old:fleetOld, next:fleetNew};
  return {
    old:[withValue(findModel(baseKey), S.baseTec, S.baseName, S.units)],
    next:[withValue(MASTER_MAP.get(primaryKey), S.targetTec, S.targetName, S.units)]
  };
}
function calc(st) {
  return EnergyCalculator.calculate(st, [{tec:st.baseTec, units:st.units}], [{tec:st.targetTec, units:st.units}]);
}
function calcFleet(st) { return EnergyCalculator.calculate(st, fleetOld, fleetNew); }
function currentCalculation() {
  const rows = currentRows();
  return EnergyCalculator.calculate(S, rows.old, rows.next);
}
function carbonSource() {
  return S.cf === DEFAULTS.cf ? '能源署 114 年度產業電力排碳係數（2026-06-02 公布）' : '使用者自訂係數；官方參考值為 0.466';
}
function sourceText(m) {
  const parts = [sourceName(m), `TEC ${fmt(m.tec,3)} kWh/週`];
  if (['moea','energystar'].includes(m.source)) {
    if (m.source === 'moea' && m.company) parts.push(companyText(m));
    parts.push(`測試標準：${m.standard || '來源未明列'}`, `電壓：${m.voltage || '來源未明列'}`);
    if (m.certificate) parts.push(`證書：${m.certificate}`);
    if (m.validUntil) parts.push(`有效期限：${m.validUntil}`);
    if (m.sourceRecordId) parts.push(`資料編號：${m.sourceRecordId}`);
    parts.push(`查核：${m.checkedAt}`);
    if (m.source === 'energystar') parts.push(m.fallbackReason || '能源署有效獲證清單未找到可用的同型號實測 TEC');
    if (m.notes) parts.push(Array.isArray(m.notes) ? m.notes.join('；') : m.notes);
    if (m.markets?.length) parts.push(`市場：${Array.isArray(m.markets) ? m.markets.join('、') : m.markets}`);
    parts.push(m.sourceUrl);
  } else parts.push('此輸入值並非官方認證數值');
  if (m.reference?.sourceUrl) parts.push(`調整前參考：${companyText(m.reference)} ${m.reference.sourceUrl}（${m.reference.tec} kWh/週）`);
  return parts.filter(Boolean).join(' · ');
}
function sourceHTML(m, expanded=false) {
  const url = m.sourceUrl && /^https:\/\//.test(m.sourceUrl) ? m.sourceUrl : null;
  const summary = [companyText(m),m.certificate && `證書 ${m.certificate}`,m.checkedAt && `查核 ${m.checkedAt.slice(0,10)}`].filter(Boolean).join(' · ');
  const text = `<div class="small muted" style="overflow-wrap:anywhere;margin-top:4px">${esc(sourceText(m))}</div>`;
  return `<div class="source-detail"><b>${esc(sourceName(m))}</b>${url ? ` · <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">查驗本筆原始資料 ↗</a>` : ''}${summary?`<div class="small muted">${esc(summary)}</div>`:''}${expanded?text:`<details><summary class="small">${url?'測試條件與查核資訊':'假設說明'}</summary>${text}</details>`}</div>`;
}
function modelOption(m) {
  const details = [companyText(m),m.variantLabel].filter(Boolean);
  const suffix = details.length ? ` · ${details.join(' · ')}` : '';
  return `<option value="${esc(m.id)}">${esc(m.model)}${m.speed?` · ${esc(m.speed)} 張/分`:''} · TEC ${fmt(m.tec,3)} [${esc(sourceName(m))}]${esc(suffix)}</option>`;
}

function calcLab(st){
  const s = st.s;
  const jobs = s <= 8 ? 8 : (s < 32 ? s : 32);
  const img = s < 4 ? 1 : Math.floor(0.5 * s * s / jobs);
  const eJobs = (2*st.ej1 + (jobs-2)*st.ej) / 1000;       // kWh
  const eFinal = 2*st.ef / 1000;
  const tJobs = jobs * 0.25, tFinal = 2 * 0.25;
  const tSleep = Math.max(0, 24 - tJobs - tFinal);
  const eSleep = tSleep * st.ps / 1000;
  const eDay = eJobs + eFinal + eSleep;
  const eWeekend = 48 * st.ps / 1000;
  const tec = 5*eDay + eWeekend;
  return {jobs, img, daily:jobs*img, eJobs, eFinal, eSleep, eDay, eWeekend, tec, tJobs, tFinal, tSleep};
}

/* =========================================================
   3. 格式化
   ========================================================= */
const fmt = (n, d=0) => (isFinite(n)?n:0).toLocaleString('zh-TW',{minimumFractionDigits:d, maximumFractionDigits:d});
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* =========================================================
   4. 滑桿定義（全部數值皆可滑動）
   ========================================================= */
const SIM_SLIDERS = [
  {k:'units', label:'事務機台數', unit:'台', min:1, max:200, step:1, d:0, c:'var(--ink)', ticks:['1','50','100','150','200']},
  {k:'baseTec', label:'舊機 TEC', unit:'kWh/週', min:0, max:20, step:0.001, d:3, c:'var(--rose)', ticks:['0','5','10','15','20']},
  {k:'targetTec', label:'新機 TEC', unit:'kWh/週', min:0, max:20, step:0.001, d:3, c:'var(--blue)', ticks:['0','5','10','15','20']},
  {k:'price', label:'每度電價', unit:'NT$/度', min:0, max:20, step:0.1, d:1, c:'var(--sand)', ticks:['0','5','10','20']},
  {k:'years', label:'評估年限（租期）', unit:'年', min:1, max:10, step:1, d:0, c:'var(--ink)', ticks:['1','5','10']},
  {k:'cf', label:'電力排碳係數', unit:'kg/度', min:0, max:2, step:0.001, d:3, c:'var(--teal)', ticks:['0','0.466','1','2']}
];
const LAB_SLIDERS = [
  {k:'s', label:'列印速度 s', unit:'ipm', min:5, max:60, step:1, d:0, c:'var(--ink)', ticks:['5','20','32','60']},
  {k:'ej1', label:'首件喚醒用電（每次）', unit:'Wh', min:0.5, max:30, step:0.1, d:1, c:'var(--rose)', ticks:['0.5','15','30']},
  {k:'ej', label:'一般批次用電（含 15 分鐘間隔）', unit:'Wh', min:0.2, max:10, step:0.1, d:1, c:'var(--sand)', ticks:['0.2','5','10']},
  {k:'ef', label:'收尾待機→睡眠（每次）', unit:'Wh', min:0, max:15, step:0.1, d:1, c:'var(--blue)', ticks:['0','7.5','15']},
  {k:'ps', label:'睡眠功率', unit:'W', min:0.1, max:10, step:0.1, d:1, c:'var(--sage)', ticks:['0.1','5','10']}
];
const LAB_PRESETS = {
  new:{ej1:4.0, ej:1.2, ef:1.0, ps:0.5},
  old:{ej1:25, ej:6.0, ef:8.0, ps:5.0},
  ij:{ej1:1.5, ej:0.9, ef:0.5, ps:0.4}
};

function sliderHTML(o){
  return `<div class="slider">
    <div class="top"><label for="r_${o.k}"><span class="dot" style="background:${o.c}"></span>${o.label}</label>
      <div class="valbox"><input type="number" data-k="${o.k}" min="${o.min}" max="${EnergyCalculator.limits[o.k]?.[1]??o.max}" step="${o.step}" aria-label="${o.label}"> ${o.unit}</div></div>
    <input type="range" id="r_${o.k}" data-k="${o.k}" min="${o.min}" max="${o.max}" step="${o.step}" style="--c:${o.c}">
    <div class="ticks">${o.ticks.map(t=>`<span>${t}</span>`).join('')}</div>
  </div>`;
}
document.getElementById('simSliders').innerHTML = SIM_SLIDERS.map(sliderHTML).join('');
// labSliders removed

const DECIMALS = {}; [...SIM_SLIDERS, ...LAB_SLIDERS].forEach(o => DECIMALS[o.k] = o.d);
DECIMALS.goal = 0;

/* Normalize before calculations; never render unbounded or fractional year counts. */
function updateParameter(event) {
  const el = event.target, key = el.dataset?.k;
  if (!EnergyCalculator.limits[key]) return;
  const value = EnergyCalculator.normalize(key, el.value);
  if (value === null) {
    el.setAttribute('aria-invalid','true');
    if (event.type === 'change') { el.value = S[key]; el.removeAttribute('aria-invalid'); }
    return;
  }
  el.removeAttribute('aria-invalid');
  S[key] = value;
  if (key === 'targetTec') markTargetAdjusted();
  syncABPickerUI();
  render(event.type === 'input' ? el : null);
}
document.addEventListener('input', updateParameter);
document.addEventListener('change', updateParameter);
function markTargetAdjusted(){
  const model = MASTER_MAP.get(primaryKey);
  S.targetName = model ? `${model.brand} ${model.model}${Math.abs(model.tec-S.targetTec)>1e-9?'（自訂 TEC）':''}` : '自訂新機';
}
function isExtModel() { return false; }

function getModelColorScore(m){
  const c = (m.color || '').toUpperCase();
  if (c === 'C' || c === 'COLOR' || c.startsWith('彩')) return 0; // 彩色機種排前面 (0)
  return 1; // 黑白機種排後面 (1)
}

function getModelVintageScore(m) { return m.source === 'moea' ? 0 : 1; }
function compareModelsUserConcept(a, b) {
  return getModelVintageScore(a)-getModelVintageScore(b) || getModelColorScore(a)-getModelColorScore(b) || a.model.localeCompare(b.model,'zh-TW') || a.id.localeCompare(b.id);
}
function populateTarget(brand, id) {
  const models = [...MASTER_MAP.values()].filter(m=>m.brand===brand).sort(compareModelsUserConcept);
  const select = document.getElementById('abModelSel');
  select.innerHTML = models.map(modelOption).join('');
  select.value = models.some(m=>m.id===id) ? id : models[0]?.id || '';
}
function populateBase(brand, id) {
  const select = document.getElementById('abBaseModelSel');
  document.getElementById('abBaseCustomRow').classList.toggle('hide',brand!=='CUSTOM');
  if (brand === 'CUSTOM') { select.innerHTML = '<option value="custom">自訂舊機</option>'; return; }
  const models = LEGACY_MODELS[brand] || [];
  select.innerHTML = models.map(modelOption).join('');
  select.value = models.some(m=>m.id===id) ? id : models[0]?.id || '';
}
function initABPicker(){
  const brands = [...new Set([...MASTER_MAP.values()].map(m=>m.brand))].sort();
  document.getElementById('abBrandSel').innerHTML = brands.map(b=>`<option>${esc(b)}</option>`).join('');
  document.getElementById('abBaseBrandSel').innerHTML = '<option value="PRESET">通用情境假設（非實測）</option>' + brands.map(b=>`<option>${esc(b)}</option>`).join('') + '<option value="CUSTOM">自訂名稱與 TEC</option>';
  document.getElementById('abBrandSel').addEventListener('change',e=>{populateTarget(e.target.value);setPrimary(document.getElementById('abModelSel').value);});
  document.getElementById('abModelSel').addEventListener('change',e=>setPrimary(e.target.value));
  document.getElementById('abBaseBrandSel').addEventListener('change',e=>{
    populateBase(e.target.value);
    if (e.target.value === 'CUSTOM') {baseKey=null;S.baseName='自訂舊機';syncABPickerUI();render();}
    else setBaseline(findModel(document.getElementById('abBaseModelSel').value));
  });
  document.getElementById('abBaseModelSel').addEventListener('change',e=>{const m=findModel(e.target.value);if(m)setBaseline(m);});
  document.getElementById('abBaseName').addEventListener('input',e=>{baseKey=null;S.baseName=e.target.value.trim().slice(0,160)||'自訂舊機';render(e.target);});
  for(const [id,key] of [['abBaseSlider','baseTec'],['abTargetSlider','targetTec']]) {
    const el=document.getElementById(id);el.min=0;el.max=20;el.step=0.001;el.dataset.k=key;
  }
  setBaseline(PRESETS[1]);
  setPrimary(primaryKey);
}
function syncABPickerUI(){
  for(const [prefix,key] of [['Base','baseTec'],['Target','targetTec']]){
    for(const suffix of ['TecOut','TecVal']) document.getElementById(`ab${prefix}${suffix}`).textContent=fmt(S[key],3);
    document.getElementById(`ab${prefix}KwhVal`).textContent=fmt(S[key]*52,1);
    const slider=document.getElementById(`ab${prefix}Slider`);slider.max=Math.max(20,S[key]);slider.value=S[key];
  }
  const name=document.getElementById('abBaseName');if(document.activeElement!==name)name.value=S.baseName;
  const rows=currentRows();
  if(calcMode==='single'){
    document.getElementById('abBaseSourceBadge').innerHTML=sourceHTML(rows.old[0]);
    document.getElementById('abSourceBadge').innerHTML=sourceHTML(rows.next[0]);
  }
}

function render(skip){
  const isFleet = calcMode === 'fleet';
  const m = currentCalculation();
  syncABPickerUI();

  // 同步所有輸入元件
  document.querySelectorAll('[data-k]').forEach(el => {
    const k = el.dataset.k; if (el === skip) return;
    const d = DECIMALS[k] ?? 0;
    if(el.type==='range' && +el.max < S[k]) el.max=S[k];
    el.value = el.type === 'number' ? (+S[k]).toFixed(d) : S[k];
  });
  document.querySelectorAll('input[type=range]').forEach(el => {
    const p = (el.value - el.min) / (el.max - el.min) * 100;
    el.style.setProperty('--fill', p + '%');
  });

  // 輸出欄位
  const out = {
    units: fmt(isFleet ? m.totalUnitsOld : S.units),
    years: fmt(S.years), price: fmt(S.price,1), cf: fmt(S.cf,3), goal: fmt(S.goal),
    rate: m.rate===null?'不適用':fmt(m.rate,1)+'%', remainRate: m.ratio===null?'不適用':fmt(m.ratio*100,1)+'%',
    totalCost: fmt(m.totalCost), costYr: fmt(m.costYr), costUnit: fmt(m.costUnit),
    kwhYr: fmt(m.kwhYr), kwhUnit: fmt(m.kwhUnit), kwhTotal: fmt(m.kwhTotal),
    co2Yr: fmt(m.co2Yr), co2Total: fmt(m.co2Total),
    baseKwh: fmt(m.baseKwh), targetKwh: fmt(m.targetKwh), baseCost: fmt(m.baseCost), targetCost: fmt(m.targetCost),
    baseTec: isFleet ? fmt(m.avgBaseTec,3) : fmt(S.baseTec,3),
    targetTec: isFleet ? fmt(m.avgTargetTec,3) : fmt(S.targetTec,3),
    ratio: m.ratio===null?'不適用':fmt(m.ratio,2),
    baseName: isFleet ? (fleetOld.length === 1 ? `${fleetOld[0].brand} ${fleetOld[0].model}` : `舊機組合（共 ${m.totalUnitsOld} 台）`) : S.baseName,
    targetName: isFleet ? (fleetNew.length === 1 ? `${fleetNew[0].brand} ${fleetNew[0].model}` : `新機組合（共 ${m.totalUnitsNew} 台）`) : S.targetName
  };
  document.querySelectorAll('[data-o]').forEach(el => { const v = out[el.dataset.o]; if (v !== undefined) el.textContent = v; });
  document.querySelectorAll('#s2 [data-o="units"]').forEach(el=>el.textContent=fmt(S.units));

  const r = Math.max(0, Math.min(100, m.rate || 0));
  document.getElementById('splitSave').style.width = r + '%';
  document.getElementById('splitRemain').style.width = (100 - r) + '%';
  const maxKwh=Math.max(m.baseKwh,m.targetKwh,1);
  document.querySelector('#simTargetFill').parentElement.parentElement.previousElementSibling.querySelector('.fill').style.width=m.baseKwh/maxKwh*100+'%';
  document.getElementById('simTargetFill').style.width=m.targetKwh/maxKwh*100+'%';

  renderCum(m);
  renderTimeline();
  renderCompare();
}

function renderCum(m){
  const max = Math.max(...m.cum.map(Math.abs), 1);
  document.getElementById('cumCols').innerHTML = m.cum.map(v =>
    `<div class="col"><span class="v">${v>=10000? fmt(v/10000,1)+'萬' : fmt(v)}</span><div class="b" style="height:${Math.max(0, Math.abs(v)/max*100)}%;background:${v<0?'var(--rose)':'var(--sage)'}"></div></div>`).join('');
  document.getElementById('cumX').innerHTML = m.cum.map((_,i)=>`<span>第${i+1}年</span>`).join('');
}

function renderTimeline(){
  const wake = 0.2;
  const jobsH = 1.8;
  const finalH = 0.5;
  const sleepH = 24 - wake - jobsH - finalH;
  const segs = [
    ['睡眠', sleepH/2, 'var(--sage)'], ['喚醒', wake/2, 'var(--rose)'], ['列印批次', jobsH/2, 'var(--sand)'], ['收尾', finalH/2, 'var(--blue)'],
    ['喚醒', wake/2, 'var(--rose)'], ['列印批次', jobsH/2, 'var(--sand)'], ['收尾', finalH/2, 'var(--blue)'], ['睡眠', sleepH/2, 'var(--sage)']
  ];
  const tl = document.getElementById('dayTimeline');
  if (tl) {
    tl.innerHTML = segs.map(sg =>
      `<div style="flex:${sg[1]};background:${sg[2]}" title="${sg[0]} ${fmt(sg[1],1)} 小時">${sg[1] >= 1.6 ? sg[0] + ' ' + fmt(sg[1],1)+'h' : ''}</div>`).join('');
  }
}
function renderGauge(m){ /* slide 4 removed */ }
function renderLab(L){ /* lab simulation removed */ }

/* 比較區 */
function renderCompare(){
  const chips = document.getElementById('chips');
  if (!compare.length){ chips.innerHTML = '<span class="small muted">尚未加入機型。請在上方清單按「加入比較」。</span>'; }
  else chips.innerHTML = compare.map(m => {
    const k = keyOf(m), on = k === primaryKey;
    const isGov = m.src.includes('官網');
    return `<label class="chip ${on?'primary':''}"><input type="radio" name="prim" value="${esc(k)}" ${on?'checked':''}>
      <span><b>${esc(m.brand)}</b> ${esc(m.model)} <span class="num muted">${fmt(m.tec,2)}</span>${isGov?' <span style="color:#A85822;font-size:10px">🏢官網</span>':''}</span>
      <button type="button" data-rm="${esc(k)}" aria-label="移除">×</button></label>`;
  }).join('');

  const rows = [{name:S.baseName, tec:S.baseTec, color:'var(--rose)', base:true}]
    .concat(compare.map(m => ({name:`${m.brand} ${m.model}`, tec:m.tec, color: keyOf(m)===primaryKey ? 'var(--blue)' : '#A9B4BE', speed:m.speed, src:m.src})));
  const max = Math.max(...rows.map(r => r.tec), 0.01);
  document.getElementById('compareBars').innerHTML = rows.map(r => {
    const kwh = r.tec*52*S.units, cost = kwh*S.price, co2 = kwh*S.cf;
    const save = (S.baseTec - r.tec)*52*S.units*S.price;
    return `<div class="hbar"><div class="meta"><b><span class="dot" style="background:${r.color}"></span> ${esc(r.name)}${r.speed?` <span class="muted small">· ${r.speed} ipm</span>`:''}${r.src&&r.src.includes('官網')?' <span class="pill" style="font-size:10px;padding:0 5px;background:#FFF6EE;color:#A85822">🏢官網規格</span>':''}</b>
      <span class="num small">${fmt(kwh)} 度 · NT$${fmt(cost)} · ${fmt(co2)} kg${r.base?'':` · <span class="c-sage">${save<0?'增加':'節省'} NT$${fmt(Math.abs(save))}</span>`}</span></div>
      <div class="track"><div class="fill" style="width:${r.tec/max*100}%;background:${r.color}"></div></div></div>`;
  }).join('');
}

document.getElementById('chips').addEventListener('click', e => {
  const rm = e.target.closest('[data-rm]');
  if (rm){ e.preventDefault(); removeCompare(rm.dataset.rm); }
});
document.getElementById('chips').addEventListener('change', e => {
  if (e.target.name === 'prim') setPrimary(e.target.value);
});

function addCompare(m){
  const k = keyOf(m);
  if (compare.some(x => keyOf(x) === k)) { removeCompare(k); return; }
  if (compare.length >= 4){ alert('最多比較 4 款機型，請先移除一款。'); return; }
  compare.push(m);
  if (!primaryKey) setPrimary(k); else { render(); renderTable(); }
}
function removeCompare(k){
  compare = compare.filter(x => keyOf(x) !== k);
  render(); renderTable();
}
function setPrimary(k){
  const model=MASTER_MAP.get(k);if(!model)return;
  primaryKey=k;S.targetTec=model.tec;S.targetName=`${model.brand} ${model.model}`;
  if(!compare.some(m=>m.id===k)){if(compare.length>=4)compare.shift();compare.push(model);}
  document.getElementById('abBrandSel').value=model.brand;populateTarget(model.brand,k);
  syncABPickerUI();render();renderTable();
}
function setBaseline(model){
  if(!model)return;
  baseKey=model.id;S.baseTec=model.tec;S.baseName=model.source==='scenario'?model.model:`${model.brand} ${model.model}`;
  document.getElementById('abBaseBrandSel').value=model.brand;populateBase(model.brand,model.id);
  syncABPickerUI();render();renderTable();
}

/* =========================================================
   7. 經濟部能源署節能標章機型篩選與呈現
   ========================================================= */
function setStatus(cls, text){
  const el = document.getElementById('apiStatus');
  el.className = 'status ' + cls;
  document.getElementById('apiStatusText').textContent = text;
}

function loadBrands(){
  const sel = document.getElementById('fBrand');
  const counts = {};
  MASTER_MAP.forEach(m => {
    const b = m.brand;
    counts[b] = (counts[b] || 0) + 1;
  });
  const list = Object.keys(counts).map(b => ({ name: b, n: counts[b] }));
  list.sort((a,b) => brandRank(a.name) - brandRank(b.name) || a.name.localeCompare(b.name));
  sel.innerHTML = `<option value="">全部品牌（全部顯示）</option>` +
    list.map(b => `<option value="${esc(b.name)}">${esc(b.name)}（${b.n} 款）</option>`).join('');
  sel.value = '';
  setStatus('ok', `可查證 TEC：${MASTER_MAP.size} 筆來源紀錄 · 查核 ${SNAPSHOT_DATE}`);
  let coverage=document.getElementById('sourceCoverage');
  if(!coverage){coverage=document.createElement('details');coverage.id='sourceCoverage';coverage.className='note';document.getElementById('apiStatus').parentElement.after(coverage);}
  coverage.innerHTML=`<summary>來源涵蓋：能源署 ${TEC_DATA.counts.moea} 筆、ENERGY STAR ${TEC_DATA.counts.energystar} 筆；${TEC_DATA.unresolved.length} 個原機型未納入自動試算</summary><p>${esc(RICOH_SOURCE_POLICY)}其餘同型號不同證書依來源規則列示。未採用的紀錄仍保留為查核證據；沒有可核實 TEC 時不沿用舊站數值。</p><ul>${TEC_DATA.unresolved.map(m=>`<li><b>${esc(m.brand)} ${esc(m.model)}</b>：${esc(m.reason)}</li>`).join('')}</ul><p><a href="data/tec-catalog.json" target="_blank" rel="noopener">檢視完整來源快照與排除原因</a></p>`;
}

function currentFilters(){
  return {
    brand: document.getElementById('fBrand').value,
    color: document.getElementById('fColor').value,
    kw: document.getElementById('fKw').value.trim(),
    smin: +document.getElementById('fSpeedMin').value,
    smax: +document.getElementById('fSpeed').value
  };
}

function search(){
  shown = 60;
  renderTable();
}

function renderTable(){
  const f = currentFilters();
  const sort = document.getElementById('fSort').value;
  const all = Array.from(MASTER_MAP.values());

  // 🌟 關鍵修正：若選了該品牌，底下嚴格只留下該品牌，絕不混入其他品牌！
  let list = all.filter(m => {
    if (f.brand && m.brand.toUpperCase() !== f.brand.toUpperCase()) return false;
    if (f.color && m.color !== f.color) return false;
    if (f.kw) {
      const kw = f.kw.toUpperCase();
      if (!m.model.toUpperCase().includes(kw) && !m.brand.toUpperCase().includes(kw)) return false;
    }
    if (m.speed !== null && (m.speed < f.smin || m.speed > f.smax)) return false;
    return true;
  });

  list.sort((a,b) => {
    if (!f.brand) {
      const r = brandRank(a.brand) - brandRank(b.brand);
      if (r !== 0) return r;
    }
    if (sort === 'speed') return a.speed - b.speed || a.tec - b.tec;
    if (sort === 'brand') return a.brand.localeCompare(b.brand) || a.tec - b.tec;
    if (sort === 'tec') return a.tec - b.tec || a.speed - b.speed;
    // 預設商務排序：彩機到黑白機、由舊到新
    return compareModelsUserConcept(a, b);
  });

  document.getElementById('resCount').textContent = fmt(list.length);
  const infoEl = document.getElementById('resFilterInfo');
  if (infoEl) {
    if (f.brand) {
      infoEl.textContent = `僅顯示 ${f.brand} 品牌機型${f.brand==='Ricoh'?' · 互盛有效節能標章優先':''}`;
    } else {
      infoEl.textContent = `能源署優先；Ricoh 依互盛有效節能標章優先規則列示`;
    }
  }

  const body = document.getElementById('resBody');
  if (!list.length){
    const unavailable=TEC_DATA.unresolved.filter(m=>f.kw&&m.model.toLowerCase().includes(f.kw.toLowerCase())&&(!f.brand||m.brand===f.brand));
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px" class="muted">${unavailable.length?unavailable.map(m=>`${esc(m.brand)} ${esc(m.model)}：${esc(m.reason)}`).join('<br>'):'沒有符合條件的機型，請放寬速度範圍或更換品牌。'}</td></tr>`;
    document.getElementById('btnMore').classList.add('hide'); return;
  }
  const inCmp = new Set(compare.map(keyOf));
  body.innerHTML = list.slice(0, shown).map((m,i) => {
    const k = keyOf(m), u = m.brand.toUpperCase();
    const tagCls = u==='RICOH'?'ricoh':u==='EPSON'?'epson':'';
    const tecColor = m.tec <= 0.25 ? 'var(--sage)' : m.tec <= 0.4 ? 'var(--ink)' : 'var(--rose)';
    const isBase = S.baseName === `${m.brand} ${m.model}` && Math.abs(S.baseTec - m.tec) < 1e-9;
    const isGov = m.src.includes('官網');


    return `<tr><td class="c-brand">${esc(m.brand)}</td><td class="c-model"><b>${esc(m.model)}</b>${m.variantLabel?`<div class="small">${esc(m.variantLabel)}</div>`:''}${sourceHTML(m)}</td><td class="c-spec">${m.color==='Color'?'彩色':m.color==='Monochrome'?'黑白':'色彩未列'} · ${m.speed??'—'} ipm · ${esc(TECH_LABEL[m.tech]||'技術未列')}<div class="small">${m.a3===true?'A3 已確認':'紙張尺寸依來源核對'}</div></td><td class="c-tec r">${fmt(m.tec,3)}</td><td class="c-kwh r">${fmt(m.tec*52,1)}</td><td class="c-act"><div class="acts"><button class="btn sm" data-add="${i}">${inCmp.has(k)?'✓ 比較中':'加入比較'}</button><button class="btn sm" data-base="${i}">${isBase?'✓ 舊機':'設為舊機'}</button></div></td></tr>`;
  }).join('');
  body._list = list;
  document.getElementById('btnMore').classList.toggle('hide', list.length <= shown);
}

document.getElementById('resBody').addEventListener('click', e => {
  const list = e.currentTarget._list || [];
  const a = e.target.closest('[data-add]'), b = e.target.closest('[data-base]');
  if (a) addCompare(list[+a.dataset.add]);
  if (b) setBaseline(list[+b.dataset.base]);
});
document.getElementById('btnMore').addEventListener('click', () => { shown += 60; renderTable(); });
document.getElementById('btnSearch').addEventListener('click', search);
document.getElementById('fKw').addEventListener('input', () => { shown = 60; renderTable(); });
document.getElementById('fKw').addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
['fBrand','fColor'].forEach(id => document.getElementById(id).addEventListener('change', () => {
  shown = 60;
  renderTable();
}));
document.getElementById('fSort').addEventListener('change', renderTable);
['fSpeed','fSpeedMin'].forEach(id => document.getElementById(id).addEventListener('input', () => {
  const lo = document.getElementById('fSpeedMin'), hi = document.getElementById('fSpeed');
  if (+lo.value > +hi.value) (id==='fSpeed' ? lo : hi).value = id==='fSpeed' ? hi.value : lo.value;
  document.getElementById('fSpeedOut').textContent = hi.value;
  document.getElementById('fSpeedMinOut').textContent = lo.value;
  [lo,hi].forEach(el => el.style.setProperty('--fill', (el.value-el.min)/(el.max-el.min)*100+'%'));
  renderTable();
}));

/* =========================================================
   7B. 多台試算模式與摘要匯出
   ========================================================= */
function switchCalcMode(mode){
  calcMode = mode;
  const btnSingle = document.getElementById('btnModeSingle');
  const btnFleet = document.getElementById('btnModeFleet');
  const pSingle = document.getElementById('panelSingleMode');
  const pFleet = document.getElementById('panelFleetMode');

  if (mode === 'single'){
    btnSingle.classList.add('on');
    btnFleet.classList.remove('on');
    pSingle.classList.remove('hide');
    pFleet.classList.add('hide');
  } else {
    btnFleet.classList.add('on');
    btnSingle.classList.remove('on');
    pSingle.classList.add('hide');
    pFleet.classList.remove('hide');
    renderFleetUI();
  }
  render();
}

function renderFleetUI(){
  renderFleetOldRows();
  renderFleetNewRows();
}

function renderFleetRows(side){
  const rows=side==='old'?fleetOld:fleetNew;
  const cap=side==='old'?'Old':'New';
  document.getElementById(`fleet${cap}Rows`).innerHTML=rows.map((row,index)=>{
    const brands=Object.keys(LEGACY_MODELS).filter(b=>side==='old'||b!=='PRESET');
    const group=row.brand==='CUSTOM'?'CUSTOM':row.brand;
    const models=LEGACY_MODELS[group]||[];
    return `<div class="fleet-row" style="padding:12px;background:white;border:1px solid var(--line);border-radius:8px;min-width:0">
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <select aria-label="第${index+1}列${cap==='Old'?'舊':'新'}機品牌" data-side="${side}" data-index="${index}" data-field="brand" style="max-width:100%">${brands.map(b=>`<option value="${esc(b)}" ${b===group?'selected':''}>${b==='PRESET'?'情境假設':esc(b)}</option>`).join('')}${side==='old'?`<option value="CUSTOM" ${group==='CUSTOM'?'selected':''}>自訂舊機</option>`:''}</select>
        <select aria-label="第${index+1}列機型與來源紀錄" data-side="${side}" data-index="${index}" data-field="model" style="width:100%;min-width:0">${group==='CUSTOM'?'<option>自訂舊機</option>':models.map(m=>modelOption(m).replace('value="'+esc(m.id)+'"','value="'+esc(m.id)+'"'+(row.id===m.id?' selected':''))).join('')}</select>
        <label>台數 <input aria-label="第${index+1}列${side==='old'?'舊':'新'}機台數" type="number" min="1" max="200" step="1" value="${row.units}" data-side="${side}" data-index="${index}" data-field="units" style="width:70px"></label>
        ${side==='old'?`<label>TEC <input aria-label="第${index+1}列舊機 TEC" type="number" min="0" max="1000" step="0.001" value="${row.tec}" data-side="${side}" data-index="${index}" data-field="tec" style="width:90px"></label>`:`<span>TEC ${fmt(row.tec,3)} kWh/週</span>`}
        <button class="btn sm" data-side="${side}" data-index="${index}" data-delete ${rows.length<=1?'disabled':''} aria-label="移除第${index+1}列">移除</button>
      </div>${sourceHTML(row)}
    </div>`;
  }).join('');
  document.getElementById(`fleet${cap}TotalUnits`).textContent=fmt(rows.reduce((sum,row)=>sum+row.units,0));
  document.getElementById(`fleet${cap}TotalKwh`).textContent=fmt(rows.reduce((sum,row)=>sum+row.tec*52*row.units,0),1);
}
function renderFleetOldRows(){renderFleetRows('old');}
function renderFleetNewRows(){renderFleetRows('new');}

function generateSummaryText(){
  const rows=currentRows(), m=currentCalculation();
  const lines=['事務機用電差額評估',`產生日期：${new Date().toLocaleDateString('sv-SE')}`,`模式：${calcMode==='fleet'?'多台組合':'單一機型'}`,`年限：${S.years} 年；電價：NT$ ${S.price}/度`, `排碳係數：${S.cf} kg CO₂e/度（${carbonSource()}）`,RICOH_SOURCE_POLICY];
  for(const [title,list] of [['現況舊機',rows.old],['擬換新機',rows.next]]){
    lines.push('',title);
    list.forEach(row=>lines.push(`${row.model} × ${row.units} 台；年用電 ${fmt(row.tec*52*row.units,1)} 度`,sourceText(row)));
  }
  lines.push('',`每年用電差額：${fmt(m.kwhYr,1)} 度；每年電費差額：NT$ ${fmt(m.costYr,1)}`,`${S.years} 年累計電費差額：NT$ ${fmt(m.totalCost,1)}`,`每年碳排差額：${fmt(m.co2Yr,1)} kg CO₂e`,`${S.years} 年累計碳排差額：${fmt(m.co2Total,1)} kg CO₂e`,'正值代表節省，負值代表增加。此為用電費用試算，未包含租金、購機、耗材或維修成本；實際用電依印量與設定而異。','排碳係數官方參考：https://www.moeaea.gov.tw/ECW/PDA.aspx?kind=1&news_id=34473');
  return lines.join('\n');
}

function generateReportSvgCharts(m){
  // 1. 生成 5 年累計省電費長條柱狀圖 (SVG)
  const cum = m.cum || [];
  const max = Math.max(...cum.map(Math.abs), 1);
  const width = 340, height = 135, padL = 40, padB = 22, padT = 20, padR = 15;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const barCount = cum.length || 1;
  const barW = Math.min(36, (chartW / barCount) * 0.65);
  const step = chartW / barCount;

  let bars = '';
  cum.forEach((val, i) => {
    const barH = Math.max(0, (Math.abs(val) / max) * chartH);
    const x = padL + i * step + (step - barW) / 2;
    const y = padT + (chartH - barH);
    const valText = val >= 10000 ? (val/10000).toFixed(1) + '萬' : Math.round(val).toLocaleString();

    bars += `
      <g>
        <rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${val<0?'#A9786F':'#059669'}" />
        <text x="${x + barW/2}" y="${y - 5}" font-size="10" font-weight="700" fill="${val<0?'#A9786F':'#047857'}" text-anchor="middle">${valText}</text>
        <text x="${x + barW/2}" y="${height - 6}" font-size="10.5" fill="#64748B" text-anchor="middle">第${i+1}年</text>
      </g>
    `;
  });

  const cumSvg = `<svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;display:block">
    <line x1="${padL}" y1="${padT + chartH}" x2="${width - padR}" y2="${padT + chartH}" stroke="#CBD5E1" stroke-width="1.5" />
    ${bars}
  </svg>`;

  // 2. 生成新舊方案年用電對照長條圖 (SVG)
  const baseKwh = m.baseKwh || 0;
  const targetKwh = m.targetKwh || 0;
  const maxKwh = Math.max(baseKwh, targetKwh, 1);
  const baseW = Math.round((baseKwh / maxKwh) * 100);
  const targetW = Math.round((targetKwh / maxKwh) * 100);

  const hbarSvg = `<div style="display:flex;flex-direction:column;gap:12px;padding:4px 0">
    <div>
      <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px">
        <span style="font-weight:700;color:#B91C1C">● 現況舊機年用電</span>
        <span style="font-family:var(--mono);font-weight:700">${fmt(baseKwh,1)} 度 (NT$ ${fmt(m.baseCost)})</span>
      </div>
      <div style="background:#FEE2E2;border-radius:6px;height:14px;overflow:hidden">
        <div style="background:#EF4444;width:${baseW}%;height:100%;border-radius:6px"></div>
      </div>
    </div>
    <div>
      <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px">
        <span style="font-weight:700;color:#047857">● 擬換新機年用電（用電減幅 ${m.rate===null?'不適用':fmt(m.rate,1)+'%'}）</span>
        <span style="font-family:var(--mono);font-weight:700">${fmt(targetKwh,1)} 度 (NT$ ${fmt(m.targetCost)})</span>
      </div>
      <div style="background:#DCFCE7;border-radius:6px;height:14px;overflow:hidden">
        <div style="background:#10B981;width:${targetW}%;height:100%;border-radius:6px"></div>
      </div>
    </div>
  </div>`;

  return { cumSvg, hbarSvg };
}

function updatePdfReportDOM(){
  const isFleet = calcMode === 'fleet';
  const m = currentCalculation();
  const W = 52;
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  document.getElementById('pdfReportDate').textContent = `報告日期：${dateStr}`;
  document.getElementById('pdfDocNo').textContent = `RPT-${dateStr.replaceAll('-','')}`;
  document.getElementById('pdfParamMode').textContent = isFleet ? '多台試算' : '單機試算';
  document.getElementById('pdfParamYears').textContent = S.years;
  document.getElementById('pdfParamPrice').textContent = fmt(S.price, 1);
  document.getElementById('pdfParamCf').textContent = fmt(S.cf, 3);

  // KPIs
  document.getElementById('pdfKpiKwh').textContent = `${fmt(m.kwhYr,1)} 度`;
  document.getElementById('pdfKpiRate').textContent = `用電減幅 ${m.rate===null?'不適用':fmt(m.rate,1)+'%'}`;
  document.getElementById('pdfKpiCostYr').textContent = `NT$ ${fmt(m.costYr)}`;
  document.getElementById('pdfKpiCostUnit').textContent = fmt(m.costUnit);
  document.getElementById('pdfKpiYearsTitle').textContent = S.years;
  document.getElementById('pdfKpiTotalCost').textContent = `NT$ ${fmt(m.totalCost)}`;
  document.getElementById('pdfKpiKwhTotal').textContent = fmt(m.kwhTotal, 1);
  document.getElementById('pdfKpiCo2').textContent = `${fmt(m.co2Yr,1)} kg`;
  document.getElementById('pdfKpiYearsCo2').textContent = S.years;
  document.getElementById('pdfKpiCo2Total').textContent = fmt(m.co2Total, 1);

const rows=currentRows();
  document.getElementById('pdfTableBody').innerHTML=[['現況舊機',rows.old],['擬換新機',rows.next]].map(([title,list])=>list.map((row,index)=>`<tr>${index===0?`<td rowspan="${list.length}">${title}</td>`:''}<td><b>${esc(row.model)}</b><div class="small">${esc(sourceName(row))}${companyText(row)?' · '+esc(companyText(row)):''}${row.certificate?' · 證書 '+esc(row.certificate):''}</div></td><td>${fmt(row.tec,3)}</td><td>${row.units} 台</td><td>${fmt(row.tec*52*row.units,1)} 度</td></tr>`).join('')).join('');
  document.getElementById('pdfSourceNotes').innerHTML=[...rows.old,...rows.next].map(row=>`<div class="pdf-source-record"><b>${esc(row.model)}</b>${sourceHTML(row,true)}</div>`).join('')+`<p>排碳係數：${fmt(S.cf,3)} · ${esc(carbonSource())}。<a href="https://www.moeaea.gov.tw/ECW/PDA.aspx?kind=1&news_id=34473">能源署公告</a></p>`;
  const cfLabel=document.getElementById('pdfCfSource');if(cfLabel)cfLabel.textContent=carbonSource();

  // Charts
  document.getElementById('pdfChartYears').textContent = S.years;
  const svgs = generateReportSvgCharts(m);
  document.getElementById('pdfChartCumSvg').innerHTML = svgs.cumSvg;
  document.getElementById('pdfChartHbarSvg').innerHTML = svgs.hbarSvg;
}

let activeDialog=null, returnFocus=null;
function openDialog(id){
  returnFocus=document.activeElement;activeDialog=document.getElementById(id);
  activeDialog.inert=false;activeDialog.classList.remove('hide');activeDialog.classList.add('on');activeDialog.setAttribute('aria-hidden','false');
  document.querySelectorAll('body > header, body > main, body > footer').forEach(el=>el.inert=true);
  document.body.style.overflow='hidden';
  activeDialog.querySelector('button')?.focus();
}
function closeDialog(){
  if(!activeDialog)return;
  const id=activeDialog.id;
  activeDialog.classList.remove('on');activeDialog.setAttribute('aria-hidden','true');activeDialog.inert=true;
  if(id==='exportModal')activeDialog.classList.add('hide');
  document.getElementById('mask').classList.remove('on');
  document.querySelectorAll('body > header, body > main, body > footer').forEach(el=>el.inert=false);
  document.body.style.overflow='';activeDialog=null;returnFocus?.focus();
}
function openExportSummary(){updatePdfReportDOM();openDialog('exportModal');}

function notifyExport(msg){
  const el = document.getElementById('exportNotify');
  const txt = document.getElementById('exportNotifyText');
  if (el && txt){
    txt.textContent = msg;
    el.style.display = 'flex';
    setTimeout(() => { el.style.display = 'none'; }, 3500);
  }
}

let pdfLoading;
function loadPdfLibrary(){
  if(window.html2pdf)return Promise.resolve();
  if(!pdfLoading)pdfLoading=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='assets/vendor/html2pdf.bundle.min.js';
    script.onload=resolve;
    script.onerror=()=>{script.remove();pdfLoading=null;reject(new Error('PDF 套件載入失敗'));};
    document.head.appendChild(script);
  });
  return pdfLoading;
}
async function downloadPdfReport(){
  const buttons=['btnDownloadPdf','btnDownloadPdf2'].map(id=>document.getElementById(id));
  buttons.forEach(button=>button.disabled=true);
  notifyExport('正在產生 PDF，請稍候…');
  try{
    await loadPdfLibrary();
    const now=new Date().toLocaleDateString('sv-SE').replaceAll('-','');
    const report=document.getElementById('pdfReportPaper').cloneNode(true);
    report.classList.add('pdf-export');
    await html2pdf().set({margin:[8,8,8,8],filename:`事務機用電評估_${now}.pdf`,image:{type:'jpeg',quality:0.95},html2canvas:{scale:2,useCORS:true,logging:false,windowWidth:1280},pagebreak:{mode:['css','legacy'],avoid:['tr','.pdf-kpi','.pdf-source-record']},jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}}).from(report).save();
    notifyExport('PDF 已下載。');
  }catch(error){notifyExport('PDF 無法產生，請使用「列印／另存」按鈕。');console.error(error);}
  finally{buttons.forEach(button=>button.disabled=false);}
}
function closeExportSummary(){closeDialog();}
function bindFleetEvents(){
  document.getElementById('btnModeSingle').addEventListener('click',()=>switchCalcMode('single'));
  document.getElementById('btnModeFleet').addEventListener('click',()=>switchCalcMode('fleet'));
  document.getElementById('btnExportSummary').addEventListener('click',openExportSummary);
  ['btnCloseExport','btnCloseExport2'].forEach(id=>document.getElementById(id).addEventListener('click',closeExportSummary));
  ['btnDownloadPdf','btnDownloadPdf2'].forEach(id=>document.getElementById(id).addEventListener('click',downloadPdfReport));
  document.getElementById('btnPrintPdf').addEventListener('click',()=>window.print());
  document.getElementById('btnCopyText').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(generateSummaryText());notifyExport('試算摘要已複製。');}
    catch{notifyExport('瀏覽器未允許複製，請下載 PDF 或使用列印。');}
  });
  for(const side of ['old','new']){
    const cap=side==='old'?'Old':'New', container=document.getElementById(`fleet${cap}Rows`);
    document.getElementById(`btnAddFleet${cap}`).addEventListener('click',()=>{
      const rows=side==='old'?fleetOld:fleetNew;if(rows.length>=50){alert('每組最多 50 筆設備。');return;}
      rows.push({... (side==='old'?PRESETS[1]:MASTER_MAP.get(primaryKey)||[...MASTER_MAP.values()][0]), units:1});
      renderFleetRows(side);render();
    });
    container.addEventListener('change',e=>{
      const el=e.target, index=+el.dataset.index, field=el.dataset.field;
      if(!field)return;
      const rows=side==='old'?fleetOld:fleetNew, row=rows[index];
      if(field==='brand'){
        rows[index]=el.value==='CUSTOM'?{brand:'CUSTOM',model:'自訂舊機',source:'custom',tec:row.tec,units:row.units}:{...LEGACY_MODELS[el.value][0],units:row.units};
      }else if(field==='model'){
        const model=findModel(el.value);if(model)rows[index]={...model,units:row.units};
      }else if(field==='units')row.units=EnergyCalculator.normalize('units',el.value)??row.units;
      else if(field==='tec')rows[index]=withValue(findModel(row.id)||row,EnergyCalculator.normalize('baseTec',el.value)??row.tec,row.model,row.units);
      renderFleetRows(side);render();
    });
    container.addEventListener('click',e=>{
      const button=e.target.closest('[data-delete]');if(!button)return;
      const rows=side==='old'?fleetOld:fleetNew;if(rows.length>1)rows.splice(+button.dataset.index,1);
      renderFleetRows(side);render();
    });
  }
}

/* =========================================================
   8. 審計抽屜
   ========================================================= */
function openAudit(type){
  const m=currentCalculation(), rows=currentRows();
  const detail=(title,list)=>`<h4>${title}</h4>`+list.map(row=>`<div class="formula">${esc(row.model)}：${fmt(row.tec,3)} × 52 × ${row.units} = ${fmt(row.tec*52*row.units,1)} 度/年</div>${sourceHTML(row)}`).join('');
  document.getElementById('dBody').innerHTML=`<h4>共同參數</h4><p>年限 ${S.years} 年 · 電價 NT$ ${S.price}/度 · 排碳係數 ${S.cf}（${esc(carbonSource())}）</p>${detail('現況舊機',rows.old)}${detail('擬換新機',rows.next)}<h4>年用電差額</h4><div class="formula">${fmt(m.baseKwh,1)} − ${fmt(m.targetKwh,1)} = ${fmt(m.kwhYr,1)} 度</div><h4>年電費差額</h4><div class="formula">${fmt(m.kwhYr,1)} × ${S.price} = NT$ ${fmt(m.costYr,1)}</div><h4>${S.years} 年累計</h4><div class="formula">${fmt(m.costYr,1)} × ${S.years} = NT$ ${fmt(m.totalCost,1)}</div><h4>年碳排差額</h4><div class="formula">${fmt(m.kwhYr,1)} × ${S.cf} = ${fmt(m.co2Yr,1)} kg CO₂e</div><p class="small">正值為節省，負值為增加。此為能源費用推估，並非採購總成本或實際節能保證。</p>`;
  document.getElementById('mask').classList.add('on');openDialog('drawer');
}
function closeAudit(){if(activeDialog?.id==='drawer')closeDialog();}
document.addEventListener('click',e=>{const el=e.target.closest('[data-audit]');if(el)openAudit(el.dataset.audit);});
document.getElementById('dClose').addEventListener('click',closeAudit);
document.getElementById('mask').addEventListener('click',closeAudit);
document.getElementById('btnReset').addEventListener('click',()=>{
  Object.assign(S,DEFAULTS);setBaseline(PRESETS[1]);
  setPrimary([...MASTER_MAP.values()].find(m=>m.brand==='Ricoh'&&m.model==='IM C3010')?.id||[...MASTER_MAP.keys()][0]);
  fleetOld=[{...PRESETS[1],units:DEFAULTS.units}];fleetNew=[{...MASTER_MAP.get(primaryKey),units:DEFAULTS.units}];
  renderFleetUI();syncABPickerUI();render();renderTable();
});

/* =========================================================
   9. 分頁控制
   ========================================================= */
let page = 1;
function go(n){
  page = Math.max(1, Math.min(3, n));
  document.querySelectorAll('.slide').forEach((s,i) => s.classList.toggle('on', i+1 === page));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', +t.dataset.go === page));
  document.getElementById('pageNo').textContent = page;
  const prevBtn = document.getElementById('prev');
  const nextBtn = document.getElementById('next');
  if (prevBtn){
    prevBtn.disabled = page === 1;
    prevBtn.style.visibility = page === 1 ? 'hidden' : 'visible';
  }
  if (nextBtn){
    nextBtn.disabled = page === 3;
    nextBtn.style.visibility = page === 3 ? 'hidden' : 'visible';
  }
  const t = document.querySelector(`.tab[data-go="${page}"]`); t && t.scrollIntoView({inline:'center', block:'nearest'});
  window.scrollTo({top:0, behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}
const brandEl = document.getElementById('brandHome') || document.querySelector('.brand');
if (brandEl) brandEl.addEventListener('click', e => { e.preventDefault(); closeAudit(); go(1); });
document.getElementById('tabs').addEventListener('click', e => { const t = e.target.closest('[data-go]'); if (t) go(+t.dataset.go); });
document.getElementById('prev').addEventListener('click', () => go(page-1));
document.getElementById('next').addEventListener('click', () => go(page+1));
document.addEventListener('keydown',e=>{
  if(activeDialog){
    if(e.key==='Escape'){e.preventDefault();closeDialog();}
    if(e.key==='Tab'){
      const items=[...activeDialog.querySelectorAll('button:not([disabled]),a[href],input,select,[tabindex="0"]')].filter(el=>el.getClientRects().length);
      const first=items[0],last=items.at(-1);
      if(!items.length){e.preventDefault();return;}
      if(e.shiftKey&&(document.activeElement===first||!activeDialog.contains(document.activeElement))){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&(document.activeElement===last||!activeDialog.contains(document.activeElement))){e.preventDefault();first.focus();}
    }
    return;
  }
  if(/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))return;
  const audit=document.activeElement.closest('[data-audit]');
  if(audit&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openAudit(audit.dataset.audit);return;}
  if(e.key==='ArrowRight'){e.preventDefault();go(page+1);}
  if(e.key==='ArrowLeft'){e.preventDefault();go(page-1);}
});

/* =========================================================
   10. 初始化
   ========================================================= */
(function init(){
  const first=[...MASTER_MAP.values()].find(m=>m.brand==='Ricoh'&&m.model==='IM C3010')||[...MASTER_MAP.values()][0];
  primaryKey=first.id;compare=[first];
  fleetOld=[{...PRESETS[1],units:DEFAULTS.units}];fleetNew=[{...first,units:DEFAULTS.units}];
  initABPicker();bindFleetEvents();go(1);render();renderTable();loadBrands();

})();
