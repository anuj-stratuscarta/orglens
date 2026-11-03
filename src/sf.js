'use strict';
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Run an `sf` CLI command and return the parsed `result`. */
function runSf(args, cwd) {
  const cmd = 'sf ' + args.map(quote).join(' ') + ' --json';
  return new Promise((resolve, reject) => {
    cp.exec(
      cmd,
      { cwd, maxBuffer: 100 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1', SF_DISABLE_TELEMETRY: 'true' } },
      (err, stdout, stderr) => {
        const out = String(stdout || '');
        const start = out.indexOf('{');
        let parsed;
        try {
          parsed = JSON.parse(out.slice(start));
        } catch {
          return reject(new Error(String(stderr || (err && err.message) || 'sf command failed').trim()));
        }
        if (parsed.status !== 0) return reject(new Error(parsed.message || parsed.name || 'sf command failed'));
        resolve(parsed.result);
      }
    );
  });
}

function quote(a) {
  a = String(a);
  if (/^[\w.@:/=-]+$/.test(a)) return a;
  return '"' + a.replace(/"/g, '\\"') + '"';
}

/** Lightweight REST connection that borrows auth from the sf CLI. */
class Connection {
  constructor(target, cwd) {
    this.target = target;
    this.cwd = cwd;
  }

  /**
   * Connect. Fast path: org metadata from the CLI's auth files (no process spawn) plus a
   * cached token; only falls back to `sf` when needed. `cache` = { accessToken, userId, userName }.
   */
  async init(cache) {
    const meta = readAuthMeta(this.target);
    let display = null;
    if (meta) Object.assign(this, meta);
    if (cache && cache.accessToken && meta) {
      this.accessToken = cache.accessToken;
      this.userId = cache.userId;
      this.userName = cache.userName;
    } else if (meta) {
      this.accessToken = await this.freshToken(null);
    } else {
      // Unknown file layout: ask the CLI for both in parallel.
      const [r, tok] = await Promise.all([
        runSf(['org', 'display', '-o', this.target], this.cwd),
        runSf(['org', 'auth', 'show-access-token', '-o', this.target, '-p'], this.cwd).catch(() => null),
      ]);
      display = r;
      this.instanceUrl = String(r.instanceUrl).replace(/\/$/, '');
      this.username = r.username;
      this.alias = r.alias || r.username;
      this.orgId = r.id;
      this.apiVersion = r.apiVersion || '62.0';
      this.accessToken = tok && tok.accessToken ? tok.accessToken : await this.freshToken(display.accessToken);
      if (this.onToken) this.onToken(this.accessToken);
    }
    if (!this.userId) {
      const u = await this.query(`SELECT Id, Name FROM User WHERE Username = '${this.username.replace(/'/g, "\\'")}'`);
      this.userId = u[0] && u[0].Id;
      this.userName = u[0] && u[0].Name;
    }
    return this;
  }

  /** Newer sf CLIs redact the token in `org display`; ask for it explicitly. */
  async freshToken(fromDisplay) {
    if (fromDisplay && !/REDACTED/i.test(fromDisplay)) return fromDisplay;
    const t = await runSf(['org', 'auth', 'show-access-token', '-o', this.target, '-p'], this.cwd);
    if (!t || !t.accessToken) throw new Error('sf CLI did not return an access token');
    if (this.onToken) this.onToken(t.accessToken);
    return t.accessToken;
  }

  url(path) {
    if (/^https?:/.test(path)) return path;
    if (path.startsWith('/services')) return this.instanceUrl + path;
    return `${this.instanceUrl}/services/data/v${this.apiVersion}${path}`;
  }

  async request(method, path, body, opts = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(this.url(path), {
        method,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          Accept: opts.text ? '*/*' : 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401 && attempt === 0 && !opts.noRetry) {
        // Token expired: let the CLI refresh it (single-flight), then retry once.
        this._refresh = this._refresh || this.freshToken(null).finally(() => (this._refresh = null));
        this.accessToken = await this._refresh;
        continue;
      }
      if (!res.ok) {
        const t = await res.text();
        let msg = t;
        try {
          const j = JSON.parse(t);
          msg = Array.isArray(j) ? j.map((e) => e.message).join('; ') : j.message || t;
        } catch { /* keep raw */ }
        throw new Error(`${res.status}: ${msg}`);
      }
      if (res.status === 204) return null;
      return opts.text ? res.text() : res.json();
    }
  }

  async query(soql, tooling = false) {
    let r = await this.request('GET', `${tooling ? '/tooling' : ''}/query?q=${encodeURIComponent(soql)}`);
    const out = [...r.records];
    while (!r.done && r.nextRecordsUrl) {
      r = await this.request('GET', r.nextRecordsUrl);
      out.push(...r.records);
    }
    return out;
  }

  /** Call the Metadata SOAP API; `body` is the inner operation XML. Returns the response text. */
  async metadata(body) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const envelope =
        '<?xml version="1.0" encoding="utf-8"?><env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        `<env:Header><SessionHeader xmlns="http://soap.sforce.com/2006/04/metadata"><sessionId>${this.accessToken}</sessionId></SessionHeader></env:Header>` +
        `<env:Body>${body}</env:Body></env:Envelope>`;
      const res = await fetch(`${this.instanceUrl}/services/Soap/m/${this.apiVersion}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=UTF-8', SOAPAction: '""' },
        body: envelope,
      });
      const text = await res.text();
      if (res.ok) return text;
      const fault = (/<faultstring>([\s\S]*?)<\/faultstring>/.exec(text) || [])[1] || `HTTP ${res.status}`;
      if (attempt === 0 && /INVALID_SESSION_ID/.test(text)) {
        this.accessToken = await this.freshToken(null);
        continue;
      }
      throw new Error(fault);
    }
  }

  /**
   * Execute anonymous Apex through the Apex SOAP API with a DebuggingHeader, so the response carries
   * the structured result (compile error line/column, exception, stack) AND the debug log — even on failure.
   */
  async executeAnonymous(code, levels) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lv = levels || { Apex_code: 'FINE', Apex_profiling: 'FINEST', Callout: 'INFO', Db: 'FINEST', System: 'INFO', Validation: 'INFO', Visualforce: 'INFO', Workflow: 'FINER' };
    const cats = Object.entries(lv).map(([c, l]) => `<apex:categories><apex:category>${c}</apex:category><apex:level>${l}</apex:level></apex:categories>`).join('');
    for (let attempt = 0; attempt < 2; attempt++) {
      const envelope =
        '<?xml version="1.0" encoding="utf-8"?><env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:apex="http://soap.sforce.com/2006/08/apex">' +
        `<env:Header><apex:SessionHeader><apex:sessionId>${this.accessToken}</apex:sessionId></apex:SessionHeader><apex:DebuggingHeader>${cats}<apex:debugLevel>NONE</apex:debugLevel></apex:DebuggingHeader></env:Header>` +
        `<env:Body><apex:executeAnonymous><apex:String>${esc(code)}</apex:String></apex:executeAnonymous></env:Body></env:Envelope>`;
      const res = await fetch(`${this.instanceUrl}/services/Soap/s/${this.apiVersion}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=UTF-8', SOAPAction: '""' },
        body: envelope,
      });
      const text = await res.text();
      if (!res.ok) {
        if (attempt === 0 && /INVALID_SESSION_ID/.test(text)) { this.accessToken = await this.freshToken(null); continue; }
        throw new Error((/<faultstring>([\s\S]*?)<\/faultstring>/.exec(text) || [])[1] || `HTTP ${res.status}`);
      }
      const X = require('./xml');
      const doc = X.parse(text);
      const field = (n) => { const f = X.find(X.find(doc, 'result') || doc, n); return f ? f.text : null; };
      const log = X.find(doc, 'debugLog');
      return {
        compiled: field('compiled') === 'true',
        success: field('success') === 'true',
        line: Number(field('line')) || null,
        column: Number(field('column')) || null,
        compileProblem: field('compileProblem') || '',
        exceptionMessage: field('exceptionMessage') || '',
        exceptionStackTrace: field('exceptionStackTrace') || '',
        logs: log ? log.text : '',
      };
    }
  }

  // ---- Apex logs -------------------------------------------------------
  listLogs({ max = 100, userId, errorsOnly } = {}) {
    const where = [];
    if (userId) where.push(`LogUserId = '${userId}'`);
    if (errorsOnly) where.push(`Status != 'Success'`);
    return this.query(
      'SELECT Id, LogUserId, LogUser.Name, Operation, Application, Status, LogLength, StartTime, ' +
        'DurationMilliseconds, Request, Location FROM ApexLog' +
        (where.length ? ' WHERE ' + where.join(' AND ') : '') +
        ` ORDER BY StartTime DESC LIMIT ${Math.min(Math.max(max, 1), 2000)}`
    );
  }

  getLogBody(id) {
    return this.request('GET', `/sobjects/ApexLog/${id}/Body`, null, { text: true });
  }

  async deleteLogs(ids) {
    let deleted = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      try {
        const r = await this.request('DELETE', `/composite/sobjects?allOrNone=false&ids=${chunk.join(',')}`);
        deleted += (r || []).filter((x) => x.success).length;
      } catch {
        for (const id of chunk) {
          try {
            await this.request('DELETE', `/sobjects/ApexLog/${id}`);
            deleted++;
          } catch { /* skip */ }
        }
      }
    }
    return deleted;
  }
}

/**
 * Authorized orgs read straight from the sf CLI's files (~/.sfdx/<username>.json + alias.json) — instant,
 * no process spawn and no network. Tokens are not read (they're encrypted anyway).
 */
function listOrgsFast() {
  const dir = path.join(os.homedir(), '.sfdx');
  let aliases = {};
  try { aliases = JSON.parse(fs.readFileSync(path.join(dir, 'alias.json'), 'utf8')).orgs || {}; } catch { /* none */ }
  const byUser = {};
  for (const [alias, user] of Object.entries(aliases)) (byUser[user] = byUser[user] || []).push(alias);
  const out = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f.includes('@')); } catch { return out; }
  for (const f of files) {
    try {
      const full = path.join(dir, f);
      const j = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (!j.username || !j.instanceUrl) continue;
      out.push({
        username: j.username,
        alias: (byUser[j.username] || [])[0] || null,
        aliases: byUser[j.username] || [],
        instanceUrl: j.instanceUrl,
        orgId: j.orgId,
        isSandbox: !!j.isSandbox,
        isScratch: !!j.isScratch,
        isDevHub: !!j.isDevHub,
        expires: j.expirationDate || null,
        lastUsed: fs.statSync(full).mtime.toISOString(),
      });
    } catch { /* skip unreadable file */ }
  }
  return out;
}

async function listOrgs(cwd) {
  const r = await runSf(['org', 'list'], cwd);
  const seen = new Map();
  for (const key of Object.keys(r || {})) {
    if (!Array.isArray(r[key])) continue;
    for (const o of r[key]) if (o && o.username && !seen.has(o.username)) seen.set(o.username, o);
  }
  return [...seen.values()];
}

/** Org metadata (not secrets) from the sf CLI's auth files: ~/.sfdx/alias.json + ~/.sfdx/<username>.json. */
function readAuthMeta(target) {
  try {
    const dir = path.join(os.homedir(), '.sfdx');
    let username = target;
    try {
      const a = JSON.parse(fs.readFileSync(path.join(dir, 'alias.json'), 'utf8'));
      if (a.orgs && a.orgs[target]) username = a.orgs[target];
    } catch { /* no aliases */ }
    const j = JSON.parse(fs.readFileSync(path.join(dir, `${username}.json`), 'utf8'));
    if (!j.instanceUrl || !j.username) return null;
    return {
      instanceUrl: String(j.instanceUrl).replace(/\/$/, ''),
      username: j.username,
      alias: target !== j.username ? target : j.username,
      orgId: j.orgId,
      apiVersion: j.instanceApiVersion || '62.0',
    };
  } catch {
    return null;
  }
}

/** Project default org from config files (fast), falling back to the CLI. */
async function defaultOrg(cwd) {
  const read = (f, k) => {
    try { return JSON.parse(fs.readFileSync(f, 'utf8'))[k] || null; } catch { return null; }
  };
  const fast =
    read(path.join(cwd, '.sf', 'config.json'), 'target-org') ||
    read(path.join(cwd, '.sfdx', 'sfdx-config.json'), 'defaultusername') ||
    read(path.join(os.homedir(), '.sf', 'config.json'), 'target-org') ||
    read(path.join(os.homedir(), '.sfdx', 'sfdx-config.json'), 'defaultusername');
  if (fast) return fast;
  try {
    const r = await runSf(['config', 'get', 'target-org'], cwd);
    return (r && r[0] && r[0].value) || null;
  } catch {
    return null;
  }
}

module.exports = { runSf, Connection, listOrgs, listOrgsFast, defaultOrg };
