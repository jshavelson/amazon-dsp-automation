#!/usr/bin/env python3
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.pdfgen.canvas import Canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/policies/2026-vdpi-da-simple-guide.pdf"

NAVY = colors.HexColor("#183153")
BLUE = colors.HexColor("#2F6690")
GOLD = colors.HexColor("#D6A84B")
PALE_GOLD = colors.HexColor("#FFF3CD")
PALE_BLUE = colors.HexColor("#EAF2F8")
PALE_GREEN = colors.HexColor("#E9F6EC")
GRAY = colors.HexColor("#5E6872")
LIGHT = colors.HexColor("#F4F6F8")
GRID = colors.HexColor("#C7D0D9")


def p(text, style):
    return Paragraph(text, style)


styles = {
    "title": ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=18, leading=20, textColor=NAVY, alignment=TA_CENTER),
    "sub": ParagraphStyle("sub", fontName="Helvetica", fontSize=8.5, leading=10.5, textColor=GRAY, alignment=TA_CENTER),
    "section": ParagraphStyle("section", fontName="Helvetica-Bold", fontSize=10.5, leading=12.5, textColor=NAVY),
    "head": ParagraphStyle("head", fontName="Helvetica-Bold", fontSize=8.1, leading=9.5, textColor=colors.white, alignment=TA_CENTER),
    "rowhead": ParagraphStyle("rowhead", fontName="Helvetica-Bold", fontSize=7.2, leading=8.5, textColor=NAVY),
    "cell": ParagraphStyle("cell", fontName="Helvetica", fontSize=7.1, leading=8.5, textColor=colors.HexColor("#222222")),
    "small": ParagraphStyle("small", fontName="Helvetica", fontSize=7.4, leading=9.3, textColor=colors.HexColor("#222222")),
    "bullet": ParagraphStyle("bullet", fontName="Helvetica", fontSize=7.3, leading=9.2, leftIndent=8, firstLineIndent=-5, textColor=colors.HexColor("#222222")),
    "callout": ParagraphStyle("callout", fontName="Helvetica-Bold", fontSize=8.5, leading=10.5, textColor=NAVY, alignment=TA_CENTER),
    "fine": ParagraphStyle("fine", fontName="Helvetica", fontSize=6.4, leading=7.8, textColor=GRAY, alignment=TA_CENTER),
}


def box(canvas, x, y, w, h, fill, stroke=GRID, radius=7):
    canvas.setFillColor(fill)
    canvas.setStrokeColor(stroke)
    canvas.roundRect(x, y, w, h, radius, fill=1, stroke=1)


def draw_wrapped(canvas, text, x, y, w, h, style):
    para = p(text, style)
    _, ph = para.wrap(w, h)
    para.drawOn(canvas, x, y + h - ph)
    return ph


def build():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    width, height = landscape(letter)
    c = Canvas(str(OUTPUT), pagesize=(width, height))
    c.setTitle("JEC Logistics Solutions LLC — VDPI Simple DA Guide")
    c.setAuthor("JEC Logistics Solutions LLC")

    c.setFillColor(NAVY)
    c.rect(0, height - 0.38 * inch, width, 0.38 * inch, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(0.42 * inch, height - 0.24 * inch, "JEC LOGISTICS SOLUTIONS LLC")
    c.setFont("Helvetica", 7)
    c.drawRightString(width - 0.42 * inch, height - 0.24 * inch, "DA QUICK GUIDE • PROPOSED VDPI PILOT")

    draw_wrapped(c, "Veteran Driver Performance Incentive (VDPI)", 0.45 * inch, height - 0.96 * inch, width - 0.9 * inch, 0.38 * inch, styles["title"])
    draw_wrapped(c, "Simple guide for Driver Associates • Proposed pilot: October 1–December 31, 2026", 0.45 * inch, height - 1.16 * inch, width - 0.9 * inch, 0.22 * inch, styles["sub"])

    left_x = 0.42 * inch
    left_w = 7.05 * inch
    right_x = 7.67 * inch
    right_w = width - right_x - 0.42 * inch
    content_top = height - 1.25 * inch

    draw_wrapped(c, "WHI vs. VDPI — What Changes?", left_x, content_top - 0.22 * inch, left_w, 0.2 * inch, styles["section"])
    rows = [
        [p("Topic", styles["head"]), p("WHI — Grandfathered Plan", styles["head"]), p("VDPI — Proposed Pilot", styles["head"])],
        [p("How it pays", styles["rowhead"]), p("Adds eligible incentive hours up to a 10-hour day.", styles["cell"]), p("Pays one variable monthly performance bonus from a WHI-capped pool. <b>No daily hours guarantee.</b>", styles["cell"])],
        [p("Maximum value", styles["rowhead"]), p("Varies based on hours worked below 10 and eligible days.", styles["cell"]), p("One variable monthly bonus: an equal share of no more than <b>90% of the WHI-equivalent pool</b>, capped at <b>$650 per DA</b>.", styles["cell"])],
        [p("Who may join", styles["rowhead"]), p("Only DAs with an existing grandfathered WHI arrangement.", styles["cell"]), p("Up to <b>15 veteran DAs per quarter</b>; at least 6 months of service and top performance.", styles["cell"])],
        [p("How measured", styles["rowhead"]), p("Daily eligibility plus weekly scorecard rules.", styles["cell"]), p("Monthly 100-point score: safety, quality, attendance, DVIC/process, and teamwork.", styles["cell"])],
        [p("Route speed", styles["rowhead"]), p("A shorter eligible day can create more WHI hours.", styles["cell"]), p("Finishing faster or staying longer <b>does not increase the award</b>. Safe route-time guardrails apply.", styles["cell"])],
        [p("Safety/damage", styles["rowhead"]), p("An at-fault accident ends WHI eligibility under the existing policy.", styles["cell"]), p("Only a <b>verified preventable</b> event counts: event month is lost, then a 90-day pause and requalification.", styles["cell"])],
        [p("Attendance", styles["rowhead"]), p("Zero call-outs, except the policy's limited grace/medical-note rule.", styles["cell"]), p("No no-call/no-show or unexcused same-day call-out. Protected/approved leave is handled according to law and policy.", styles["cell"])],
        [p("Pay and OT", styles["rowhead"]), p("WHI credits follow the existing policy; actual hours determine overtime.", styles["cell"]), p("All hours worked are paid. Payroll will add any legally required bonus/overtime adjustment.", styles["cell"])],
    ]
    comparison = Table(rows, colWidths=[1.02 * inch, 2.78 * inch, 3.25 * inch], repeatRows=1)
    comparison.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.45, GRID),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3.2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.2),
    ]))
    tw, th = comparison.wrap(left_w, 5.35 * inch)
    comparison.drawOn(c, left_x, content_top - 0.29 * inch - th)

    # Right column: eligibility and payout.
    box(c, right_x, content_top - 2.68 * inch, right_w, 2.60 * inch, PALE_BLUE)
    draw_wrapped(c, "How Do I Qualify Each Month?", right_x + 0.13 * inch, content_top - 0.43 * inch, right_w - 0.26 * inch, 0.25 * inch, styles["section"])
    bullets = [
        "Score <b>90/100 or higher</b> and pass every critical gate.",
        "Drive safely and protect the van; promptly report damage.",
        "Show up for scheduled shifts and be on time.",
        "Meet scorecard, DCR/POD, customer, and RTS standards.",
        "Complete honest DVICs, take required breaks, and record all work time.",
        "Accept reasonable rescue/additional-work requests unless there is an approved reason.",
        "Stay within the adjusted safe-efficiency guardrail without rushing or stretching.",
    ]
    by = content_top - 0.68 * inch
    for item in bullets:
        used = draw_wrapped(c, "• " + item, right_x + 0.14 * inch, by - 0.18 * inch, right_w - 0.28 * inch, 0.22 * inch, styles["bullet"])
        by -= max(used + 2, 0.24 * inch)

    box(c, right_x, content_top - 4.35 * inch, right_w, 1.50 * inch, PALE_GREEN)
    draw_wrapped(c, "One Monthly Cost-Aligned Bonus", right_x + 0.13 * inch, content_top - 3.10 * inch, right_w - 0.26 * inch, 0.24 * inch, styles["section"])
    payout = (
        "<b>1.</b> Calculate what WHI would have cost for the same 15 DAs.<br/>"
        "<b>2.</b> Set the VDPI pool at no more than <b>90%</b> of that amount.<br/>"
        "<b>3.</b> Divide it equally among qualifying DAs, capped at <b>$650 each</b>.<br/><br/>"
        "If all eligible shifts are 10+ hours, the VDPI pool is <b>$0</b>."
    )
    draw_wrapped(c, payout, right_x + 0.15 * inch, content_top - 4.23 * inch, right_w - 0.30 * inch, 1.08 * inch, styles["small"])

    box(c, right_x, content_top - 5.72 * inch, right_w, 1.20 * inch, PALE_GOLD, GOLD)
    draw_wrapped(c, "What Can Cause Me to Lose a Month?", right_x + 0.13 * inch, content_top - 4.77 * inch, right_w - 0.26 * inch, 0.22 * inch, styles["section"])
    lose = (
        "Verified preventable collision/damage; unreported damage; serious safety conduct; dishonesty or time theft; "
        "no-call/no-show or unexcused same-day call-out; repeated avoidable excess route time; serious quality failure; "
        "or refusal of reasonable work without an approved reason."
    )
    draw_wrapped(c, lose, right_x + 0.15 * inch, content_top - 5.60 * inch, right_w - 0.30 * inch, 0.73 * inch, styles["small"])

    # Numeric comparison fills the lower-left area.
    numeric_top = content_top - 3.55 * inch
    draw_wrapped(c, "Pay Example — $20.50/Hour, 4 Shifts/Week", left_x, numeric_top, left_w, 0.22 * inch, styles["section"])
    draw_wrapped(c, "Assumes all 15 DAs work the same average hours and qualify. VDPI uses 90% of the WHI-equivalent amount and never exceeds the $650 individual cap.", left_x, numeric_top - 0.24 * inch, left_w, 0.24 * inch, styles["small"])
    numeric_rows = [[
        p("Avg. actual<br/>hours/shift", styles["head"]),
        p("WHI added<br/>hours/shift", styles["head"]),
        p("WHI monthly<br/>per DA", styles["head"]),
        p("90% pool share<br/>per DA", styles["head"]),
        p("Individual<br/>monthly cap", styles["head"]),
        p("VDPI monthly<br/>per DA", styles["head"]),
        p("VDPI vs.<br/>WHI", styles["head"]),
    ]]
    hourly_rate = 20.50
    shifts_per_week = 4
    weeks_per_month = 4.333
    pool_rate = 0.90
    individual_cap = 650
    for avg_hours in (7.5, 8.0, 8.5, 9.0, 9.5, 10.0, 10.5):
        added = max(0, 10 - avg_hours)
        whi_monthly = added * hourly_rate * shifts_per_week * weeks_per_month
        pool_share = whi_monthly * pool_rate
        vdpi_monthly = min(individual_cap, pool_share)
        difference = vdpi_monthly - whi_monthly
        numeric_rows.append([
            p(f"{avg_hours:.1f}", styles["cell"]),
            p(f"{added:.1f}", styles["cell"]),
            p(f"${whi_monthly:,.0f}", styles["cell"]),
            p(f"${pool_share:,.0f}", styles["cell"]),
            p(f"${individual_cap:,.0f}", styles["cell"]),
            p(f"${vdpi_monthly:,.0f}", styles["cell"]),
            p(("+" if difference >= 0 else "−") + f"${abs(difference):,.0f}", styles["cell"]),
        ])
    numeric = Table(numeric_rows, colWidths=[0.86 * inch, 0.90 * inch, 1.06 * inch, 1.05 * inch, 0.95 * inch, 1.12 * inch, 0.92 * inch], repeatRows=1)
    numeric.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 1), (-1, -1), "CENTER"),
        ("GRID", (0, 0), (-1, -1), 0.45, GRID),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("BACKGROUND", (0, 2), (-1, 2), PALE_GREEN),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 2.6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.6),
    ]))
    nw, nh = numeric.wrap(left_w, 2.1 * inch)
    numeric.drawOn(c, left_x, numeric_top - 0.30 * inch - nh)

    # Bottom strip under the comparison tables.
    bottom_y = 0.52 * inch
    bottom_h = 0.72 * inch
    box(c, left_x, bottom_y, left_w, bottom_h, PALE_GOLD, GOLD)
    draw_wrapped(c, "SAFE-EFFICIENCY RULE: The normal review band is 85%–105% of your adjusted route-time baseline. Legitimate delays—route size, rescues, late dispatch, weather, traffic, vehicle or station problems—are reviewed before a decision. <b>Never speed, skip breaks, work off the clock, or hide damage.</b>", left_x + 0.13 * inch, bottom_y + 0.08 * inch, left_w - 0.26 * inch, bottom_h - 0.14 * inch, styles["callout"])

    c.setStrokeColor(GRID)
    c.line(0.42 * inch, 0.36 * inch, width - 0.42 * inch, 0.36 * inch)
    draw_wrapped(c, "This is a simplified guide, not the full policy. The signed VDPI policy controls. Draft for management and payroll review; not yet effective. A DA may not receive WHI and VDPI for the same period.", 0.45 * inch, 0.11 * inch, width - 0.9 * inch, 0.18 * inch, styles["fine"])

    c.showPage()
    c.save()
    print(OUTPUT)


if __name__ == "__main__":
    build()
