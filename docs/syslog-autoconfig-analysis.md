# Analysis: a "Configure syslog reception" button in the TA

**Status:** ANALYSIS COMPLETE. **Decision: Option A** (ship clear setup docs; do
not automate controller config). See §3 / §4. The "Get UniFi syslog into Splunk
(SC4S)" steps are in the app README.
**Question:** Can the TA set the UniFi controller's remote-syslog destination via
an API call, so a user clicks *"Configure syslog reception"* after entering a
syslog destination, and the controller starts shipping syslog to Splunk (SC4S)?

**Short answer:** **Technically yes, but not with the API the TA uses today.**
The official **Integration API has no syslog/settings endpoints at all.** Syslog
config only exists in the **unofficial "Classic" controller API**, which uses a
**different authentication model** (username/password cookie session + CSRF),
not the `X-API-KEY` the TA uses. Adding this would mean bolting a second,
unofficial, write-capable API client (with stored admin credentials) onto a tool
that is currently a clean, read-only, officially-supported collector. That's a
meaningful change in risk profile — recommendation and options below.

---

## 1. Evidence

### 1a. The official Integration API cannot do it
Checked against the live controller's own OpenAPI spec
(the `integration-oas.json` OpenAPI snapshot shipped with the `TA_unifi_ng` repo), **UniFi Network API
v10.4.57**:

- Methods present: 41 GET, 12 POST, 9 PUT, 10 DELETE, 1 PATCH.
- Resource families: `countries`, `dpi`, `info`, `pending-devices`, `sites`.
- Paths containing `setting` / `system` / `admin` / `controller` / `logging` /
  `syslog`: **none**.
- The entire write surface is firewall / DNS / networks / ACL / wifi / vouchers /
  device & client *actions*. **No system or logging settings.**

So a button built on the API the TA already speaks (`X-API-KEY` →
`/proxy/network/integration/v1/…`) is **not possible**.

### 1b. Syslog config lives only in the Classic (private) API
Syslog is a **site setting** (`rsyslogd`) reachable only via the legacy controller
API. Confirmed by the Ubiquiti Community Wiki and three independent tools
(Terraform `filipowm/unifi`, Pulumi `unifi.setting.Rsyslogd`, PowerShell `UNIFI`),
all requiring **controller 8.5+** and **session auth**:

- Read: `GET /api/s/{site}/rest/setting` → returns all settings incl. the
  `rsyslogd` object and its `_id`.
- Write: `PUT /api/s/{site}/set/setting/rsyslogd/{_id}` with the full object.

`rsyslogd` object fields:

| Field | Type | Meaning |
|-------|------|---------|
| `enabled` | bool | remote syslog on/off |
| `ip` | string | syslog server IP |
| `port` | int (1–65535) | syslog port (e.g. 514, 1514) |
| `contents` | []string | `device`, `client`, `firewall_default_policy`, `triggers`, `updates`, `admin_activity`, `critical`, `security_detections`, `vpn` |
| `log_all_contents` | bool | send all content types |
| `debug` | bool | debug logging |
| `this_controller` | bool | use the controller itself as the syslog server |
| `this_controller_encrypted_only` | bool | encrypted-only to this controller |
| `netconsole_enabled` / `netconsole_host` / `netconsole_port` | | kernel netconsole target |
| `_id` | string | **required in the PUT path** |

### 1c. On this environment (UDM-SE / UniFi OS) the Classic API needs more
The controller here is a UDM-SE (UniFi OS), so the Classic API differs from a
standalone controller:

- Auth: `POST /api/auth/login` with `{username, password}` → session **cookie**
  **and** an `X-CSRF-Token` (returned in the login response headers).
- Path prefix: every Classic call is under **`/proxy/network`**, e.g.
  `https://<udm>/proxy/network/api/s/default/rest/setting`.
- Write/state-changing calls (the `PUT … set/setting/…`) require the
  **`X-CSRF-Token`** header and a **Super-Admin** account.

So the credentials needed are **full controller admin** (username/password), not
the scoped, read-only **API key** the TA stores today.

---

## 2. Why this is a real design decision, not just "add an endpoint"

| Dimension | TA today | With a syslog-config button |
|-----------|----------|------------------------------|
| API used | Integration API (official, GA, `X-API-KEY`) | + Classic API (unofficial, may change/break) |
| Operations | **GET only** (read-only) | + a **write** (`PUT set/setting`) that mutates controller config |
| Credentials | Scoped API key, encrypted | + **admin username/password** (Super-Admin), encrypted |
| Blast radius | Cannot change anything | Edits a global site setting; a malformed `rsyslogd` PUT can disable logging or (because the PUT replaces the object) drop other fields if not round-tripped carefully |
| Splunk app vetting | Clean read-only collector | Write actions + stored admin creds → harder AppInspect / security review |
| Failure modes | Auth/timeouts only | CSRF expiry, session handling, UniFi OS vs standalone path differences, version drift of an unofficial API |

The feature is genuinely useful (one-click closes the loop: "I added a syslog
destination → make the controller send to it"), but it crosses the line from
*observer* to *controller-configurator*, and it depends on an **unofficial** API
with **admin** creds. That should be a conscious choice.

---

## 3. Options (no work done yet — pick one)

### Option A — Don't automate; ship clear instructions (lowest risk)
Add a short "Enable UniFi syslog → Splunk (SC4S)" doc section + a copy-paste path
in the UI (Settings → System → Logging in the UniFi console, or SC4S). Zero new
attack surface, nothing unofficial, always works.
**Recommended default**, especially for a public/AppInspect-able release.

### Option B — One-click button via the Classic API, in the **companion app**
Implement the "Configure syslog reception" action as a **custom REST handler /
setup action in `unifi_app_for_splunk`** (not the collector TA), so the
read-only TA stays pristine:
1. New, separate stored credential: controller **admin user/password** (encrypted
   via `storage/passwords`), clearly labelled "write access — optional".
2. Handler flow: `login → GET rest/setting (grab rsyslogd + _id) → merge user's
   ip/port/contents into the existing object → PUT set/setting/rsyslogd/{_id}
   (with X-CSRF-Token) → logout`. **Round-trip the full object** so no fields are
   lost.
3. UI: a form (syslog IP/port, content checkboxes) + a "Configure" button +
   a "Test / read current" button that just shows the current `rsyslogd`.
4. Guardrails: explicit confirm dialog ("this changes your controller config"),
   dry-run/preview of the JSON to be sent, and a clear "unofficial API" note.

Effort: moderate (new handler, session+CSRF auth, settings round-trip, UI form).
Risk: medium (unofficial API, admin creds, write op) — contained to the companion
app and opt-in.

### Option C — Hybrid
Ship Option A now (docs), and offer Option B later as an **opt-in** advanced
feature behind a config flag, only if there's demand. Keeps the first public
release clean.

---

## 4. Recommendation

1. For the imminent public release: **Option A** (docs only) — keep the TA
   read-only and officially-supported; add a crisp syslog-setup section.
2. If you want the one-click experience: **Option B in the companion app**, as an
   explicitly opt-in feature with its own admin credential and a preview/confirm
   step — never in the read-only collector TA.

I did not implement anything. If you choose B (or C), I'll write a focused build
plan (handler, auth, settings round-trip, UI, guardrails, test on the UDM-SE)
before touching code.

---

## 5. References

- UniFi Integration API spec: `_ref/integration-oas.json` in the `TA_unifi_ng` repo (v10.4.57)
- Ubiquiti Community Wiki — controller API & `rest/setting`: <https://www.ubntwiki.com/products/software/unifi-controller/api>
- Terraform `unifi_setting_rsyslogd`: <https://registry.terraform.io/providers/filipowm/unifi/latest/docs/resources/setting_rsyslogd>
- Pulumi `unifi.setting.Rsyslogd`: <https://www.pulumi.com/registry/packages/unifi/api-docs/setting/rsyslogd/>
