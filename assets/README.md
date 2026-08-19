# Splunkbase & README assets

Files in this folder are for **GitHub README** and **Splunkbase listing** — not shipped inside the Splunk app package.

## Required before Splunkbase submit

| File | Size | Purpose |
|------|------|---------|
| `listing_icon_200.png` | 200×200 | Splunkbase listing icon |
| `listing_icon_400.png` | 400×400 | Splunkbase listing icon (large) |
| `screenshot.png` | ~1200–1600 px wide | Hero screenshot (README + Splunkbase) |
| `screenshot-topology.png` | optional | Topology dashboard (needs Network Diagram Viz) |
| `screenshot-drilldown.png` | optional | Device or client drilldown with enriched syslog |

## Starting point

```bash
cp ../unifi_app_for_splunk/static/appIcon_2x.png listing_icon_400.png
# Resize to 200×200 for listing_icon_200.png
```

## Screenshots to capture

1. **Setup page** — index macros configured.
2. **UniFi – Overview** — normal band + kick reasons.
3. **UniFi – Device Drilldown** — enriched syslog (names, not raw MACs).
4. **UniFi – Topology** — if Network Diagram Viz is installed.

Redact client names / IPs if using production data; lab data is preferable.
