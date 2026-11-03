'use strict';
/** Minimal, dependency-free XML → tree parser (enough for SOAP responses). */

const decode = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');

function parse(xml) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { top.text += m[1]; continue; }
    if (m[6] !== undefined) { top.text += decode(m[6]); continue; }
    const [, , close, rawName, attrStr, selfClose] = m;
    if (rawName.startsWith('?') || rawName.startsWith('!')) continue;
    const name = rawName.includes(':') ? rawName.split(':').pop() : rawName;
    if (close) { if (stack.length > 1) stack.pop(); continue; }
    const attrs = {};
    attrStr.replace(/([\w:.-]+)="([^"]*)"/g, (_, k, v) => { attrs[k.includes(':') ? k.split(':').pop() : k] = decode(v); });
    const node = { name, attrs, children: [], text: '' };
    top.children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

function find(node, name) {
  if (node.name === name) return node;
  for (const c of node.children) { const f = find(c, name); if (f) return f; }
  return null;
}
function findAll(node, name, out = []) {
  if (node.name === name) out.push(node);
  for (const c of node.children) findAll(c, name, out);
  return out;
}

/** Flatten an element into [{key, value}] with dotted paths; repeated children get [i]. */
function flatten(node, prefix = '', out = []) {
  const counts = {};
  node.children.forEach((c) => (counts[c.name] = (counts[c.name] || 0) + 1));
  const seen = {};
  for (const c of node.children) {
    let key = prefix + c.name;
    if (counts[c.name] > 1) key += `[${(seen[c.name] = (seen[c.name] || 0) + 1) - 1}]`;
    if (c.children.length) flatten(c, key + '.', out);
    else {
      const t = c.text.trim();
      out.push({ key, value: t === 'true' ? true : t === 'false' ? false : t });
    }
  }
  return out;
}

module.exports = { parse, find, findAll, flatten };
