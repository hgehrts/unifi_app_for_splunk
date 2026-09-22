# Splunkbase submission — UniFi App for Splunk

Use this as a copy-paste guide when submitting at [Splunkbase Developer Portal](https://splunkbase.splunk.com/). Full listing text lives in [`../splunkbase.md`](../splunkbase.md).

---

## Listing metadata (form fields)

| Field | Value |
|-------|-------|
| **App / package name** | UniFi App for Splunk |
| **Package ID** | `unifi_app_for_splunk` |
| **Type** | App |
| **Version** | 1.3.0 |
| **License** | Apache-2.0 |
| **Support model** | Developer Supported |
| **Author / Created by** | Hans-Henning Gehrts |
| **Contact email** | hgehrts@gmail.com |
| **Source code URL** | https://github.com/hgehrts/unifi_app_for_splunk |
| **Categories** | Network, IT Operations |
| **Splunk compatibility** | **9.0, 9.1, 9.2, 9.3, 9.4, 10.0, 10.1, 10.2, 10.3, 10.4, 10.5** (Dashboard Studio; tested on 10.4) |
| **CIM Model Version** | Not shipped by this app. If required: **4.x–8.x** (same as `TA_unifi_ng`). Not 3.x. |
| **Splunk Cloud** | Expected compatible — submit AppInspect cloud report |

## Prerequisites (state clearly in listing)

1. **UniFi Network Add-on for Splunk** (`TA_unifi_ng`) — data collector add-on.
2. UniFi device **syslog via SC4S** (`ubnt*` sourcetypes) for full enrichment and dashboards.
3. Optional: **Network Diagram Viz** app (Topology dashboard only).

## Package to upload

- https://github.com/hgehrts/unifi_app_for_splunk/releases/download/v1.3.0/unifi_app_for_splunk-1.3.0.tar.gz

## Icons

| Asset | File |
|-------|------|
| Icon 200×200 | `assets/listing_icon_200.png` |
| Icon 400×400 | `assets/listing_icon_400.png` |
| Screenshot | `assets/screenshot.png` *(capture before submit)* |

## AppInspect

```bash
splunk-appinspect inspect dist/unifi_app_for_splunk-1.3.0.tar.gz \
  --included-tags cloud --included-tags private_app --mode precert \
  --output-file docs/appinspect-v1.3.0.json
```

## Short description (≤250 chars)

```
Dashboards, syslog correlation and ID→name enrichment for UniFi gear. Joins TA_unifi_ng asset data with SC4S syslog so cryptic MACs become readable names, IPs and vendors.
```

## Summary / Details / Installation / Troubleshooting

Copy from [`splunkbase.md`](../splunkbase.md).

## Reviewer notes (optional)

- Search-time enrichment only; writes KV Store lookups in this app's namespace.
- No credentials stored; no outbound network calls.
- Companion to `TA_unifi_ng` (submit TA listing first or reference GitHub if TA still in review).

## Submit order

1. Submit **TA_unifi_ng** add-on first (or reference GitHub release if in parallel review).
2. Submit **unifi_app_for_splunk** with prerequisite note above.
