// src/app/markdown-lite.js
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https:\/\/[^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function inline(document, parent, text) {
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parent.append(text.slice(last, match.index));
    const token = match[0];
    let node;
    if (token.startsWith('**')) {
      node = document.createElement('strong');
      node.textContent = token.slice(2, -2);
    } else if (token.startsWith('`')) {
      node = document.createElement('code');
      node.textContent = token.slice(1, -1);
    } else if (token.startsWith('[')) {
      const [, label, href] = /^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/.exec(token);
      node = document.createElement('a');
      node.href = href;
      node.target = '_blank';
      node.rel = 'noopener noreferrer';
      node.textContent = label;
    } else {
      node = document.createElement('em');
      node.textContent = token.slice(1, -1);
    }
    parent.append(node);
    last = match.index + token.length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

export function renderMarkdown(document, text) {
  const fragment = document.createDocumentFragment();
  const blocks = String(text ?? '').replace(/\r\n/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim());
    if (!lines.length) continue;
    const heading = /^(#{1,3})\s+(.*)$/.exec(lines[0]);
    if (heading && lines.length === 1) {
      const node = document.createElement(`h${heading[1].length}`);
      inline(document, node, heading[2]);
      fragment.append(node);
      continue;
    }
    if (lines.every((line) => /^\s*[-*]\s+/.test(line)) || lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
      const ordered = /^\s*\d+\./.test(lines[0]);
      const list = document.createElement(ordered ? 'ol' : 'ul');
      for (const line of lines) {
        const item = document.createElement('li');
        inline(document, item, line.replace(/^\s*(?:[-*]|\d+\.)\s+/, ''));
        list.append(item);
      }
      fragment.append(list);
      continue;
    }
    const paragraph = document.createElement('p');
    lines.forEach((line, index) => {
      if (index) paragraph.append(document.createElement('br'));
      inline(document, paragraph, line);
    });
    fragment.append(paragraph);
  }
  return fragment;
}
