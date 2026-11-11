(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SalaryDefaults = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_SETTINGS = Object.freeze({
    // 薪资
    baseSalary: 20000,
    bonusSalary: 5000,
    // 计薪方式：默认按 21.75 天
    useActualWorkdays: false,
    standardWorkdays: 21.75,
    // 实际工作日模式下，0 表示自动按当月周一至周五计算
    actualWorkdaysOverride: 0,
    // 工作时间
    workStart: '09:00',
    workEnd: '18:00',
    lunchStart: '12:00',
    lunchEnd: '13:00',
    // 窗口 / 系统
    alwaysOnTop: true,
    openAtLogin: false,
    windowBounds: null
  });

  return { DEFAULT_SETTINGS };
});
