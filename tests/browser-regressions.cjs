const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Run with: node --test tests/browser-regressions.cjs
// The application must already be served at http://127.0.0.1:8765.
function loadPlaywright() {
  const candidates = ['playwright'];
  if (process.env.APPDATA) {
    const installed = path.join(process.env.APPDATA, 'npm', 'node_modules', 'omniroute');
    candidates.push(path.join(installed, 'node_modules', 'playwright'));
    candidates.push(path.join(installed, 'dist', 'node_modules', 'playwright'));
  }
  for (const candidate of candidates) {
    let resolved;
    try { resolved = require.resolve(candidate); } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') continue;
      throw error;
    }
    return require(resolved);
  }
  throw new Error('Playwright is unavailable. Install locally with npm install --no-save --package-lock=false playwright.');
}

const { chromium } = loadPlaywright();
const baseUrl = 'http://127.0.0.1:8765/';
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const near = (actual, expected, tolerance = 1e-7) => {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `Expected ${expected}, got ${actual} (tolerance ${tolerance})`);
};
const number = text => {
  const match = String(text).replaceAll(',', '').replaceAll('−', '-').match(/-?\d+(?:\.\d+)?/);
  assert.ok(match, `No number in ${JSON.stringify(text)}`);
  return Number(match[0]);
};
const evidence = ['energylabel-verified.json', 'energystar-verified.json']
  .flatMap(file => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', file), 'utf8')).records);

async function openPage(t, viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, [], 'The page must not throw JavaScript errors');
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#abModelSel')?.options.length > 0);
  assert.deepEqual(errors, [], 'Application initialization failed');
  return page;
}

async function setParameter(page, key, value) {
  const field = page.locator(`input[type="number"][data-k="${key}"]`);
  await field.fill(String(value));
  await field.press('Tab');
}

async function snapshot(page) {
  return page.evaluate(() => ({
    params: { ...S }, rows: currentRows(), calculation: currentCalculation(),
    baseKey, primaryKey, mode: calcMode
  }));
}

function expectedResult({ params, rows }) {
  const total = list => list.reduce((sum, row) => sum + row.tec * 52 * row.units, 0);
  const baseKwh = total(rows.old), targetKwh = total(rows.next);
  const kwhYr = baseKwh - targetKwh, costYr = kwhYr * params.price;
  return {
    baseKwh, targetKwh, kwhYr, costYr,
    totalCost: costYr * params.years,
    kwhTotal: kwhYr * params.years,
    co2Yr: kwhYr * params.cf,
    co2Total: kwhYr * params.cf * params.years
  };
}

async function assertMainOutputs(page, expected) {
  for (const key of ['baseKwh', 'targetKwh', 'kwhYr', 'costYr', 'totalCost', 'co2Yr']) {
    const text = await page.locator(`#s1 [data-o="${key}"]`).first().textContent();
    near(number(text), expected[key], 0.51);
  }
}

async function assertPdfOutputs(page, expected) {
  const checks = [
    ['pdfKpiKwh', 'kwhYr', 0.051], ['pdfKpiCostYr', 'costYr', 0.51],
    ['pdfKpiTotalCost', 'totalCost', 0.51], ['pdfKpiKwhTotal', 'kwhTotal', 0.051],
    ['pdfKpiCo2', 'co2Yr', 0.051], ['pdfKpiCo2Total', 'co2Total', 0.051]
  ];
  for (const [id, key, tolerance] of checks) {
    near(number(await page.locator(`#${id}`).textContent()), expected[key], tolerance);
  }
}

async function assertEstimateDisclosure(page, { preset = false, custom = false } = {}) {
  const labels = await page.locator('#s1 [data-o="estimateBasis"]').allTextContents();
  assert.ok(labels.length, 'The main result must disclose its calculation basis');
  for (const label of labels) {
    assert.equal(label, labels[0]);
    assert.match(label, /依輸入 TEC 試算/);
    assert.match(label, /比較條件待確認/);
    assert.equal(label.includes('含預設假設值'), preset);
    assert.equal(label.includes('含使用者自訂 TEC'), custom);
  }
  const unsupportedClaim = /用電減幅|換機後消耗佔比|\d[\d,.]*\s*(?:[%％]|倍)/;
  assert.doesNotMatch(await page.locator('#s1').innerText(), unsupportedClaim);
  const summary = await page.evaluate(() => generateSummaryText());
  assert.ok(summary.includes(labels[0]), 'Copied summary must retain the same disclosure');
  assert.doesNotMatch(summary, unsupportedClaim);
  const expected = expectedResult(await snapshot(page));
  await assertMainOutputs(page, expected);
  await page.locator('#btnExportSummary').click();
  assert.equal(await page.locator('#pdfEstimateBasis').textContent(), labels[0]);
  assert.doesNotMatch(await page.locator('#pdfReportPaper').innerText(), unsupportedClaim);
  assert.doesNotMatch(await page.locator('#pdfChartHbarSvg').innerText(), unsupportedClaim);
  await assertPdfOutputs(page, expected);
  await page.keyboard.press('Escape');
}

test('assumed and custom TEC remain clearly identified in results, summary and PDF', async t => {
  const page = await openPage(t);
  const initial = await snapshot(page);
  near(initial.params.baseTec, 1.6);
  near(initial.params.targetTec, 0.8);
  assert.equal(initial.rows.old[0].speed, 30);
  near(initial.calculation.rate, 50, 1e-7); // Keep arithmetic; suppress unsupported public conclusions.
  assert.match(await page.locator('#abBaseSourceBadge').innerText(), /預設假設，可自行調整/);
  await assertEstimateDisclosure(page, { preset: true });
  await setParameter(page, 'baseTec', 2.3);
  await assertEstimateDisclosure(page, { custom: true });
  await page.locator('#btnReset').click();
  await assertEstimateDisclosure(page, { preset: true });
  await page.locator('[data-go="2"]').click();
  assert.equal(await page.locator('#fSort option[value="tec"]').textContent(), '登錄 TEC 數值由低至高');
});

test('matching speeds and ENERGY STAR version labels do not establish comparable test conditions', async t => {
  const page = await openPage(t);
  const models = await page.evaluate(() => TEC_DATA.models);
  const government = models.filter(m => m.source === 'moea' && m.speed === 30);
  const historical = models.find(m => m.source === 'energystar' && m.archived);
  const current = models.filter(m => m.source === 'energystar' && !m.archived);
  assert.ok(government.length >= 2 && historical && current.length >= 2);
  assert.equal(government[0].standard, null);
  assert.match(historical.standard, /v2\.0/);
  assert.match(current[0].standard, /individual version unpublished/);
  for (const [old, next] of [[government[0], government[1]], [historical, current[0]], [current[0], current[1]]]) {
    for (const [brandId, modelId, model] of [
      ['abBaseBrandSel', 'abBaseModelSel', old], ['abBrandSel', 'abModelSel', next]
    ]) {
      await page.locator(`#${brandId}`).selectOption(model.brand);
      await page.locator(`#${modelId}`).selectOption(model.id);
    }
    const state = await snapshot(page);
    near(state.params.baseTec, old.tec);
    near(state.params.targetTec, next.tec);
    await assertEstimateDisclosure(page);
  }
});

test('fleet disclosures include every assumed or custom row and clear removed assumptions', async t => {
  const page = await openPage(t);
  await page.locator('#btnModeFleet').click();
  await page.locator('#btnAddFleetOld').click();
  const customTec = page.locator('input[data-side="old"][data-index="1"][data-field="tec"]');
  await customTec.fill('0.1');
  await customTec.press('Tab');
  const rows = (await snapshot(page)).rows.old;
  assert.equal(rows[0].source, 'scenario');
  assert.equal(rows[1].source, 'custom');
  await assertEstimateDisclosure(page, { preset: true, custom: true });
  await page.locator('button[data-side="old"][data-index="0"][data-delete]').click();
  await assertEstimateDisclosure(page, { custom: true });
  assert.ok((await snapshot(page)).calculation.kwhYr < 0, 'Negative differences must remain visible');
});

test('default TEC uses the MOEA record and every catalog value has matching source evidence', async t => {
  const page = await openPage(t);
  const state = await snapshot(page);
  const target = state.rows.next[0];
  assert.equal(target.source, 'moea');
  assert.match(target.model, /IM C3010/);
  near(target.tec, 0.8);
  assert.equal(target.speed, 30);
  assert.equal(state.params.units, 1);
  assert.equal(state.rows.old[0].speed, 30);
  assert.equal(state.rows.old[0].source, 'scenario');
  assert.match(await page.locator('#abBaseModelSel option:checked').textContent(), /30 張\/分/);
  assert.match(await page.locator('#abModelSel option:checked').textContent(), /30 張\/分/);
  assert.match(target.company, /互盛/);
  assert.equal(await page.locator('#abModelSel').inputValue(), state.primaryKey);
  assert.equal(await page.locator('#abSourceBadge a').first().getAttribute('href'), target.sourceUrl);
  assert.equal(await page.locator('#comparisonNotice').count(), 0);

  const models = await page.evaluate(() => TEC_DATA.models);
  assert.ok(models.length > 0);
  assert.equal(new Set(models.map(m => m.id)).size, models.length);
  for (const model of models) {
    assert.ok(['moea', 'energystar'].includes(model.source), model.id);
    const original = evidence.find(row => row.source === model.source &&
      String(row.sourceRecordId) === String(model.sourceRecordId) &&
      (row.sourceDataset || null) === (model.sourceDataset || null));
    assert.ok(original, `${model.id} must reference a retained official record`);
    near(model.tec, original.tec);
    for (const field of ['sourceUrl', 'standard', 'voltage', 'certificate', 'company']) {
      assert.equal(model[field] ?? null, original[field] ?? null, `${model.id}: invented or changed ${field}`);
    }
    const url = new URL(model.sourceUrl);
    assert.equal(url.protocol, 'https:');
    assert.ok(model.source === 'moea' ? url.hostname === 'ea03.moeaea.gov.tw' :
      /(^|\.)energystar\.gov$/.test(url.hostname), `${model.id}: unexpected source host`);
    if (model.source === 'moea') assert.equal(url.searchParams.get('itemp0'), String(model.sourceRecordId));
    else assert.ok(model.fallbackReason, `${model.id}: missing MOEA fallback explanation`);
  }
  await page.locator('[data-go="2"]').click();
  const renderedSources = await page.locator('#resBody a[href]').evaluateAll(links => links.map(a => a.href));
  assert.ok(renderedSources.length > 0, 'Results need individual source links');
  assert.ok(renderedSources.every(url => models.some(model => model.sourceUrl === url)));
});

test('TEC sliders use a compact range and preserve high official values across both controls', async t => {
  const page = await openPage(t);
  async function assertRange(key, value, max) {
    const controls = await page.locator(`input[type="range"][data-k="${key}"]`).evaluateAll(elements =>
      elements.map(el => ({ value: +el.value, max: +el.max })));
    assert.deepEqual(controls, [{ value, max }, { value, max }]);
    const ticks = await page.locator(`#r_${key}`).locator('..').locator('.ticks span').allTextContents();
    assert.deepEqual(ticks.map(Number), Array.from({ length: 6 }, (_, i) => max * i / 5));
    near((await snapshot(page)).params[key], value);
  }
  await assertRange('baseTec', 1.6, 5);
  await assertRange('targetTec', 0.8, 5);
  const high = await page.evaluate(() => TEC_DATA.models.find(m => m.model === 'Revoria Press E1136'));
  assert.equal(high.tec, 20.5);
  for (const [brand, model, key] of [
    ['abBaseBrandSel', 'abBaseModelSel', 'baseTec'],
    ['abBrandSel', 'abModelSel', 'targetTec']
  ]) {
    await page.locator(`#${brand}`).selectOption(high.brand);
    await page.locator(`#${model}`).selectOption(high.id);
    await assertRange(key, high.tec, 25);
  }
  // The scale must stay stable during range input, even when crossing a scale boundary.
  await page.locator('#abTargetSlider').press('Home');
  await assertRange('targetTec', 0, 25);
  await page.locator('#abTargetSlider').press('End');
  await assertRange('targetTec', 25, 25);
  await setParameter(page, 'targetTec', 9.2);
  await assertRange('targetTec', 9.2, 10);
  await setParameter(page, 'targetTec', 0.8);
  await assertRange('targetTec', 0.8, 5);
  await page.locator('#abModelSel').selectOption(high.id);
  const standard = await page.evaluate(() => TEC_DATA.models.find(m => m.brand === 'Ricoh' && m.model === 'IM C3010'));
  await page.locator('#abBrandSel').selectOption(standard.brand);
  await page.locator('#abModelSel').selectOption(standard.id);
  await assertRange('targetTec', standard.tec, 5);
  await page.locator('#btnReset').click();
  await assertRange('baseTec', 1.6, 5);
  await assertRange('targetTec', 0.8, 5);
});

test('Ricoh choices prefer Husheng and expose the certificate company in the report', async t => {
  const page = await openPage(t);
  const models = await page.evaluate(() => TEC_DATA.models);
  const c2010 = models.filter(m => m.brand === 'Ricoh' && m.model === 'IM C2010');
  assert.equal(c2010.length, 1);
  assert.match(c2010[0].company, /互盛/);
  assert.match(await page.locator('#abModelSel option:checked').textContent(), /互盛/);
  assert.match(await page.locator('#abSourceBadge').textContent(), /互盛/);
  assert.match(await page.evaluate(() => generateSummaryText()), /互盛/);
  await page.locator('#btnExportSummary').click();
  assert.match(await page.locator('#pdfTableBody').textContent(), /互盛/);
  assert.match(await page.locator('#pdfSourceNotes').textContent(), /互盛/);
  await page.keyboard.press('Escape');

  const fallback = models.find(m => m.brand === 'Ricoh' && m.model === 'IM 3000');
  assert.match(fallback.company, /台灣理光/);
  await page.locator('#abModelSel').selectOption(fallback.id);
  assert.match(await page.locator('#abSourceBadge').textContent(), /台灣理光/);
  near((await snapshot(page)).params.targetTec, fallback.tec);
  assert.equal(models.some(m => m.brand === 'Ricoh' && m.model === 'IM 7000'), false);
  assert.match(await page.evaluate(() => TEC_DATA.unresolved.find(m => m.model === 'IM 7000').reason), /互盛.*待核實/);
});

test('a more expensive replacement retains negative cost, energy and carbon in UI and report', async t => {
  const page = await openPage(t);
  await setParameter(page, 'baseTec', 0.2);
  await setParameter(page, 'targetTec', 2);
  const state = await snapshot(page), expected = expectedResult(state);
  near(expected.kwhYr, -93.6);
  near(expected.costYr, -374.4);
  for (const key of ['kwhYr', 'costYr', 'totalCost', 'co2Yr', 'co2Total']) {
    near(state.calculation[key], expected[key]);
    assert.ok(state.calculation[key] < 0, key);
  }
  await assertMainOutputs(page, expected);
  const cumulativeLabels = await page.locator('#cumCols .v').allTextContents();
  assert.equal(cumulativeLabels.length, state.params.years);
  assert.ok(cumulativeLabels.every(text => number(text) < 0));
  await page.locator('#btnExportSummary').click();
  await assertPdfOutputs(page, expected);
});

test('fractional years normalize to two before calculating and rendering', async t => {
  const page = await openPage(t);
  await setParameter(page, 'years', 1.5);
  const state = await snapshot(page);
  assert.equal(state.params.years, 2);
  assert.equal(Number(await page.locator('input[type="number"][data-k="years"]').inputValue()), 2);
  assert.equal(state.calculation.cum.length, 2);
  near(state.calculation.totalCost, state.calculation.kwhTotal * state.params.price);
  await assertMainOutputs(page, expectedResult(state));
  await page.locator('#btnExportSummary').click();
  assert.equal(await page.locator('#pdfParamYears').textContent(), '2');
  await assertPdfOutputs(page, expectedResult(state));
});

test('reset restores matching names, TEC values and selected record IDs', async t => {
  const page = await openPage(t);
  await page.locator('#abBaseBrandSel').selectOption('CUSTOM');
  await page.locator('#abBaseName').fill('測試自訂舊機');
  await setParameter(page, 'baseTec', 7.25);
  await setParameter(page, 'targetTec', 3.4);
  await setParameter(page, 'years', 9);
  await page.locator('#btnReset').click();
  const state = await snapshot(page);
  assert.equal(state.baseKey, 'scenario-5c');
  assert.equal(await page.locator('#abBaseModelSel').inputValue(), state.baseKey);
  assert.equal(await page.locator('#abModelSel').inputValue(), state.primaryKey);
  assert.equal(state.params.baseTec, 1.6);
  assert.match(state.params.baseName, /5 年.*情境假設/);
  assert.equal(state.params.years, 5);
  assert.equal(state.params.units, 1);
  const records = await page.evaluate(() => ({ base: findModel(baseKey), target: MASTER_MAP.get(primaryKey) }));
  assert.equal(state.params.baseName, records.base.model);
  near(state.params.baseTec, records.base.tec);
  near(state.params.targetTec, records.target.tec);
  near(number(await page.locator('#abTargetTecOut').textContent()), records.target.tec);
  assert.match(await page.locator('#abBaseModelSel option:checked').textContent(), /5 年/);
  assert.equal(state.rows.old[0].speed, 30);
  assert.equal(state.rows.next[0].speed, 30);
  await page.locator('#btnModeFleet').click();
  const fleet = await snapshot(page);
  assert.equal(fleet.rows.old[0].units, 1);
  assert.equal(fleet.rows.next[0].units, 1);
  assert.equal(fleet.rows.old[0].speed, 30);
  assert.equal(fleet.rows.next[0].speed, 30);
});

test('archived ENERGY STAR options explain the old certification source', async t => {
  const page = await openPage(t);
  const archived = await page.evaluate(() => TEC_DATA.models.find(m => m.brand === 'Ricoh' && m.archived));
  await page.locator('#abModelSel').selectOption(archived.id);
  assert.match(await page.locator('#abModelSel option:checked').textContent(), /舊版認證資料/);
  assert.doesNotMatch(await page.locator('#abModelSel option:checked').textContent(), /歷史紀錄/);
  assert.match(await page.locator('#abSourceBadge').textContent(), /ENERGY STAR（舊版認證資料）/);
  assert.match(await page.locator('#abSourceBadge').textContent(), /不代表目前仍有效認證/);
  assert.equal(await page.locator('#comparisonNotice').count(), 0);
  assert.doesNotMatch(await page.evaluate(() => generateSummaryText()), /標準化用電情境推估|測試版本或電壓未確認一致/);
  await page.locator('#btnExportSummary').click();
  assert.equal(await page.locator('#pdfComparisonNotice').count(), 0);
});

test('unequal multi-row fleets agree across cards, audit formulas and PDF', async t => {
  const page = await openPage(t);
  await page.locator('#btnModeFleet').click();
  await page.locator('#btnAddFleetOld').click();
  await page.locator('#btnAddFleetNew').click();
  for (const [side, index, field, value] of [
    ['old', 0, 'units', 3], ['old', 0, 'tec', 1.1],
    ['old', 1, 'units', 2], ['old', 1, 'tec', 0.9],
    ['new', 0, 'units', 1], ['new', 1, 'units', 2]
  ]) {
    const input = page.locator(`input[data-side="${side}"][data-index="${index}"][data-field="${field}"]`);
    await input.fill(String(value));
    await input.press('Tab');
  }
  const state = await snapshot(page), expected = expectedResult(state);
  assert.equal(state.rows.old.length, 2);
  assert.equal(state.rows.next.length, 2);
  assert.equal(state.calculation.totalUnitsOld, 5);
  assert.equal(state.calculation.totalUnitsNew, 3);
  for (const [key, value] of Object.entries(expected)) near(state.calculation[key], value);
  assert.equal(await page.locator('#comparisonNotice').count(), 0);
  await assertMainOutputs(page, expected);
  await page.locator('button[data-audit="total"]').click();
  const formulas = await page.locator('#dBody').evaluate(el =>
    Object.fromEntries([...el.querySelectorAll('h4')].map(h => [h.textContent, h.nextElementSibling?.textContent])));
  for (const [heading, key] of [['年用電差額', 'kwhYr'], ['年電費差額', 'costYr'],
    [`${state.params.years} 年累計`, 'totalCost'], ['年碳排差額', 'co2Yr']]) {
    assert.ok(formulas[heading], `Missing audit formula: ${heading}`);
    near(number(formulas[heading].split('=').at(-1)), expected[key], 0.051);
  }
  const auditText = await page.locator('#dBody').textContent();
  assert.match(auditText, /× 52 × 3/);
  assert.match(auditText, /× 52 × 2/);
  await page.keyboard.press('Escape');
  await page.locator('#btnExportSummary').click();
  await assertPdfOutputs(page, expected);
  assert.equal(await page.locator('#pdfTableBody tr').count(), 4);
  assert.equal(await page.locator('#pdfComparisonNotice').count(), 0);
  const sourceLinks = await page.locator('#pdfSourceNotes a[href]').evaluateAll(links => links.map(a => a.href));
  for (const row of [...state.rows.old, ...state.rows.next].filter(row => row.sourceUrl)) {
    assert.ok(sourceLinks.includes(row.sourceUrl), `Report lost source for ${row.model}`);
  }
});

test('repeated fleet TEC edits retain record identity while marking the values custom', async t => {
  const page = await openPage(t);
  const initial = await snapshot(page), target = initial.rows.next[0];
  await page.locator('#btnModeFleet').click();
  const field = name => page.locator(`[data-side="old"][data-index="0"][data-field="${name}"]`);
  await field('brand').selectOption(target.brand);
  await field('model').selectOption(target.id);
  const original = (await snapshot(page)).rows.old[0];
  for (const tec of [2.5, 3.75]) {
    await field('tec').fill(String(tec));
    await field('tec').press('Tab');
    const row = (await snapshot(page)).rows.old[0];
    assert.equal(row.id, original.id);
    assert.equal(row.brand, original.brand);
    assert.equal(row.model, original.model);
    assert.equal(row.source, 'custom');
    near(row.tec, tec);
    assert.equal(row.sourceUrl, null);
    assert.equal(row.certificate, null);
    assert.equal(row.reference.id, original.id);
    assert.equal(row.reference.source, original.source);
    assert.equal(row.reference.sourceUrl, original.sourceUrl);
    assert.equal(await field('brand').inputValue(), original.brand);
    assert.equal(await field('model').inputValue(), original.id);
    assert.match(await page.locator('#fleetOldRows .fleet-row').first().textContent(), /使用者自訂/);
  }

  // A custom row has no catalog ID; editing it twice must not erase its brand.
  await field('brand').selectOption('CUSTOM');
  const customIdentity = (await snapshot(page)).rows.old[0];
  for (const tec of [1.125, 2.625]) {
    await field('tec').fill(String(tec));
    await field('tec').press('Tab');
    const row = (await snapshot(page)).rows.old[0];
    assert.equal(row.brand, 'CUSTOM');
    assert.equal(row.model, customIdentity.model);
    assert.equal(row.source, 'custom');
    near(row.tec, tec);
    assert.equal(row.sourceUrl ?? null, null);
    assert.equal(await field('brand').inputValue(), 'CUSTOM');
    assert.equal(await field('model').inputValue(), customIdentity.model);
  }
});

test('removing comparison chips never clears the selected target or its source', async t => {
  const page = await openPage(t);
  const initial = await snapshot(page), selected = initial.rows.next[0];
  const alternative = await page.locator('#abModelSel').evaluate((select, selectedId) =>
    [...select.options].find(option => option.value !== selectedId)?.value, initial.primaryKey);
  assert.ok(alternative, 'This scenario needs another record in the selected brand');
  await page.locator('#abModelSel').selectOption(alternative);
  await page.locator('#abModelSel').selectOption(initial.primaryKey);
  await page.locator('[data-go="2"]').click();
  assert.equal(await page.locator('#chips [data-rm]').count(), 2);

  for (const removedId of [initial.primaryKey, alternative]) {
    await page.locator(`#chips button[data-rm="${removedId}"]`).click();
    const state = await snapshot(page), target = state.rows.next[0];
    assert.equal(state.primaryKey, initial.primaryKey);
    assert.equal(target.id, selected.id);
    assert.equal(target.source, selected.source);
    assert.equal(target.sourceUrl, selected.sourceUrl);
    assert.equal(target.certificate, selected.certificate);
    near(state.params.targetTec, initial.params.targetTec);
    assert.equal(state.params.targetName, initial.params.targetName);
    const comparisonIds = await page.evaluate(() => compare.map(model => model.id));
    assert.ok(!comparisonIds.includes(removedId));
    await page.locator('[data-go="1"]').click();
    assert.equal(await page.locator('#abModelSel').inputValue(), initial.primaryKey);
    assert.equal(await page.locator('#abSourceBadge a').first().getAttribute('href'), selected.sourceUrl);
    await page.locator('[data-go="2"]').click();
  }
  assert.equal(await page.locator('#chips [data-rm]').count(), 0);
});

test('custom TEC and carbon factors are never presented as official measured values', async t => {
  const page = await openPage(t);
  await setParameter(page, 'targetTec', 0.123);
  await setParameter(page, 'cf', 0.5);
  const state = await snapshot(page), custom = state.rows.next[0];
  assert.equal(custom.source, 'custom');
  assert.equal(custom.sourceUrl, null);
  assert.equal(custom.certificate, null);
  assert.equal(custom.standard, null);
  assert.equal(await page.locator('#abSourceBadge a').count(), 0);
  assert.match(await page.locator('#abSourceBadge').textContent(), /使用者自訂/);
  await page.locator('#btnExportSummary').click();
  assert.match(await page.locator('#pdfTableBody').textContent(), /使用者自訂/);
  assert.doesNotMatch(await page.locator('#pdfTableBody').textContent(), /節能標章認證|v3\.0 實測/);
  const reportText = await page.locator('#pdfSourceNotes').textContent();
  assert.match(reportText, /0\.500.*使用者自訂係數/s);
  assert.doesNotMatch(reportText, /(?:官方公告值|公告係數)[^。\n]{0,12}0\.500|0\.500[^。\n]{0,12}官方公告值/);
  const summary = await page.evaluate(() => generateSummaryText());
  assert.match(summary, /0\.5 kg CO₂e\/度（使用者自訂係數/);
});

test('dialogs trap focus, block page shortcuts and restore focus on Escape', async t => {
  const page = await openPage(t);
  for (const [trigger, dialog, key] of [
    ['#btnExportSummary', '#exportModal', 'Enter'],
    ['[data-audit="cost"]', '#drawer', 'Space']
  ]) {
    await page.locator(trigger).focus();
    await page.keyboard.press(key);
    assert.equal(await page.locator(dialog).getAttribute('aria-hidden'), 'false');
    assert.equal(await page.locator(dialog).evaluate(el => el.inert), false);
    assert.equal(await page.locator('main').evaluate(el => el.inert), true);
    assert.ok(await page.locator(dialog).evaluate(el => el.contains(document.activeElement)));
    const currentPage = await page.locator('#pageNo').textContent();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#pageNo').textContent(), currentPage);

    const focusable = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex="0"],[contenteditable="true"]';
    await page.locator(dialog).evaluate((el, selector) => {
      [...el.querySelectorAll(selector)].filter(node => node.getClientRects().length)[0].focus();
    }, focusable);
    await page.keyboard.press('Shift+Tab');
    assert.ok(await page.locator(dialog).evaluate((el, selector) => {
      const items = [...el.querySelectorAll(selector)].filter(node => node.getClientRects().length);
      return document.activeElement === items.at(-1);
    }, focusable), `${dialog}: reverse tab must wrap to last control`);
    await page.keyboard.press('Tab');
    assert.ok(await page.locator(dialog).evaluate((el, selector) => {
      const items = [...el.querySelectorAll(selector)].filter(node => node.getClientRects().length);
      return document.activeElement === items[0];
    }, focusable), `${dialog}: tab must wrap to first control`);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator(dialog).getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator(dialog).evaluate(el => el.inert), true);
    assert.equal(await page.locator('main').evaluate(el => el.inert), false);
    assert.ok(await page.locator(trigger).evaluate(el => el === document.activeElement));
  }
});

test('375px viewport contains all pages, fleet controls and report dialog without body overflow', async t => {
  const page = await openPage(t, { width: 375, height: 812 });
  const assertNoBodyOverflow = async label => {
    const size = await page.evaluate(() => ({
      viewport: innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth
    }));
    assert.ok(size.body <= size.viewport + 1 && size.document <= size.viewport + 1,
      `${label}: ${JSON.stringify(size)}`);
  };
  for (const index of [1, 2, 3]) {
    await page.locator(`[data-go="${index}"]`).click();
    await assertNoBodyOverflow(`page ${index}`);
  }
  await page.locator('[data-go="1"]').click();
  await page.locator('#btnModeFleet').click();
  await page.locator('#btnAddFleetOld').click();
  await page.locator('#btnAddFleetNew').click();
  await assertNoBodyOverflow('multi-row fleet');
  await page.locator('#btnExportSummary').click();
  await assertNoBodyOverflow('PDF preview');
  const dialogBounds = await page.locator('#exportModal > div').boundingBox();
  assert.ok(dialogBounds.x >= 0 && dialogBounds.x + dialogBounds.width <= 376);
  const closeBounds = await page.locator('#btnCloseExport').boundingBox();
  assert.ok(closeBounds.x >= 0 && closeBounds.x + closeBounds.width <= 376);
  assert.ok(await page.locator('.pdf-modal-scroll').evaluate(el => el.clientHeight > 0 && el.scrollHeight >= el.clientHeight));
});
