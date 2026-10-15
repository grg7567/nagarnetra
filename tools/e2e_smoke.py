"""Browser smoke test against a running server (default http://localhost:8000).

Files a report as a citizen on a phone-sized screen, then works the ticket as an official.
Usage: python tools/e2e_smoke.py [base_url] [admin_password] [screenshot_dir]
Needs: pip install playwright, and Microsoft Edge or Chrome installed.
"""
import io
import sys
from pathlib import Path

from PIL import Image, ImageDraw
from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
ADMIN_PW = sys.argv[2] if len(sys.argv) > 2 else "localtest123"
SHOTS = Path(sys.argv[3] if len(sys.argv) > 3 else "e2e-shots")
SHOTS.mkdir(parents=True, exist_ok=True)
NAVRANGPURA = {"latitude": 23.0365, "longitude": 72.5611}


def photo(path: Path, color=(70, 72, 76)):
    img = Image.new("RGB", (1200, 900), color)
    d = ImageDraw.Draw(img)
    d.ellipse((350, 380, 850, 600), fill=(30, 31, 33))
    img.save(path, "JPEG")
    return path


def no_hscroll(page, name):
    w = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    assert w[0] <= w[1], f"{name}: page scrolls sideways ({w[0]} > {w[1]})"


def main():
    before = photo(SHOTS / "_before.jpg")
    after = photo(SHOTS / "_after.jpg", (120, 120, 118))
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge")

        # ---- citizen on a phone ----
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                                  geolocation=NAVRANGPURA, permissions=["geolocation"], color_scheme="light")
        pg = ctx.new_page()
        pg.goto(BASE + "/")
        no_hscroll(pg, "report")
        pg.locator('input[type=file]').nth(1).set_input_files(str(before))
        expect(pg.get_by_text("Ward 18 · Navrangpura")).to_be_visible(timeout=15000)
        pg.get_by_placeholder("e.g. opposite Iscon Mall").fill("Near Swastik Cross Road")
        pg.screenshot(path=SHOTS / "1-citizen-photo-location.png", full_page=True)
        pg.get_by_role("button", name="Continue").or_(pg.get_by_role("button", name="Analyse photo")).click()
        expect(pg.get_by_role("heading", name="Check and file")).to_be_visible(timeout=60000)
        pg.get_by_role("button", name="Pothole / damaged road").click()
        pg.get_by_role("group", name="Severity").get_by_role("button", name="high").click()
        radio = pg.get_by_text("No, mine is a different problem")
        if radio.count():
            radio.click()
        pg.screenshot(path=SHOTS / "2-citizen-review.png", full_page=True)
        no_hscroll(pg, "review")
        pg.get_by_role("button", name="File complaint").click()
        code_el = pg.locator(".big-code")
        expect(code_el).to_be_visible(timeout=30000)
        code = code_el.inner_text().strip()
        print("filed", code)
        pg.screenshot(path=SHOTS / "3-citizen-filed.png", full_page=True)
        pg.get_by_role("link", name="Track this complaint").click()
        expect(pg.get_by_text("Engineering Dept. (Roads), AMC")).to_be_visible()
        pg.screenshot(path=SHOTS / "4-citizen-track.png", full_page=True)
        no_hscroll(pg, "track")
        ctx.close()

        # ---- official on a desktop ----
        ctx = browser.new_context(viewport={"width": 1366, "height": 900}, color_scheme="dark")
        pg = ctx.new_page()
        pg.goto(BASE + "/admin")
        pg.get_by_label("Email").fill("admin@nagarnetra.app")
        pg.get_by_label("Password").fill(ADMIN_PW)
        pg.get_by_role("button", name="Sign in").click()
        expect(pg.get_by_role("heading", name="Complaint dashboard")).to_be_visible()
        expect(pg.get_by_text(code)).to_be_visible()
        pg.wait_for_timeout(2500)  # map tiles
        pg.screenshot(path=SHOTS / "5-official-dashboard.png", full_page=True)
        pg.get_by_text(code).click()
        expect(pg.get_by_role("heading", name="Update status")).to_be_visible()
        pg.get_by_role("button", name="Assign to field team").click()
        expect(pg.get_by_text("Assigned to a field team.")).to_be_visible()
        pg.locator('input[type=file]').set_input_files(str(after))
        pg.get_by_placeholder("Work done").fill("Patched with hot mix")
        pg.get_by_role("button", name="Mark fixed").click()
        expect(pg.get_by_text("Marked fixed.")).to_be_visible(timeout=60000)
        pg.wait_for_timeout(1500)
        pg.screenshot(path=SHOTS / "6-official-ticket.png", full_page=True)
        pg.goto(BASE + "/admin/team")
        expect(pg.get_by_role("heading", name="Team and settings")).to_be_visible()
        pg.screenshot(path=SHOTS / "7-official-team.png", full_page=True)
        ctx.close()
        browser.close()
    print("E2E OK")


if __name__ == "__main__":
    main()
