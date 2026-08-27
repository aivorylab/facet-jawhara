#!/usr/bin/env python3
"""
Refreshes data.json from the connected Windsor.ai account.

WHAT THIS COVERS AUTOMATICALLY (the parts that genuinely change every day and
drive every KPI, chart, and date-filter in the dashboard):
  - Meta / Google / Snapchat / TikTok / GA4 daily performance (spend, clicks,
    impressions, purchases, revenue, funnel-stage counts)
  - Rolled-up campaign-level totals for Meta/Google/Snapchat/TikTok

WHAT THIS DOES NOT COVER (documented honestly, not silently skipped):
  - Creative thumbnail URLs (Meta/TikTok/Google) — these are short-lived
    signed CDN links from each ad platform and need their own periodic
    refresh call, not currently included in this script.

Requires the WINDSOR_API_KEY environment variable (set as a GitHub Secret —
see the repo README). Uses Windsor.ai's REST API directly:
  GET https://connectors.windsor.ai/{connector}?api_key=...&fields=...&date_preset=...
Verify field names / endpoint behaviour against your own Windsor.ai account —
connector field availability can vary by account and platform permissions.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.parse
from datetime import datetime, timedelta, timezone

WINDSOR_BASE = "https://connectors.windsor.ai"
API_KEY = os.environ.get("WINDSOR_API_KEY")
DATA_JSON_PATH = os.path.join(os.path.dirname(__file__), "..", "data.json")

# Real Windsor.ai account identifiers already connected for this project.
ACCOUNTS = {
    "facebook": "1499460650506686",
    "google_ads": "793-518-5903",
    "googleanalytics4": "394213533",
    "snapchat": "9f0ce432-0c11-4f2a-b1b7-151aafe35dca",
    "tiktok": "7010714667421057026",
}


def windsor_get(connector, fields, date_preset="last_30d", extra_params=None):
    """Real GET call against Windsor.ai's REST API. Returns parsed JSON (list of rows)."""
    if not API_KEY:
        raise RuntimeError("WINDSOR_API_KEY is not set — see README for how to add it as a GitHub Secret.")
    params = {
        "api_key": API_KEY,
        "fields": ",".join(fields),
        "date_preset": date_preset,
    }
    if extra_params:
        params.update(extra_params)
    url = f"{WINDSOR_BASE}/{connector}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "facet-refresh-script/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(body)


def safe_num(v, default=0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def refresh_platform_daily(data):
    """Refreshes the campaign_daily array (Meta/Google/Snapchat/TikTok) — the array every
    date-range filter, chart, and campaign table in the dashboard is ultimately built from."""
    rows = []

    meta = windsor_get("facebook", ["date", "campaign_name", "spend", "clicks", "impressions",
                                     "actions_purchase", "action_values_purchase",
                                     "actions_landing_page_view", "actions_view_content",
                                     "actions_add_to_cart", "actions_initiate_checkout"],
                        extra_params={"filter_spend": "gt0"})
    for r in meta:
        rows.append({
            "date": r.get("date"), "platform": "Meta", "campaign_name": r.get("campaign_name"),
            "spend": safe_num(r.get("spend")), "clicks": safe_num(r.get("clicks")),
            "impressions": safe_num(r.get("impressions")),
            "lpv": safe_num(r.get("actions_landing_page_view")), "vc": safe_num(r.get("actions_view_content")),
            "atc": safe_num(r.get("actions_add_to_cart")), "ic": safe_num(r.get("actions_initiate_checkout")),
            "purchases": safe_num(r.get("actions_purchase")), "revenue": safe_num(r.get("action_values_purchase")),
        })

    google = windsor_get("google_ads", ["date", "campaign_name", "spend", "clicks", "impressions",
                                         "conversions", "conversions_value"])
    for r in google:
        rows.append({
            "date": r.get("date"), "platform": "Google", "campaign_name": r.get("campaign_name"),
            "spend": safe_num(r.get("spend")), "clicks": safe_num(r.get("clicks")),
            "impressions": safe_num(r.get("impressions")), "lpv": 0, "vc": 0, "atc": 0, "ic": 0,
            "purchases": safe_num(r.get("conversions")), "revenue": safe_num(r.get("conversions_value")),
        })

    snap = windsor_get("snapchat", ["date", "campaign", "spend", "clicks", "impressions",
                                     "swipe_up_percent", "conversion_purchases", "conversion_purchases_value",
                                     "conversion_add_cart", "conversion_start_checkout"])
    for r in snap:
        rows.append({
            "date": r.get("date"), "platform": "Snapchat", "campaign_name": r.get("campaign"),
            "spend": safe_num(r.get("spend")), "clicks": safe_num(r.get("clicks")),
            "impressions": safe_num(r.get("impressions")), "lpv": 0,
            "vc": 0, "atc": safe_num(r.get("conversion_add_cart")), "ic": safe_num(r.get("conversion_start_checkout")),
            "purchases": safe_num(r.get("conversion_purchases")), "revenue": safe_num(r.get("conversion_purchases_value")),
        })

    tiktok = windsor_get("tiktok", ["date", "campaign_name", "spend", "clicks", "impressions",
                                     "complete_payment", "onsite_shopping"])
    for r in tiktok:
        rows.append({
            "date": r.get("date"), "platform": "TikTok", "campaign_name": r.get("campaign_name"),
            "spend": safe_num(r.get("spend")), "clicks": safe_num(r.get("clicks")),
            "impressions": safe_num(r.get("impressions")), "lpv": 0, "vc": 0, "atc": 0, "ic": 0,
            "purchases": safe_num(r.get("complete_payment")), "revenue": 0,
        })

    data["campaign_daily"] = rows
    print(f"  campaign_daily: {len(rows)} rows refreshed")


def refresh_ga4_daily(data):
    """Refreshes GA4's website performance and revenue series."""
    rows = windsor_get("googleanalytics4", ["date", "sessions", "active_users", "conversions_purchase",
                                             "total_revenue", "bounce_rate", "engagement_rate",
                                             "average_session_duration", "screen_page_views"])
    out = []
    for r in rows:
        out.append({
            "date": r.get("date"), "sessions": safe_num(r.get("sessions")),
            "active_users": safe_num(r.get("active_users")), "purchases": safe_num(r.get("conversions_purchase")),
            "revenue": safe_num(r.get("total_revenue")),
        })
    if "ga4" not in data:
        data["ga4"] = {}
    data["ga4"]["daily"] = out
    print(f"  ga4.daily: {len(out)} rows refreshed")

    perf = windsor_get("googleanalytics4", ["date", "bounce_rate", "engagement_rate",
                                             "average_session_duration", "screen_page_views", "sessions"])
    ga4_daily_perf = []
    for r in perf:
        ga4_daily_perf.append({
            "date": r.get("date"), "bounce_rate": safe_num(r.get("bounce_rate")),
            "engagement_rate": safe_num(r.get("engagement_rate")),
            "avg_session_duration": safe_num(r.get("average_session_duration")),
            "page_views": safe_num(r.get("screen_page_views")), "sessions": safe_num(r.get("sessions")),
        })
    data["ga4_daily_perf"] = ga4_daily_perf
    print(f"  ga4_daily_perf: {len(ga4_daily_perf)} rows refreshed")


def refresh_meta_totals(data):
    """Refreshes the meta.totals summary block used by Page 1/3 KPI cards."""
    rows = windsor_get("facebook", ["spend", "impressions", "reach", "clicks",
                                     "actions_purchase", "action_values_purchase"])
    if rows:
        r = rows[0]
        spend = safe_num(r.get("spend"))
        clicks = safe_num(r.get("clicks"))
        impressions = safe_num(r.get("impressions"))
        purchases = safe_num(r.get("actions_purchase"))
        revenue = safe_num(r.get("action_values_purchase"))
        data.setdefault("meta", {})["totals"] = {
            "spend": spend, "impressions": impressions, "reach_avg": safe_num(r.get("reach")),
            "clicks": clicks, "purchases": purchases, "revenue": revenue,
            "ctr": (clicks / impressions) if impressions else 0,
            "cpc": (spend / clicks) if clicks else 0,
            "cpm": (spend / impressions * 1000) if impressions else 0,
            "roas": (revenue / spend) if spend else 0,
            "cpa": (spend / purchases) if purchases else 0,
        }
        print("  meta.totals refreshed")


def main():
    if not os.path.exists(DATA_JSON_PATH):
        print(f"ERROR: {DATA_JSON_PATH} not found. Run this from the repo root, or check the path.", file=sys.stderr)
        sys.exit(1)

    with open(DATA_JSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    print("Refreshing data.json from Windsor.ai...")
    steps = [
        ("Platform daily performance (Meta/Google/Snapchat/TikTok)", refresh_platform_daily),
        ("Meta account totals", refresh_meta_totals),
        ("GA4 daily performance", refresh_ga4_daily),
    ]
    failures = []
    for label, fn in steps:
        try:
            print(f"- {label}")
            fn(data)
        except Exception as e:
            print(f"  FAILED: {e}", file=sys.stderr)
            failures.append((label, str(e)))

    data["_last_refreshed_utc"] = datetime.now(timezone.utc).isoformat()

    with open(DATA_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

    print(f"\nWrote {DATA_JSON_PATH}")
    if failures:
        print(f"\n{len(failures)} step(s) failed (data.json was still written with whatever succeeded):")
        for label, err in failures:
            print(f"  - {label}: {err}")
        # Non-zero exit so the GitHub Action can flag a failed run, without blocking the
        # partial update that did succeed from being committed if the workflow chooses to.
        sys.exit(2)


if __name__ == "__main__":
    main()
