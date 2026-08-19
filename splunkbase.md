# UniFi App for Splunk — Splunkbase listing content

Copy the sections below into the Splunkbase app listing fields (Short Description, Summary, Details, Installation, Troubleshooting), matching the structure used for [Whiteboard App](https://splunkbase.splunk.com/app/8908).

**Listing type:** app (visualization / dashboards)  
**Prerequisite add-on (separate listing):** [UniFi Network Add-on for Splunk](https://github.com/hgehrts/TA_unifi_ng) (`TA_unifi_ng`)

---

## Short Description

Dashboards, syslog correlation and ID→name enrichment for UniFi gear. Joins TA_unifi_ng asset data with SC4S syslog so cryptic MACs become readable names, IPs and vendors.

---

## Summary

UniFi App for Splunk is the companion to the UniFi Network Add-on for Splunk. It bridges two feeds that normally do not share human-friendly identifiers: structured asset and telemetry from the UniFi Integration API (via `TA_unifi_ng`) and device syslog via Splunk Connect for Syslog (SC4S). Auto-refreshing KV Store lookups resolve cryptic device and client IDs at search time; bundled MAC-OUI enrichment adds hardware vendor. Six linked Dashboard Studio views cover fleet health, topology, WiFi experience, auditing, and per-device / per-client drilldown. Index-agnostic via editable macros and an in-app Setup page.

---

## Details

### What it does

UniFi syslog events often contain bare MAC prefixes instead of device or client names. This app:

1. Builds **device** and **client** KV Store lookups from `TA_unifi_ng` asset events (scheduled every 15 minutes).
2. Applies **search-time LOOKUP** enrichment to SC4S `ubnt*` sourcetypes (`device_name`, `client_name`, `client_vendor`, plus extracted WiFi/syslog fields).
3. Ships **Dashboard Studio dashboards** that correlate asset, telemetry and syslog for RCA and drilldown.

Example: `942a6f4877f1 … kick-sta … reason:Low RSSI` becomes `U7DG kicked Sigitas-iPhone (Apple, Inc.) — Low RSSI`.

### Dashboards

| Dashboard | Purpose |
|-----------|---------|
| **UniFi – Topology** | Live map (clients → APs → switches → Dream Machine) with uplink throughput labels, error colouring, time-travel picker. *Optional: Network Diagram Viz app.* |
| **UniFi – Overview** | Online/offline, clients seen, WiFi disconnects vs a same-weekday/hour "normal band", top kick reasons, problem devices. |
| **UniFi – Device Drilldown** | Multi-select device view: asset, firmware, CPU/memory, uplink, fan/temperature, ports/PoE, clients, filtered syslog. |
| **UniFi – Client Drilldown** | Multi-select client view: identity, vendor, APs touched, roaming, RSSI, full syslog. |
| **UniFi – WiFi Experience & Roaming** | Fleet wireless RCA: kicks by AP, association failures, low-RSSI clients, roaming churn. |
| **UniFi – Auditing** | SSH logins, port up/down, config-change hints, errors/warnings timeline. |

All dashboards include auto-refresh and link to each other via drilldown tokens.

### Data and storage

| Component | Purpose |
|---|---|
| KV Store collections | Device and client lookup tables (written by scheduled searches in this app) |
| `lookups/unifi_oui.csv` | Bundled IEEE OUI registry (~39k rows) for vendor enrichment |
| Macros `unifi_index`, `unifi_syslog_index` | Point searches at your TA and SC4S indexes (defaults: `unifi`, `netops`) |

This app performs **read** searches against your data and **writes only its own KV Store lookups**. It does not modify UniFi controller settings and stores no credentials.

### Prerequisites

- **TA_unifi_ng** installed and collecting asset/telemetry into an index.
- UniFi device syslog reaching Splunk via **SC4S** as sourcetypes `ubnt`, `ubnt:wireless`, `ubnt:dns` (or your equivalent `ubnt*` sourcetypes).
- KV Store enabled (default on most deployments).

### Optional dependency

**Network Diagram Viz** — required only for the Topology dashboard. Declared as an optional dependency in `app.manifest`.

### External services

The app does not phone home and includes no product analytics.

### Compatibility

| Platform | Minimum version |
|---|---|
| Splunk Enterprise | 9.0+ (Dashboard Studio) |
| Splunk Cloud (Victoria) | 9.0+ |

Tested on Splunk Enterprise 10.x against UniFi Network 10.4.

### Roles and permissions

Any user who can access the app and run searches against the configured indexes can use the dashboards. Lookup rebuild searches need permission to write KV Store collections in this app's namespace. App installation requires `admin` or `sc_admin`.

### Source and license

- **Source code:** https://github.com/hgehrts/unifi_app_for_splunk
- **License:** Apache-2.0
- **Author:** Hans-Henning Gehrts

> Not affiliated with or endorsed by Ubiquiti Inc. or Splunk LLC.

---

## Installation

**Restart required:** Restart Splunk after install before opening dashboards.

### Splunkbase (Splunk Enterprise)

1. Install **UniFi Network Add-on for Splunk** (`TA_unifi_ng`) first and confirm data is flowing.
2. Log in to Splunkbase and download this app package.
3. **Apps → Manage Apps → Install app via upload** → restart.
4. Open **UniFi App for Splunk → Setup** (or **Settings → Advanced search → Search macros**) and set:
   - `unifi_index` — where `TA_unifi_ng` writes (default: `index=unifi`)
   - `unifi_syslog_index` — where SC4S writes UniFi syslog (default: `index=netops source=sc4s`)
5. Run the scheduled searches once: *unifi - rebuild device lookup* and *unifi - rebuild client lookup* (or wait ~15 minutes).

### Splunk Cloud

Upload via your Cloud app workflow. Ensure KV Store is available and macros/indexes match your deployment.

### Manual install

```bash
git clone https://github.com/hgehrts/unifi_app_for_splunk.git
cd unifi_app_for_splunk
./build.sh
# Produces dist/unifi_app_for_splunk-<version>.tar.gz

$SPLUNK_HOME/bin/splunk install app unifi_app_for_splunk-<version>.tar.gz -update 1 -auth admin:changeme
$SPLUNK_HOME/bin/splunk restart
```

### SC4S syslog (prerequisite for enrichment)

Configure UniFi devices to send syslog to SC4S. See [Splunk Connect for Syslog — Ubiquiti UniFi](https://splunk.github.io/splunk-connect-for-syslog/latest/sources/vendor/Ubiquiti/unifi/). Ensure events land with `ubnt*` sourcetypes in the index referenced by `unifi_syslog_index`.

---

## Troubleshooting

### Dashboards empty

- Verify `TA_unifi_ng` is indexing: `index=<unifi_index> sourcetype=unifi:device | head 1`
- Verify syslog is present: `index=<syslog_index> sourcetype=ubnt* | head 1`
- Check macros on the Setup page match your indexes.

### Enrichment not applied (still seeing raw MACs)

- Run lookup rebuild searches manually from **Settings → Searches, reports, and alerts**.
- Confirm KV Store collections exist: **Settings → KV Store collections** (app context `unifi_app_for_splunk`).
- Ensure syslog sourcetypes match `props.conf`/`transforms.conf` (`ubnt*`).

### Topology dashboard missing or error

Install the optional **Network Diagram Viz** app from Splunkbase, or use the other dashboards which have no extra dependency.

### Lookup rebuild failures

Check that the Splunk user running scheduled searches can read the TA index and write KV Store in this app. Review `_internal` logs for the saved search names.

### Getting help

- **Documentation:** https://github.com/hgehrts/unifi_app_for_splunk/blob/main/README.md
- **Issues:** https://github.com/hgehrts/unifi_app_for_splunk/issues
- **Contact:** hgehrts@splunk.com (or open a GitHub issue)
