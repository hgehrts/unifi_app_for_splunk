# UniFi App for Splunk — companion app (`unifi_app_for_splunk`)

> Consolidated dashboards, syslog correlation and ID→name enrichment for UniFi
> gear. Companion to the data-collector add-on
> **`TA_unifi_ng`** (the *UniFi Network Add-on for Splunk*, a separate repo).

- **App folder:** [`unifi_app_for_splunk/`](../unifi_app_for_splunk/)
- **Release package:** [`dist/`](../dist/)
- **In-app README:** [`unifi_app_for_splunk/README.md`](../unifi_app_for_splunk/README.md)
- **Design / decision log:** [`docs/correlation-dashboards-plan.md`](correlation-dashboards-plan.md)
- **Current version:** 1.2.0

---

## 1. What it is, and why it exists

The TA (`TA_unifi_ng`) collects UniFi **asset + telemetry** from the Integration
API into Splunk. Separately, UniFi devices stream **syslog** to Splunk via
[Splunk Connect for Syslog (SC4S)](https://splunk.github.io/splunk-connect-for-syslog/).
These two feeds never share a common identifier the way a human thinks about the
network:

| Feed | Index (default) | Identifies devices by | Identifies clients by |
|------|-----------------|------------------------|------------------------|
| TA asset/telemetry | `unifi` | name + UUID + MAC | name + MAC + IP |
| UniFi syslog (SC4S) | `netops` (`source=sc4s`) | bare MAC prefix (`942a6f4877f1`) | bare MAC (`fc:31:5d:58:59:16`) |

This app bridges the two. It **enriches the syslog at search time** with friendly
names, IPs, model and the client hardware vendor, then ships four linked
**Dashboard Studio** dashboards for fleet health, root-cause analysis (RCA) and
per-device / per-client drilldown.

So instead of reading `942a6f4877f1 … kick-sta … reason:Low RSSI` you see
`U7DG kicked Sigitas-iPhone (Apple, Inc.) — Low RSSI`.

---

## 2. How it relates to the TA

```
UniFi Integration API ──► TA_unifi_ng ──────────────► index=unifi   (asset + telemetry)
                                                          │
                                                          ├─ scheduled lookup-gen searches
                                                          ▼
UniFi devices ──syslog──► SC4S ─────────────────────► index=netops  (source=sc4s, ubnt*)
                                                          ▲
                                          search-time LOOKUP- enrichment
                                                          │
                                              unifi_app_for_splunk
                                          (lookups + extractions + dashboards)
```

- The TA is a **pure read-only collector** — unchanged by this app.
- This app **reads** the TA's `unifi:device` / `unifi:client` events to build
  enrichment lookups, and **decorates** the SC4S `ubnt*` events with the result.
- Both indexes are referenced only through two editable macros (below), so the
  app adapts to any environment without code edits.

---

## 3. Requirements

- Splunk 9.x or 10.x (Dashboard Studio dashboards require 9.0+; tested on 10.4).
- KV Store enabled (default on most deployments).
- **`TA_unifi_ng`** (the *UniFi Network Add-on for Splunk*) installed and collecting into an index.
- UniFi device syslog reaching Splunk via SC4S as sourcetypes `ubnt`,
  `ubnt:wireless`, `ubnt:dns`.

---

## 4. Install

1. Download `unifi_app_for_splunk-<version>.tar.gz` from
   [`dist/`](../dist/) (or a GitHub Release).
2. Splunk Web → **Apps → Manage Apps → Install app from file** → upload → restart.
3. Set the two index macros (next section) for your environment.
4. Run the two lookup-generating searches once (or wait for the schedule).

---

## 5. Setup — point the app at your indexes (required)

All index references live in **two search macros**. Edit them once; no restart
needed (they are search-time). *Settings → Advanced search → Search macros →
app `unifi_app_for_splunk`.*

| Macro | Default | Meaning |
|-------|---------|---------|
| [`unifi_index`](https://help.splunk.com/en/splunk-cloud-platform/search/search-manual/9.4/use-search-macros-in-searches) | `index=unifi` | Where `TA_unifi_ng` writes asset/telemetry. |
| `unifi_syslog_index` | `index=netops source=sc4s` | Where UniFi device syslog lands. |

These two macros are the **only** place indexes are referenced; every saved
search, lookup generator and dashboard builds on them. Convenience macros
(`unifi_syslog`, `unifi_devices`, `unifi_clients`, `unifi_device_stats`,
`mac_nocolon()`) are derived from them.

---

## 6. Enrichment lookups (auto-refreshing)

Two KV Store collections are populated from the live TA asset data on a schedule:

| Lookup | Source sourcetype | Key | Refresh |
|--------|-------------------|-----|---------|
| `unifi_device_lookup` | `unifi:device` | device MAC (no colons) | every 15 min |
| `unifi_client_lookup` | `unifi:client` | client MAC (with colons) | every 15 min (offset) |
| `unifi_oui_lookup` (static CSV) | IEEE MA-L registry | OUI (first 3 bytes) | manual (see below) |

Generating saved searches (*Settings → Searches, reports, and alerts*):

- **`unifi - rebuild device lookup`**
- **`unifi - rebuild client lookup`** — runs after the device one so each
  client's uplink device resolves to a **name**.

To populate immediately after install, open each and click **Run**.

The OUI vendor table ([`lookups/unifi_oui.csv`](../unifi_app_for_splunk/lookups/unifi_oui.csv),
~39 k rows) ships pre-built from the
[IEEE OUI registry](https://standards-oui.ieee.org/oui/oui.csv). To refresh it
later, download that CSV and keep `Assignment` + `Organization Name`, lowercasing
the OUI, with header `oui,vendor`.

---

## 7. What gets enriched onto syslog

Applied automatically (search-time `LOOKUP-`/`REPORT-`/`EVAL-`) to `ubnt`,
`ubnt:wireless`, `ubnt:dns`:

| Field | From | Example |
|-------|------|---------|
| `device_name`, `device_ip`, `device_model`, `device_state` | device lookup | `U7DG`, `192.168.1.144`, `U7 Pro Max`, `ONLINE` |
| `client_name`, `client_ip`, `client_type` | client lookup | `Sigitas-iPhone`, `192.168.1.113`, `WIRELESS` |
| `client_vendor` | OUI lookup | `Apple, Inc.` |
| `proc` | extraction | `hostapd`, `stahtd`, `stamgr`, `kernel`, `wevent` |
| `wifi_event` | extraction | `associated`, `disassociated`, `EVENT_STA_LEAVE` |
| `kick_reason`, `rssi` | extraction | `Low RSSI rssi:12`, `12` |
| `stahtd_event_type`, `stahtd_dc_reason` | extraction | `failure`, `sta_roam` |

The lookups are shared **globally** (`metadata/default.meta`), so the enrichment
also applies to ad-hoc searches outside this app.

---

## 8. Dashboards (Dashboard Studio)

Under the app's nav. All cross-links pass the device name / client MAC as a token
so the target shows **only** that entity.

| Dashboard | View | Purpose |
|-----------|------|---------|
| **UniFi – Overview** | [`unifi_overview.xml`](../unifi_app_for_splunk/default/data/ui/views/unifi_overview.xml) | Devices online/offline, **clients-seen and WiFi-disconnects vs a "normal" band** (same weekday+hour over the prior 28 days, ±10 %), top kick reasons, problem devices, noisiest clients. Click a device/client → drilldown. |
| **UniFi – Device Drilldown** | [`unifi_device_drilldown.xml`](../unifi_app_for_splunk/default/data/ui/views/unifi_device_drilldown.xml) | One device: asset, CPU/memory telemetry, connect/disconnect/kick timeline, clients on it (clickable), full syslog. |
| **UniFi – Client Drilldown** | [`unifi_client_drilldown.xml`](../unifi_app_for_splunk/default/data/ui/views/unifi_client_drilldown.xml) | One client across the fleet: identity + vendor, which APs it touches, roaming spread, RSSI over time, full syslog. |
| **UniFi – WiFi Experience & Roaming** | [`unifi_wifi_experience.xml`](../unifi_app_for_splunk/default/data/ui/views/unifi_wifi_experience.xml) | Fleet-wide wireless RCA: kicks by AP, association failures over time, most-kicked low-RSSI clients, roaming churn, TX-retry by AP. |

The "normal band" is the mean of the **same weekday and hour** over the trailing
28 days, drawn as `Normal low`/`Normal high` lines at ±10 %, so an operator can
see at a glance whether the current hour is busy/quiet **for that time of week**.

---

## 9. What this finds that the UniFi console doesn't

The UniFi controller shows *current* state and a short event feed. Splunk keeps
full history and lets you correlate syslog with asset/telemetry:

- **Sticky / low-RSSI clients** — devices kicked repeatedly at low RSSI
  (`kick_reason="Low RSSI*"`); classic for a phone in a far room or a car in the
  driveway. Visible per-client and per-AP.
- **Roaming churn** — a client ping-ponging across many APs → min-RSSI/coverage
  tuning needed.
- **Association failures** — `stahtd` `failure`/`soft failure` spikes →
  PSK/PMF/DHCP problems, often invisible in the UI.
- **AP airtime pressure** — high TX-retry % per AP → interference / channel width.
- **Slow-failing hardware** — CPU/memory/uptime trends to catch a degrading AP or
  overheating switch before it drops.

---

## 10. Source layout

```
unifi_app_for_splunk/
├── app.manifest
├── VERSION
├── default/
│   ├── app.conf
│   ├── macros.conf          # unifi_index / unifi_syslog_index + helpers
│   ├── collections.conf     # KV Store collections
│   ├── transforms.conf      # lookup defs + syslog field extractions
│   ├── props.conf           # auto LOOKUP- + REPORT- on ubnt* sourcetypes
│   ├── savedsearches.conf   # lookup generators (scheduled)
│   └── data/ui/
│       ├── nav/default.xml
│       └── views/           # 4 Dashboard Studio dashboards
├── lookups/unifi_oui.csv    # IEEE OUI → vendor (~39k rows)
├── static/                  # app icons (appIcon*, appLogo*)
└── metadata/default.meta    # global sharing
```

---

## 11. Troubleshooting

| Symptom | Check |
|---------|-------|
| Names not resolving on syslog | Run the two lookup generators; `\| inputlookup unifi_device_lookup` should return rows; confirm `unifi_index` matches where the TA actually writes. |
| No syslog events | Confirm `unifi_syslog_index` matches your SC4S index + `source`; `` `unifi_syslog` \| stats count by sourcetype ``. |
| Dashboard panel empty | Widen the time range — kicks/failures are bursty (drilldowns default to `-7d`). |
| Drilldown opens empty | Ensure app ≥ 1.0.1 (older builds had a token-handover bug). |

---

## 12. Reference links

- This app's repo README: [`README.md`](../README.md)
- TA add-on (separate repo): *UniFi Network Add-on for Splunk* (`TA_unifi_ng`)
- UniFi Integration API (Ubiquiti developer site): <https://developer.ui.com/>
- Splunk Connect for Syslog (SC4S): <https://splunk.github.io/splunk-connect-for-syslog/>
- Dashboard Studio — linking interactions / tokens:
  <https://help.splunk.com/en/splunk-enterprise/create-dashboards-and-reports/dashboard-studio>
- Splunk CIM: <https://docs.splunk.com/Documentation/CIM/latest/User/Overview>
- IEEE OUI registry: <https://standards-oui.ieee.org/oui/oui.csv>

> Not affiliated with or endorsed by Ubiquiti Inc. or Splunk LLC. "UniFi" is a
> trademark of Ubiquiti Inc.; "Splunk" is a trademark of Splunk LLC.
