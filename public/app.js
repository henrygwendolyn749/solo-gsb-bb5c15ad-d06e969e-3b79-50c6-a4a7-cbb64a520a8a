'use strict';

// 对比度调色板求解器前端（原生 JS，无外部依赖）。
// 页面只与同源的本机 Express 服务通信，数据不离开本机。

const $ = (id) => document.getElementById(id);

const els = {
  jsonInput: $('jsonInput'),
  fileInput: $('fileInput'),
  loadSampleBtn: $('loadSampleBtn'),
  solveBtn: $('solveBtn'),
  parseError: $('parseError'),
  tokenLocks: $('tokenLocks'),
  inputMeta: $('inputMeta'),
  resultPlaceholder: $('resultPlaceholder'),
  resultArea: $('resultArea'),
  resultSummary: $('resultSummary'),
  constraintTable: $('constraintTable'),
  tokenTable: $('tokenTable'),
  exportBtn: $('exportBtn'),
  conflictArea: $('conflictArea'),
  conflictIntro: $('conflictIntro'),
  conflictList: $('conflictList'),
  limitArea: $('limitArea'),
};

let parsed = null; // 最近一次成功解析的 JSON 对象
let lastExport = null; // 最近一次最优解的导出对象

const LIMITS = { tokens: 10, candidates: 12, constraints: 30 };
const KNOWN_PROFILES = ['normal', 'protanopia', 'deuteranopia', 'tritanopia'];

// ---------- 解析与锁定面板 ----------

function parseTextarea() {
  const text = els.jsonInput.value.trim();
  els.parseError.hidden = true;
  if (!text) {
    parsed = null;
    refreshLockPanel();
    return null;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    showParseError('JSON 语法错误：' + err.message);
    parsed = null;
    refreshLockPanel();
    return null;
  }
  const problem = validateShape(data);
  if (problem) {
    showParseError(problem);
    parsed = null;
    refreshLockPanel();
    return null;
  }
  parsed = data;
  refreshLockPanel();
  return data;
}

function showParseError(msg) {
  els.parseError.textContent = msg;
  els.parseError.hidden = false;
}

// 轻量前端校验（服务端会做同样的严格校验，此处仅为提前反馈）。
function validateShape(data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return '输入必须是 JSON 对象。';
  }
  if (!Array.isArray(data.tokens)) return '缺少 tokens 数组。';
  if (!Array.isArray(data.candidates)) return '缺少 candidates 数组。';
  if (!Array.isArray(data.constraints)) return '缺少 constraints 数组。';
  if (data.tokens.length < 1 || data.tokens.length > LIMITS.tokens) {
    return `令牌数量必须在 1–${LIMITS.tokens} 之间（当前 ${data.tokens.length}）。`;
  }
  if (data.candidates.length > LIMITS.candidates) {
    return `候选色最多 ${LIMITS.candidates} 个（当前 ${data.candidates.length}）。`;
  }
  if (data.constraints.length > LIMITS.constraints) {
    return `约束最多 ${LIMITS.constraints} 条（当前 ${data.constraints.length}）。`;
  }
  const names = new Set();
  for (let i = 0; i < data.tokens.length; i++) {
    const t = data.tokens[i];
    if (!t || typeof t !== 'object' || typeof t.name !== 'string' || !t.name) {
      return `tokens[${i}] 缺少有效的 name。`;
    }
    if (names.has(t.name)) return `令牌名 "${t.name}" 重复。`;
    names.add(t.name);
    if (typeof t.color !== 'string' || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(t.color.trim())) {
      return `tokens[${i}] (${t.name}) 的 color 不是 #rgb/#rrggbb 颜色。`;
    }
  }
  for (let i = 0; i < data.candidates.length; i++) {
    if (typeof data.candidates[i] !== 'string' ||
        !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(data.candidates[i].trim())) {
      return `candidates[${i}] 不是合法颜色。`;
    }
  }
  for (let i = 0; i < data.constraints.length; i++) {
    const c = data.constraints[i];
    if (!c || typeof c !== 'object') return `constraints[${i}] 必须是对象。`;
    if (!names.has(c.foreground) || !names.has(c.background)) {
      return `constraints[${i}] 引用了不存在的令牌。`;
    }
    const m = Number(c.minContrast);
    if (!Number.isFinite(m) || m < 1 || m > 21) {
      return `constraints[${i}].minContrast 必须是 1–21 的数字。`;
    }
  }
  if (data.profiles !== undefined && data.profiles !== null) {
    if (!Array.isArray(data.profiles) || data.profiles.length === 0) {
      return 'profiles 必须是非空数组。';
    }
    for (const p of data.profiles) {
      if (!KNOWN_PROFILES.includes(p)) {
        return `profiles 包含未知视型 "${p}"（可选：${KNOWN_PROFILES.join(' / ')}）。`;
      }
    }
  }
  return null;
}

function refreshLockPanel() {
  els.tokenLocks.innerHTML = '';
  els.solveBtn.disabled = !parsed;
  if (!parsed) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.textContent = '尚未载入有效数据。';
    els.tokenLocks.appendChild(empty);
    els.inputMeta.textContent = '';
    return;
  }
  for (const t of parsed.tokens) {
    const item = document.createElement('div');
    item.className = 'lock-item' + (t.locked ? ' is-locked' : '');

    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = t.locked === true;
    cb.dataset.name = t.name;
    cb.addEventListener('change', () => {
      t.locked = cb.checked;
      item.classList.toggle('is-locked', cb.checked);
      // 锁定状态同步回文本框中的 JSON。
      syncLocksIntoText();
    });

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = t.color;

    const textWrap = document.createElement('span');
    const nameEl = document.createElement('div');
    nameEl.className = 'lock-name';
    nameEl.textContent = t.name;
    const hexEl = document.createElement('div');
    hexEl.className = 'lock-hex';
    hexEl.textContent = t.color;
    textWrap.append(nameEl, hexEl);

    label.append(cb, swatch, textWrap);
    item.appendChild(label);
    els.tokenLocks.appendChild(item);
  }
  const profileCount = Array.isArray(parsed.profiles) ? parsed.profiles.length : 1;
  els.inputMeta.textContent =
    `${parsed.tokens.length} 个令牌 · ${parsed.candidates.length} 个候选色 · ` +
    `${parsed.constraints.length} 条约束 · ${profileCount} 种视型`;
}

// 将面板上的锁定勾选状态回写到 textarea 的 JSON 文本。
function syncLocksIntoText() {
  if (!parsed) return;
  try {
    els.jsonInput.value = JSON.stringify(parsed, null, 2);
  } catch (_) {
    /* 文本仅作展示，失败时保持原样 */
  }
}

// ---------- 文件导入 / 示例 ----------

els.fileInput.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    els.jsonInput.value = await file.text();
    parseTextarea();
    clearResults();
  } catch (err) {
    showParseError('读取文件失败：' + err.message);
  } finally {
    els.fileInput.value = '';
  }
});

els.loadSampleBtn.addEventListener('click', async () => {
  try {
    const res = await fetch('/sample-palette.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    els.jsonInput.value = JSON.stringify(data, null, 2);
    parseTextarea();
    clearResults();
  } catch (err) {
    showParseError('载入示例失败：' + err.message);
  }
});

els.jsonInput.addEventListener('input', () => {
  parseTextarea();
  clearResults();
});

// ---------- 求解 ----------

els.solveBtn.addEventListener('click', async () => {
  const data = parseTextarea();
  if (!data) return;

  const locks = {};
  for (const t of data.tokens) locks[t.name] = t.locked === true;

  clearResults();
  els.solveBtn.disabled = true;
  els.resultPlaceholder.innerHTML = '<span class="spinner"></span>正在进行全局分支定界搜索…';
  els.resultPlaceholder.hidden = false;

  try {
    const res = await fetch('/api/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: data, locks }),
    });
    const body = await res.json();
    if (!res.ok) {
      els.resultPlaceholder.hidden = true;
      showParseError(body.error || '求解失败');
      return;
    }
    renderResult(body);
  } catch (err) {
    els.resultPlaceholder.hidden = true;
    showParseError('请求本地服务失败：' + err.message);
  } finally {
    els.solveBtn.disabled = false;
  }
});

function clearResults() {
  els.resultPlaceholder.hidden = false;
  els.resultPlaceholder.textContent = '运行求解后在此查看结果。';
  els.resultArea.hidden = true;
  els.conflictArea.hidden = true;
  els.limitArea.hidden = true;
  els.parseError.hidden = true;
  lastExport = null;
}

// ---------- 结果渲染 ----------

function renderResult(body) {
  els.resultPlaceholder.hidden = true;

  if (body.status === 'unsatisfiable') {
    renderConflicts(body);
    return;
  }

  if (body.status === 'search-limit') {
    els.limitArea.hidden = false;
    els.limitArea.textContent = body.message || '搜索达到节点上限，以下为当前找到的最佳候选（未经最优性证明）。';
    if (!body.best || !body.report) return;
  }

  if (!body.report) return;

  els.resultArea.hidden = false;
  const reportSource = body.report;
  const changes = body.status === 'search-limit' ? body.best.changes : body.changes;
  const totalDelta = body.status === 'search-limit' ? body.best.totalDelta : body.totalDelta;

  // 概要
  els.resultSummary.innerHTML = '';
  const summary = document.createElement('div');
  summary.className = 'summary';
  summary.append(
    stat(reportSource.tokens.filter((t) => t.changed).length, '改色令牌数', true),
    stat(changes + ' / ' + reportSource.tokens.length, '改色 / 总数'),
    stat(Number(totalDelta).toFixed(2), 'CIE Lab 总色差 ΔE*ab'),
    stat(
      reportSource.constraints.filter((c) => c.afterPass).length +
        ' / ' + reportSource.constraints.length,
      '满足约束'
    ),
    stat((body.profiles || reportSource.profiles || ['normal']).length, '色觉视型数'),
    stat(body.stats.nodes.toLocaleString('zh-CN'), '搜索节点'),
    stat(body.stats.elapsedMs + ' ms', '耗时')
  );
  els.resultSummary.appendChild(summary);

  // 约束表：每条约束按视型逐行列出改前/改后比值，并突出最差视型。
  els.constraintTable.innerHTML = '';
  els.constraintTable.appendChild(buildConstraintTable(reportSource.constraints));

  // 令牌表
  els.tokenTable.innerHTML = '';
  els.tokenTable.appendChild(
    buildTable(
      ['令牌', '原色', '', '改后', 'ΔE', '状态'],
      reportSource.tokens.map((t) => [
        t.name + (t.locked ? ' 🔒' : ''),
        colorCell(t.original),
        t.changed ? '→' : '',
        colorCell(t.final),
        { num: t.deltaE.toFixed(2) },
        t.locked ? pill('已锁定', true) : t.changed ? pill('改色', false) : pill('保持', true),
      ])
    )
  );

  lastExport = body.export;
}

function stat(num, label, optimal) {
  const el = document.createElement('div');
  el.className = 'stat' + (optimal ? ' optimal' : '');
  const n = document.createElement('div');
  n.className = 'num';
  n.textContent = num;
  const l = document.createElement('div');
  l.className = 'label';
  l.textContent = label;
  el.append(n, l);
  return el;
}

function pill(text, pass) {
  const el = document.createElement('span');
  el.className = 'pill ' + (pass ? 'pass' : 'fail');
  el.textContent = text;
  return el;
}

function ratioText(r) {
  return r.toFixed(2) + ':1';
}

function colorCell(hex) {
  return { html: `<span class="cell-color"><span class="swatch" style="background:${hex}"></span>${hex}</span>` };
}

// 约束结果表：每条约束占 profiles.length 行，首行带 rowspan 的约束信息；
// 改后比值最差的视型所在行高亮并标注「最差」。
function buildConstraintTable(constraints) {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const h of ['#', '前景', '背景', '要求', '视型', '改前', '改后', '结果']) {
    const th = document.createElement('th');
    th.textContent = h;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const c of constraints) {
    const rows = c.profiles || [];
    rows.forEach((p, pi) => {
      const tr = document.createElement('tr');
      const isWorst = rows.length > 1 && p.profile === c.worstAfterProfile;
      if (isWorst) tr.classList.add('worst-profile');

      if (pi === 0) {
        for (const text of [String(c.index + 1), c.foreground, c.background, String(c.minContrast)]) {
          const td = document.createElement('td');
          td.rowSpan = rows.length;
          td.textContent = text;
          tr.appendChild(td);
        }
      }

      const tdProfile = document.createElement('td');
      tdProfile.appendChild(document.createTextNode(p.profile));
      if (isWorst) {
        tdProfile.appendChild(document.createTextNode(' '));
        const tag = document.createElement('span');
        tag.className = 'pill warn';
        tag.textContent = '最差';
        tdProfile.appendChild(tag);
      }
      tr.appendChild(tdProfile);

      const tdBefore = document.createElement('td');
      tdBefore.className = 'num ratio-after ' + (p.beforePass ? 'good' : 'bad');
      tdBefore.textContent = ratioText(p.beforeRatio);
      tr.appendChild(tdBefore);

      const tdAfter = document.createElement('td');
      tdAfter.className = 'num ratio-after strong ' + (p.afterPass ? 'good' : 'bad');
      tdAfter.textContent = ratioText(p.afterRatio);
      tr.appendChild(tdAfter);

      const tdResult = document.createElement('td');
      tdResult.appendChild(pill(p.afterPass ? '满足' : '不满足', p.afterPass));
      tr.appendChild(tdResult);

      tbody.appendChild(tr);
    });
  }
  table.appendChild(tbody);
  return table;
}

function buildTable(headers, rows) {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const h of headers) {
    const th = document.createElement('th');
    th.textContent = h;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const cell of row) {
      const td = document.createElement('td');
      if (cell && typeof cell === 'object' && cell.html) {
        td.innerHTML = cell.html;
      } else if (cell && typeof cell === 'object' && 'num' in cell) {
        td.classList.add('num');
        td.textContent = String(cell.num);
        if (cell.cls) td.classList.add('ratio-after', cell.cls);
        if (cell.strong) td.classList.add('strong');
      } else if (cell instanceof HTMLElement) {
        td.appendChild(cell);
      } else {
        td.textContent = cell == null ? '' : String(cell);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function renderConflicts(body) {
  els.conflictArea.hidden = false;
  els.conflictList.innerHTML = '';

  els.conflictIntro.textContent =
    body.reason === 'global'
      ? (body.message || '全局无解，且未发现由锁定颜色直接造成的冲突。')
      : '以下冲突由锁定颜色直接导致，解锁相应令牌（或更换锁定颜色）后可能恢复可行：';

  const conflicts = body.conflicts || [];
  for (const c of conflicts) {
    const li = document.createElement('li');
    li.textContent = c.message || JSON.stringify(c);
    els.conflictList.appendChild(li);
  }
}

// ---------- 导出 ----------

els.exportBtn.addEventListener('click', () => {
  if (!lastExport) return;
  const blob = new Blob([JSON.stringify(lastExport, null, 2) + '\n'], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (lastExport.name ? String(lastExport.name) : 'palette') + '-solved.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// ---------- 初始化 ----------

refreshLockPanel();
clearResults();
