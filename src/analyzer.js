'use strict';
const vscode = require('vscode');
const path = require('path');
const { parse } = require('./parser');

const panels = new Map();

/**
 * Open (or focus) the analyzer for a log.
 * @param {vscode.ExtensionContext} ctx
 * @param {{key:string,title:string,text:string,uri:vscode.Uri,meta?:object,getConn?:()=>any}} o
 */
function showAnalyzer(ctx, o) {
  const existing = panels.get(o.key);
  if (existing) {
    existing.reveal(vscode.ViewColumn.Active);
    if (o.search) existing.webview.postMessage({ type: 'search', term: o.search, line: o.line });
    return existing;
  }
  const media = vscode.Uri.joinPath(ctx.extensionUri, 'media');
  const panel = vscode.window.createWebviewPanel('orglens.analyzer', o.title, vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [media],
  });
  panel.iconPath = vscode.Uri.joinPath(media, 'icon-tab.svg');
  panels.set(o.key, panel);
  panel.onDidDispose(() => panels.delete(o.key));

  const cfg = vscode.workspace.getConfiguration('orglens');
  let data;
  try {
    data = parse(o.text, { includeSystem: cfg.get('analyzer.includeSystemMethods') });
  } catch (e) {
    vscode.window.showErrorMessage('Could not parse log: ' + e.message);
    panel.dispose();
    return;
  }
  data.meta = { title: o.title, size: o.text.length, file: o.uri.fsPath, ...(o.meta || {}) };
  data.raw = o.text;
  if (o.search) data.meta.search = { term: o.search, line: o.line };

  const w = panel.webview;
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const css = w.asWebviewUri(vscode.Uri.joinPath(media, 'analyzer.css'));
  const js = w.asWebviewUri(vscode.Uri.joinPath(media, 'analyzer.js'));
  w.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${w.cspSource} data:; style-src ${w.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${w.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><link rel="stylesheet" href="${css}"><title>${o.title}</title></head>
<body><div id="app"><div class="loading"><div class="spinner"></div>Analyzing log…</div></div>
<script nonce="${nonce}" src="${js}"></script></body></html>`;

  w.onDidReceiveMessage(async (msg) => {
    try {
      switch (msg.cmd) {
        case 'ready':
          w.postMessage({ type: 'data', data });
          break;
        case 'reveal':
          await revealLine(o.uri, msg.line);
          break;
        case 'openSource':
          await openSource(msg.name, msg.line);
          break;
        case 'openRaw':
          await revealLine(o.uri, 0);
          break;
        case 'copy':
          await vscode.env.clipboard.writeText(msg.text);
          vscode.window.setStatusBarMessage('$(check) Copied', 2000);
          break;
        case 'explain': {
          const conn = o.getConn && o.getConn();
          if (!conn) throw new Error('Connect to an org to get query plans.');
          const q = msg.query.replace(/:\s*\w+(\.\w+)*/g, "''"); // bind vars → literal
          const r = await conn.request('GET', `/query?explain=${encodeURIComponent(q)}`);
          w.postMessage({ type: 'plan', id: msg.id, plans: r.plans || [] });
          break;
        }
      }
    } catch (e) {
      if (msg.cmd === 'explain') w.postMessage({ type: 'plan', id: msg.id, error: e.message });
      else vscode.window.showErrorMessage(e.message);
    }
  });
  return panel;
}

async function revealLine(uri, line) {
  const doc = await vscode.workspace.openTextDocument(uri);
  if (doc.languageId !== 'apexlog') await vscode.languages.setTextDocumentLanguage(doc, 'apexlog');
  const ed = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false });
  const pos = new vscode.Position(Math.max(0, line || 0), 0);
  ed.selection = new vscode.Selection(pos, doc.lineAt(pos.line).range.end);
  ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

/** Map a log frame name (Class.method(...) or trigger code unit) to a workspace file. */
async function openSource(name, line) {
  let cls = String(name || '')
    .replace(/^new /, '')
    .replace(/^__sfdc_trigger\/(?:\w+\/)?/, '')
    .split(/[\s(]/)[0];
  const parts = cls.split('.');
  // Skip managed-package namespaces we can't open.
  cls = parts.length > 2 ? parts[parts.length - 2] : parts[0];
  if (!cls) return;
  const files = await vscode.workspace.findFiles(`**/${cls}.{cls,trigger}`, '**/{node_modules,.sfdx,.sf}/**', 5);
  if (!files.length) {
    vscode.window.showInformationMessage(`No local source for "${cls}" in this workspace (managed package or not retrieved).`);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(files[0]);
  const ed = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
  if (line) {
    const pos = new vscode.Position(Math.max(0, line - 1), 0);
    ed.selection = new vscode.Selection(pos, pos);
    ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }
}

module.exports = { showAnalyzer, openSource, basename: path.basename };
