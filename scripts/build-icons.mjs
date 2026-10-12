import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const svg = await readFile('favicon.svg', 'utf8');
await mkdir('assets/icons', { recursive: true });
const browser = await chromium.launch();
for (const size of [180, 192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:#17120d">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `assets/icons/app-${size}.png`, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
}
await browser.close();
console.log('Wrote assets/icons/app-{180,192,512}.png');
