'use strict';
const vscode = require('vscode');
const { parse } = require('./parser');

const KIND = {
  EXECUTION: vscode.SymbolKind.Event,
  CODE_UNIT: vscode.SymbolKind.Module,
  METHOD: vscode.SymbolKind.Method,
  SOQL: vscode.SymbolKind.Field,
  DML: vscode.SymbolKind.Operator,
  CALLOUT: vscode.SymbolKind.Interface,
  FLOW: vscode.SymbolKind.Struct,
  WORKFLOW: vscode.SymbolKind.Struct,
  EXCEPTION: vscode.SymbolKind.Null,
  FATAL: vscode.SymbolKind.Null,
};

const cache = new WeakMap();
function parsed(doc) {
  const c = cache.get(doc);
  if (c && c.v === doc.version) return c.r;
  const r = parse(doc.getText());
  cache.set(doc, { v: doc.version, r });
  return r;
}

function register(ctx) {
  const sel = { language: 'apexlog' };
  ctx.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(sel, {
      provideDocumentSymbols(doc) {
        const r = parsed(doc);
        let budget = 5000;
        const conv = (n, depth) => {
          const out = [];
          for (const c of n.children) {
            if (budget <= 0) break;
            if (c.type === 'DEBUG' || c.type === 'SYSTEM') continue;
            budget--;
            const endLine = Math.min(doc.lineCount - 1, c.endLine ?? c.line);
            const range = new vscode.Range(c.line, 0, endLine, doc.lineAt(endLine).text.length);
            const s = new vscode.DocumentSymbol(
              c.name.length > 120 ? c.name.slice(0, 120) + '…' : c.name || c.type,
              c.type === 'EXCEPTION' || c.type === 'FATAL' ? '⚠ ' + c.type : `${(c.dur / 1e6).toFixed(1)} ms`,
              KIND[c.type] || vscode.SymbolKind.Object,
              range,
              new vscode.Range(c.line, 0, c.line, doc.lineAt(c.line).text.length)
            );
            if (depth < 40) s.children = conv(c, depth + 1);
            out.push(s);
          }
          return out;
        };
        return conv(r.root, 0);
      },
    }),
    vscode.languages.registerFoldingRangeProvider(sel, {
      provideFoldingRanges(doc) {
        const r = parsed(doc);
        const out = [];
        (function walk(n) {
          for (const c of n.children) {
            if (c.endLine != null && c.endLine > c.line) out.push(new vscode.FoldingRange(c.line, c.endLine));
            walk(c);
          }
        })(r.root);
        return out.slice(0, 20000);
      },
    })
  );
}

module.exports = { register };
