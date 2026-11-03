'use strict';
/**
 * Apex debug log parser. Turns a raw log into a call tree plus
 * SOQL / DML / debug / exception / limit summaries and insights.
 */

const TS = /^(\d{1,2}:\d{2}:\d{2}\.\d+) \((\d+)\)\|([A-Z_]+)(?:\||$)/;

const PAIRS = {
  EXECUTION_STARTED: 'EXECUTION_FINISHED',
  CODE_UNIT_STARTED: 'CODE_UNIT_FINISHED',
  METHOD_ENTRY: 'METHOD_EXIT',
  CONSTRUCTOR_ENTRY: 'CONSTRUCTOR_EXIT',
  SYSTEM_METHOD_ENTRY: 'SYSTEM_METHOD_EXIT',
  SYSTEM_CONSTRUCTOR_ENTRY: 'SYSTEM_CONSTRUCTOR_EXIT',
  SOQL_EXECUTE_BEGIN: 'SOQL_EXECUTE_END',
  SOSL_EXECUTE_BEGIN: 'SOSL_EXECUTE_END',
  DML_BEGIN: 'DML_END',
  CALLOUT_REQUEST: 'CALLOUT_RESPONSE',
  NAMED_CREDENTIAL_REQUEST: 'NAMED_CREDENTIAL_RESPONSE',
  FLOW_START_INTERVIEWS_BEGIN: 'FLOW_START_INTERVIEWS_END',
  FLOW_START_INTERVIEW_BEGIN: 'FLOW_START_INTERVIEW_END',
  FLOW_ELEMENT_BEGIN: 'FLOW_ELEMENT_END',
  WF_RULE_EVAL_BEGIN: 'WF_RULE_EVAL_END',
  VF_APEX_CALL_START: 'VF_APEX_CALL_END',
};
const ENDS = new Set(Object.values(PAIRS));

const KIND = {
  EXECUTION_STARTED: 'EXECUTION',
  CODE_UNIT_STARTED: 'CODE_UNIT',
  METHOD_ENTRY: 'METHOD',
  CONSTRUCTOR_ENTRY: 'METHOD',
  SYSTEM_METHOD_ENTRY: 'SYSTEM',
  SYSTEM_CONSTRUCTOR_ENTRY: 'SYSTEM',
  SOQL_EXECUTE_BEGIN: 'SOQL',
  SOSL_EXECUTE_BEGIN: 'SOQL',
  DML_BEGIN: 'DML',
  CALLOUT_REQUEST: 'CALLOUT',
  NAMED_CREDENTIAL_REQUEST: 'CALLOUT',
  FLOW_START_INTERVIEWS_BEGIN: 'FLOW',
  FLOW_START_INTERVIEW_BEGIN: 'FLOW',
  FLOW_ELEMENT_BEGIN: 'FLOW',
  WF_RULE_EVAL_BEGIN: 'WORKFLOW',
  VF_APEX_CALL_START: 'METHOD',
};

const LEAVES = {
  USER_DEBUG: 'DEBUG',
  EXCEPTION_THROWN: 'EXCEPTION',
  FATAL_ERROR: 'FATAL',
  VALIDATION_FAIL: 'EXCEPTION',
  FLOW_ELEMENT_ERROR: 'FATAL',
  FLOW_ELEMENT_FAULT: 'EXCEPTION',
};

const srcLine = (s) => {
  const m = /^\[(\d+)\]$/.exec(s || '');
  return m ? Number(m[1]) : null;
};

function nameFor(type, f) {
  switch (type) {
    case 'EXECUTION_STARTED':
      return 'Execution';
    case 'CODE_UNIT_STARTED':
      return f[f.length - 1] || 'Code unit';
    case 'METHOD_ENTRY':
    case 'SYSTEM_METHOD_ENTRY':
      return f[f.length - 1];
    case 'CONSTRUCTOR_ENTRY':
    case 'SYSTEM_CONSTRUCTOR_ENTRY':
      return 'new ' + (f[f.length - 1] || '') + (f.length > 3 ? ' ' + (f[f.length - 2] || '').replace(/^<init>/, '') : '');
    case 'SOQL_EXECUTE_BEGIN':
    case 'SOSL_EXECUTE_BEGIN':
      return f.slice(2).join('|');
    case 'DML_BEGIN': {
      const kv = Object.fromEntries(f.slice(1).map((x) => x.split(':')));
      return `${kv.Op || 'DML'} ${kv.Type || ''}`.trim();
    }
    case 'CALLOUT_REQUEST':
    case 'NAMED_CREDENTIAL_REQUEST':
      return f.slice(1).join('|');
    case 'FLOW_START_INTERVIEWS_BEGIN':
      return 'Flow interviews';
    case 'FLOW_START_INTERVIEW_BEGIN':
      return 'Flow: ' + (f[1] || f[0]);
    case 'FLOW_ELEMENT_BEGIN':
      return `${(f[1] || '').replace(/^Flow/, '')}: ${f[2] || ''}`;
    case 'WF_RULE_EVAL_BEGIN':
      return 'Workflow: ' + (f[0] || '');
    case 'VF_APEX_CALL_START':
      return f.slice(1).join(' ');
    default:
      return type;
  }
}

function parseHeader(line) {
  const m = /^(\d+\.\d+)\s+(.*)$/.exec(line || '');
  if (!m) return { apiVersion: null, levels: [] };
  const levels = m[2]
    .split(';')
    .map((p) => p.split(','))
    .filter((p) => p.length === 2)
    .map(([category, level]) => ({ category, level }));
  return { apiVersion: m[1], levels };
}

const normalizeQuery = (q) =>
  q
    .replace(/'(?:[^'\\]|\\.)*'/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim();

function parse(text, opts = {}) {
  const includeSystem = !!opts.includeSystem;
  const lines = text.split(/\r?\n/);
  const header = parseHeader(lines[0]);
  const truncated = /MAXIMUM DEBUG LOG SIZE REACHED|\*\*\* Skipped \d+ bytes/.test(text);

  let nid = 0;
  const root = { id: nid++, type: 'ROOT', name: 'Log', start: 0, end: 0, line: 0, endLine: lines.length - 1, children: [] };
  const stack = [root];
  const parent = new Map();
  const soql = [];
  const dml = [];
  const debugs = [];
  const exceptions = [];
  const callouts = [];
  const limits = {};
  const eventCounts = {};
  let firstTs = null;
  let lastTs = 0;
  let cur = null; // current leaf awaiting continuation lines
  let curLimit = null;

  const close = (node, ts, line) => {
    node.end = ts;
    node.endLine = line;
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const m = TS.exec(ln);
    if (!m) {
      if (cur && ln.length) cur.detail = (cur.detail ? cur.detail + '\n' : '') + ln;
      if (curLimit) {
        const lm = /^\s*(.+?):\s*(\d+)\s+out of\s+(\d+)/.exec(ln);
        if (lm) {
          const k = lm[1].trim();
          const prev = curLimit[k];
          curLimit[k] = { used: Math.max(Number(lm[2]), prev ? prev.used : 0), max: Number(lm[3]) };
        }
      }
      continue;
    }
    cur = null;
    curLimit = null;
    const ts = Number(m[2]);
    const type = m[3];
    const f = ln.slice(m[0].length).split('|');
    eventCounts[type] = (eventCounts[type] || 0) + 1;
    if (firstTs === null) firstTs = ts;
    lastTs = ts;
    const top = stack[stack.length - 1];

    if (PAIRS[type]) {
      if (!includeSystem && KIND[type] === 'SYSTEM') continue;
      const node = {
        id: nid++,
        type: KIND[type],
        name: nameFor(type, f),
        start: ts,
        end: null,
        line: i,
        endLine: null,
        srcLine: srcLine(f[0]),
        children: [],
        _end: PAIRS[type],
      };
      if (type === 'DML_BEGIN') {
        const rm = /Rows:(\d+)/.exec(f.join('|'));
        node.rows = rm ? Number(rm[1]) : 0;
        dml.push(node);
      } else if (KIND[type] === 'SOQL') {
        node.rows = 0;
        soql.push(node);
      } else if (KIND[type] === 'CALLOUT') {
        callouts.push(node);
      }
      top.children.push(node);
      parent.set(node, top);
      stack.push(node);
      continue;
    }

    if (ENDS.has(type)) {
      let k = stack.length - 1;
      while (k > 0 && stack[k]._end !== type) k--;
      if (k > 0) {
        while (stack.length - 1 > k) close(stack.pop(), ts, i);
        const node = stack.pop();
        close(node, ts, i);
        if (type === 'SOQL_EXECUTE_END' || type === 'SOSL_EXECUTE_END') {
          const rm = /Rows:(\d+)/.exec(f.join('|'));
          node.rows = rm ? Number(rm[1]) : 0;
        } else if (type === 'CALLOUT_RESPONSE' || type === 'NAMED_CREDENTIAL_RESPONSE') {
          node.detail = f.slice(1).join('|');
        }
      }
      continue;
    }

    if (LEAVES[type]) {
      const kind = LEAVES[type];
      let msg, level, sl;
      if (type === 'USER_DEBUG') {
        sl = srcLine(f[0]);
        level = f[1];
        msg = f.slice(2).join('|');
      } else if (type === 'FATAL_ERROR') {
        msg = f.join('|');
      } else {
        sl = srcLine(f[0]);
        msg = sl !== null ? f.slice(1).join('|') : f.join('|');
      }
      const node = { id: nid++, type: kind, name: msg, start: ts, end: ts, line: i, endLine: i, srcLine: sl, level, children: [] };
      top.children.push(node);
      parent.set(node, top);
      cur = node;
      if (kind === 'DEBUG') debugs.push(node);
      else exceptions.push(node);
      continue;
    }

    if (type === 'LIMIT_USAGE_FOR_NS') {
      const ns = (f[0] || '(default)').trim();
      curLimit = limits[ns] = limits[ns] || {};
    }
  }

  while (stack.length > 1) close(stack.pop(), lastTs, lines.length - 1);
  root.start = firstTs || 0;
  root.end = lastTs;

  // Post pass: durations, self time, aggregates.
  const hot = new Map();
  (function walk(n) {
    n.dur = Math.max(0, (n.end ?? n.start) - n.start);
    let childDur = 0;
    n.soql = n.type === 'SOQL' ? 1 : 0;
    n.dml = n.type === 'DML' ? 1 : 0;
    n.totalRows = n.rows || 0;
    for (const c of n.children) {
      walk(c);
      childDur += c.dur;
      n.soql += c.soql;
      n.dml += c.dml;
      n.totalRows += c.totalRows;
    }
    n.self = Math.max(0, n.dur - childDur);
    delete n._end;
    if (['METHOD', 'CODE_UNIT', 'FLOW', 'SYSTEM', 'WORKFLOW'].includes(n.type)) {
      const h = hot.get(n.name) || { name: n.name, type: n.type, count: 0, total: 0, self: 0, soql: 0, dml: 0, rows: 0, firstId: n.id, slowId: n.id, durs: [] };
      h.count++;
      h.durs.push(n.dur);
      h.rows += n.totalRows;
      if (n.dur > (h._max || -1)) { h._max = n.dur; h.slowId = n.id; }
      h.total += n.dur;
      h.self += n.self;
      h.soql += n.soql;
      h.dml += n.dml;
      hot.set(n.name, h);
    }
  })(root);

  const enclosing = (n) => {
    let p = parent.get(n);
    while (p && !['METHOD', 'CODE_UNIT', 'FLOW'].includes(p.type)) p = parent.get(p);
    return p ? p.name : '';
  };

  const groupBy = (list, keyFn) => {
    const g = new Map();
    for (const n of list) {
      const k = keyFn(n);
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(n);
    }
    return g;
  };

  const soqlRows = soql.map((n) => ({
    id: n.id, query: n.name, norm: normalizeQuery(n.name), rows: n.rows || 0, dur: n.dur,
    line: n.line, srcLine: n.srcLine, from: enclosing(n),
  }));
  const normCount = groupBy(soqlRows, (r) => r.norm);
  soqlRows.forEach((r) => (r.repeats = normCount.get(r.norm).length));

  const dmlRows = dml.map((n) => ({
    id: n.id, op: n.name, rows: n.rows || 0, dur: n.dur, line: n.line, srcLine: n.srcLine, from: enclosing(n),
  }));
  const dmlCount = groupBy(dmlRows, (r) => r.op + '|' + r.from + '|' + r.srcLine);
  dmlRows.forEach((r) => (r.repeats = dmlCount.get(r.op + '|' + r.from + '|' + r.srcLine).length));

  // Insights
  const insights = [];
  const add = (sev, title, detail, id) => insights.push({ sev, title, detail, id });
  exceptions
    .filter((e) => e.type === 'FATAL')
    .forEach((e) => add('error', 'Fatal error', e.name + (e.detail ? '\n' + e.detail : ''), e.id));
  const thrown = exceptions.filter((e) => e.type !== 'FATAL');
  if (thrown.length) add('warn', `${thrown.length} exception(s) thrown`, thrown.slice(0, 3).map((e) => e.name).join('\n'), thrown[0].id);
  for (const [, list] of groupBy(soqlRows, (r) => r.norm + '|' + r.from + '|' + r.srcLine)) {
    if (list.length >= 3)
      add('warn', `SOQL executed ${list.length}× from the same line — likely inside a loop`,
        `${list[0].from || 'unknown'} line ${list[0].srcLine ?? '?'}\n${list[0].query}`, list[0].id);
  }
  for (const [, list] of dmlCount) {
    if (list.length >= 3)
      add('warn', `DML executed ${list.length}× from the same line — likely inside a loop`,
        `${list[0].op} · ${list[0].from || 'unknown'} line ${list[0].srcLine ?? '?'}`, list[0].id);
  }
  const limitRows = [];
  for (const [ns, map] of Object.entries(limits)) {
    for (const [name, v] of Object.entries(map)) {
      const pct = v.max ? (v.used / v.max) * 100 : 0;
      limitRows.push({ ns, name, used: v.used, max: v.max, pct });
      if (pct >= 80) add('error', `${name}: ${v.used} of ${v.max} (${pct.toFixed(0)}%)`, `Namespace ${ns}`);
      else if (pct >= 50) add('warn', `${name}: ${v.used} of ${v.max} (${pct.toFixed(0)}%)`, `Namespace ${ns}`);
    }
  }
  const hotspots = [...hot.values()].sort((a, b) => b.self - a.self);
  for (const h of hotspots) {
    const d = h.durs.sort((a, b) => a - b);
    h.min = d[0];
    h.max = d[d.length - 1];
    h.p95 = d[Math.min(d.length - 1, Math.floor(d.length * 0.95))];
    h.median = d[Math.floor(d.length / 2)];
    delete h.durs;
    delete h._max;
  }

  // Performance: where did the time go (self-time by category sums to total).
  const breakdown = { apex: 0, soql: 0, dml: 0, callout: 0, flow: 0, system: 0, platform: 0 };
  const slowCalls = [];
  (function bw(n) {
    switch (n.type) {
      case 'METHOD': case 'CODE_UNIT': breakdown.apex += n.self; break;
      case 'SOQL': breakdown.soql += n.dur; break;
      case 'DML': breakdown.dml += n.self; break;
      case 'CALLOUT': breakdown.callout += n.dur; break;
      case 'FLOW': case 'WORKFLOW': breakdown.flow += n.self; break;
      case 'SYSTEM': breakdown.system += n.self; break;
      default: if (!['DEBUG', 'EXCEPTION', 'FATAL'].includes(n.type)) breakdown.platform += n.self;
    }
    if (['METHOD', 'SOQL', 'DML', 'CALLOUT', 'FLOW'].includes(n.type)) slowCalls.push(n);
    if (n.type !== 'SOQL' && n.type !== 'CALLOUT') for (const c of n.children) bw(c);
  })(root);
  slowCalls.sort((a, b) => b.dur - a.dur);
  const criticalPath = [];
  for (let n = root; n; ) {
    const next = n.children.filter((c) => c.dur > 0).sort((a, b) => b.dur - a.dur)[0];
    if (!next) break;
    criticalPath.push(next.id);
    n = next;
  }
  const lim = (name) => {
    for (const map of Object.values(limits)) if (map[name]) return map[name];
    return null;
  };
  const perf = {
    breakdown,
    criticalPath,
    slowest: slowCalls.slice(0, 25).map((n) => n.id),
    cpu: lim('Maximum CPU time'),
    heap: lim('Maximum heap size'),
    units: root.children
      .flatMap((c) => (c.type === 'EXECUTION' ? c.children : [c]))
      .filter((c) => c.type === 'CODE_UNIT' || c.type === 'FLOW')
      .map((c) => c.id),
  };
  const slow = hotspots.find((h) => h.type === 'METHOD' || h.type === 'FLOW');
  if (slow && root.end - root.start > 0 && slow.self / (root.end - root.start) > 0.2)
    add('info', `Hotspot: ${slow.name}`, `${(slow.self / 1e6).toFixed(1)} ms self time across ${slow.count} call(s)`, slow.firstId);
  const slowQ = [...soqlRows].sort((a, b) => b.dur - a.dur)[0];
  if (slowQ && slowQ.dur > 200e6) add('warn', `Slow query (${(slowQ.dur / 1e6).toFixed(0)} ms)`, slowQ.query, slowQ.id);
  if (truncated) add('warn', 'Log was truncated', 'The log hit the 20 MB limit; lower log levels for a complete trace.');
  const apex = header.levels.find((l) => l.category === 'APEX_CODE');
  if (apex && ['NONE', 'ERROR', 'WARN', 'INFO', 'DEBUG'].includes(apex.level))
    add('info', `APEX_CODE is ${apex.level}`, 'Method entry/exit is only logged at FINE or above, so the call tree is shallow.');
  const order = { error: 0, warn: 1, info: 2 };
  insights.sort((a, b) => order[a.sev] - order[b.sev]);

  const stats = {
    duration: root.end - root.start,
    lines: lines.length,
    codeUnits: eventCounts.CODE_UNIT_STARTED || 0,
    methods: (eventCounts.METHOD_ENTRY || 0) + (eventCounts.CONSTRUCTOR_ENTRY || 0),
    soql: soql.length,
    soqlRows: soqlRows.reduce((s, r) => s + r.rows, 0),
    dml: dml.length,
    dmlRows: dmlRows.reduce((s, r) => s + r.rows, 0),
    callouts: callouts.length,
    debugs: debugs.length,
    exceptions: exceptions.length,
    flows: eventCounts.FLOW_START_INTERVIEW_BEGIN || 0,
  };

  return {
    header,
    truncated,
    root,
    stats,
    insights,
    limits: limitRows,
    soql: soqlRows,
    dml: dmlRows,
    debugs: debugs.map((n) => ({ id: n.id, level: n.level, msg: n.name + (n.detail ? '\n' + n.detail : ''), line: n.line, srcLine: n.srcLine, ts: n.start - root.start, from: enclosing(n) })),
    exceptions: exceptions.map((n) => ({ id: n.id, type: n.type, msg: n.name + (n.detail ? '\n' + n.detail : ''), line: n.line, srcLine: n.srcLine, from: enclosing(n) })),
    hotspots: hotspots.slice(0, 1000),
    perf,
    eventCounts: Object.entries(eventCounts).sort((a, b) => b[1] - a[1]),
  };
}

module.exports = { parse, normalizeQuery };
