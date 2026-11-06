const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculate, normalize } = require('../assets/calculator.js');
const state = { years: 5, price: 4, cf: 0.466 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('more consumption remains a negative saving in every output', () => {
  const result = calculate(state, [{tec: 0.2, units: 1}], [{tec: 2, units: 1}]);
  near(result.kwhYr, -93.6);
  near(result.costYr, -374.4);
  near(result.totalCost, -1872);
  near(result.rate, -900);
  assert.ok(result.co2Yr < 0 && result.cum.every(v => v < 0));
});
test('fleet aggregates each model and each side independently', () => {
  const result = calculate(state, [{tec: 1.1, units: 2}, {tec: 1.15, units: 1}], [{tec: 0.2, units: 2}, {tec: 0.23, units: 1}]);
  near(result.totalCost, 2828.8);
  assert.equal(result.totalUnitsOld, 3);
  near(result.totalCost, result.kwhTotal * state.price);
});
test('years and units normalize to bounded integers before rendering', () => {
  assert.equal(normalize('years', 1.5), 2);
  assert.equal(normalize('years', 1e100), 10);
  assert.equal(normalize('years', Infinity), null);
  assert.equal(normalize('units', ''), null);
  assert.equal(normalize('units', -1), 1);
  assert.equal(normalize('units', 9999), 200);
  const result = calculate({...state, years: 1.5}, [{tec: 1.6, units: 2}], [{tec: 0.2, units: 2}]);
  assert.equal(result.cum.length, 2);
  near(result.totalCost, result.kwhTotal * state.price);
});
test('zero baseline has no invented percentage or ratio', () => {
  const result = calculate(state, [{tec: 0, units: 1}], [{tec: 1, units: 1}]);
  assert.equal(result.rate, null);
  assert.equal(result.ratio, null);
  near(result.costYr, -208);
});
test('official TEC above old slider maxima is preserved', () => {
  assert.equal(normalize('targetTec', 8.7), 8.7);
  near(calculate(state, [{tec: 1.6, units: 2}], [{tec: 8.7, units: 2}]).targetKwh, 904.8);
});
