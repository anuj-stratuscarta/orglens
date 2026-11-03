'use strict';
const vscode = require('vscode');

const CATS = ['ApexCode', 'ApexProfiling', 'Callout', 'Database', 'System', 'Validation', 'Visualforce', 'Workflow'];

const PRESETS = {
  Analysis: {
    label: '$(graph) Analysis',
    detail: 'Best for the analyzer: method timing, SOQL/DML, limits, flows (ApexCode FINE, Profiling FINEST, DB FINEST)',
    levels: { ApexCode: 'FINE', ApexProfiling: 'FINEST', Callout: 'INFO', Database: 'FINEST', System: 'INFO', Validation: 'INFO', Visualforce: 'INFO', Workflow: 'FINER' },
  },
  Debug: {
    label: '$(debug) Debug',
    detail: 'System.debug output, SOQL & DML, small logs (ApexCode DEBUG, DB INFO)',
    levels: { ApexCode: 'DEBUG', ApexProfiling: 'INFO', Callout: 'INFO', Database: 'INFO', System: 'DEBUG', Validation: 'INFO', Visualforce: 'INFO', Workflow: 'INFO' },
  },
  Finest: {
    label: '$(flame) Finest',
    detail: 'Everything incl. variable assignments — large logs, may truncate',
    levels: { ApexCode: 'FINEST', ApexProfiling: 'FINEST', Callout: 'FINEST', Database: 'FINEST', System: 'FINE', Validation: 'INFO', Visualforce: 'FINER', Workflow: 'FINER' },
  },
  Minimal: {
    label: '$(dash) Errors only',
    detail: 'Exceptions and limits only — tiny logs',
    levels: { ApexCode: 'ERROR', ApexProfiling: 'INFO', Callout: 'NONE', Database: 'NONE', System: 'NONE', Validation: 'NONE', Visualforce: 'NONE', Workflow: 'NONE' },
  },
};

async function ensureDebugLevel(conn, name, levels) {
  const dev = `OrgLens_${name}`;
  const existing = await conn.query(`SELECT Id FROM DebugLevel WHERE DeveloperName = '${dev}'`, true);
  if (existing.length) {
    await conn.request('PATCH', `/tooling/sobjects/DebugLevel/${existing[0].Id}`, levels);
    return existing[0].Id;
  }
  const r = await conn.request('POST', '/tooling/sobjects/DebugLevel', { DeveloperName: dev, MasterLabel: dev, ...levels });
  return r.id;
}

async function activeTraceFlag(conn, userId) {
  const r = await conn.query(
    `SELECT Id, StartDate, ExpirationDate, DebugLevel.DeveloperName FROM TraceFlag WHERE TracedEntityId = '${userId}' AND LogType IN ('DEVELOPER_LOG','USER_DEBUG') ORDER BY ExpirationDate DESC`,
    true
  );
  return r.find((t) => new Date(t.ExpirationDate) > Date.now()) || null;
}

/**
 * Create or extend a trace flag. Your own user gets DEVELOPER_LOG; anyone else
 * (other users, Automated Process, guest users, classes/triggers) gets USER_DEBUG.
 */
async function startTrace(conn, { userId, minutes, preset, levels, debugLevelId, logType }) {
  const dlId = debugLevelId || (await ensureDebugLevel(conn, preset || 'Custom', levels || PRESETS[preset].levels));
  const type = logType || (userId === conn.userId ? 'DEVELOPER_LOG' : userId.startsWith('005') ? 'USER_DEBUG' : 'CLASS_TRACING');
  const now = new Date(Date.now() - 60 * 1000);
  const exp = new Date(Date.now() + Math.min(minutes, 24 * 60 - 2) * 60 * 1000);
  const body = { StartDate: now.toISOString(), ExpirationDate: exp.toISOString(), DebugLevelId: dlId };
  const existing = await conn.query(`SELECT Id FROM TraceFlag WHERE TracedEntityId = '${userId}' AND LogType = '${type}'`, true);
  if (existing.length) {
    await conn.request('PATCH', `/tooling/sobjects/TraceFlag/${existing[0].Id}`, body);
  } else {
    await conn.request('POST', '/tooling/sobjects/TraceFlag', { ...body, TracedEntityId: userId, LogType: type });
  }
  return exp;
}

/** All trace flags in the org with the traced entity's name resolved. */
async function listTraceFlags(conn) {
  const flags = await conn.query(
    'SELECT Id, TracedEntityId, LogType, StartDate, ExpirationDate, DebugLevelId, DebugLevel.DeveloperName FROM TraceFlag ORDER BY ExpirationDate DESC',
    true
  );
  const ids = [...new Set(flags.map((f) => f.TracedEntityId))];
  const names = {};
  const users = ids.filter((i) => i.startsWith('005'));
  const classes = ids.filter((i) => i.startsWith('01p'));
  const triggers = ids.filter((i) => i.startsWith('01q'));
  const inList = (a) => a.map((x) => `'${x}'`).join(',');
  if (users.length)
    (await conn.query(`SELECT Id, Name, Username, UserType FROM User WHERE Id IN (${inList(users)})`)).forEach(
      (u) => (names[u.Id] = { name: u.Name, sub: u.Username, kind: u.UserType === 'AutomatedProcess' ? 'Automated Process' : u.UserType === 'Guest' ? 'Guest user' : 'User' })
    );
  if (classes.length)
    (await conn.query(`SELECT Id, Name FROM ApexClass WHERE Id IN (${inList(classes)})`, true)).forEach((c) => (names[c.Id] = { name: c.Name, kind: 'Apex class' }));
  if (triggers.length)
    (await conn.query(`SELECT Id, Name FROM ApexTrigger WHERE Id IN (${inList(triggers)})`, true)).forEach((c) => (names[c.Id] = { name: c.Name, kind: 'Apex trigger' }));
  return flags.map((f) => ({
    id: f.Id,
    entityId: f.TracedEntityId,
    entity: names[f.TracedEntityId] || { name: f.TracedEntityId, kind: '?' },
    logType: f.LogType,
    start: f.StartDate,
    exp: f.ExpirationDate,
    active: new Date(f.ExpirationDate) > Date.now(),
    debugLevelId: f.DebugLevelId,
    debugLevel: f.DebugLevel && f.DebugLevel.DeveloperName,
  }));
}

async function listDebugLevels(conn) {
  return conn.query(`SELECT Id, DeveloperName, ${CATS.join(', ')} FROM DebugLevel ORDER BY DeveloperName`, true);
}

async function saveDebugLevel(conn, { id, name, levels }) {
  const lv = Object.fromEntries(CATS.map((c) => [c, levels[c] || 'NONE']));
  if (id) {
    await conn.request('PATCH', `/tooling/sobjects/DebugLevel/${id}`, lv);
    return id;
  }
  const dev = String(name).replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'Custom';
  const r = await conn.request('POST', '/tooling/sobjects/DebugLevel', { DeveloperName: dev, MasterLabel: dev, ...lv });
  return r.id;
}

async function stopTrace(conn, userId) {
  const r = await conn.query(`SELECT Id FROM TraceFlag WHERE TracedEntityId = '${userId}' AND LogType IN ('DEVELOPER_LOG','USER_DEBUG')`, true);
  for (const t of r) await conn.request('DELETE', `/tooling/sobjects/TraceFlag/${t.Id}`);
  return r.length;
}

/** Interactive flow: who → preset → duration. */
async function startTraceInteractive(conn, opts = {}) {
  let userId = conn.userId;
  let userName = conn.userName;
  if (opts.pickUser) {
    const pick = await pickUser(conn);
    if (!pick) return null;
    userId = pick.id;
    userName = pick.label;
  }
  const cfg = vscode.workspace.getConfiguration('orglens');
  const presetItems = Object.entries(PRESETS).map(([k, p]) => ({ label: p.label, detail: p.detail, key: k }));
  presetItems.push({ label: '$(settings) Custom…', detail: 'Choose a level per category', key: 'Custom' });
  const def = cfg.get('trace.defaultPreset');
  presetItems.sort((a, b) => (a.key === def ? -1 : b.key === def ? 1 : 0));
  const preset = await vscode.window.showQuickPick(presetItems, { title: `Debug level for ${userName}`, placeHolder: 'What do you want to capture?' });
  if (!preset) return null;
  let levels;
  if (preset.key === 'Custom') {
    levels = {};
    const base = PRESETS.Analysis.levels;
    for (const c of CATS) {
      const v = await vscode.window.showQuickPick(['NONE', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'FINE', 'FINER', 'FINEST'].map((l) => ({ label: l, picked: l === base[c], description: l === base[c] ? 'recommended' : '' })), { title: `${c} level` });
      if (!v) return null;
      levels[c] = v.label;
    }
  }
  const mins = await vscode.window.showQuickPick(
    [15, 30, 60, 120, 240, 480, 1440].map((m) => ({ label: m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`, m })),
    { title: 'Trace duration', placeHolder: `Default ${cfg.get('trace.durationMinutes')} min` }
  );
  if (!mins) return null;
  const exp = await startTrace(conn, { userId, minutes: mins.m, preset: preset.key === 'Custom' ? null : preset.key, levels });
  return { exp, userName, self: userId === conn.userId };
}

async function pickUser(conn) {
  const qp = vscode.window.createQuickPick();
  qp.title = 'Trace which user?';
  qp.placeholder = 'Type to search active users (incl. Automated Process, Site Guest)';
  qp.busy = true;
  const load = async (term) => {
    qp.busy = true;
    const where = term ? ` AND (Name LIKE '%${term.replace(/'/g, "\\'")}%' OR Username LIKE '%${term.replace(/'/g, "\\'")}%')` : '';
    try {
      const users = await conn.query(`SELECT Id, Name, Username, UserType FROM User WHERE (IsActive = true OR UserType = 'AutomatedProcess')${where} ORDER BY LastLoginDate DESC NULLS LAST LIMIT 50`);
      qp.items = users.map((u) => ({ label: u.Name, description: u.Username, detail: u.UserType, id: u.Id }));
    } catch (e) {
      qp.items = [{ label: 'Error: ' + e.message }];
    }
    qp.busy = false;
  };
  let t;
  qp.onDidChangeValue((v) => {
    clearTimeout(t);
    t = setTimeout(() => load(v), 300);
  });
  load('');
  return new Promise((resolve) => {
    qp.onDidAccept(() => {
      resolve(qp.selectedItems[0] && qp.selectedItems[0].id ? qp.selectedItems[0] : null);
      qp.hide();
    });
    qp.onDidHide(() => resolve(null));
    qp.show();
  });
}

module.exports = { PRESETS, CATS, startTrace, stopTrace, activeTraceFlag, startTraceInteractive, listTraceFlags, listDebugLevels, saveDebugLevel, ensureDebugLevel };
