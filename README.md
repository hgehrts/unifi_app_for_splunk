# UniFi App for Splunk (`unifi_app_for_splunk`)

Consolidated dashboards, syslog correlation and ID→name enrichment for UniFi
gear. **Companion app** to the data-collector add-on
[`TA_unifi_ng`](https://github.com/) (UniFi Network Add-on for Splunk).

It joins two normally-disconnected feeds into one investigable picture:

- **`TA_unifi_ng`** asset + telemetry (UniFi Integration API) → `index=unifi`
- **UniFi device syslog** via [Splunk Connect for Syslog (SC4S)](https://splunk.github.io/splunk-connect-for-syslog/) → `index=netops source=sc4s sourcetype=ubnt*`

UniFi syslog only carries cryptic MAC addresses. This app enriches those events
**at search time** with friendly device names, client names, IPs, model and the
client hardware vendor — so you read `U7DG kicked Sigitas-iPhone (Apple, Inc.) —
Low RSSI` instead of `942a6f4877f1 … kick-sta … reason:Low RSSI`. It then ships
**four linked Dashboard Studio dashboards** for fleet health, root-cause analysis
and per-device / per-client drilldown.

> Built and tested on Splunk Enterprise 10.x (10.4) against UniFi Network 10.4.

---

## Highlights

- **Auto-refreshing KV Store lookups** (device + client) built from the TA's
  asset data; cryptic IDs resolve to names/IP/MAC everywhere.
- **Search-time enrichment** auto-applied to the SC4S `ubnt*` sourcetypes
  (`device_name`, `client_name`, `client_vendor`, plus extracted `proc`,
  `wifi_event`, `kick_reason`, `rssi`, `stahtd_*`).
- **MAC-OUI vendor lookup** (bundled IEEE registry, ~39k rows).
- **Four dashboards** — Overview (with a "normal band" trend baseline), Device
  Drilldown, Client Drilldown, WiFi Experience & Roaming — all click-to-drilldown.
- **Index-agnostic** via two editable macros (`unifi_index`, `unifi_syslog_index`).

---

## Install

1. Download `unifi_app_for_splunk-<version>.tar.gz` from [`dist/`](dist/) or a
   GitHub Release.
2. Splunk Web → **Apps → Manage Apps → Install app from file** → upload → restart.
3. **Set the two index macros** for your environment (Settings → Advanced search
   → Search macros): `unifi_index` and `unifi_syslog_index`.
4. Run the two lookup-generating searches once (or wait for the 15-minute
   schedule): *unifi - rebuild device lookup*, then *unifi - rebuild client
   lookup*.

Full setup, including getting UniFi syslog into Splunk via SC4S, is in the in-app
[`unifi_app_for_splunk/README.md`](unifi_app_for_splunk/README.md) and
[`docs/companion-app.md`](docs/companion-app.md).

### Prerequisites

- Splunk 9.x or 10.x, KV Store enabled.
- The **`TA_unifi_ng`** add-on installed and collecting.
- UniFi device syslog reaching Splunk via SC4S (`ubnt*` sourcetypes).

---

## Dashboards

| Dashboard | Purpose |
|-----------|---------|
| **UniFi – Overview** | Online/offline, clients-seen and WiFi-disconnects vs a same-weekday/hour ±10% "normal band", top kick reasons, problem devices, noisiest clients. Click to drill down. |
| **UniFi – Device Drilldown** | One device: asset, CPU/memory, connect/disconnect/kick timeline, its clients, full syslog. |
| **UniFi – Client Drilldown** | One client across the fleet: identity + vendor, APs touched, roaming spread, RSSI, full syslog. |
| **UniFi – WiFi Experience & Roaming** | Fleet-wide wireless RCA: kicks by AP, association failures, low-RSSI kicked clients, roaming churn, TX-retry by AP. |

---

## Build from source

The ready-to-install app is committed under
[`unifi_app_for_splunk/`](unifi_app_for_splunk/).

```bash
./build.sh            # -> dist/unifi_app_for_splunk-<VERSION>.tar.gz (+ .sha256)
./build.sh 1.0.3      # override version label
```

---

## Repository layout

```
unifi_app_for_splunk/   Ready-to-install Splunk app (this is what ships)
dist/                   Prebuilt release tarball + SHA-256
docs/                   Companion-app docs, correlation design, syslog analysis
build.sh                Package the app into dist/
LICENSE                 Apache-2.0
```

---

## Security

- This app issues only **read** searches against your data and **writes only its
  own KV Store lookups**. It does **not** modify any UniFi controller settings.
- The companion app stores no credentials. (The TA stores its API key encrypted.)
- Do not commit `local/`, `passwords.conf`, or any secrets — see `.gitignore`.

---

## License

Apache-2.0 — see [LICENSE](LICENSE).

> Not affiliated with or endorsed by Ubiquiti Inc. or Splunk LLC. "UniFi" is a
> trademark of Ubiquiti Inc.; "Splunk" is a trademark of Splunk LLC.
