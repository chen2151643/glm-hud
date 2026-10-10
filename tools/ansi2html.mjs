#!/usr/bin/env node
// ansi2html.mjs — glm-hud 视觉预览：HUD stdout(ANSI) → 单文件 HTML（零依赖）
// 只支持本项目实际用到的 SGR：0(重置)/1(粗体)/38;5;N(256色前景)，其余 SGR 子串忽略；
// 非 m 的 CSI 忽略；OSC8 超链接序列降级为纯文本（序列丢弃、内文原样保留）。
// 页面背景二选一：默认浅底 #fafafa（light 主题）；--dark 用暗底 #1c1c1c（dark 默认主题）。
// 等宽 14px、行高 1.5、pre 白空间。
// 用法：node tools/ansi2html.mjs [--dark] [标题] < hud.ansi > preview.html
import { readFileSync } from 'node:fs';

// xterm-256 → CSS 颜色（16 基色用 xterm 传统值；16-231 立方体；232-255 灰阶）
const BASE16 = ['#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0',
  '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'];
export function xtermCss(n) {
  if (!Number.isInteger(n) || n < 0 || n > 255) return null;
  if (n < 16) return BASE16[n];
  const hex = (x) => x.toString(16).padStart(2, '0');
  if (n >= 232) { const v = 8 + (n - 232) * 10; return '#' + hex(v) + hex(v) + hex(v); }
  const lv = [0, 95, 135, 175, 215, 255];
  const i = n - 16;
  return '#' + hex(lv[Math.floor(i / 36)]) + hex(lv[Math.floor((i % 36) / 6)]) + hex(lv[i % 6]);
}

const escHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 状态机：逐字符扫描，SGR 变更点先冲刷缓冲再重开 span；文本一律 HTML 转义
export function ansiToHtml(src) {
  let out = '';
  let bold = false;
  let fg = null; // 256 色索引
  let open = false;
  let buf = '';
  const flush = () => { if (buf) { out += escHtml(buf); buf = ''; } };
  const closeSpan = () => { if (open) { out += '</span>'; open = false; } };
  const restyle = () => {
    closeSpan();
    const css = (bold ? 'font-weight:700;' : '') + (fg !== null ? `color:${xtermCss(fg)};` : '');
    if (css) { out += `<span style="${css}">`; open = true; }
  };
  const applySgr = (params) => {
    const parts = params === '' ? ['0'] : params.split(';');
    for (let k = 0; k < parts.length; k++) {
      const p = parts[k];
      if (p === '' || p === '0') { bold = false; fg = null; }
      else if (p === '1') bold = true;
      else if (p === '38' && parts[k + 1] === '5' && parts[k + 2] !== undefined) {
        const n = parseInt(parts[k + 2], 10);
        if (Number.isInteger(n)) fg = n;
        k += 2;
      }
      // 其余 SGR 子串（本项目未用）忽略
    }
  };
  let i = 0;
  while (i < src.length) {
    if (src[i] !== '\x1b') { buf += src[i]; i++; continue; }
    const c1 = src[i + 1];
    if (c1 === '[') { // CSI … final[@-~]
      let j = i + 2;
      let params = '';
      while (j < src.length && !/[@-~]/.test(src[j])) { params += src[j]; j++; }
      const fin = src[j];
      j++; // 越过 final；截断输入时也吞掉已扫部分
      if (fin === 'm') { flush(); applySgr(params); restyle(); }
      i = j;
      continue;
    }
    if (c1 === ']') { // OSC … (BEL | ESC \)；OSC8 超链接降级为纯文本 → 整段序列丢弃
      let j = i + 2;
      let len = -1;
      while (j < src.length) {
        if (src[j] === '\x07') { len = j + 1 - i; break; }
        if (src[j] === '\x1b' && src[j + 1] === '\\') { len = j + 2 - i; break; }
        j++;
      }
      i += len === -1 ? src.length - i : len;
      continue;
    }
    i += 2; // 其他 ESC 序列：保守跳过 ESC+1
  }
  flush();
  closeSpan();
  return out;
}

export function pageHtml(bodyHtml, title, theme = 'light') {
  const dark = theme === 'dark';
  const bg = dark ? '#1c1c1c' : '#fafafa';
  const fg = dark ? '#cccccc' : '#1a1a1a'; // 终端默认前景兜底（分隔空格等无色文本）
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title || 'glm-hud 预览')}</title>
<style>
  :root { color-scheme: ${dark ? 'dark' : 'light'}; }
  html, body { margin: 0; padding: 0; background: ${bg}; }
  body { padding: 20px 24px; }
  pre {
    margin: 0;
    font-family: ui-monospace, Menlo, Monaco, Consolas, monospace;
    font-size: 14px;
    line-height: 1.5;
    white-space: pre;
    background: ${bg};
    color: ${fg};
  }
</style>
</head>
<body>
<pre>${bodyHtml}</pre>
</body>
</html>
`;
}

function main() {
  const argv = process.argv.slice(2);
  const dark = argv.includes('--dark');
  const title = argv.find((a) => a !== '--dark') || '';
  let src = '';
  try { src = readFileSync(0, 'utf8'); } catch { src = ''; }
  src = src.replace(/\n$/, ''); // 末尾换行不产生多余空行
  process.stdout.write(pageHtml(ansiToHtml(src), title, dark ? 'dark' : 'light'));
  process.exitCode = 0;
}
main();
