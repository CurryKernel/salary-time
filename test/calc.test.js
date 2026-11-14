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
const overtimeHourly = (base, days) => saturdayDaily(base, days) / 8;

test('2026 年 11 月：21 个工作日，最后一个周六是 28 号', () => {
  assert.equal(calc.countWeekdays(2026, 10), 21);
  assert.equal(calc.lastSaturdayOfMonth(2026, 10), 28);
  assert.equal(calc.isEndOfMonthSaturday(new Date(2026, 10, 28)), true);
  assert.equal(calc.isEndOfMonthSaturday(new Date(2026, 10, 21)), false);
  assert.equal(calc.isEndOfMonthSaturday(new Date(2026, 10, 27)), false);
});

test('固定月薪：普通工作日日薪 = 月薪 ÷ 当月工作日（11 月 21 天）', () => {
  const s = settings();
  const wednesday = new Date(2026, 10, 11);
  assert.equal(calc.dayType(wednesday, s), 'workday');
  near(calc.dayAmountForDate(wednesday, s), normalDaily(20000, 5000, 21));
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

test('实际工作日模式：正常日薪仍按固定月薪摊算，加班折算天数不同', () => {
  const s = settings({ useActualWorkdays: true });
  const wednesday = new Date(2026, 10, 11);
  assert.equal(calc.effectiveWorkdays(s, 2026, 10), 21);
  near(calc.dayAmountForDate(wednesday, s), normalDaily(20000, 5000, 21));
  near(calc.dayAmountForDate(new Date(2026, 10, 28), s), saturdayDaily(20000, 21));
});

test('手动覆盖当月工作日只影响加班折算，不影响固定月薪', () => {
  const s = settings({ useActualWorkdays: true, actualWorkdaysOverride: 22 });
  assert.equal(calc.effectiveWorkdays(s, 2026, 10), 22);
  near(calc.dayAmountForDate(new Date(2026, 10, 11), s), normalDaily(20000, 5000, 21));
  near(calc.dayAmountForDate(new Date(2026, 10, 28), s), saturdayDaily(20000, 22));
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

  const day = normalDaily(20000, 5000, 21);
  near(calc.compute(at(12, 30), s).todayEarned, day * (3 / 8));
  near(calc.compute(at(21, 0), s).todayEarned, day);
});

test('本月 / 本周累计（11 月 11 日 19:00）', () => {
  const s = settings();
  const now = new Date(2026, 10, 11, 19, 0, 0);
  const day = normalDaily(20000, 5000, 21);
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
  const day = normalDaily(20000, 5000, 21);
  const lunch = calc.compute(new Date(2026, 10, 11, 12, 30, 0), s);
  const noon = calc.compute(new Date(2026, 10, 11, 12, 0, 0), s);
  near(lunch.todayEarned, noon.todayEarned);
  near(lunch.todayEarned, day * (3 / 8));
});

test('本月预计 = 固定月薪 + 月末周六双倍', () => {
  const s = settings();
  const result = calc.compute(new Date(2026, 10, 11, 10, 0, 0), s);
  near(result.fixedMonthly, 25000);
  near(result.normalDailyAmount, normalDaily(20000, 5000, 21));
  near(result.weekProjected, 5 * normalDaily(20000, 5000, 21));
  near(result.monthProjected, 25000 + saturdayDaily(20000, 21.75));
  assert.equal(result.monthOvertime, 0);
  assert.equal(result.monthOvertimeDays, 0);
});

test('月末正常工作结束后，本月累计正好等于本月预计', () => {
  const s = settings();
  const result = calc.compute(new Date(2026, 10, 30, 23, 0, 0), s);
  near(result.monthly, 25000 + saturdayDaily(20000, 21.75));
  near(result.monthly, result.monthProjected);
  near(result.monthPercent, 1);
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
  const octDay = normalDaily(20000, 5000, 22);
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

test('手动添加周末加班：自定义时段，不足 8 小时按实际工时折算', () => {
  const s = settings({ overtimeDays: [{ date: '2026-11-21', workStart: '10:00', workEnd: '15:00' }] });
  const saturday = new Date(2026, 10, 21);
  assert.equal(calc.dayType(saturday, s), 'overtime');
  assert.equal(calc.overtimeKind(saturday, s), 'weekend');
  // 10:00-12:00 + 13:30-15:00，扣除 12:00-13:30 固定休息
  near(calc.workPeriod(s, saturday).totalSeconds, 3.5 * 3600);
  near(calc.dayAmountForDate(saturday, s), overtimeHourly(20000, 21.75) * 3.5);
  // 未添加的周日仍不计薪
  assert.equal(calc.dayType(new Date(2026, 10, 22), s), 'rest');
  assert.equal(calc.dayAmountForDate(new Date(2026, 10, 22), s), 0);
});

test('周末加班固定休息 12:00-13:30 与 18:00-18:30 均不计薪', () => {
  const s = settings({ overtimeDays: [{ date: '2026-11-21', workStart: '09:00', workEnd: '19:00' }] });
  const at = (h, m) => new Date(2026, 10, 21, h, m, 0);
  const period = calc.workPeriod(s, new Date(2026, 10, 21));
  near(period.restSeconds, 2 * 3600);
  near(period.totalSeconds, 8 * 3600); // 10 小时 - 1.5 小时 - 0.5 小时

  assert.equal(calc.phaseAt(at(12, 30), s), 'lunch');
  assert.equal(calc.phaseAt(at(18, 10), s), 'lunch');
  near(calc.fractionAt(at(12, 30), s), 3 / 8);
  near(calc.fractionAt(at(13, 30), s), 3 / 8);
  near(calc.fractionAt(at(14, 0), s), 3.5 / 8);
  near(calc.fractionAt(at(18, 20), s), 7.5 / 8);
  near(calc.fractionAt(at(19, 0), s), 1);
});

test('周末加班当天费用 = 时薪 × 实际工时', () => {
  const s = settings({ overtimeDays: [{ date: '2026-11-21', workStart: '09:00', workEnd: '19:00' }] });
  const hourly = overtimeHourly(20000, 21.75);
  const result = calc.compute(new Date(2026, 10, 21, 21, 0, 0), s);
  near(result.dayAmount, hourly * 8);
  near(result.todayEarned, hourly * 8);
  near(result.hourlyRate, hourly);
});

test('实际工作日模式下周末加班同样按时薪与实际工时计费', () => {
  const s = settings({
    useActualWorkdays: true,
    overtimeDays: [{ date: '2026-11-22', workStart: '09:00', workEnd: '18:00' }]
  });
  const period = calc.workPeriod(s, new Date(2026, 10, 22));
  near(period.totalSeconds, 7.5 * 3600); // 9 小时 - 1.5 小时午休
  near(calc.dayAmountForDate(new Date(2026, 10, 22), s), overtimeHourly(20000, 21) * 7.5);
});

test('本月预计包含手动添加的周末加班（按实际工时）', () => {
  const s = settings({ overtimeDays: [{ date: '2026-11-21', workStart: '10:00', workEnd: '15:00' }] });
  const result = calc.compute(new Date(2026, 10, 11, 10, 0, 0), s);
  const expectedOvertime = overtimeHourly(20000, 21.75) * 3.5;
  near(result.monthProjected,
    25000 + saturdayDaily(20000, 21.75) + expectedOvertime);
  near(result.monthOvertime, expectedOvertime);
  assert.equal(result.monthOvertimeDays, 1);
});

test('工作日、非法日期与非法时段会被忽略，月末周六仍自动双倍', () => {
  const s = settings({
    overtimeDays: [
      { date: '2026-11-11', workStart: '09:00', workEnd: '18:00' },
      { date: '2026-02-30', workStart: '09:00', workEnd: '18:00' },
      { date: '2026-11-22', workStart: '18:00', workEnd: '09:00' },
      { date: '2026-11-21', workStart: '09:00', workEnd: '18:00' }
    ]
  });
  assert.equal(calc.normalizeSettings(s).overtimeDays.length, 1);
  assert.equal(calc.dayType(new Date(2026, 10, 11), s), 'workday');
  assert.equal(calc.overtimeKind(new Date(2026, 10, 28), s), 'month-end');
});

test('旧数据缺少加班起止时间时退回全局上下班时间', () => {
  const s = settings({ overtimeDays: [{ date: '2026-11-21' }] });
  const entry = calc.overtimeEntryForDate(new Date(2026, 10, 21), s);
  assert.equal(entry.workStart, '09:00');
  assert.equal(entry.workEnd, '18:00');
});
