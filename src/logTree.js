'use strict';
const vscode = require('vscode');

const OP_ICON = [
  [/executeAnonymous/i, 'terminal'],
  [/^\/aura|lightning|\/apexremote/i, 'globe'],
  [/ApexTestHandler|test/i, 'beaker'],
  [/batch/i, 'layers'],
  [/future|queueable|scheduled/i, 'clock'],
  [/^Api$|\/services\//i, 'plug'],
  [/flow|process/i, 'git-merge'],
  [/trigger/i, 'zap'],
];

const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1024).toFixed(1) + ' KB');
const fmtTime = (iso) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

class LogItem extends vscode.TreeItem {
  constructor(log, isNew, defaultAction) {
    super(`${fmtTime(log.StartTime)}  ${log.Operation}`, vscode.TreeItemCollapsibleState.None);
    this.log = log;
    this.id = log.Id;
    const user = (log.LogUser && log.LogUser.Name) || '';
    const failed = log.Status && log.Status !== 'Success';
    this.description = `${user} · ${log.DurationMilliseconds} ms · ${fmtSize(log.LogLength)}`;
    const icon = (OP_ICON.find(([re]) => re.test(log.Operation || '')) || [0, 'output'])[1];
    this.iconPath = failed
      ? new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'))
      : isNew
      ? new vscode.ThemeIcon('sparkle', new vscode.ThemeColor('charts.green'))
      : new vscode.ThemeIcon(icon);
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**${log.Operation}**\n\n`);
    md.appendMarkdown(`| | |\n|---|---|\n`);
    md.appendMarkdown(`| User | ${user} |\n| Status | ${failed ? '$(error) ' : ''}${log.Status} |\n`);
    md.appendMarkdown(`| Started | ${new Date(log.StartTime).toLocaleString()} |\n| Duration | ${log.DurationMilliseconds} ms |\n`);
    md.appendMarkdown(`| Size | ${fmtSize(log.LogLength)} |\n| Request | ${log.Request} · ${log.Application} · ${log.Location} |\n| Id | \`${log.Id}\` |`);
    this.tooltip = md;
    this.contextValue = 'apexLog';
    this.command = {
      command: defaultAction === 'raw' ? 'orglens.openRaw' : 'orglens.analyze',
      title: 'Open',
      arguments: [this],
    };
  }
}

class LogTreeProvider {
  constructor(state) {
    this.state = state; // { conn(), filter }
    this.logs = [];
    this.newIds = new Set();
    this.knownIds = null;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
    this.loading = false;
    this.error = null;
  }

  get filter() {
    return this.state.filter;
  }

  getTreeItem(el) {
    return el;
  }

  getChildren(el) {
    if (el) return [];
    if (!this.state.conn()) return [];
    if (this.error) {
      const e = new vscode.TreeItem('Failed to load logs');
      e.description = this.error;
      e.tooltip = this.error;
      e.iconPath = new vscode.ThemeIcon('warning');
      e.command = { command: 'orglens.refresh', title: 'Retry' };
      return [e];
    }
    const cfg = vscode.workspace.getConfiguration('orglens');
    const items = this.filtered().map((l) => new LogItem(l, this.newIds.has(l.Id), cfg.get('defaultOpenAction')));
    if (!items.length && !this.loading) {
      const e = new vscode.TreeItem(this.logs.length ? 'No logs match the filter' : 'No debug logs yet');
      e.description = this.logs.length ? 'Clear filter' : 'Start tracing, then run something';
      e.iconPath = new vscode.ThemeIcon('info');
      e.command = this.logs.length
        ? { command: 'orglens.clearFilter', title: 'Clear' }
        : { command: 'orglens.startTrace', title: 'Start' };
      return [e];
    }
    return items;
  }

  filtered() {
    const f = this.filter;
    const t = (f.text || '').toLowerCase();
    return this.logs.filter((l) => {
      if (f.operation && l.Operation !== f.operation) return false;
      if (f.userName && (l.LogUser && l.LogUser.Name) !== f.userName) return false;
      if (f.minDuration && l.DurationMilliseconds < f.minDuration) return false;
      if (t && !`${l.Operation} ${l.LogUser && l.LogUser.Name} ${l.Status} ${l.Request}`.toLowerCase().includes(t)) return false;
      return true;
    });
  }

  /** Fetch logs; returns the newly-arrived log records. */
  async refresh() {
    const conn = this.state.conn();
    if (!conn) {
      this.logs = [];
      this._emitter.fire();
      return [];
    }
    const cfg = vscode.workspace.getConfiguration('orglens');
    this.loading = true;
    try {
      const logs = await conn.listLogs({
        max: cfg.get('maxLogs'),
        userId: this.filter.mineOnly ? conn.userId : undefined,
        errorsOnly: this.filter.errorsOnly,
      });
      const hadError = this.error !== null;
      this.error = null;
      const fresh = this.knownIds ? logs.filter((l) => !this.knownIds.has(l.Id)) : [];
      fresh.forEach((l) => this.newIds.add(l.Id));
      const sig = logs.map((l) => l.Id).join(',');
      const changed = hadError || sig !== this._sig;
      this._sig = sig;
      this.knownIds = new Set(logs.map((l) => l.Id));
      this.logs = logs;
      if (changed) this._emitter.fire();
      return fresh;
    } catch (e) {
      this.error = e.message;
      this._emitter.fire();
      return [];
    } finally {
      this.loading = false;
    }
  }

  markSeen(id) {
    if (this.newIds.delete(id)) this._emitter.fire();
  }

  reset() {
    this.logs = [];
    this.newIds.clear();
    this.knownIds = null;
    this.error = null;
    this._emitter.fire();
  }
}

module.exports = { LogTreeProvider, LogItem };
