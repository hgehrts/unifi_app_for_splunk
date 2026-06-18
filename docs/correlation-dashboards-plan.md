# Plan: Consolidated UniFi Dashboards + Syslog Correlation + Enrichment Lookups

**Status:** APPROVED — executing. Decisions locked 2026-06-18 (see §0a).
**Date:** 2026-06-18
**Author research:** live against production `splk` (Splunk 10.4.0) + community/forum research.

## 0a. Locked decisions

| # | Decision |
|---|----------|
| Q1 | **Auto-enrich** the SC4S `ubnt*` sourcetypes (search-time `LOOKUP-…` in the companion app) so names appear everywhere with zero user effort. |
| Q2 | Ship a **new companion app: `unifi_app_for_splunk`** (depends on TA `TA_unifi_ng`). TA stays a pure collector. |
| Q3 | Indexes are **macro-driven**: `` `unifi_index` `` and `` `unifi_syslog_index` `` (admin-editable). Pre-set to this environment: unifi data = `unifi`, syslog = `netops` (with `source=sc4s`). A **Docs/Setup** section documents how to change them. |
| Q4 | **KV Store lookups** with auto-refresh (scheduled `outputlookup`). |
| Q5 | **Dashboard Studio** for the new dashboards. |
| Q6 | Include **all UniFi gear** (APs, switches, gateway/UDM-SE). |
| Q7 | OK to **display personal client names** as-is. |
| Q8 | **Add MAC-OUI vendor lookup** for clients (bundled OUI CSV). |

Refinements from answers:
- §4 dashboards: entity filtering still uses click-driven **tokens**, but the
  index selection comes from the **macros** (not per-dashboard index inputs).
- §2c: implement **Option A** (auto `LOOKUP-…`) but anchored on the
  `` `unifi_syslog_index` `` macro for the generating/extraction context.
- Add client **`vendor`** via `unifi_oui_lookup` (OUI → manufacturer).

## 0. Goal (restated)

Make UniFi problems easy to spot and root-cause by consolidating **three data
sources that already exist on `splk`** into linked, drill-downable dashboards,
and by translating cryptic UUIDs into **device names / IP / MAC** everywhere.

The three sources (all already flowing on the production server):

| Source | Where | What |
|--------|-------|------|
| **Asset / config** | `index=unifi sourcetype=unifi:device`, `unifi:network`, `unifi:firewall:*`, … (TA 3.3.0) | inventory, names, IP, MAC, model, firmware, state |
| **Telemetry** | `index=unifi sourcetype=unifi:device:stats` (TA) | CPU, memory, load, uptime, uplink rates per device |
| **Syslog** | `index=netops source=sc4s sourcetype=ubnt / ubnt:wireless / ubnt:dns` (SC4S) | hostapd, stamgr, stahtd, wevent, kernel, mcad, dnsmasq events |

Both the TA (`index=unifi`) and SC4S (`index=netops`) are confirmed live with
~5 months of syslog retention.

---

## 1. The core problem: identifiers don't match across sources

This is the crux and must be solved first; everything else builds on it.

| Source | Device identifier | Client identifier |
|--------|-------------------|-------------------|
| TA asset/telemetry | `id` = **UUID** (`b5a020a2-6bd0-…`), plus `name`, `macAddress`, `ipAddress` | `macAddress`, `name`, `ipAddress` |
| Syslog (`_raw` prefix) | **device MAC, colon-stripped** (`942a6f4861a8`) + `host` = short name (`u7eg`) | `sta` / `mac` = **client MAC with colons** (`70:ee:50:26:53:0a`) |

### Verified join keys (from live data)

- **Device:** syslog `_raw` prefix MAC `942a6f4861a8` → normalize to `94:2a:6f:48:61:a8` → matches TA `unifi:device.macAddress`. The syslog `host` (`u7eg`) also matches TA `name` case-insensitively, but **MAC is the reliable key**.
- **Client:** syslog `sta`/`mac` (`70:ee:50:26:53:0a`) → matches TA `unifi:client.macAddress` directly.

### Confirmed examples

| syslog host | syslog devmac | TA name | TA mac | TA ip |
|---|---|---|---|---|
| terrasse | 9c05d67962c7 | Terrasse | 9c:05:d6:79:62:c7 | 192.168.1.37 |
| u7eg | 942a6f4861a8 | U7EG | 94:2a:6f:48:61:a8 | 192.168.1.145 |
| ap3abuero | 9c05d6736ae9 | AP3ABuero | 9c:05:d6:73:6a:e9 | 192.168.10.173 |

13 devices, 79 clients (all clients have names in the TA).

---

## 2. Enrichment lookups (the foundation)

Build **two automatic lookups** so every event — syslog or TA — gets friendly
fields (`device_name`, `device_ip`, `device_model`, `client_name`, `client_ip`)
without users ever touching a UUID or bare MAC.

### Why KV Store + scheduled generation (not static CSV)

KV Store is **`ready`** on `splk`. The inventory changes (new clients, renames,
DHCP IP changes), so the lookups must **auto-refresh from the live TA data**.
Plan: KV Store collections populated by a scheduled `outputlookup` search.

### 2a. Device lookup — `unifi_device_lookup`

Keyed on **normalized MAC** (lowercase, no colons) so it joins both the TA and
the syslog `_raw` prefix.

| field | source |
|-------|--------|
| `device_mac_nocolon` (key) | TA `macAddress` → `replace(lower(mac),":","")` |
| `device_id` | TA `id` (UUID) |
| `device_name` | TA `name` (trimmed) |
| `device_mac` | TA `macAddress` (canonical, with colons) |
| `device_ip` | TA `ipAddress` |
| `device_model` | TA `model` |
| `device_state` | latest TA `state` |

Generating search (scheduled, e.g. every 15 min):
```spl
index=unifi sourcetype=unifi:device
| stats latest(name) as device_name latest(macAddress) as device_mac
        latest(ipAddress) as device_ip latest(model) as device_model
        latest(state) as device_state by id
| eval device_id=id, device_name=trim(device_name)
| eval device_mac_nocolon=replace(lower(device_mac),":","")
| table device_mac_nocolon device_id device_name device_mac device_ip device_model device_state
| outputlookup unifi_device_lookup
```

A **second key** is also needed because syslog `stamgr`/`hostapd` device id is
the `_raw` MAC, but some dashboards group by `host` (name). We will also build a
small `host`→name reconciliation, but `device_mac_nocolon` is primary.

### 2b. Client lookup — `unifi_client_lookup`

Keyed on **MAC with colons** (matches syslog `sta`/`mac` directly).

| field | source |
|-------|--------|
| `client_mac` (key) | TA `macAddress` |
| `client_name` | TA `name` |
| `client_ip` | TA `ipAddress` |
| `client_type` | TA `type` (WIRED/WIRELESS) |
| `uplink_device_id` | TA `uplinkDeviceId` (→ which AP/switch) |

```spl
index=unifi sourcetype=unifi:client
| stats latest(name) as client_name latest(ipAddress) as client_ip
        latest(type) as client_type latest(uplinkDeviceId) as uplink_device_id
        by macAddress
| rename macAddress as client_mac
| outputlookup unifi_client_lookup
```

### 2c. Automatic application (`props.conf` LOOKUP-… on syslog sourcetypes)

So users never run a manual `| lookup`, attach the lookups at search time to the
syslog sourcetypes. Because syslog needs the MAC normalized first, we add a
small extraction + lookup chain. Two options to decide at build time:

- **Option A (calculated field + LOOKUP in our app):** add `EXTRACT`/`EVAL` for
  `device_mac_nocolon` (from `_raw` prefix) and `client_mac` (from `sta`/`mac`),
  then `LOOKUP-unifi_dev = unifi_device_lookup device_mac_nocolon OUTPUT device_name device_ip device_model` and
  `LOOKUP-unifi_cli = unifi_client_lookup client_mac AS sta OUTPUT client_name client_ip`.
  Applied via the app's `props.conf` targeting `[ubnt]`, `[ubnt:wireless]`, `[ubnt:dns]`.
- **Option B (macro):** ship `` `unifi_enrich` `` search macro users prepend.

Recommendation: **Option A** (automatic, zero user effort) — this directly
satisfies "users should see names along with the id".

> Note: these are **search-time** props additions on sourcetypes owned by SC4S.
> The TA app can still define `props.conf [ubnt]` stanzas (they merge globally),
> but we must ship them **exported globally** and document the dependency. If you
> prefer not to attach to SC4S sourcetypes, we fall back to Option B (macro).
> **Decision needed — see §8 Q1.**

---

## 3. Field extractions we need from syslog (search-time)

SC4S already extracts `bssid, radio, sta, vap, satisfaction_now, anomalies,
sc4s_*`. We add (in our app, search-time, no reindex):

| field | regex target | used for |
|-------|--------------|----------|
| `device_mac_nocolon` | `^(?<m>[0-9a-f]{12}),` | device join |
| `device_model_fw` | `^[0-9a-f]{12},(?<x>[^:]+):` | model/firmware context |
| `proc` | `: (?<proc>[a-zA-Z0-9_\-]+)(\[\d+\])?:` | daemon (hostapd/stamgr/…) |
| `sta` (already) / `client_mac` | hostapd `STA (?<m>[0-9a-f:]{17})`, stamgr `kick-sta-on (?<m>…)`, stahtd JSON `mac` | client join |
| `wifi_event` | hostapd `(disassociated|associated|authenticated|deauthenticated)` | disconnect analysis |
| `kick_reason` | `\(reason:(?<r>[^)]+)\)` | roam/kick RCA |
| `rssi` | `rssi:(?<rssi>\d+)` | RF analysis |
| `stahtd_*` | JSON fields `event_type, assoc_status, sta_dc_reason, *_delta` | association failure RCA |

These become a `props.conf`/`transforms.conf` set scoped to `ubnt*` sourcetypes.

---

## 4. Dashboards (Dashboard Studio, Splunk 10.4)

Four linked dashboards. **All built around tokens** so a click filters every
panel and every linked dashboard to the selected device / client / message.

### 4.1 `UniFi - Network Operations (Overview)`
The landing "is anything wrong?" board.

- KPI tiles: devices online/offline (TA state), total clients, **disconnects last 1h** (syslog), **kicks last 1h** (stamgr), avg device CPU/mem (telemetry), DNS errors.
- "Problem devices" table: device_name, model, state, CPU%, mem%, uptime, **disassoc count**, **kick count**, satisfaction — sorted by a composite health score. **Row click → drilldown token `device_name`/`device_mac`.**
- Timechart: disconnect & kick events across all APs (spot storms).
- Top noisy clients (most disassoc/roams) → click sets `client_mac`.
- All tiles use enriched names (no UUIDs).

### 4.2 `UniFi - Device Drilldown`
Opened by clicking a device. Input token: `device_mac` (+ `device_name`).
**Every panel filters to that one device**, across all three sources:

- Header: name, model, IP, MAC, firmware, current state, uptime (asset+telemetry).
- Telemetry timecharts: CPU%, memory%, load, uplink tx/rx (from `unifi:device:stats`).
- Syslog event timeline for this device (`device_mac_nocolon` match): disassoc, kicks, rrm-scans, reboots.
- "Clients on this AP": from syslog `sta` seen on this device's BSSIDs + TA `uplinkDeviceId` → client_name list. Click a client → Client Drilldown.
- Kick-reason breakdown (why this AP is kicking clients).
- Raw syslog (enriched) for this device, newest first.

### 4.3 `UniFi - Client Drilldown`
Opened by clicking a client. Input token: `client_mac` (+ `client_name`).
**Every panel filters to that one client:**

- Header: client_name, IP, type, current AP (uplink), vendor (MAC OUI optional).
- Roaming timeline: which AP/BSSID/VAP over time (from `wevent`/`stahtd`/hostapd) — **the key "why does my phone drop" view**.
- Disconnect/association events with reasons (`stahtd sta_dc_reason`, hostapd disassoc), association timing deltas (auth/dhcp/wpa) → shows slow-DHCP vs auth failures.
- Satisfaction / anomalies over time (`mcad satisfaction_now`, `anomalies`).
- RSSI over time (from kernel/stamgr).
- Raw enriched syslog for this client.

### 4.4 `UniFi - WiFi Experience & Roaming` (thematic RCA)
Cross-cutting analysis (not single-entity):

- Kick-sta heatmap by AP × reason (Low RSSI, load balance, other).
- Disassociation rate by AP and by SSID/VAP.
- Association failures (stahtd `soft failure`, `assoc_status!=0`) by AP/client.
- "Sticky client" finder: clients with many low-RSSI kicks (community's #1 issue).
- RRM scan frequency by AP (instability signal).
- DNS nameserver flapping (`ubnt:dns`).

### Drilldown token model (how clicks work)

```
Overview  --click device row-->  set tokens device_name, device_mac  --> Device Drilldown
Overview  --click client row-->  set tokens client_name, client_mac  --> Client Drilldown
Device DD --click client-------> Client Drilldown (client_mac)
Any panel --click message------> opens raw-events panel filtered to that entity+time window
```

In Dashboard Studio: each source-driving search keys off `$device_mac$` /
`$client_mac$` tokens; drilldown actions set tokens and/or link to the target
dashboard with URL params (`?form.device_mac=…`). Default token `*` shows all.

---

## 5. How Splunk beats the UniFi UI (research-backed)

Community's most common UniFi problems and the value Splunk adds:

| Problem (from forums) | Signal we have | Splunk advantage |
|---|---|---|
| Random client disconnects | `hostapd disassociated`, `wevent STA_LEAVE` | History + rate + per-client/AP trends; UniFi shows only "now" |
| Aggressive roaming/load-balance kicks | `stamgr kick-sta (reason:Low RSSI rssi:N)` | Surfaces the **reason + RSSI**, which the UniFi UI hides |
| Sticky clients / poor roaming | `stahtd` JSON, `kernel rssi:N` | Correlate roams across APs on one timeline |
| RF churn / auto-channel instability | `syswrapper Trigger rrm scan` | Find APs constantly re-scanning |
| PoE/power faults, reboots | telemetry uptime reset + device `state` flip + kernel | Cross-source confirmation of a reboot/flap |
| Slow/failed auth or DHCP | `stahtd` `wpa_auth_delta`, `ip_delta`, `sta_dc_reason` | Quantify *why* association failed |
| Client experience degradation | `mcad satisfaction_now`, `anomalies=tcp_latency` | Per-client satisfaction history + alerting |
| Device health | `unifi:device:stats` | Trend/alert CPU/mem; UniFi only shows a gauge |

This is the "where Splunk helps where UniFi can't": **historical correlation,
reason-level RCA, cross-source confirmation, alerting, and arbitrary pivots** —
versus UniFi's mostly real-time, single-pane, no-export view.

---

## 6. Where this ships

Two packaging options (**Decision needed — §8 Q2**):

- **A) Inside `TA_unifi_ng`** (add lookups, lookup-gen saved searches, props
  enrichment, dashboards to the existing app). Simplest for the user; one app.
  Risk: a collection TA now also owns syslog enrichment + dashboards.
- **B) New companion app `unifi_app_for_splunk`** (a "DA"/dashboard app) that
  depends on the TA. Cleaner separation (Splunk's TA-vs-app convention), and the
  syslog `props` enrichment lives in an app clearly scoped to search-time.

Recommendation: **B** — a companion app keeps the TA a pure data collector and
puts dashboards/lookups/enrichment where Splunk conventions expect them. It also
avoids touching the already-published TA repo's collection contract.

---

## 7. Build phases (proposed, after approval)

1. **Lookups + enrichment**: KV Store collections, two `outputlookup`
   generating saved searches (scheduled), `transforms.conf` lookup defs,
   `props.conf` field extractions + `LOOKUP-…` on `ubnt*`. Verify names resolve
   on live data. *(Foundation — everything else needs this.)*
2. **Overview dashboard** + health scoring.
3. **Device Drilldown** + token wiring from Overview.
4. **Client Drilldown** + roaming timeline.
5. **WiFi Experience & Roaming** thematic board.
6. **Optional**: saved searches/alerts (disconnect storm, AP reboot, sticky
   client, low satisfaction), CIM tags already exist from TA 3.3.0.

Each phase verified against `splk` live data using the `cursor` account.

---

## 8. Questions before building

1. **Enrich SC4S sourcetypes directly (Option A) or ship a macro (Option B)?**
   Auto-enrichment edits search-time props on `ubnt*` (owned by SC4S app); it
   merges cleanly and is global, but it's a cross-app touch. Macro is opt-in.
   *(Recommend A for "names everywhere with zero effort".)*
2. **Package as part of `TA_unifi_ng` or a new companion app?** (Recommend new
   companion app; §6.)
3. **Index assumptions:** TA data is in `index=unifi`, syslog in `index=netops`.
   Dashboards will take **index tokens** defaulting to those — OK? Any chance
   data moves indexes?
4. **KV Store vs CSV lookups:** KV Store is ready and supports auto-refresh.
   OK to use KV Store (recommended), or do you want simple committable CSVs
   (snapshot, manual refresh) for portability?
5. **Dashboard Studio vs Simple XML:** 10.4 supports Studio (nicer, better
   drilldown UX). The TA's existing 3 dashboards are Simple XML. Preference?
   *(Recommend Studio for the new linked drilldown dashboards.)*
6. **Scope of "devices":** include switches & the UDM-SE the same way as APs?
   (Syslog is AP-heavy; switches/gateway emit less but do appear.) Assume **all
   UniFi gear**.
7. **Client naming/privacy:** client names include personal device names
   (e.g. "Sigitas-iPhone"). Fine to display as-is in dashboards?
8. **MAC OUI vendor lookup** for clients (nice-to-have): add a vendor column via
   a bundled OUI lookup? Optional.

---

## 9. Research artifacts / evidence

- Live syslog structure (device MAC prefix, `host`=name, `sta`=client MAC),
  daemon mix (hostapd 32k, kernel 18k, wevent 12k, stamgr 7.5k, stahtd, mcad),
  `stamgr kick-sta (reason:Low RSSI)`, `stahtd` JSON association tracker.
- TA inventory join confirmed (UUID↔name↔mac↔ip) for all 13 devices, 79 clients.
- Community sources: UniFi disconnect/roaming guides (min-RSSI, band steering,
  802.11r/k/v, load-balance kicks), Wazuh-UniFi syslog rule set (disassoc
  flapping, RADIUS brute-force patterns) — informing the RCA panels.
- `splk`: Splunk 10.4.0, KV Store ready, netops retention ~5 months.

---

## 10. IMPLEMENTED & VERIFIED (2026-06-18)

Shipped as companion app **`unifi_app_for_splunk` v1.0.0** at
`companion/unifi_app_for_splunk/`. Installed and verified live on `splk`.

### Build
- `macros.conf`: `unifi_index` = `index=unifi`, `unifi_syslog_index` =
  `index=netops source=sc4s`, plus helper macros (`unifi_syslog`,
  `unifi_devices`, `unifi_clients`, `unifi_device_stats`, `mac_nocolon()`).
- `collections.conf`: `unifi_device_kv`, `unifi_client_kv`.
- `transforms.conf`: lookup defs (`unifi_device_lookup`, `unifi_device_by_id`,
  `unifi_client_lookup`, `unifi_oui_lookup`) + 11 syslog field extractions.
- `savedsearches.conf`: two scheduled lookup generators (device every :00/:15…,
  client offset by 5 min so uplink names resolve).
- `props.conf`: auto `REPORT-`/`LOOKUP-`/`EVAL-` on `ubnt`, `ubnt:wireless`,
  `ubnt:dns`.
- `lookups/unifi_oui.csv`: 39,572 IEEE OUI→vendor rows.
- 4 Dashboard Studio views + nav, `metadata/default.meta` global export.

### Live verification on `splk`
| Check | Result |
|-------|--------|
| App install + restart | OK (v1.0.0 enabled) |
| Device KV populated | 13 devices (APs, switches, UDM-SE) with name/mac/ip/model/state |
| Client KV populated | 94 clients with name/ip/type + uplink **device name resolved** |
| Syslog device-name enrichment | 100% of device MACs → friendly name (U7EG, HWR, …) |
| Syslog client-name + vendor | resolved (steamdeck/Apple, Sigitas-iPhone/Apple, Echo/Amazon, …) |
| RCA extractions | wifi_event, kick_reason, rssi, stahtd_event_type all populate |
| Dashboards | all 4 load server-side as Studio v2, JSON valid, every panel returns live data |

### Notable RCA findings already visible in the data
- A client (`Uconnect-`, WNC/Chrysler) kicked **179k+ times** at avg RSSI 13 —
  textbook sticky/driveway client.
- `HWR` AP shows fleet-low avg RSSI (~12) and the bulk of Low-RSSI kicks.
- Multiple iPhones/watch roaming across all 6 APs (roaming churn).
- `stahtd` `failure`/`soft failure` association errors quantified over time.

### Known environment limitation
- Browser screenshot of the rendered dashboards was **not** captured: Splunk Web
  on `splk` uses a self-signed cert that the headless browser (Playwright MCP)
  rejects (`ERR_CERT_AUTHORITY_INVALID`), and the MCP context's
  `ignoreHTTPSErrors` can't be toggled here. All dashboards were instead verified
  server-side (valid Studio v2 definitions) and by running every panel's SPL
  directly against live data.

### Decisions resolved
All 8 questions in §8 answered and implemented: auto-enrich (Q1), companion app
(Q2), index macros with docs (Q3), KV Store auto-refresh (Q4), Dashboard Studio
(Q5), all gear incl. switches/gateway (Q6), personal client names shown (Q7),
MAC-OUI vendor lookup added (Q8).
