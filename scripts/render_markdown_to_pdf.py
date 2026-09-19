#!/usr/bin/env python3
from __future__ import annotations

import pathlib
import re
import sys

PORTRAIT = (612, 792)  # US Letter
LANDSCAPE = (792, 612)
ML, MR, MT, MB = 54, 54, 62, 54
KAPPA = 0.5522847498
FONT_AVG = {
    ('F1', 9): 4.7,
    ('F1', 8): 4.2,
    ('F1', 8.5): 4.45,
    ('F1', 10): 5.2,
    ('F1', 11): 5.7,
    ('F1', 12): 6.1,
    ('F2', 8): 4.5,
    ('F2', 8.5): 4.75,
    ('F2', 9): 5.1,
    ('F2', 12): 6.4,
    ('F2', 15): 7.8,
    ('F2', 22): 11.2,
}


def esc(s: str) -> str:
    return s.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')


def clean_inline(s: str) -> str:
    s = s.replace('**', '').replace('__', '')
    s = re.sub(r'`([^`]*)`', r'\1', s)
    s = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', s)
    return re.sub(r'\s+', ' ', s).strip()


def avg_width(font: str, size: float) -> float:
    return FONT_AVG.get((font, size), FONT_AVG.get((font, int(size)), size * (0.56 if font == 'F1' else 0.6)))


def text_width(text: str, font: str = 'F1', size: float = 11) -> float:
    return len(clean_inline(text)) * avg_width(font, size)


def wrap(text: str, font: str = 'F1', size: float = 11, width: float = 504) -> list[str]:
    text = clean_inline(text)
    if not text:
        return ['']
    max_chars = max(4, int(width / avg_width(font, size)))
    words = text.split(' ')
    out: list[str] = []
    cur = ''

    def split_word(word: str) -> list[str]:
        if text_width(word, font, size) <= width:
            return [word]
        parts: list[str] = []
        remainder = word
        while remainder:
            take = min(len(remainder), max_chars)
            chunk = remainder[:take]
            while len(chunk) > 1 and text_width(chunk + '…', font, size) > width:
                chunk = chunk[:-1]
            if len(chunk) == len(remainder):
                parts.append(chunk)
                break
            parts.append(chunk + '…')
            remainder = remainder[len(chunk):]
        return parts

    for word in words:
        for part in split_word(word):
            trial = part if not cur else f'{cur} {part}'
            if text_width(trial, font, size) <= width:
                cur = trial
            else:
                if cur:
                    out.append(cur)
                cur = part
    if cur:
        out.append(cur)
    return out


class PDF:
    def __init__(self) -> None:
        self.objs: list[bytes] = []

    def add(self, b: bytes) -> int:
        self.objs.append(b)
        return len(self.objs)

    def save(self, path: pathlib.Path, page_ids: list[int]) -> None:
        kids = ' '.join(f'{p} 0 R' for p in page_ids)
        pages_id = self.add(f'<< /Type /Pages /Count {len(page_ids)} /Kids [{kids}] >>'.encode())
        for pid in page_ids:
            self.objs[pid - 1] = self.objs[pid - 1].replace(b'__PAGES__', f'{pages_id} 0 R'.encode())
        catalog_id = self.add(f'<< /Type /Catalog /Pages {pages_id} 0 R >>'.encode())

        out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
        offsets = [0]
        for i, obj in enumerate(self.objs, start=1):
            offsets.append(len(out))
            out += f'{i} 0 obj\n'.encode() + obj + b'\nendobj\n'
        xref = len(out)
        out += f'xref\n0 {len(self.objs) + 1}\n'.encode()
        out += b'0000000000 65535 f \n'
        for off in offsets[1:]:
            out += f'{off:010d} 00000 n \n'.encode()
        out += f'trailer\n<< /Size {len(self.objs) + 1} /Root {catalog_id} 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
        tmp_path = path.with_suffix(path.suffix + '.tmp')
        tmp_path.write_bytes(out)
        tmp_path.replace(path)


class Renderer:
    def __init__(self, title: str) -> None:
        self.title = title
        self.pages: list[tuple[float, float, str]] = []
        self.cmds: list[str] = []
        self.page_no = 0
        self.page_w, self.page_h = PORTRAIT
        self.new_page()

    @property
    def content_w(self) -> float:
        return self.page_w - ML - MR

    def new_page(self, size: tuple[float, float] | None = None) -> None:
        if self.cmds:
            self.pages.append((self.page_w, self.page_h, '\n'.join(self.cmds)))
        if size is not None:
            self.page_w, self.page_h = size
        self.cmds = []
        self.page_no += 1
        self.y = self.page_h - MT
        self.text(ML, self.page_h - 34, self.title, 'F1', 9, 0.45)
        self.line(ML, self.page_h - 42, self.page_w - MR, self.page_h - 42, 0.8, 0.8)
        self.line(ML, MB - 10, self.page_w - MR, MB - 10, 0.8, 0.85)
        self.text(self.page_w - MR - 38, 22, str(self.page_no), 'F1', 9, 0.45)

    def finish(self) -> None:
        if self.cmds:
            self.pages.append((self.page_w, self.page_h, '\n'.join(self.cmds)))
            self.cmds = []

    def ensure(self, h: float) -> None:
        if self.y - h < MB:
            self.new_page()

    def text(self, x: float, y: float, txt: str, font: str = 'F1', size: float = 11, gray: float = 0.1) -> None:
        self.cmds.append(f'BT /{font} {size} Tf {gray:.3f} g 1 0 0 1 {x:.2f} {y:.2f} Tm ({esc(txt)}) Tj ET')

    def line(self, x1: float, y1: float, x2: float, y2: float, w: float = 1, gray: float = 0.75) -> None:
        self.cmds.append(f'{gray:.3f} G {w:.2f} w {x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S')

    def rect(self, x: float, y: float, w: float, h: float, stroke: float = 0.8, fill: float | None = None, linew: float = 0.6) -> None:
        parts = []
        if fill is not None:
            parts.append(f'{fill:.3f} g')
        parts.append(f'{stroke:.3f} G {linew:.2f} w {x:.2f} {y:.2f} {w:.2f} {h:.2f} re')
        parts.append('B' if fill is not None else 'S')
        self.cmds.append(' '.join(parts))

    def circle(self, cx: float, cy: float, r: float, gray: float = 0.15) -> None:
        c = KAPPA * r
        self.cmds.append(
            f'{gray:.3f} g {cx+r:.2f} {cy:.2f} m '
            f'{cx+r:.2f} {cy+c:.2f} {cx+c:.2f} {cy+r:.2f} {cx:.2f} {cy+r:.2f} c '
            f'{cx-c:.2f} {cy+r:.2f} {cx-r:.2f} {cy+c:.2f} {cx-r:.2f} {cy:.2f} c '
            f'{cx-r:.2f} {cy-c:.2f} {cx-c:.2f} {cy-r:.2f} {cx:.2f} {cy-r:.2f} c '
            f'{cx+c:.2f} {cy-r:.2f} {cx+r:.2f} {cy-c:.2f} {cx+r:.2f} {cy:.2f} c f'
        )

    def heading(self, txt: str, level: int) -> None:
        txt = clean_inline(txt)
        if level == 1:
            self.ensure(44)
            self.text(ML, self.y, txt, 'F2', 22, 0.05)
            self.y -= 28
            self.line(ML, self.y + 6, self.page_w - MR, self.y + 6, 1.1, 0.75)
            self.y -= 12
        elif level == 2:
            self.ensure(28)
            self.text(ML, self.y, txt, 'F2', 15, 0.05)
            self.y -= 22
        else:
            self.ensure(22)
            self.text(ML, self.y, txt, 'F2', 12, 0.05)
            self.y -= 18

    def paragraph(self, txt: str, font: str = 'F1', size: float = 11, indent: float = 0, bullet: bool = False, space: float = 6, gray: float = 0.1) -> None:
        bullet_pad = 16 if bullet else 0
        lines = wrap(txt, font, size, self.content_w - indent - bullet_pad)
        leading = size * 1.35
        self.ensure(len(lines) * leading + space)
        x = ML + indent + bullet_pad
        if bullet:
            self.circle(ML + indent + 5, self.y + size * 0.28, 2.2, 0.18)
        for line in lines:
            self.text(x, self.y, line, font, size, gray)
            self.y -= leading
        self.y -= space

    def numbered(self, num: str, txt: str, size: float = 11) -> None:
        numw = 18
        lines = wrap(txt, 'F1', size, self.content_w - numw - 6)
        leading = size * 1.35
        self.ensure(len(lines) * leading + 4)
        self.text(ML, self.y, num, 'F2', size, 0.12)
        for line in lines:
            self.text(ML + numw, self.y, line, 'F1', size, 0.1)
            self.y -= leading
        self.y -= 4

    def table(self, raw_rows: list[str]) -> bool:
        rows = [[clean_inline(c.strip()) for c in r.strip().strip('|').split('|')] for r in raw_rows]
        if len(rows) >= 2 and all(set(c.replace(' ', '')) <= set('-:') for c in rows[1]):
            rows.pop(1)
        if not rows:
            return False
        cols = max(len(r) for r in rows)
        rows = [r + [''] * (cols - len(r)) for r in rows]
        header, body = rows[0], rows[1:]
        body_font = 9.5
        header_font = 10.0
        pad = 5

        def min_width_for(i: int) -> float:
            label = header[i].lower()
            if label == 'week':
                return 58
            if label in {'dcr', 'pod'}:
                return 42
            if 'safety events' in label:
                return 48
            if 'pickup stops' in label:
                return 52
            if 'failed pickup stops' in label:
                return 58
            if 'cdf' in label:
                return 62
            if 'tenured workforce' in label:
                return 74
            if 'pickup quality' in label:
                return 68
            if 'overall standing' in label:
                return 88
            if label in {'read', 'note', 'notes', 'summary'}:
                return 160
            return 60

        portrait_mins = [min_width_for(i) for i in range(cols)]
        use_landscape = cols >= 9 or sum(portrait_mins) > self.content_w
        if use_landscape and (self.page_w, self.page_h) != LANDSCAPE:
            self.new_page(LANDSCAPE)
        elif not use_landscape and (self.page_w, self.page_h) != PORTRAIT:
            self.new_page(PORTRAIT)

        if use_landscape:
            body_font = 8.0 if cols >= 11 else 8.5
            header_font = 8.5 if cols >= 11 else 9.0
            pad = 4

        mins = [min_width_for(i) for i in range(cols)]
        ideals: list[float] = []
        for i in range(cols):
            header_need = text_width(header[i], 'F2', header_font) + pad * 2
            cell_need = max((text_width(row[i], 'F1', body_font) for row in rows), default=0) * 0.45 + pad * 2
            ideals.append(max(mins[i], min(max(header_need, cell_need), 220 if header[i].lower() == 'read' else 150)))

        total_min = sum(mins)
        total_ideal = sum(ideals)
        if total_min >= self.content_w:
            widths = [w * (self.content_w / total_min) for w in mins]
        elif total_ideal <= self.content_w:
            widths = ideals
        else:
            extra = self.content_w - total_min
            needs = [ideal - minimum for ideal, minimum in zip(ideals, mins)]
            total_need = sum(needs) or 1
            widths = [minimum + extra * (need / total_need) for minimum, need in zip(mins, needs)]

        def draw_header() -> None:
            cell_lines = [wrap(cell, 'F2', header_font, widths[i] - pad * 2) for i, cell in enumerate(header)]
            leading = header_font + 3
            h = max(len(cl) for cl in cell_lines) * leading + 10
            self.ensure(h + 4)
            x = ML
            for i, cl in enumerate(cell_lines):
                self.rect(x, self.y - h + 4, widths[i], h, stroke=0.72, fill=0.92, linew=0.7)
                yy = self.y - (header_font + 4)
                for line in cl:
                    self.text(x + pad, yy, line, 'F2', header_font, 0.08)
                    yy -= leading
                x += widths[i]
            self.y -= h

        draw_header()
        alt = False
        for row in body:
            cell_lines = [wrap(cell, 'F1', body_font, widths[i] - pad * 2) for i, cell in enumerate(row)]
            leading = body_font + 2.5
            h = max(len(cl) for cl in cell_lines) * leading + 8
            if self.y - h < MB:
                self.new_page(LANDSCAPE if use_landscape else PORTRAIT)
                draw_header()
            x = ML
            fill = 0.98 if alt else None
            for i, cl in enumerate(cell_lines):
                self.rect(x, self.y - h + 4, widths[i], h, stroke=0.82, fill=fill, linew=0.55)
                yy = self.y - (body_font + 3)
                for line in cl:
                    self.text(x + pad, yy, line, 'F1', body_font, 0.1)
                    yy -= leading
                x += widths[i]
            alt = not alt
            self.y -= h
        self.y -= 8
        return use_landscape

    def render(self, text: str) -> None:
        lines = text.splitlines()
        i = 0
        while i < len(lines):
            s = lines[i].strip()
            if not s:
                self.y -= 3
                i += 1
                continue
            if s.startswith('# '):
                self.heading(s[2:], 1)
                i += 1
                continue
            if s.startswith('## '):
                self.heading(s[3:], 2)
                i += 1
                continue
            if s.startswith('### '):
                self.heading(s[4:], 3)
                i += 1
                continue
            if s.startswith('|'):
                block = []
                while i < len(lines) and lines[i].strip().startswith('|'):
                    block.append(lines[i])
                    i += 1
                used_landscape = self.table(block)
                if used_landscape and i < len(lines):
                    self.new_page(PORTRAIT)
                continue
            if re.match(r'^(\d+)\.\s+', s):
                while i < len(lines):
                    s2 = lines[i].strip()
                    m = re.match(r'^(\d+)\.\s+(.*)', s2)
                    if not m:
                        break
                    self.numbered(m.group(1) + '.', m.group(2))
                    i += 1
                self.y -= 2
                continue
            if s.startswith('- '):
                while i < len(lines) and lines[i].strip().startswith('- '):
                    self.paragraph(lines[i].strip()[2:], bullet=True, space=3)
                    i += 1
                self.y -= 2
                continue
            para = [s]
            i += 1
            while i < len(lines):
                s2 = lines[i].strip()
                if not s2 or s2.startswith('#') or s2.startswith('|') or s2.startswith('- ') or re.match(r'^(\d+)\.\s+', s2):
                    break
                para.append(s2)
                i += 1
            text_block = ' '.join(para)
            size = 10.5 if text_block.startswith('**DSP:**') or text_block.startswith('**Station:**') or text_block.startswith('**Week:**') or text_block.startswith('**Prepared:**') else 11
            self.paragraph(text_block, size=size)
        self.finish()


def render_markdown_to_pdf(md_path: pathlib.Path, pdf_path: pathlib.Path) -> None:
    renderer = Renderer(md_path.stem.replace('-', ' ').title())
    renderer.render(md_path.read_text(encoding='utf-8'))
    pdf = PDF()
    f1 = pdf.add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    f2 = pdf.add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')
    font_dict = f'<< /F1 {f1} 0 R /F2 {f2} 0 R >>'
    page_ids = []
    for page_w, page_h, page in renderer.pages:
        stream = page.encode('latin-1', 'replace')
        c_id = pdf.add(f'<< /Length {len(stream)} >>\nstream\n'.encode() + stream + b'\nendstream')
        p_id = pdf.add(f'<< /Type /Page /Parent __PAGES__ /MediaBox [0 0 {page_w} {page_h}] /Resources << /Font {font_dict} >> /Contents {c_id} 0 R >>'.encode())
        page_ids.append(p_id)
    pdf.save(pdf_path, page_ids)


def main() -> int:
    if len(sys.argv) != 3:
        print('Usage: render_markdown_to_pdf.py <input.md> <output.pdf>', file=sys.stderr)
        return 1
    md_path = pathlib.Path(sys.argv[1]).resolve()
    pdf_path = pathlib.Path(sys.argv[2]).resolve()
    render_markdown_to_pdf(md_path, pdf_path)
    print(f'Rendered {pdf_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
