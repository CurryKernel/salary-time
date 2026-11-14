(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./defaults.js'));
  } else {
    root.SalaryCalc = factory(root.SalaryDefaults);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Defaults) {
  'use strict';

  const BASE = Defaults.DEFAULT_SETTINGS;
  const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  // 加班日固定休息时段（不计薪）
  const OVERTIME_REST_WINDOWS = [
    [12 * 3600, 13 * 3600 + 30 * 60],
    [18 * 3600, 18 * 3600 + 30 * 60]
  ];
  // 加班时薪的折算基准：与月末周六一致的 8 小时
  const OVERTIME_STANDARD_HOURS = 8;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function normalizeSettings(settings) {
    const s = Object.assign({}, BASE, settings || {});
    s.baseSalary = toNumber(s.baseSalary, BASE.baseSalary);
    s.bonusSalary = toNumber(s.bonusSalary, BASE.bonusSalary);
    s.standardWorkdays = toNumber(s.standardWorkdays, BASE.standardWorkdays);
    s.actualWorkdaysOverride = Math.max(0, Math.floor(toNumber(s.actualWorkdaysOverride, 0)));
    s.useActualWorkdays = !!s.useActualWorkdays;
    s.alwaysOnTop = s.alwaysOnTop !== false;
    s.openAtLogin = !!s.openAtLogin;
    s.overtimeDays = normalizeOvertimeDays(
      s.overtimeDays,
      normalizeClock(s.workStart, BASE.workStart),
      normalizeClock(s.workEnd, BASE.workEnd)
    );
    return s;
  }

  function toNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function formatDateKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function parseDateKey(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day);
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
    return date;
  }

  function normalizeClock(value, fallback) {
    const seconds = parseTimeToSeconds(value);
    if (seconds == null) return fallback;
    return pad2(Math.floor(seconds / 3600)) + ':' + pad2(Math.floor((seconds % 3600) / 60));
  }

  function normalizeOvertimeEntry(entry, fallbackStart, fallbackEnd) {
    if (!entry || typeof entry !== 'object') return null;
    const date = parseDateKey(entry.date);
    if (!date) return null;
    const weekday = date.getDay();
    if (weekday !== 0 && weekday !== 6) return null;

    const startSeconds = parseTimeToSeconds(entry.workStart);
    const endSeconds = parseTimeToSeconds(entry.workEnd);

    let workStart;
    let workEnd;
    if (startSeconds == null && endSeconds == null) {
      // 旧数据没有上下班时间，退回全局上下班时间
      workStart = normalizeClock(fallbackStart, '09:00');
      workEnd = normalizeClock(fallbackEnd, '18:00');
      if (parseTimeToSeconds(workEnd) <= parseTimeToSeconds(workStart)) return null;
    } else {
      if (startSeconds == null || endSeconds == null || endSeconds <= startSeconds) return null;
      workStart = normalizeClock(entry.workStart, fallbackStart);
      workEnd = normalizeClock(entry.workEnd, fallbackEnd);
    }
    return { date: formatDateKey(date), workStart, workEnd };
  }

  function normalizeOvertimeDays(list, fallbackStart, fallbackEnd) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const days = [];
    for (const entry of list) {
      const normalized = normalizeOvertimeEntry(entry, fallbackStart, fallbackEnd);
      if (!normalized || seen.has(normalized.date)) continue;
      seen.add(normalized.date);
      days.push(normalized);
    }
    days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return days;
  }

  /** 命中手动添加的周末加班记录时返回该记录 */
  function overtimeEntryForDate(date, settings) {
    if (!date) return null;
    const s = normalizeSettings(settings);
    const key = formatDateKey(date);
    return s.overtimeDays.find((entry) => entry.date === key) || null;
  }

  /** 是否为加班日（月末周六或手动添加的周末加班） */
  function isOvertimeDay(date, settings) {
    return isEndOfMonthSaturday(date) || !!overtimeEntryForDate(date, settings);
  }

  /** month-end | weekend | null */
  function overtimeKind(date, settings) {
    if (isEndOfMonthSaturday(date)) return 'month-end';
    return overtimeEntryForDate(date, settings) ? 'weekend' : null;
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  function countWeekdays(year, month) {
    let count = 0;
    const total = daysInMonth(year, month);
    for (let day = 1; day <= total; day++) {
      const weekday = new Date(year, month, day).getDay();
      if (weekday >= 1 && weekday <= 5) count++;
    }
    return count;
  }

  /** 当月最后一个周六的日期（1-31），必定存在 */
  function lastSaturdayOfMonth(year, month) {
    const total = daysInMonth(year, month);
    for (let day = total; day >= 1; day--) {
      if (new Date(year, month, day).getDay() === 6) return day;
    }
    return 0;
  }

  /** 是否为“月末周六”（当月最后一个周六，双倍工资） */
  function isEndOfMonthSaturday(date) {
    return date.getDay() === 6 &&
      date.getDate() === lastSaturdayOfMonth(date.getFullYear(), date.getMonth());
  }

  /** 本月实际计薪工作日数：21.75 天模式 / 实际工作日模式（可手动覆盖） */
  function effectiveWorkdays(settings, year, month) {
    const s = normalizeSettings(settings);
    if (!s.useActualWorkdays) return s.standardWorkdays;
    if (s.actualWorkdaysOverride > 0) return s.actualWorkdaysOverride;
    return countWeekdays(year, month);
  }

  function parseTimeToSeconds(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return hour * 3600 + minute * 60;
  }

  /** 一天的工作时段（扣除休息），单位秒；加班日使用自定义上下班时间与固定休息时段 */
  function workPeriod(settings, date) {
    const s = normalizeSettings(settings);
    const overtime = date ? overtimeEntryForDate(date, s) : null;

    let start;
    let end;
    let restWindows;

    if (overtime) {
      start = parseTimeToSeconds(overtime.workStart);
      end = parseTimeToSeconds(overtime.workEnd);
      restWindows = OVERTIME_REST_WINDOWS;
    } else {
      start = parseTimeToSeconds(s.workStart);
      end = parseTimeToSeconds(s.workEnd);
      restWindows = [[parseTimeToSeconds(s.lunchStart), parseTimeToSeconds(s.lunchEnd)]];
    }

    const safeStart = start == null ? 9 * 3600 : start;
    let safeEnd = end == null ? 18 * 3600 : end;
    if (safeEnd <= safeStart) safeEnd = Math.min(24 * 3600, safeStart + 8 * 3600);

    const safeWindows = [];
    let restSeconds = 0;
    for (const window of restWindows) {
      let restStart = window[0] == null ? 12 * 3600 : window[0];
      let restEnd = window[1] == null ? 13 * 3600 : window[1];
      if (restEnd < restStart) {
        const tmp = restStart;
        restStart = restEnd;
        restEnd = tmp;
      }
      restStart = Math.min(Math.max(restStart, safeStart), safeEnd);
      restEnd = Math.min(Math.max(restEnd, safeStart), safeEnd);
      if (restEnd <= restStart) continue;
      safeWindows.push([restStart, restEnd]);
      restSeconds += restEnd - restStart;
    }

    return {
      start: safeStart,
      end: safeEnd,
      restWindows: safeWindows,
      restSeconds,
      totalSeconds: Math.max(0, safeEnd - safeStart - restSeconds)
    };
  }

  /** workday | overtime | rest */
  function dayType(date, settings) {
    if (isOvertimeDay(date, settings)) return 'overtime';
    const weekday = date.getDay();
    return weekday >= 1 && weekday <= 5 ? 'workday' : 'rest';
  }

  /** 固定月薪摊算的日薪：月薪 ÷ 当月周一至周五天数（与计薪方式无关） */
  function normalDailyAmount(settings, year, month) {
    const s = normalizeSettings(settings);
    const days = countWeekdays(year, month);
    return days > 0 ? (s.baseSalary + s.bonusSalary) / days : 0;
  }

  /** 某一天应得的全日工资（月薪按当月工作日摊算；月末周六双倍；周末加班按时薪 × 实际工时） */
  function dayAmountForDate(date, settings) {
    const s = normalizeSettings(settings);
    const denom = effectiveWorkdays(s, date.getFullYear(), date.getMonth());
    if (!denom || denom <= 0) return 0;

    if (isEndOfMonthSaturday(date)) {
      return (s.baseSalary / denom) * 2;
    }
    if (overtimeEntryForDate(date, s)) {
      const period = workPeriod(s, date);
      const hourlyRate = ((s.baseSalary / denom) * 2) / OVERTIME_STANDARD_HOURS;
      return hourlyRate * (period.totalSeconds / 3600);
    }
    const weekday = date.getDay();
    if (weekday >= 1 && weekday <= 5) {
      return normalDailyAmount(s, date.getFullYear(), date.getMonth());
    }
    return 0;
  }

  function secondsOfDay(date) {
    return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() +
      date.getMilliseconds() / 1000;
  }

  /** 今天的工作进度 0-1（休息时段冻结） */
  function fractionAt(date, settings) {
    if (dayType(date, settings) === 'rest') return 0;
    const period = workPeriod(settings, date);
    if (period.totalSeconds <= 0) {
      return secondsOfDay(date) >= period.end ? 1 : 0;
    }
    const now = secondsOfDay(date);
    if (now <= period.start) return 0;
    if (now >= period.end) return 1;

    let worked = now - period.start;
    for (const window of period.restWindows) {
      worked -= Math.max(0, Math.min(now, window[1]) - window[0]);
    }
    return Math.min(1, Math.max(0, worked / period.totalSeconds));
  }

  /** before | working | lunch | after | rest */
  function phaseAt(date, settings) {
    if (dayType(date, settings) === 'rest') return 'rest';
    const period = workPeriod(settings, date);
    const now = secondsOfDay(date);
    if (now < period.start) return 'before';
    if (now >= period.end) return 'after';
    if (period.restWindows.some((window) => now >= window[0] && now < window[1])) return 'lunch';
    return 'working';
  }

  function remainingSecondsAt(date, settings) {
    const period = workPeriod(settings, date);
    const now = secondsOfDay(date);
    switch (phaseAt(date, settings)) {
      case 'before': return Math.max(0, period.start - now);
      case 'lunch': {
        const window = period.restWindows.find((item) => now >= item[0] && now < item[1]);
        return window ? Math.max(0, window[1] - now) : 0;
      }
      case 'working': return Math.max(0, period.end - now);
      default: return 0;
    }
  }

  function dateKey(date) {
    return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  }

  /** 某天已经挣到的钱：过去整天按全额，今天按时段进度，未来为 0 */
  function earnedOnDate(date, now, settings) {
    const dayAmount = dayAmountForDate(date, settings);
    const key = dateKey(date);
    const todayKey = dateKey(now);
    if (key < todayKey) return dayAmount;
    if (key > todayKey) return 0;
    return dayAmount * fractionAt(now, settings);
  }

  function sumDays(startDate, endDate, now, settings, fullDay) {
    let total = 0;
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const last = dateKey(endDate);
    while (dateKey(cursor) <= last) {
      total += fullDay ? dayAmountForDate(cursor, settings) : earnedOnDate(cursor, now, settings);
      cursor.setDate(cursor.getDate() + 1);
    }
    return total;
  }

  function startOfWeekMonday(date) {
    const day = date.getDay();
    const offset = day === 0 ? 6 : day - 1;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
  }

  function formatMonthDay(date) {
    return (date.getMonth() + 1) + '/' + date.getDate();
  }

  function compute(now, settings) {
    const s = normalizeSettings(settings);
    const date = now instanceof Date ? now : new Date(now);
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();

    const totalDays = daysInMonth(year, month);
    const type = dayType(date, s);
    const period = workPeriod(s, date);
    const fraction = fractionAt(date, s);
    const dayAmount = dayAmountForDate(date, s);
    const todayEarned = dayAmount * fraction;
    const phase = phaseAt(date, s);

    const denom = effectiveWorkdays(s, year, month);
    const monthWorkdaysAuto = countWeekdays(year, month);
    const lastSaturdayDay = lastSaturdayOfMonth(year, month);
    const lastSaturday = new Date(year, month, lastSaturdayDay);

    let monthProjected = 0;
    let monthOvertime = 0;
    let monthOvertimeDays = 0;
    for (let d = 1; d <= totalDays; d++) {
      const cursor = new Date(year, month, d);
      const amount = dayAmountForDate(cursor, s);
      monthProjected += amount;
      // 手动添加的周末加班单独统计，便于在设置页展示其对本月的贡献
      if (overtimeEntryForDate(cursor, s)) {
        monthOvertime += amount;
        monthOvertimeDays += 1;
      }
    }
    let monthly = 0;
    for (let d = 1; d <= day; d++) {
      monthly += earnedOnDate(new Date(year, month, d), date, s);
    }

    const monday = startOfWeekMonday(date);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    const weekly = sumDays(monday, date, date, s, false);
    const weekProjected = sumDays(monday, sunday, date, s, true);

    const monthlyWorkdays = countWeekdays(year, month);
    const fixedMonthly = s.baseSalary + s.bonusSalary;
    const normalDaily = monthlyWorkdays > 0 ? fixedMonthly / monthlyWorkdays : 0;
    const saturdayAmount = denom > 0 ? (s.baseSalary / denom) * 2 : 0;
    const hourlyRate = period.totalSeconds > 0 ? dayAmount / (period.totalSeconds / 3600) : 0;

    return {
      now: date,
      year,
      month,
      day,
      dateLabel: (month + 1) + '月' + day + '日 ' + WEEKDAY_NAMES[date.getDay()],
      monthLabel: (month + 1) + '月',
      weekRangeLabel: formatMonthDay(monday) + ' - ' + formatMonthDay(sunday),
      dayType: type,
      phase,
      fraction,
      dayAmount,
      todayEarned,
      todayRemaining: Math.max(0, dayAmount - todayEarned),
      monthly,
      weekly,
      monthProjected,
      monthOvertime,
      monthOvertimeDays,
      weekProjected,
      monthPercent: monthProjected > 0 ? Math.min(1, monthly / monthProjected) : 0,
      weekPercent: weekProjected > 0 ? Math.min(1, weekly / weekProjected) : 0,
      countdownSeconds: remainingSecondsAt(date, s),
      remainingWorkSeconds: Math.max(0, period.totalSeconds * (1 - fraction)),
      totalWorkSeconds: period.totalSeconds,
      effectiveWorkdays: denom,
      autoWorkdays: monthWorkdaysAuto,
      monthlyWorkdays,
      fixedMonthly,
      standardWorkdays: s.standardWorkdays,
      useActualWorkdays: s.useActualWorkdays,
      normalDailyAmount: normalDaily,
      saturdayAmount,
      hourlyRate,
      lastSaturday,
      lastSaturdayLabel: (month + 1) + '月' + lastSaturdayDay + '日',
      overtimeKind: type === 'overtime' ? overtimeKind(date, s) : null,
      isLastSaturdayToday: isEndOfMonthSaturday(date)
    };
  }

  return {
    // 常量
    WEEKDAY_NAMES,
    // 工具
    normalizeSettings,
    formatDateKey,
    daysInMonth,
    countWeekdays,
    lastSaturdayOfMonth,
    isEndOfMonthSaturday,
    normalizeOvertimeDays,
    overtimeEntryForDate,
    isOvertimeDay,
    overtimeKind,
    effectiveWorkdays,
    parseTimeToSeconds,
    workPeriod,
    dayType,
    dayAmountForDate,
    fractionAt,
    phaseAt,
    remainingSecondsAt,
    earnedOnDate,
    startOfWeekMonday,
    // 主计算
    compute
  };
});
