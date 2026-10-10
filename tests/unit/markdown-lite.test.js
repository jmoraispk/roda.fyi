// tests/unit/markdown-lite.test.js
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderMarkdown } from '../../src/app/markdown-lite.js';

function html(text) {
  const root = document.createElement('div');
  root.append(renderMarkdown(document, text));
  return root;
}

describe('markdown lite', () => {
  it('renders the supported subset', () => {
    const root = html('# Class 1\n\nWarm-up with **ginga** and *negativa*.\n\n- armada\n- `au`\n\n1. first\n2. second\n\nSee [video](https://youtu.be/x).');
    expect(root.querySelector('h1').textContent).toBe('Class 1');
    expect(root.querySelector('strong').textContent).toBe('ginga');
    expect(root.querySelector('em').textContent).toBe('negativa');
    expect([...root.querySelectorAll('ul li')].map((li) => li.textContent)).toEqual(['armada', 'au']);
    expect(root.querySelector('code').textContent).toBe('au');
    expect(root.querySelectorAll('ol li')).toHaveLength(2);
    const link = root.querySelector('a');
    expect(link.href).toBe('https://youtu.be/x');
    expect(link.rel).toBe('noopener noreferrer');
  });

  it('keeps hostile input inert', () => {
    const root = html('<script>window.bad=1</script>\n\n<img src=x onerror=alert(1)>\n\n[click](javascript:alert(1))\n\n[http](http://example.test)');
    expect(root.querySelector('script, img')).toBeNull();
    expect(root.querySelector('a')).toBeNull();
    expect(root.textContent).toContain('<script>window.bad=1</script>');
    expect(root.textContent).toContain('[click](javascript:alert(1))');
  });
});
