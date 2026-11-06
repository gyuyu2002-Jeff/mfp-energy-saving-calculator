/* Shared calculation rules for the page, audit drawer and exported report. */
const EnergyCalculator = (() => {
  const limits = {
    units: [1, 200, 1], years: [1, 10, 1],
    baseTec: [0, 1000, 0.001], targetTec: [0, 1000, 0.001],
    price: [0, 20, 0.1], cf: [0, 2, 0.001]
  };
  function normalize(key, raw) {
    const rule = limits[key];
    const value = Number(raw);
    if (!rule || raw === '' || !Number.isFinite(value)) return null;
    const [min, max, step] = rule;
    return Number((Math.round(Math.min(max, Math.max(min, value)) / step) * step).toFixed(3));
  }
  function calculate(state, oldRows, newRows) {
    const years = normalize('years', state.years);
    const price = normalize('price', state.price);
    const cf = normalize('cf', state.cf);
    const total = rows => rows.reduce((sum, row) => {
      const units = normalize('units', row.units);
      const tec = normalize('baseTec', row.tec);
      if (units === null || tec === null) throw new Error('請輸入有效的台數與 TEC');
      return { units: sum.units + units, kwh: sum.kwh + tec * 52 * units };
    }, { units: 0, kwh: 0 });
    if (years === null || price === null || cf === null) throw new Error('請輸入有效的試算參數');
    const old = total(oldRows), next = total(newRows);
    const kwhYr = old.kwh - next.kwh;
    const costYr = kwhYr * price;
    const cum = Array.from({ length: years }, (_, i) => costYr * (i + 1));
    const denominator = old.units || 1;
    return {
      baseKwh: old.kwh, targetKwh: next.kwh, kwhYr,
      rate: old.kwh > 0 ? kwhYr / old.kwh * 100 : null,
      baseCost: old.kwh * price, targetCost: next.kwh * price,
      costYr, costUnit: costYr / denominator, kwhUnit: kwhYr / denominator,
      totalCost: costYr * years, cum, kwhTotal: kwhYr * years,
      co2Yr: kwhYr * cf, co2Total: kwhYr * cf * years,
      ratio: old.kwh > 0 ? next.kwh / old.kwh : null,
      totalUnitsOld: old.units, totalUnitsNew: next.units,
      avgBaseTec: old.units ? old.kwh / (52 * old.units) : 0,
      avgTargetTec: next.units ? next.kwh / (52 * next.units) : 0
    };
  }
  return { normalize, calculate, limits };
})();
if (typeof module !== 'undefined') module.exports = EnergyCalculator;
