'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { DEFAULT_SETTINGS } = require('../src/shared/defaults.js');
const calc = require('../src/shared/calc.js');

const near = (actual, expected, epsilon = 1e-6) => {
  assert.ok(Math.abs(actual - expected) < epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`);
};

const settings = (patch) => Object.assign({}, DEFAULT_SETTINGS, patch);

const normalDaily = (base, bonus, days) => (base + bonus) / days;
const saturdayDaily = (base, days) => (base / days) * 2;

test('2026 年 11 月：21 个工作日，最后一个周六是 28 号', () => {
  assert.equal(calc.countWeekdays(2026, 10), 21);
  assert.equal(calc.lastSaturdayOfMonth(2026, 10), 28);
  assert.equal(calc.isEndOfMonthSaturday(new Date(2026, 10, 28)), true);
  assert.equal(calc.isEndOfMonthSaturday(new Date(2026, 10, 21)), false);
  assert.equal(calc.isEndOfMonthSaturday(new Date(2026, 10, 27)), false);
});

test('21.75 天模式：普通工作日日薪 = (基础+绩效)/21.75', () => {
  const s = settings();
  const wednesday = new Date(2026, 10, 11);
  assert.equal(calc.dayType(wednesday, s), 'workday');
  near(calc.dayAmountForDate(wednesday, s), normalDaily(20000, 5000, 21.75));
});

test('21.75 天模式：月末周六 = 基础工资/21.75*2，不含绩效', () => {
  const s = settings();
  const saturday = new Date(2026, 10, 28);
  assert.equal(calc.dayType(saturday, s), 'overtime');
  near(calc.dayAmountForDate(saturday, s), saturdayDaily(20000, 21.75));
  near(calc.dayAmountForDate(saturday, s), 1839.080459770115);
});

test('普通周末不计薪', () => {
  const s = settings();
  const saturday = new Date(2026, 10, 7);
  assert.equal(calc.dayType(saturday, s), 'rest');
  assert.equal(calc.dayAmountForDate(saturday, s), 0);
  const sunday = new Date(2026, 10, 8);
  assert.equal(calc.dayType(sunday, s), 'rest');
});

test('实际工作日模式：11 月按 21 天摊算', () => {
  const s = settings({ useActualWorkdays: true });
  const wednesday = new Date(2026, 10, 11);
  assert.equal(calc.effectiveWorkdays(s, 2026, 10), 21);
  near(calc.dayAmountForDate(wednesday, s), normalDaily(20000, 5000, 21));
  near(calc.dayAmountForDate(new Date(2026, 10, 28), s), saturdayDaily(20000, 21));
});

test('实际工作日模式：支持手动覆盖工作日数（用于法定节假日调整）', () => {
  const s = settings({ useActualWorkdays: true, actualWorkdaysOverride: 22 });
  near(calc.dayAmountForDate(new Date(2026, 10, 11), s), normalDaily(20000, 5000, 22));
});

test('工时进度：9:00-18:00，午休 12:00-13:00，共 8 小时', () => {
  const s = settings();
  const at = (h, m) => new Date(2026, 10, 11, h, m, 0);
  near(calc.fractionAt(at(8, 0), s), 0);
  near(calc.fractionAt(at(9, 0), s), 0);
  near(calc.fractionAt(at(10, 30), s), 1.5 / 8);
  near(calc.fractionAt(at(12, 0), s), 3 / 8);
  near(calc.fractionAt(at(12, 30), s), 3 / 8);
  near(calc.fractionAt(at(13, 30), s), 3.5 / 8);
  near(calc.fractionAt(at(17, 0), s), 7 / 8);
  near(calc.fractionAt(at(18, 0), s), 1);
  near(calc.fractionAt(at(21, 0), s), 1);
});

test('状态：午休冻结、下班后满额、上班前为 0', () => {
  const s = settings();
  const at = (h, m) => new Date(2026, 10, 11, h, m, 0);
  assert.equal(calc.phaseAt(at(8, 0), s), 'before');
  assert.equal(calc.phaseAt(at(12, 30), s), 'lunch');
  assert.equal(calc.phaseAt(at(15, 0), s), 'working');
  assert.equal(calc.phaseAt(at(19, 0), s), 'after');
  assert.equal(calc.phaseAt(new Date(2026, 10, 7, 15, 0), s), 'rest');

  const day = normalDaily(20000, 5000, 21.75);
  near(calc.compute(at(12, 30), s).todayEarned, day * (3 / 8));
  near(calc.compute(at(21, 0), s).todayEarned, day);
});

test('本月 / 本周累计（11 月 11 日 19:00）', () => {
  const s = settings();
  const now = new Date(2026, 10, 11, 19, 0, 0);
  const day = normalDaily(20000, 5000, 21.75);
  const result = calc.compute(now, s);

  // 11/2 - 11/6 + 11/9 - 11/11 = 8 个工作日
  near(result.monthly, 8 * day);
  // 本周 11/9 - 11/15，已过 11/9 - 11/11 = 3 个工作日
  near(result.weekly, 3 * day);
  assert.equal(result.weekRangeLabel, '11/9 - 11/15');
  assert.equal(result.dayType, 'workday');
  assert.equal(result.phase, 'after');
});

test('午休中累计金额冻结在 12:00', () => {
  const s = settings();
  const day = normalDaily(20000, 5000, 21.75);
  const lunch = calc.compute(new Date(2026, 10, 11, 12, 30, 0), s);
  const noon = calc.compute(new Date(2026, 10, 11, 12, 0, 0), s);
  near(lunch.todayEarned, noon.todayEarned);
  near(lunch.todayEarned, day * (3 / 8));
});

test('本月预计：21 个工作日 + 月末周六双倍', () => {
  const s = settings();
  const result = calc.compute(new Date(2026, 10, 11, 10, 0, 0), s);
  near(result.weekProjected, 5 * normalDaily(20000, 5000, 21.75));
  near(result.monthProjected,
    21 * normalDaily(20000, 5000, 21.75) + saturdayDaily(20000, 21.75));
});

test('实际工作日模式下本月预计 = 月薪 + 月末周六双倍基础', () => {
  const s = settings({ useActualWorkdays: true });
  const result = calc.compute(new Date(2026, 10, 11, 10, 0, 0), s);
  near(result.monthProjected, 25000 + saturdayDaily(20000, 21));
});

test('月末周六：全天按时段累计，日薪按双倍基础工资', () => {
  const s = settings();
  const morning = calc.compute(new Date(2026, 10, 28, 10, 30, 0), s);
  const evening = calc.compute(new Date(2026, 10, 28, 21, 0, 0), s);
  near(morning.dayAmount, saturdayDaily(20000, 21.75));
  near(morning.todayEarned, saturdayDaily(20000, 21.75) * (1.5 / 8));
  near(evening.todayEarned, saturdayDaily(20000, 21.75));
});

test('跨月的一周：周范围与累计跨越月份边界', () => {
  const s = settings();
  // 2026-11-01 是周日，本周从 10-26（周一）开始；其中 10-31 是 10 月的月末周六
  const result = calc.compute(new Date(2026, 10, 1, 10, 0, 0), s);
  assert.equal(result.weekRangeLabel, '10/26 - 11/1');
  const octDay = normalDaily(20000, 5000, 21.75);
  near(result.weekly, 5 * octDay + saturdayDaily(20000, 21.75));
});

test('倒计时：上班前 / 午休 / 工作中', () => {
  const s = settings();
  const at = (h, m) => new Date(2026, 10, 11, h, m, 0);
  assert.equal(calc.compute(at(8, 0), s).countdownSeconds, 3600);
  assert.equal(calc.compute(at(12, 30), s).countdownSeconds, 1800);
  assert.equal(calc.compute(at(17, 0), s).countdownSeconds, 3600);
  assert.equal(calc.compute(at(19, 0), s).countdownSeconds, 0);
});

test('自定义工作时间与午休', () => {
  const s = settings({ workStart: '10:00', workEnd: '19:00', lunchStart: '13:00', lunchEnd: '14:00' });
  const at = (h, m) => new Date(2026, 10, 11, h, m, 0);
  near(calc.fractionAt(at(11, 0), s), 1 / 8);
  near(calc.fractionAt(at(13, 30), s), 3 / 8);
  near(calc.fractionAt(at(18, 0), s), 7 / 8);
});

test('工资为 0 时仍然可以判断工作日与进度', () => {
  const s = settings({ baseSalary: 0, bonusSalary: 0 });
  const result = calc.compute(new Date(2026, 10, 11, 12, 0, 0), s);
  assert.equal(result.dayType, 'workday');
  assert.equal(result.todayEarned, 0);
  near(result.fraction, 3 / 8);
});
