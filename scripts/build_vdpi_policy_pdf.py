#!/usr/bin/env python3
from pathlib import Path
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/policies/2026-veteran-driver-performance-incentive-policy.md"
OUTPUT = ROOT / "data/policies/2026-veteran-driver-performance-incentive-policy.pdf"

NAVY = colors.HexColor("#183153")
BLUE = colors.HexColor("#2F6690")
LIGHT_BLUE = colors.HexColor("#EAF2F8")
GOLD = colors.HexColor("#D6A84B")
GRAY = colors.HexColor("#5E6872")
LIGHT_GRAY = colors.HexColor("#F3F5F7")


def inline_markup(text: str) -> str:
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    return text


def header_footer(canvas, doc):
    canvas.saveState()
    width, height = letter
    canvas.setFillColor(NAVY)
    canvas.rect(0, height - 0.42 * inch, width, 0.42 * inch, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 8.5)
    canvas.drawString(0.58 * inch, height - 0.27 * inch, "JEC LOGISTICS SOLUTIONS LLC")
    canvas.setFont("Helvetica", 7.8)
    canvas.drawRightString(width - 0.58 * inch, height - 0.27 * inch, "VDPI POLICY • DRAFT")
    canvas.setStrokeColor(colors.HexColor("#CCD4DB"))
    canvas.line(0.58 * inch, 0.47 * inch, width - 0.58 * inch, 0.47 * inch)
    canvas.setFillColor(GRAY)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(0.58 * inch, 0.29 * inch, "Draft for management and payroll review — not yet effective")
    canvas.drawRightString(width - 0.58 * inch, 0.29 * inch, f"Page {doc.page}")
    canvas.restoreState()


def make_styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "Title", parent=base["Title"], fontName="Helvetica-Bold", fontSize=18,
            leading=21, textColor=NAVY, alignment=TA_CENTER, spaceAfter=4,
        ),
        "subtitle": ParagraphStyle(
            "Subtitle", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=12.5,
            leading=15, textColor=BLUE, alignment=TA_CENTER, spaceAfter=8,
        ),
        "draft": ParagraphStyle(
            "Draft", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=9,
            leading=12, textColor=colors.HexColor("#7A4B00"), alignment=TA_CENTER,
            backColor=colors.HexColor("#FFF3CD"), borderColor=GOLD, borderWidth=0.6,
            borderPadding=6, spaceAfter=10,
        ),
        "h3": ParagraphStyle(
            "H3", parent=base["Heading3"], fontName="Helvetica-Bold", fontSize=11.3,
            leading=14, textColor=NAVY, spaceBefore=9, spaceAfter=4, keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "Body", parent=base["BodyText"], fontName="Helvetica", fontSize=9.1,
            leading=12.1, textColor=colors.HexColor("#222222"), spaceAfter=5,
        ),
        "bullet": ParagraphStyle(
            "Bullet", parent=base["BodyText"], fontName="Helvetica", fontSize=8.9,
            leading=11.7, leftIndent=14, firstLineIndent=-7, bulletIndent=4, spaceAfter=3.1,
        ),
        "number": ParagraphStyle(
            "Number", parent=base["BodyText"], fontName="Helvetica", fontSize=9,
            leading=12, leftIndent=16, firstLineIndent=-11, spaceAfter=4,
        ),
        "table_header": ParagraphStyle(
            "TableHeader", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=7.7,
            leading=9.2, textColor=colors.white, alignment=TA_LEFT,
        ),
        "table_cell": ParagraphStyle(
            "TableCell", parent=base["BodyText"], fontName="Helvetica", fontSize=7.5,
            leading=9.2, textColor=colors.HexColor("#222222"),
        ),
        "ack": ParagraphStyle(
            "Ack", parent=base["BodyText"], fontName="Helvetica", fontSize=9.4,
            leading=13, textColor=colors.HexColor("#222222"), spaceAfter=10,
        ),
    }


def parse_markdown(md: str, styles):
    lines = md.splitlines()
    story = []
    i = 0
    first_h1 = True
    while i < len(lines):
        line = lines[i].rstrip()
        if not line:
            i += 1
            continue
        if line == "---":
            story.append(Spacer(1, 8))
            i += 1
            continue
        if line.startswith("# "):
            if first_h1:
                story.append(Spacer(1, 10))
                first_h1 = False
            story.append(Paragraph(inline_markup(line[2:]), styles["title"]))
        elif line.startswith("## "):
            text = line[3:]
            if text == "Veteran Driver Performance Incentive (VDPI) Policy":
                story.append(Paragraph(inline_markup(text), styles["subtitle"]))
            elif text == "Driver Associate Acknowledgment":
                story.append(Spacer(1, 6))
                story.append(Paragraph(inline_markup(text), styles["h3"]))
            else:
                story.append(Paragraph(inline_markup(text), styles["h3"]))
        elif line.startswith("### "):
            story.append(Paragraph(inline_markup(line[4:]), styles["h3"]))
        elif line.startswith("**Draft for"):
            parts = [line.replace("  ", "")]
            if i + 1 < len(lines) and lines[i + 1].startswith("**Proposed"):
                i += 1
                parts.append(lines[i])
            combined = "<br/>".join(inline_markup(part) for part in parts)
            story.append(Paragraph(combined, styles["draft"]))
        elif line.startswith("| "):
            raw_rows = []
            while i < len(lines) and lines[i].startswith("|"):
                raw_rows.append(lines[i])
                i += 1
            i -= 1
            rows = []
            for idx, raw in enumerate(raw_rows):
                cells = [c.strip() for c in raw.strip("|").split("|")]
                if idx == 1 and all(set(c) <= {"-", ":"} for c in cells):
                    continue
                style = styles["table_header"] if idx == 0 else styles["table_cell"]
                rows.append([Paragraph(inline_markup(c), style) for c in cells])
            if len(rows[0]) == 4:
                col_widths = [1.35 * inch, 1.65 * inch, 1.75 * inch, 1.55 * inch]
            else:
                col_widths = [1.55 * inch, 0.58 * inch, 4.35 * inch]
            table = Table(rows, colWidths=col_widths, repeatRows=1)
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#C8D0D8")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_GRAY]),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]))
            story.append(KeepTogether([table, Spacer(1, 5)]))
        elif line.startswith("- "):
            story.append(Paragraph("• " + inline_markup(line[2:]), styles["bullet"]))
        elif re.match(r"^\d+\. ", line):
            story.append(Paragraph(inline_markup(line), styles["number"]))
        elif line.startswith("**Driver Associate:") or line.startswith("**Signature:") or line.startswith("**Manager/Witness:"):
            story.append(Paragraph(inline_markup(line), styles["ack"]))
        else:
            paragraph = line
            while i + 1 < len(lines):
                nxt = lines[i + 1].rstrip()
                if not nxt or nxt.startswith(("#", "- ", "|", "---")) or re.match(r"^\d+\. ", nxt):
                    break
                i += 1
                paragraph += " " + nxt
            story.append(Paragraph(inline_markup(paragraph), styles["body"]))
        i += 1
    return story


def build():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = BaseDocTemplate(
        str(OUTPUT), pagesize=letter,
        rightMargin=0.62 * inch, leftMargin=0.62 * inch,
        topMargin=0.62 * inch, bottomMargin=0.62 * inch,
        title="JEC Logistics Solutions LLC — Veteran Driver Performance Incentive Policy",
        author="JEC Logistics Solutions LLC",
        subject="Draft veteran driver incentive policy",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="policy")
    doc.addPageTemplates([PageTemplate(id="policy", frames=[frame], onPage=header_footer)])
    story = parse_markdown(SOURCE.read_text(encoding="utf-8"), make_styles())
    doc.build(story)
    print(OUTPUT)


if __name__ == "__main__":
    build()
