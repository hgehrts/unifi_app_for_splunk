# UniFi App for Splunk

Consolidated dashboards, syslog correlation and ID→name enrichment for UniFi
gear. Companion to the **`TA_unifi_ng`** Technical Add-on.

This app turns two disconnected data sources into one investigable picture:

- **`TA_unifi_ng`** asset + telemetry (UniFi Integration API) → `index=unifi`
- **UniFi device syslog** via Splunk Connect for Syslog (SC4S) → `index=netops source=sc4s sourcetype=ubnt*`

UniFi syslog only ever carries cryptic MAC addresses. This app enriches those
events **at search time** with friendly device names, client names, IPs, device
model and the client hardware vendor — so every dashboard and ad-hoc search
shows `U7DG`, `Sigitas-iPhone` and `Apple, Inc.` instead of `942a6f4877f1`.

---

## 1. Requirements

- Splunk 9.x or 10.x (Dashboard Studio dashboards require 9.0+; tested on 10.4).
- KV Store enabled (default on most deployments).
- The **`TA_unifi_ng`** add-on installed and collecting into an index.
- UniFi device syslog reaching Splunk via SC4S (sourcetypes `ubnt`,
  `ubnt:wireless`, `ubnt:dns`).

---

## 2. Setup — point the app at your indexes (required)

All index references live in **two macros**. Set them once, no restart needed
(they are search-time).

**Easiest: the Setup page.** Open the app → **Setup** (in the app nav, or
*Manage Apps → UniFi App for Splunk → Set up*). It runs a discovery search that
shows which indexes hold your UniFi TA data and your UniFi syslog, lets you enter
the two index expressions, and **writes the macros on Save** — no manual editing.

**Or by hand:** Settings → Advanced search → Search macros → app
`unifi_app_for_splunk`:

| Macro | Default | Meaning |
|-------|---------|---------|
| `unifi_index` | `index=unifi` | Where `TA_unifi_ng` writes asset/telemetry. |
| `unifi_syslog_index` | `index=netops source=sc4s` | Where UniFi device syslog lands. |

Edit the **Definition** to match your environment, e.g. if your TA writes to
`index=network_unifi`, set `unifi_index` definition to `index=network_unifi`.

> These two macros are the *only* place indexes are referenced. Every saved
> search, lookup generator and dashboard is built on top of them.

After editing, run the two lookup generators once (next section) so enrichment
picks up immediately.

---

## 3. Get UniFi syslog into Splunk (SC4S)

This app correlates and enriches UniFi **syslog**, so the UniFi controller must
be sending syslog to Splunk. The recommended path is
[Splunk Connect for Syslog (SC4S)](https://splunk.github.io/splunk-connect-for-syslog/),
which already ships parsers for the `ubnt`, `ubnt:wireless` and `ubnt:dns`
sourcetypes this app expects.

**a) Point the UniFi controller at your syslog collector**

In the UniFi Network console:

1. **Settings → Control Plane → Integrations** *(or, on older firmware,
   Settings → System → Advanced / Logging)*.
2. Enable **Remote Logging / Syslog**.
3. Set the **Syslog server** to your SC4S host and **port** (SC4S default UDP
   `514`; many run a dedicated UDP/TCP port per source).
4. Select the content to send (devices, clients, firewall, triggers, etc.) and
   save.

> Exact menu wording varies by UniFi OS / Network version. The setting is the
> controller's **rsyslogd** remote-logging configuration.

**b) Make sure SC4S forwards it to Splunk**

- Run SC4S per the
  [official quickstart](https://splunk.github.io/splunk-connect-for-syslog/main/gettingstarted/),
  pointing it at your Splunk HEC.
- UniFi traffic is auto-classified by SC4S to `sourcetype=ubnt*`. If you route it
  to a custom index/source, set the `unifi_syslog_index` macro (above) to match
  — e.g. `index=netops source=sc4s`.

**c) Verify it's arriving**

```spl
`unifi_syslog` | stats count by sourcetype
```

You should see `ubnt`, `ubnt:wireless`, (and possibly `ubnt:dns`) with rising
counts. Once both this and `` `unifi_devices` `` return data, the enrichment and
dashboards work end-to-end.

> Note: this app does **not** change any controller settings — configuring the
> controller's syslog destination is a deliberate, manual step you perform in the
> UniFi console. (The official UniFi Integration API has no syslog/settings
> endpoint; see the repo's `docs/syslog-autoconfig-analysis.md`.)

---

## 4. Enrichment lookups (auto-refreshing)

Two KV Store collections are populated from the live TA asset data and refreshed
on a schedule:

| Lookup | Source | Key | Refresh |
|--------|--------|-----|---------|
| `unifi_device_lookup` | `unifi:device` | device MAC (no colons) | every 15 min |
| `unifi_client_lookup` | `unifi:client` | client MAC (with colons) | every 15 min (offset) |

Generating saved searches (Settings → Searches, reports, and alerts):

- **`unifi - rebuild device lookup`**
- **`unifi - rebuild client lookup`** (runs after the device one so it can
  resolve each client's uplink device name)

To populate immediately after install, open each and click **Run**, or wait for
the next scheduled run.

A third lookup, **`unifi_oui_lookup`** (`lookups/unifi_oui.csv`), maps the MAC
OUI (first 3 bytes) to the hardware vendor. It ships pre-populated from the IEEE
MA-L registry (~39k entries). To refresh it later:

```bash
curl -s -o oui.csv https://standards-oui.ieee.org/oui/oui.csv
# keep only Assignment + Organization Name, lowercase the OUI, header: oui,vendor
```

---

## 5. What gets enriched onto syslog

Applied automatically to `ubnt`, `ubnt:wireless`, `ubnt:dns`:

| Field | From | Example |
|-------|------|---------|
| `device_name` | device lookup | `U7DG` |
| `device_ip`, `device_model`, `device_state` | device lookup | `192.168.1.144`, `U7 Pro Max` |
| `client_name` | client lookup | `Sigitas-iPhone 59:16` |
| `client_ip`, `client_type` | client lookup | `192.168.1.113`, `WIRELESS` |
| `client_vendor` | OUI lookup | `Apple, Inc.` |
| `proc` | extraction | `hostapd`, `stahtd`, `stamgr`, `kernel`, `wevent`, `dropbear`, `ubnt-fanctrl` |
| `wifi_event` | extraction | `associated`, `disassociated`, `EVENT_STA_LEAVE` |
| `kick_reason`, `rssi` | extraction | `Low RSSI rssi:12`, `12` |
| `stahtd_event_type`, `stahtd_dc_reason` | extraction | `failure`, `sta_roam` |
| `severity`, `severity_rank` | SC4S | `err`/`warning`/`notice`/`info`/`debug` (+ numeric rank) |
| `event_action` | derived | `connect`, `disconnect`, `kick`, `roam`, `link_up`, `link_down`, `login_success`, `login_fail`, `fan`, `error` |
| `port`, `link_state` | kernel | `3`, `up`/`down` |
| `poe_port`, `poe_event` | kernel | `5`, `enabled`/`overload` |
| `device_temp_c`, `fan_rpm`, `fan_speed_pct`, `fan_pwm_set`/`_actual` | `ubnt-fanctrl` | `42`, `2311`, `25` |
| `login_user`, `login_src_ip`, `login_result` | dropbear (SSH) | `admin`, `192.168.1.1`, `auth succeeded` |

---

## 6. Dashboards (Dashboard Studio)

| Dashboard | Purpose |
|-----------|---------|
| **UniFi - Overview** | Fleet health (online/offline), **clients-seen and WiFi-disconnects each plotted against a "normal" band** (mean of the same weekday+hour over the prior 28 days, ±10%), top kick reasons, problem devices and noisiest clients. Click a device or client to drill down. |
| **UniFi - Device Drilldown** | One **or more** devices (multi-select, defaults to All): asset, **software/firmware version**, CPU/memory, **uplink throughput**, **fan & temperature** (from `ubnt-fanctrl` syslog), **active ports/PoE**, clients (clickable), events-over-time, and a rich syslog section with **severity / event-type filters** and **clustering by client, by device and by message pattern**. |
| **UniFi - Client Drilldown** | One **or more** clients (multi-select): identity + vendor, which APs they touch, roaming spread, RSSI over time, full syslog. |
| **UniFi - WiFi Experience & Roaming** | Fleet-wide wireless RCA: kicks by AP, association failures over time, most-kicked low-RSSI clients, roaming churn, TX-retry by AP. |
| **UniFi - Auditing** | Device SSH logins (**who / from where / when**), login sources, port link up/down history, **config-change detection** (firmware/IP/state), and an errors/warnings timeline. Login and port rows drill down to the device. |

Drilldowns pass the device name / client MAC as a token, and the target
dashboard shows **only** the selected entities' telemetry, asset and syslog.
Every dashboard has an **Auto-refresh** control (default Off; 30s–15m).

### Note on audit scope

The Auditing dashboard covers what the devices actually emit: **device-level SSH
logins** (`dropbear`), **port up/down** (`kernel`) and **config drift** derived
from the TA's periodic snapshots. The **UniFi controller's own admin-UI logins
and configuration audit log are not in the device syslog stream and are not
exposed by the Integration API.** To get that full coverage, forward the
controller's audit log to Splunk — see `docs/syslog-autoconfig-analysis.md` and
`docs/v1.1.0-plan.md`. Fan/temperature is only emitted by devices that have a
fan controller (mainly switches and some APs); APs/gateways without it simply
show no fan/temp data.

---

## 7. What this finds that the UniFi UI hides

The UniFi controller shows *current* state and a short event feed. Splunk keeps
full history and lets you correlate. Common root causes this surfaces:

- **Sticky / low-RSSI clients** — devices repeatedly kicked at low RSSI
  (`kick_reason="Low RSSI*"`). Classic for a phone left in a far room or a car
  in the driveway. Visible per-client and per-AP.
- **Roaming churn** — a client ping-ponging across many APs (high distinct-AP
  count per window) → min-RSSI/coverage tuning needed.
- **Association failures** — `stahtd` `failure` / `soft failure` spikes →
  PSK/PMF/DHCP problems, often invisible in the UI.
- **AP airtime pressure** — high TX-retry % per AP → interference / channel
  width issues.
- **Per-device health over time** — CPU/memory/uptime trends to catch a slowly
  failing AP or an overheating switch before it drops.

---

## 8. Layout

```
unifi_app_for_splunk/
├── default/
│   ├── app.conf
│   ├── macros.conf          # unifi_index / unifi_syslog_index + helpers
│   ├── collections.conf     # KV Store collections
│   ├── transforms.conf      # lookup defs + syslog field extractions
│   ├── props.conf           # auto LOOKUP- + REPORT- on ubnt* sourcetypes
│   ├── savedsearches.conf   # lookup generators (scheduled)
│   └── data/ui/
│       ├── nav/default.xml
│       └── views/           # 5 dashboards + Setup
│           ├── unifi_overview.xml
│           ├── unifi_device_drilldown.xml
│           ├── unifi_client_drilldown.xml
│           ├── unifi_wifi_experience.xml
│           ├── unifi_audit.xml
│           └── setup.xml            # Setup page (SimpleXML + JS)
├── appserver/static/        # setup_macros.js / .css (Setup page logic)
├── lookups/
│   └── unifi_oui.csv        # IEEE OUI → vendor
└── metadata/default.meta    # global sharing (enrichment applies everywhere)
```

---

## 9. Changelog

**1.1.0**
- Device & Client drilldowns now use **multi-select** inputs (lookup-driven,
  `IN (...)`, default All); drilldowns pre-select the clicked entity.
- New **Setup page** that discovers indexes via search and writes the index
  macros on Save (no manual editing).
- **Auto-refresh** control on every dashboard (default Off).
- Richer syslog extractions: `severity`/`severity_rank`, `event_action`,
  `port`/`link_state`, `poe_*`, fan/temp (`device_temp_c`, `fan_rpm`,
  `fan_speed_pct`), and SSH login fields (`login_user`, `login_src_ip`,
  `login_result`).
- Device Drilldown rebuilt: software/firmware version, uplink throughput, fan &
  temperature, active ports/PoE, events-over-time, severity/event filters, and
  clustering by client / device / message.
- New **Auditing dashboard**: device SSH logins (who/where/when), port up/down
  history, config-change detection, errors/warnings timeline.

**1.0.2**
- Added app icons (the UniFi "U" mark) and a logo.
- Added a "Get UniFi syslog into Splunk (SC4S)" setup section.

**1.0.1**
- Fixed Overview "Devices offline" tile (each KPI now has its own data source;
  offline no longer mirrors the online count).
- Fixed drilldowns from Overview / WiFi Experience into the Device and Client
  drilldowns — corrected the `linkToDashboard` token schema (`token`/`value`)
  and the target dropdowns (proper search-populated `context`/`items` pattern,
  no `defaultValue` blocking the inbound URL token).
- Added "normal band" trend lines (same weekday+hour, prior 28 days, ±10%) to
  the clients-seen and WiFi-disconnects charts on the Overview.

**1.0.0**
- Initial release: enrichment lookups, syslog correlation, 4 dashboards.

## 10. Troubleshooting

- **Names not resolving on syslog** → run the two lookup generators; confirm
  `| inputlookup unifi_device_lookup` returns rows; confirm `unifi_index` macro
  matches where the TA actually writes.
- **No syslog events** → confirm `unifi_syslog_index` matches your SC4S index
  and `source`. Check `` `unifi_syslog` | stats count by sourcetype ``.
- **Dashboard panel empty** → widen the time range; some signals (kicks,
  failures) are bursty.
