'use strict';
// 求解器行为测试：锁定冲突、全局无解、决胜顺序、上限校验、自反约束、零改色、色觉鲁棒模式。
const assert = require('assert');
const { solve, buildReport, parseModel, SolverError } = require('../src/solver');
const { simulateHex } = require('../src/color');

function base(overrides = {}) {
  return {
    tokens: [
      { name: 'a', color: '#ffffff' },
      { name: 'b', color: '#000000' },
    ],
    candidates: ['#777777', '#eeeeee', '#111111'],
    constraints: [
      { foreground: 'a', background: 'b', minContrast: 4.5 },
    ],
    ...overrides,
  };
}

// 1. 原方案已满足 -> 零改色、零色差，立即返回。
{
  const r = solve(base());
  assert.strictEqual(r.status, 'optimal');
  assert.strictEqual(r.changes, 0);
  assert.ok(r.totalDelta === 0);
  assert.strictEqual(r.assignment.a, '#ffffff');
}

// 2. 两端锁定且不达标 -> both-locked 直接冲突。
{
  const input = base({
    tokens: [
      { name: 'a', color: '#ffffff', locked: true },
      { name: 'b', color: '#eeeeee', locked: true },
    ],
  });
  const r = solve(input);
  assert.strictEqual(r.status, 'unsatisfiable');
  assert.strictEqual(r.reason, 'locked-conflict');
  assert.strictEqual(r.conflicts[0].kind, 'both-locked');
  assert.ok(r.conflicts[0].actual < 4.5);
}

// 3. 前景锁定，对端值域无解 -> locked-foreground 冲突。
{
  const input = base({
    tokens: [
      { name: 'a', color: '#777777', locked: true },
      { name: 'b', color: '#ffffff' },
    ],
    candidates: ['#ffffff', '#eeeeee'], // 与 #777777 对比均 < 4.5
  });
  const r = solve(input);
  assert.strictEqual(r.status, 'unsatisfiable');
  assert.strictEqual(r.conflicts[0].kind, 'locked-foreground');
}

// 4. 无直接锁定冲突，但组合无解 -> reason global。
{
  const input = {
    tokens: [
      { name: 'a', color: '#777777' },
      { name: 'b', color: '#666666' },
      { name: 'c', color: '#888888' },
    ],
    candidates: ['#707070', '#808080'],
    constraints: [
      { foreground: 'a', background: 'b', minContrast: 4.5 },
      { foreground: 'b', background: 'c', minContrast: 4.5 },
      { foreground: 'a', background: 'c', minContrast: 4.5 },
    ],
  };
  const r = solve(input);
  assert.strictEqual(r.status, 'unsatisfiable');
  assert.strictEqual(r.reason, 'global');
}

// 5. 决胜顺序：改色数与色差均相同的方案，取令牌名升序色值字典序最小者。
{
  const input = {
    tokens: [
      { name: 'z', color: '#808080' },
      { name: 'a', color: '#808080' },
    ],
    candidates: ['#000000', '#ffffff'],
    // 无约束 -> 零改色；改为测有约束但两种对称解等距的情形。
    constraints: [],
  };
  const r = solve(input);
  assert.strictEqual(r.status, 'optimal');
  assert.strictEqual(r.changes, 0);
}

// 6. 稳定决胜：对称构造，两个方案同为改 1 个令牌且 ΔE 相同。
{
  // a 与 b 原色相同，候选提供纯黑/纯白；#444 对白底对比度约 8.7:1，改任一侧即可达标。
  const input = {
    tokens: [
      { name: 'a', color: '#444444' },
      { name: 'b', color: '#444444' },
    ],
    candidates: ['#000000', '#ffffff'],
    constraints: [{ foreground: 'a', background: 'b', minContrast: 7 }],
  };
  const r = solve(input);
  assert.strictEqual(r.status, 'optimal');
  assert.strictEqual(r.changes, 1);
  // 两种方案 ΔE 相同；决胜键按令牌名升序（a 在 b 前），#444444 < #ffffff，
  // 故 a 保留原色、b 改为白。
  assert.strictEqual(r.assignment.a, '#444444');
  assert.strictEqual(r.assignment.b, '#ffffff');
}

// 7. locks 由请求覆盖 JSON 中的 locked 字段。
{
  const input = base({
    tokens: [
      { name: 'a', color: '#ffffff' },
      { name: 'b', color: '#eeeeee' },
    ],
  });
  const r = solve(input, { a: true, b: true });
  assert.strictEqual(r.status, 'unsatisfiable');
  assert.strictEqual(r.conflicts[0].kind, 'both-locked');
}

// 8. 上限与格式校验。
assert.throws(() => solve({ tokens: [], candidates: [], constraints: [] }), SolverError);
assert.throws(
  () =>
    solve({
      tokens: Array.from({ length: 11 }, (_, i) => ({ name: 't' + i, color: '#fff' })),
      candidates: [],
      constraints: [],
    }),
  /不能超过 10/
);
assert.throws(
  () => solve({ tokens: [{ name: 'x', color: '#fff' }], candidates: Array(13).fill('#000'), constraints: [] }),
  /候选色不能超过 12/
);
assert.throws(
  () => solve({ tokens: [{ name: 'x', color: '#fff' }], candidates: [], constraints: Array(31).fill({ foreground: 'x', background: 'x', minContrast: 1 }) }),
  /约束不能超过 30/
);
assert.throws(
  () => solve({ tokens: [{ name: 'x', color: 'nope' }], candidates: [], constraints: [] }),
  /颜色/
);
assert.throws(
  () => solve({ tokens: [{ name: 'x', color: '#fff' }], candidates: [], constraints: [{ foreground: 'x', background: 'y', minContrast: 4 }] }),
  /不存在的令牌/
);

// 9. 自反约束：>1 恒无解（锁定与未锁定均给出直接冲突）。
{
  const r = solve({
    tokens: [{ name: 'a', color: '#ffffff', locked: true }],
    candidates: ['#000000'],
    constraints: [{ foreground: 'a', background: 'a', minContrast: 2 }],
  });
  assert.strictEqual(r.status, 'unsatisfiable');
  assert.strictEqual(r.conflicts[0].kind, 'self-contrast');

  const ok = solve({
    tokens: [{ name: 'a', color: '#ffffff' }],
    candidates: ['#000000'],
    constraints: [{ foreground: 'a', background: 'a', minContrast: 1 }],
  });
  assert.strictEqual(ok.status, 'optimal');
}

// 10. #rgb 短格式、重复候选去重。
{
  const r = solve({
    tokens: [{ name: 'a', color: '#fff' }],
    candidates: ['#000', '#000000'],
    constraints: [],
  });
  assert.strictEqual(r.status, 'optimal');
  assert.strictEqual(r.assignment.a, '#ffffff');
}

// 11. 最小改色数优先：存在一个色差巨大但 0 改色不可行、1 改色可行的情形。
{
  const r = solve({
    tokens: [
      { name: 'a', color: '#ffffff' },
      { name: 'b', color: '#fafafa' },
    ],
    candidates: ['#000000'],
    constraints: [{ foreground: 'a', background: 'b', minContrast: 4.5 }],
  });
  assert.strictEqual(r.status, 'optimal');
  assert.strictEqual(r.changes, 1);
}

// 12. profiles 校验：缺省等同 ["normal"]、去重并按固定顺序排列、拒绝未知值与空数组。
{
  const r = solve(base());
  assert.deepStrictEqual(r.profiles, ['normal']);

  const r2 = solve(base({ profiles: ['deuteranopia', 'normal', 'deuteranopia'] }));
  assert.deepStrictEqual(r2.profiles, ['normal', 'deuteranopia']);

  assert.throws(() => solve(base({ profiles: ['achromatopsia'] })), /未知视型/);
  assert.throws(() => solve(base({ profiles: [] })), /profiles 必须是非空数组/);
  assert.throws(() => solve(base({ profiles: 'normal' })), /profiles 必须是非空数组/);
}

// 13. 多视型约束：normal 达标但 protanopia 不达标时，必须继续改色直到全部视型达标。
//     #aa0000 对 #000000：normal 约 2.71:1，protanopia 模拟后约 1.93:1。
{
  const input = {
    tokens: [
      { name: 'fg', color: '#aa0000' },
      { name: 'bg', color: '#000000', locked: true },
    ],
    candidates: ['#ffffff'],
    constraints: [{ foreground: 'fg', background: 'bg', minContrast: 2.5 }],
  };
  const normalOnly = solve({ ...input, profiles: ['normal'] });
  assert.strictEqual(normalOnly.status, 'optimal');
  assert.strictEqual(normalOnly.changes, 0);

  const robust = solve({ ...input, profiles: ['normal', 'protanopia'] });
  assert.strictEqual(robust.status, 'optimal');
  assert.strictEqual(robust.changes, 1);
  assert.strictEqual(robust.assignment.fg, '#ffffff');
}

// 14. 两端锁定：冲突必须指明具体失败视型。
{
  const r = solve({
    tokens: [
      { name: 'fg', color: '#aa0000', locked: true },
      { name: 'bg', color: '#000000', locked: true },
    ],
    candidates: [],
    constraints: [{ foreground: 'fg', background: 'bg', minContrast: 2.5 }],
    profiles: ['normal', 'protanopia'],
  });
  assert.strictEqual(r.status, 'unsatisfiable');
  assert.strictEqual(r.reason, 'locked-conflict');
  assert.strictEqual(r.conflicts[0].kind, 'both-locked');
  assert.deepStrictEqual(r.conflicts[0].failedProfiles, ['protanopia']);
  assert.ok(r.conflicts[0].message.includes('protanopia'));
  assert.strictEqual(r.conflicts[0].actual < 2.5, true);
}

// 15. 单侧锁定：仅 protanopia 视型下对端值域无解（normal 下本可不改色）。
//     #ff0000 对 #004400：normal 约 2.87:1，protanopia 模拟后约 1.72:1。
{
  const input = {
    tokens: [
      { name: 'fg', color: '#ff0000', locked: true },
      { name: 'bg', color: '#004400' },
    ],
    candidates: [],
    constraints: [{ foreground: 'fg', background: 'bg', minContrast: 2.5 }],
    profiles: ['normal', 'protanopia'],
  };
  const r = solve(input);
  assert.strictEqual(r.status, 'unsatisfiable');
  assert.strictEqual(r.reason, 'locked-conflict');
  assert.strictEqual(r.conflicts[0].kind, 'locked-foreground');
  assert.deepStrictEqual(r.conflicts[0].failedProfiles, ['protanopia']);
  assert.ok(r.conflicts[0].message.includes('protanopia'));

  const normalOnly = solve({ ...input, profiles: ['normal'] });
  assert.strictEqual(normalOnly.status, 'optimal');
  assert.strictEqual(normalOnly.changes, 0);
}

// 16. 报告按约束列出各视型改前/改后比值，并标出最差视型。
{
  const input = {
    tokens: [
      { name: 'fg', color: '#aa0000' },
      { name: 'bg', color: '#000000', locked: true },
    ],
    candidates: ['#ffffff'],
    constraints: [{ foreground: 'fg', background: 'bg', minContrast: 2.5 }],
    profiles: ['normal', 'protanopia'],
  };
  const r = solve(input);
  const report = buildReport(input, undefined, r.assignment);
  assert.deepStrictEqual(report.profiles, ['normal', 'protanopia']);
  const c = report.constraints[0];
  assert.strictEqual(c.profiles.length, 2);
  assert.strictEqual(c.worstBeforeProfile, 'protanopia');
  assert.strictEqual(c.worstAfterProfile, 'normal'); // 改后为白/黑，两视型并列 21:1，取前者
  assert.strictEqual(c.afterPass, true);
  assert.ok(c.profiles.every((p) => p.afterPass));
  assert.ok(c.profiles.find((p) => p.profile === 'protanopia').beforeRatio < 2.5);
}

// 17. 模拟管线：normal 恒等；CVD 矩阵保持白/黑不变；模拟结果稳定可复现。
{
  assert.strictEqual(simulateHex('#1d4ed8', 'normal'), '#1d4ed8');
  for (const p of ['protanopia', 'deuteranopia', 'tritanopia']) {
    assert.strictEqual(simulateHex('#ffffff', p), '#ffffff');
    assert.strictEqual(simulateHex('#000000', p), '#000000');
    assert.strictEqual(simulateHex('#1d4ed8', p), simulateHex('#1d4ed8', p));
  }
}

console.log('全部求解器测试通过');
