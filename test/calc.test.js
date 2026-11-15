'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_SETTINGS } = require('../src/shared/defaults.js');
const calc = require('../src/shared/calc.js');

const near = (actual, expected, epsilon = 1e-6) => {
  assert.ok(Math.abs(actual - expected) < epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`);
};

const settings = (patch) => Object.assign({}, DEFAULT_SETTINGS, patch);

const normalDaily = (base, bonus, days) => (base + bonus) / days;
const overtimeHourly = (base, days) => ((base / days) * 2) / 8;
const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

test('2026 年 11 月：21 个工作日，最后一个周六是 28 号', () => {
  assert.equal(calc.countWeekdays(2026, 10), 21);
  assert.equal(calc.lastSaturdayOfMonth(2026, 10), 28);
  assert.equal(calc.isEndOfMonthSaturday(new Date(2026, 10, 28)), true);
  assert.equal(calc.isEndOfMonthSaturday(new Date(2026, 10, 21)), false);
});

test('固定月薪：普通工作日日薪 = 月薪 ÷ 当月工作日（11 月 21 天）', () => {
  const s = settings();
  const wednesday = new Date(2026, 10, 11);
  assert.equal(calc.dayType(wednesday, s), 'workday');
  near(calc.dayAmountForDate(wednesday, s), normalDaily(20000, 5000, 21));
});

test('月末周六自动转调休，不计工资', () => {
  const s = settings();
  const saturday = new Date(2026, 10, 28);
  assert.equal(calc.dayType(saturday, s), 'overtime');
  assert.equal(calc.isCompDay(saturday, s), true);
  assert.equal(calc.dayAmountForDate(saturday, s), 0);
  const result = calc.compute(new Date(2026, 10, 28, 10, 30, 0), s);
  assert.equal(result.todayIsComp, true);
  assert.equal(result.todayEarned, 0);
  assert.equal(result.monthEndCompDays, 1);
  assert.equal(result.monthCompDays, 1);
});

test('普通周末不计薪，也不是调休', () => {
  const s = settings();
  for (const day of [7, 8]) {
    const weekend = new Date(2026, 10, day);
    assert.equal(calc.dayType(weekend, s), 'rest');
    assert.equal(calc.dayAmountForDate(weekend, s), 0);
    assert.equal(calc.isCompDay(weekend, s), false);
  }
});

test('旧的实际工作日设置不再影响月末周六；月末周六固定转调休', () => {
  const legacy = settings({ useActualWorkdays: true, actualWorkdaysOverride: 22 });
  assert.equal(calc.dayAmountForDate(new Date(2026, 10, 28), legacy), 0);
  assert.equal(calc.dayAmountForDate(new Date(2026, 10, 28), settings()), 0);
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

  near(result.monthly, 8 * day);
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

test('本月预计 = 固定月薪（月末周六不计工资）', () => {
  const s = settings();
  const result = calc.compute(new Date(2026, 10, 11, 10, 0, 0), s);
  near(result.fixedMonthly, 25000);
  near(result.normalDailyAmount, normalDaily(20000, 5000, 21));
  near(result.weekProjected, 5 * normalDaily(20000, 5000, 21));
  near(result.monthProjected, 25000);
  near(result.monthOvertime, 0);
  assert.equal(result.monthOvertimeDays, 0);
});

test('月末正常工作结束后，本月累计正好等于本月预计', () => {
  const s = settings();
  const result = calc.compute(new Date(2026, 10, 30, 23, 0, 0), s);
  near(result.monthly, 25000);
  near(result.monthly, result.monthProjected);
  near(result.monthPercent, 1);
});

test('跨月的一周：月末周六转调休，不再计入周累计', () => {
  const s = settings();
  // 2026-11-01 是周日，本周从 10-26（周一）开始；10-31 是 10 月的月末周六
  const result = calc.compute(new Date(2026, 10, 1, 10, 0, 0), s);
  assert.equal(result.weekRangeLabel, '10/26 - 11/1');
  const octDay = normalDaily(20000, 5000, 22);
  near(result.weekly, 5 * octDay);
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
  assert.equal(calc.isCompDay(saturday, s), false);
  near(calc.workPeriod(s, saturday).totalSeconds, 3.5 * 3600);
  near(calc.dayAmountForDate(saturday, s), overtimeHourly(20000, 21.75) * 3.5);
  assert.equal(calc.dayType(new Date(2026, 10, 22), s), 'rest');
  assert.equal(calc.dayAmountForDate(new Date(2026, 10, 22), s), 0);
});

test('周末加班固定休息 12:00-13:30 与 18:00-18:30 均不计薪', () => {
  const s = settings({ overtimeDays: [{ date: '2026-11-21', workStart: '09:00', workEnd: '19:00' }] });
  const at = (h, m) => new Date(2026, 10, 21, h, m, 0);
  const period = calc.workPeriod(s, new Date(2026, 10, 21));
  near(period.restSeconds, 2 * 3600);
  near(period.totalSeconds, 8 * 3600);

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

test('周末加班固定按 21.75 折算时薪', () => {
  const s = settings({
    overtimeDays: [{ date: '2026-11-22', workStart: '09:00', workEnd: '18:00' }]
  });
  const period = calc.workPeriod(s, new Date(2026, 10, 22));
  near(period.totalSeconds, 7.5 * 3600);
  near(calc.dayAmountForDate(new Date(2026, 10, 22), s), overtimeHourly(20000, 21.75) * 7.5);
});

test('手动加班选择转调休：不计工资，计入调休天数', () => {
  const s = settings({
    overtimeDays: [{ date: '2026-11-21', workStart: '09:00', workEnd: '18:00', compTime: true }]
  });
  const saturday = new Date(2026, 10, 21);
  assert.equal(calc.isCompDay(saturday, s), true);
  assert.equal(calc.dayAmountForDate(saturday, s), 0);
  const result = calc.compute(new Date(2026, 10, 21, 19, 0, 0), s);
  assert.equal(result.todayIsComp, true);
  assert.equal(result.todayEarned, 0);
  assert.equal(result.monthOvertime, 0);
  assert.equal(result.monthOvertimeDays, 1);
  assert.equal(result.monthPaidOvertimeDays, 0);
  assert.equal(result.monthCompOvertimeDays, 1);
  assert.equal(result.monthCompDays, 2); // 月末周六 1 天 + 手动加班 1 天
  near(result.monthProjected, 25000);
});

test('手动加班未转调休时仍按实际工时发钱', () => {
  const s = settings({
    overtimeDays: [{ date: '2026-11-21', workStart: '10:00', workEnd: '15:00', compTime: false }]
  });
  const result = calc.compute(new Date(2026, 10, 11, 10, 0, 0), s);
  const expectedOvertime = overtimeHourly(20000, 21.75) * 3.5;
  near(result.monthOvertime, expectedOvertime);
  near(result.monthProjected, 25000 + expectedOvertime);
  assert.equal(result.monthOvertimeDays, 1);
  assert.equal(result.monthPaidOvertimeDays, 1);
  assert.equal(result.monthCompOvertimeDays, 0);
  assert.equal(result.monthCompDays, 1);
});

test('加班记录 compTime 会被保留；旧记录默认发工资', () => {
  const normalized = calc.normalizeSettings({
    baseSalary: 20000,
    bonusSalary: 5000,
    overtimeDays: [
      { date: '2026-11-21', workStart: '09:00', workEnd: '18:00', compTime: true },
      { date: '2026-11-22', workStart: '09:00', workEnd: '18:00' }
    ]
  });
  assert.equal(normalized.overtimeDays[0].compTime, true);
  assert.equal(normalized.overtimeDays[1].compTime, false);
});

test('月末周六不能再作为手动加班添加，旧的月末周六记录会被忽略', () => {
  const normalized = calc.normalizeSettings({
    baseSalary: 20000,
    bonusSalary: 5000,
    overtimeDays: [
      { date: '2026-11-28', workStart: '09:00', workEnd: '18:00' },
      { date: '2026-11-21', workStart: '09:00', workEnd: '18:00' }
    ]
  });
  assert.equal(normalized.overtimeDays.length, 1);
  assert.equal(normalized.overtimeDays[0].date, '2026-11-21');
  assert.equal(calc.isCompDay(new Date(2026, 10, 28), normalized), true);
});

test('工作日、非法日期与非法时段会被忽略，月末周六自动转调休', () => {
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
  assert.equal(calc.isCompDay(new Date(2026, 10, 28), s), true);
});

test('旧数据缺少加班起止时间时退回全局上下班时间', () => {
  const s = settings({ overtimeDays: [{ date: '2026-11-21' }] });
  const entry = calc.overtimeEntryForDate(new Date(2026, 10, 21), s);
  assert.equal(entry.workStart, '09:00');
  assert.equal(entry.workEnd, '18:00');
  assert.equal(entry.compTime, false);
});

test('五险一金：基数默认基础工资，五险 10.5% + 公积金 5%', () => {
  const s = settings();
  const result = calc.compute(new Date(2026, 10, 11, 10, 0, 0), s);
  near(result.insuranceBase, 20000);
  near(result.socialAmount, 2100);
  near(result.housingFundAmount, 1000);
  near(result.insuranceTotal, 3100);
});

test('五险一金：自定义缴费基数与固定金额', () => {
  const s = settings({
    insurance: {
      base: 10000,
      social: { enabled: true, mode: 'ratio', ratio: 10.5, amount: 0 },
      housingFund: { enabled: true, mode: 'fixed', ratio: 5, amount: 800 }
    }
  });
  const result = calc.compute(new Date(2026, 10, 11, 10, 0, 0), s);
  near(result.insuranceBase, 10000);
  near(result.socialAmount, 1050);
  near(result.housingFundAmount, 800);
  near(result.insuranceTotal, 1850);
});

test('五险一金：关闭项目后不扣款', () => {
  const s = settings({
    insurance: {
      base: null,
      social: { enabled: false, mode: 'ratio', ratio: 10.5, amount: 0 },
      housingFund: { enabled: true, mode: 'ratio', ratio: 5, amount: 0 }
    }
  });
  const result = calc.compute(new Date(2026, 10, 11, 10, 0, 0), s);
  assert.equal(result.socialAmount, 0);
  near(result.housingFundAmount, 1000);
  near(result.insuranceTotal, 1000);
});

test('个税与到手：默认不含月末周六工资', () => {
  const s = settings();
  const result = calc.compute(new Date(2026, 10, 11, 10, 0, 0), s);
  near(result.taxRate, 10);
  near(result.taxReduction, 0);
  near(result.monthProjected, 25000);
  near(result.taxBase, 16900);
  near(result.taxAmount, 1690);
  near(result.partyDues, 0);
  near(result.netMonthly, 20210);
});

test('个税：每月减免额度增加后个税减少', () => {
  const s = settings({ tax: { rate: 10, monthlyReduction: 2000 } });
  const result = calc.compute(new Date(2026, 10, 11, 10, 0, 0), s);
  near(result.taxBase, 14900);
  near(result.taxAmount, 1490);
  near(result.netMonthly, 20410);
});

test('党费：在个税后扣除，不影响计税基数', () => {
  const s = settings({ partyDues: 150 });
  const result = calc.compute(new Date(2026, 10, 11, 10, 0, 0), s);
  near(result.taxBase, 16900);
  near(result.taxAmount, 1690);
  near(result.partyDues, 150);
  near(result.netMonthly, 20210 - 150);
});

test('本月到手：发钱的加班费计入税前与个税', () => {
  const s = settings({
    overtimeDays: [{ date: '2026-11-21', workStart: '10:00', workEnd: '15:00', compTime: false }]
  });
  const result = calc.compute(new Date(2026, 10, 11, 10, 0, 0), s);
  near(result.monthProjected, 25000 + overtimeHourly(20000, 21.75) * 3.5);
  near(result.taxBase, 17704.60);
  near(result.taxAmount, 1770.46);
  near(result.netMonthly, 20934.14);
});

test('本月到手：转调休的加班费不计税前', () => {
  const s = settings({
    overtimeDays: [{ date: '2026-11-21', workStart: '10:00', workEnd: '15:00', compTime: true }],
    partyDues: 100
  });
  const result = calc.compute(new Date(2026, 10, 11, 10, 0, 0), s);
  near(result.monthProjected, 25000);
  near(result.taxBase, 16900);
  near(result.taxAmount, 1690);
  near(result.netMonthly, 20110);
});

test('本月兑换配额：按加班时薪把小时数兑换为工资', () => {
  const s = settings({ compConversion: { enabled: true, hours: 2.5 } });
  const hourly = overtimeHourly(20000, 21.75);
  const conversionPay = round2(2.5 * hourly);
  const result = calc.compute(new Date(2026, 10, 11, 19, 0, 0), s);
  assert.equal(calc.normalizeSettings(s).compConversion.hours, 2.5);
  near(result.conversionHours, 2.5);
  near(result.conversionHourly, hourly);
  near(result.conversionPay, conversionPay);
  near(result.conversionPay, 574.71);
  near(result.monthProjected, 25000 + conversionPay);
  near(result.monthly,
    8 * normalDaily(20000, 5000, 21) + conversionPay);
  near(result.taxBase, 25000 + conversionPay - 3100 - 5000);
  near(result.taxAmount, round2((25000 + conversionPay - 3100 - 5000) * 0.1));
  near(result.netMonthly,
    25000 + conversionPay - 3100 - result.taxAmount);
});

test('本月兑换配额：关闭时不兑换，即使填了小时数', () => {
  const s = settings({ compConversion: { enabled: false, hours: 8 } });
  const result = calc.compute(new Date(2026, 10, 11, 10, 0, 0), s);
  near(result.conversionHours, 0);
  near(result.conversionPay, 0);
  near(result.monthProjected, 25000);
  near(result.netMonthly, 20210);
});

test('本月兑换配额与党费同时生效', () => {
  const s = settings({
    compConversion: { enabled: true, hours: 2.5 },
    partyDues: 100
  });
  const result = calc.compute(new Date(2026, 10, 11, 10, 0, 0), s);
  const conversionPay = 574.71;
  const taxAmount = round2((25000 + conversionPay - 3100 - 5000) * 0.1);
  near(result.conversionPay, conversionPay);
  near(result.partyDues, 100);
  near(result.netMonthly, 25000 + conversionPay - 3100 - taxAmount - 100);
});

test('扣除超过税前收入时，个税与到手均为 0', () => {
  const s = settings({
    insurance: {
      base: null,
      social: { enabled: true, mode: 'fixed', ratio: 10.5, amount: 1000000 },
      housingFund: { enabled: true, mode: 'ratio', ratio: 5, amount: 0 }
    }
  });
  const result = calc.compute(new Date(2026, 10, 11, 10, 0, 0), s);
  near(result.taxBase, 0);
  near(result.taxAmount, 0);
  near(result.netMonthly, 0);
});

test('旧配置缺少五险一金、个税与党费时使用默认值', () => {
  const s = calc.normalizeSettings({ baseSalary: 20000, bonusSalary: 5000 });
  assert.equal(s.insurance.base, null);
  near(s.insurance.social.ratio, 10.5);
  near(s.insurance.housingFund.ratio, 5);
  near(s.tax.rate, 10);
  assert.equal(s.tax.monthlyReduction, 0);
  assert.equal(s.partyDues, 0);
});

test('加班休息时段可配置', () => {
  const s = settings({
    overtimeDays: [{ date: '2026-11-21', workStart: '09:00', workEnd: '19:00' }],
    overtimeRests: [
      { start: '12:00', end: '13:00' },
      { start: '17:00', end: '17:30' }
    ]
  });
  const period = calc.workPeriod(s, new Date(2026, 10, 21));
  near(period.restSeconds, 1.5 * 3600);
  near(period.totalSeconds, 8.5 * 3600);

  const at = (h, m) => new Date(2026, 10, 21, h, m, 0);
  assert.equal(calc.phaseAt(at(17, 10), s), 'lunch');
  near(calc.fractionAt(at(17, 10), s), 7 / 8.5);
  near(calc.fractionAt(at(18, 0), s), 7.5 / 8.5);
  near(calc.dayAmountForDate(new Date(2026, 10, 21), s), overtimeHourly(20000, 21.75) * 8.5);
});

test('加班休息时段重叠时自动合并，不重复扣减', () => {
  const s = settings({
    overtimeDays: [{ date: '2026-11-21', workStart: '09:00', workEnd: '19:00' }],
    overtimeRests: [
      { start: '12:00', end: '14:00' },
      { start: '13:00', end: '15:00' }
    ]
  });
  const period = calc.workPeriod(s, new Date(2026, 10, 21));
  near(period.restSeconds, 3 * 3600);
  near(period.totalSeconds, 7 * 3600);
});

test('加班休息时段缺失或非法时使用默认值', () => {
  const s = calc.normalizeSettings({
    baseSalary: 20000,
    bonusSalary: 5000,
    overtimeRests: [{ start: '20:00', end: '19:00' }]
  });
  assert.equal(s.overtimeRests.length, 2);
  assert.equal(s.overtimeRests[0].start, '19:00');
  assert.equal(s.overtimeRests[0].end, '20:00');
  assert.equal(s.overtimeRests[1].start, '18:00');
  assert.equal(s.overtimeRests[1].end, '18:30');
});
