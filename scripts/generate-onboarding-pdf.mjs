#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, '..', 'platform', 'docs');

const escapeHtml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function inline(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

export function markdownToHtml(markdown) {
  const lines = markdown.split(/\r?\n/);
  let html = '';
  let list = false;
  let table = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] || '';
    if (line.startsWith('|') && next.match(/^\|(?:\s*:?-+:?\s*\|)+$/)) {
      if (list) { html += '</ul>'; list = false; }
      const headers = line.split('|').slice(1, -1).map((item) => item.trim());
      html += `<table><thead><tr>${headers.map((item) => `<th>${inline(item)}</th>`).join('')}</tr></thead><tbody>`;
      table = true; index += 1; continue;
    }
    if (table && line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map((item) => item.trim());
      html += `<tr>${cells.map((item) => `<td>${inline(item)}</td>`).join('')}</tr>`; continue;
    }
    if (table) { html += '</tbody></table>'; table = false; }
    if (line.startsWith('- ')) {
      if (!list) { html += '<ul>'; list = true; }
      html += `<li>${inline(line.slice(2))}</li>`; continue;
    }
    if (list) { html += '</ul>'; list = false; }
    if (!line.trim()) continue;
    if (line.startsWith('> ')) html += `<aside>${inline(line.slice(2))}</aside>`;
    else if (line.startsWith('### ')) html += `<h3>${inline(line.slice(4))}</h3>`;
    else if (line.startsWith('## ')) html += `<h2>${inline(line.slice(3))}</h2>`;
    else if (line.startsWith('# ')) html += `<h1>${inline(line.slice(2))}</h1>`;
    else html += `<p>${inline(line)}</p>`;
  }
  if (list) html += '</ul>';
  if (table) html += '</tbody></table>';
  return html;
}

const template = (content) => `<!doctype html><html><head><meta charset="utf-8"><title>Tenant Onboarding Checklist</title><style>
@page{size:Letter;margin:0.55in}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;font-size:10.5px;line-height:1.42}h1{font-size:24px;color:#153b72;border-bottom:3px solid #2563eb;padding-bottom:8px}h2{font-size:16px;color:#17365d;border-bottom:1px solid #cbd5e1;padding-bottom:4px;margin-top:22px;break-after:avoid}h3{font-size:13px}p{margin:6px 0}ul{padding-left:20px;margin:7px 0}li{margin:3px 0;break-inside:avoid}aside{background:#eff6ff;border-left:4px solid #2563eb;padding:10px;margin:12px 0}code{font-family:ui-monospace,monospace;background:#f1f5f9;padding:1px 4px}table{width:100%;border-collapse:collapse;margin:10px 0;break-inside:avoid}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left;vertical-align:top}th{background:#1d4ed8;color:#fff}tr:nth-child(even){background:#f8fafc}</style></head><body>${content}</body></html>`;

export async function generate() {
  const markdown = await fs.readFile(path.join(DOCS, 'tenant-onboarding-checklist.md'), 'utf8');
  const html = template(markdownToHtml(markdown));
  const htmlPath = path.join(DOCS, 'tenant-onboarding-checklist.html');
  const pdfPath = path.join(DOCS, 'tenant-onboarding-checklist.pdf');
  await fs.writeFile(htmlPath, html);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({ path: pdfPath, format: 'Letter', printBackground: true, margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' } });
  } finally {
    await browser.close();
  }
  process.stdout.write(`${htmlPath}\n${pdfPath}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await generate();
