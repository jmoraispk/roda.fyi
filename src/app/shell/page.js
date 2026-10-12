// src/app/shell/page.js
export function el(document, tag, { className, text, attrs = {}, dataset = {}, on = {} } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null && value !== false) node.setAttribute(name, value === true ? '' : value);
  }
  for (const [name, value] of Object.entries(dataset)) node.dataset[name] = value;
  for (const [name, handler] of Object.entries(on)) node.addEventListener(name, handler);
  for (const child of children) if (child) node.append(child);
  return node;
}

export function initials(name) {
  const letters = String(name ?? '').trim().split(/\s+/).filter(Boolean)
    .slice(0, 2).map((word) => word[0].toUpperCase()).join('');
  return letters || '?';
}

export function pageHeader({ document, title, backLabel, onBack, actions = [] }) {
  const header = el(document, 'header', { className: 'page-header' });
  if (onBack) {
    header.append(el(document, 'button', {
      className: 'page-back', text: '‹', attrs: { type: 'button', 'aria-label': backLabel }, on: { click: onBack },
    }));
  }
  header.append(el(document, 'h1', { className: 'page-title', text: title }));
  const tools = el(document, 'div', { className: 'page-actions' }, actions);
  header.append(tools);
  return header;
}
