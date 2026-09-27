# Homey Energy and Wallbox Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the user's approved six stages: reliable widget commands, correct Flow/device control, compatible voltage and charging modes, truthful diagnostics, resilient disconnect-based energy accounting, and timer Flow control.

**Architecture:** Preserve Homey SDK v3 and existing device/Flow identities. A per-device serialized control service coordinates physical writes and Homey/V2C ownership; the widget and legacy Flow actions reuse that service. Polling supplies valid versioned snapshots; EnergyManager continues its disconnect-only settlement model with durable retry behavior.

**Tech Stack:** CommonJS JavaScript, Homey Apps SDK v3, Homey Compose, Node.js 22 built-in tests, vanilla widget HTML/JS.

**Spec:** User-approved business plan in this conversation; current baseline and reproduction evidence in `docs/audits/2026-09-27-main-consolidation.md`. Latest steering: user has tested LogoLED; preserve it. Homey Energy reference: https://apps.developer.homey.app/the-basics/devices/energy.

## Global Constraints

- Base commit `d9f4b06`; app currently `2.0.4`; compatibility stays `>=12.13.0`, SDK `3`, driver class `evcharger`, `energy.evCharger=true`, imported energy capability `meter_power`.
- System `measure_power` remains measured nonnegative charging W for this unidirectional device; `meter_power` remains cumulative imported kWh. Do not replace them with custom capability definitions or reset valid stored lifetime totals.
- `target_power_mode='homey'`: Homey controls power, V2C dynamic control is disabled. Every non-`homey` strategy delegates power control to V2C; ignore Homey power changes while such a strategy is active. Homey's Set target power card supplies a combined mode/power/charging batch.
- Explicit manual Stop wins over a simultaneous positive target. Keep a paused Homey target for the next start. Handback to V2C discards Homey target and resumes only a pause known to have been imposed by Homey's zero-power idle, never a known manual pause. Start must not silently unlock, disable Timer, or change charging strategy.
- Keep existing Flow IDs, argument names, tokens, and released enum values. `calculate_power_with_buffer` and `compare_calculated_current` remain pure input-based helpers with no device IO. `set_power` intentionally calculates from explicit inputs and writes Intensity; `set_energy_counter` modifies app statistics only.
- Preserve tested `set_led_brightness` behavior: LogoLED brightness 0..100 and `both` sequential writes remain supported. Do not replace the logo with a boolean based only on the HTTP table.
- Do not blindly swap DynamicPowerMode codes 2/3 or migrate saved choices. Change numeric mapping only if firmware-specific primary evidence confirms it; otherwise preserve codes and report unresolved discrepancy. Deprecated code 1 stays supported for existing installations.
- Keep valid old energy totals and disconnect-only settlement. A final disconnect sample may supplement an already observed session, but repeated disconnected polls must not resurrect/settle the old counter. Do not synthesize historical corrections.
- Implementation workers make no live wallbox writes or deployments. Firmware-specific verification may use the coordinator's read-only firmware 2.5.1 recording; do not invent hardware-tested claims. The user additionally authorized Homey CLI installation and runtime testing on Homey "Doma" after implementation and final review, with pairing and stores preserved (no clean install).
- All implementation and review subagents use `gpt-6-luna`, effort `max`, as requested. One implementation agent at a time; scoped independent research/reviews may run in parallel. No subagents spawned by workers.

## Review Focus

- Concurrent Homey setpoint/Stop and Homey-to-V2C handoff: manual pause remains, V2C receives no Homey Intensity, owner change does not apply a stale target.
- Widget requests finishing out of order or command failure: explicit intent, latest response wins, visible error, no false start confirmation.
- Two devices and stale device selection: exact selected device or explicit error, never first-device fallback for an invalid explicit selection.
- Storage/capability failures and restart: energy journal replay remains idempotent, dirty pending sample can be retried, displayed lifetime matches accepted store value.
- Missing/invalid/fault telemetry and IP replacement: stale data is marked, null is not invented zero, old in-flight operations cannot publish into a new/deleted device session.

## Task 1: Shared device control and Homey ownership contract

**Files:** Create `lib/ChargerControl.js`, `test/charger_control.test.js`; modify `drivers/v2c-wallbox/device.js`, `drivers/v2c-wallbox/FlowCardManager.js`; add focused Flow tests to `test/flow_contracts.test.js` and adapt existing phase tests where public routing changes.

**Interfaces:** `ChargerControl(device)` owns a Promise control queue. Device exposes `setChargingPaused(paused)`, `applyChargingChanges(values)`, `setDynamicPowerMode(mode)`, `setIntensityLimit(kind, amps)`, `setChargingIntensity(amps)` as async operations backed by that queue. `kind` is `'min'|'max'`; mode retains legacy `'disabled'` and `'0'..'5'`. Preserve old API convenience methods. `getChargingVoltage()` supplies valid matching live voltage, otherwise matching configured installation voltage, otherwise 230 V L-N / 400 V L-L. Later widget/Flow tasks consume these methods, never private queue state.

- [ ] Write failing behavior tests before implementation: combined Stop/6000W never emits Paused=0; paused target change stays paused; explicit resume sets Intensity before Paused=0; failing Intensity leaves paused; V2C strategy ignores power-only change; Set target power combined batch enters Homey control; handback discards target, releases only a persisted known Homey-idle pause; manual pause persists across handback/restart; negative/invalid power never starts unidirectional charging; L-L absent voltage uses 400V; independent calculators perform no reads/writes; two initialized devices route actions/conditions to args.device; threshold conditions use args.power.
- [ ] Run `node --test test/charger_control.test.js test/flow_contracts.test.js` and record expected RED failures. If files need Homey fixtures, use minimal mock module loading pattern from existing tests; assert real production decisions/writes, not just mock call count.
- [ ] Implement control queue and ownership/intent behavior. Register shared Flow handlers once for each Homey flow manager (no last-device closure); device-dependent handlers resolve args.device. Fix only named dynamic/min/max setter effects, power conditions, pause/current/phase routing. Pure calculators retain existing explicit inputs/rounding and tokens. Existing callers without args.device in legacy unit fixtures should be updated to match actual Compose device arguments rather than introducing arbitrary fallback.
- [ ] Persist known Homey idle-pause provenance after successful zero-target pause and clear it on successful explicit manual intent. A failed metadata write must not claim an unexecuted ownership action succeeded. Do not reapply measured Intensity as a desired Homey target on every poll; preserve accepted desired target while Homey owns control, and clear/discard it on deliberate handback.
- [ ] Keep target_power zero-inclusive options and 500ms multi-capability batching; update options only on initialization/configuration changes, never every sample. Honor effective configured/reported amp limits and physical minimum without over-requesting at low target. Do not introduce mixed automatic phase switching.
- [ ] Run `node --test`, inspect changed contracts, and commit. Report RED/GREEN output, decisions, exact new interfaces, and any source ambiguity.

## Task 2: Widget commands, synchronization, and exact device selection

**Files:** Modify `widgets/wallbox-status/api.js`, `widgets/wallbox-status/public/index.html`, `widgets/wallbox-status/widget.compose.json`, and `app.js`; create `test/widget_api.test.js`, `test/widget_frontend.test.js`. Create a small shared widget selection helper only if justified by documented SDK resolver.

**Interfaces:** Existing `/status` and `/paused` endpoints stay. `/paused` body contains explicit `paused:boolean` and selected `deviceId`; calls `device.setChargingPaused(paused)`. `/status` retains old fields and adds physical EV state, known locked/timer/mode/fault flags and last-valid/stale metadata from device. A missing selection may fall back only when exactly one device exists; explicit unknown/deleted ID is an error. Use the documented SDK resolver discovered by research; do not use private fields or invent getId() if unavailable.

**Resolver decision:** Replace the built-in widget device picker with app-owned autocomplete, registered through `homey.dashboards.getWidget('wallbox-status').registerSettingAutocompleteListener`. Suggestions carry the app pairing key in their documented `id` field; frontend reads it through `Homey.getSettings()` and backend resolves `driver.getDevice({id: key})`. This avoids adding broad `homey:manager:api` permission to resolve Homey-managed IDs. Existing widgets without the new selection may fall back only when exactly one wallbox is paired; multiple-device installations require visible reselection guidance. An explicit invalid pairing key never falls back.

- [ ] Write failing tests for two-device selection, invalid explicit selector, legacy no-selector single device, malformed command body, and delegation that leaves ownership/lock/timer untouched. Frontend VM/DOM tests reproduce old GET after command, repeated Start, failed POST, and refresh already in flight.
- [ ] Verify RED via `node --test test/widget_api.test.js test/widget_frontend.test.js`.
- [ ] Make Start/Pause explicit idempotent intents derived from the rendered action, not inversion of a new GET. Disable control while command is pending, invalidate pre-command responses, guarantee a fresh response after command, and show command/error/pending state. A successful write with unavailable confirmation must be shown as unconfirmed, not falsely physically charging. Preserve dashboard layout/branding and resize behavior.
- [ ] Display physical charging separately from permission to charge. Show known flags such as locked or timer active without claiming they uniquely explain no consumption. Never automatically remove those settings. Refresh after visibility return and recover after initial load error.
- [ ] Consume device freshness metadata from Task 4 when available; handle baseline absence safely until that task lands. Run full tests and commit.

## Task 3: Truthful telemetry, API failures, and fault representation

**Files:** Modify `lib/DataValidator.js`, `lib/constants.js`, `drivers/v2c-wallbox/api.js`, `drivers/v2c-wallbox/device.js`, `drivers/v2c-wallbox/driver.flow.compose.json`, `drivers/v2c-wallbox/FlowCardManager.js`; create `test/telemetry_api.test.js`, extend focused device tests.

**Interfaces:** Processed telemetry represents absent optional numeric signals as null; required finite ChargePower/ChargeEnergy/Intensity and known ChargeState remain validated. FirmwareVersion is optional diagnostic. Boolean parsing accepts booleans, 0/1, `'0'/'1'`, `'false'/'true'` explicitly, rejects unexpected control values instead of assuming true. ChargeState preserves documented 0/1/2/4/5/6; undefined state 3 must fail closed or remain explicitly unknown, never healthy/disconnected. Missing installation voltage remains unavailable rather than an invented 230 V reading; valid supported 415 V is accepted. Device exposes a fault descriptor for widget and standard `alarm_generic` if a capability is added/migrated. Do not invent additional EV-state enum values unsupported by Homey.

- [ ] Write/RED tests for HTTP503 JSON, missing FirmwareVersion, control strings, missing House/FV/Battery/Signal and phase values, NaN/Infinity, fault states4/5/6. Fault must not be normal idle/plugged_out or trigger disconnected energy settlement; actual prior connected/charging state can remain only with explicit fault/unknown display, not a claimed healthy state.
- [ ] Check HTTP status before accepting JSON. Maintain success/error accounting at the valid snapshot level; malformed data is an error for freshness. Preserve 150ms request spacing and serial HTTP queue; session probe uses same serialization. No automatic retry of uncertain writes.
- [ ] Preserve null/unavailable across capabilities (including clearing a previously populated absent phase value); do not invent battery readings from an undocumented key. Keep system Homey power/meter contracts and old valid firmware payload compatibility.
- [ ] Expose fault indication and declare typed error tokens for existing slave-error trigger, distinguishing error code from description. Existing trigger ID stays. Fault handling never auto-starts or clears lock.
- [ ] Review DynamicPowerMode primary evidence before changing anything. Preserve user's verified LED contract. If codes cannot be verified, document discrepancy without silently swapping runtime codes. Run full tests, regenerate app.json with Homey CLI once no other mutation runs, and commit.

## Task 4: Freshness, polling lifecycle, and connection repair

**Files:** Modify `drivers/v2c-wallbox/device.js`, `drivers/v2c-wallbox/driver.js`, `lib/ip_validator.js`, `lib/constants.js`; create `test/polling_lifecycle.test.js`, `test/repair_ip.test.js`.

**Interfaces:** `getProductionData({force=false,throwOnError=false})` shares one in-flight fetch; force bypasses cache and ensures post-command freshness. Timeout (6000ms) remains distinct from TTL. Device exposes `getStatusMetadata()` with `lastUpdated:number|null`, `stale:boolean`, `connectionError:boolean`, `fault` as supported by Task3. Freshness threshold derives from intended interval plus bounded request time; offline display is independent from growing retry interval. `reconnectWallbox(ip)` is the shared Repair/settings path, retains device identity/history, invalidates old generations, restores listeners/timer once if initialization previously lacked a valid IP.

- [ ] Write/RED tests for 5-second charging ticks not swallowed by 6-second TTL; concurrent regular/forced read coalescing without losing post-write refresh; repeated invalid snapshots become stale; request failure marks stale promptly while preserving backoff; success restores availability; poll released after delete/IP swap never publishes; Repair creates live new client; invalid-IP init repair restores runtime; `010.0.0.1` rejected rather than reinterpreted.
- [ ] Separate timeout/cache/availability, mark valid successful sample time only after validation and successful applicable publication, and expose status metadata to widget. Preserve adaptive retry up to 5 minutes and avoid duplicate poll loops.
- [ ] Add generation/disposal guards and handle timer promise rejection safely. Do not null dependencies that in-flight cleanup/error paths still need. Reconnect path is explicit; programmatic setSettings is not treated as invoking onSettings. Canonical private IPv4 validation is used consistently for pairing, settings, and Repair; preserve identity.
- [ ] Run full tests; commit.

## Task 5: Durable disconnect energy and error recovery

**Files:** Modify `lib/EnergyManager.js`, `test/energy_manager.test.js`; extend device integration tests only where needed.

**Interfaces:** Preserve processEnergyData, pendingSessionEnergy, settlement transaction absolute targets and queue, all public counter methods, and disconnect-only meter behavior. Add persistent session tracking fields only with backward-compatible initialization and documented migration. Monthly store gains a year field without erasing valid same-period totals.

- [ ] Write/RED tests: connected .20 then first disconnected .40 settles .40 once; repeated stale disconnected .40 adds nothing; restart with pending session settles once; failed pending store is retried on same next sample; failed lifetime capability write keeps accepted store/memory consistent and retry restores display; failed counter mutation doesn't allow later settlement replay to overwrite correction; month same number new year resets; direct upgrade valid totals remain.
- [ ] Handle valid final sample only as a supplement to an already active/pending session or its durable settlement journal. Repeated disconnected samples cannot create a new session. Validate energy samples against finite/nonnegative limits and accepted last raw reading.
- [ ] Maintain separate last raw reading / accepted segment accounting if reset handling is supported by evidence. Distinguish an out-of-order lower reading from a counter reset: do not add every decrease as a new segment. If no stable reset discriminator exists, persist uncertainty and report it; keep the current conservative maximum for ambiguous input. Tests pin confirmed reset evidence rather than assuming every 5->0->3 sequence is a physical reset.
- [ ] Make pending persistence failures retryable, and accepted counter store/memory changes consistent even when capability publication fails. Keep durable absolute-target replay and the common mutation queue. Do not seed lifetime from resetting annual counters or rewrite historic sums.
- [ ] Run full tests plus restart/failure scenarios, commit, document actual guarantees and any unavoidable offline uncertainty.

## Task 6: Timer Flow control and release integration

**Files:** Modify `drivers/v2c-wallbox/device.js`, `drivers/v2c-wallbox/FlowCardManager.js`, `drivers/v2c-wallbox/driver.flow.compose.json`; add `test/timer_flow.test.js`; update `.homeycompose/app.json`, `.homeychangelog.json`, `docs/homey-energy-and-flows.md`, `docs/http-api-coverage.md`, and generated `app.json`.

**Interfaces:** Device `setTimerEnabled(enabled:boolean)` uses serialized explicit `Timer=0/1` write and forced state refresh. New action `set_timer` has argument `enabled` dropdown `'1'|'0'`; new condition `timer_is_enabled` reads selected device timer_state. These toggle existing V2C plans only. They never change owner, current target, manual pause or lock.

- [ ] Write/RED tests for two-device timer routing, enable/disable writes and readback, failure propagation, condition knowntrue/false and unknown, and no hidden changes to Dynamic/Intensity/Paused/Locked.
- [ ] Implement new Flow cards with English/Czech titles/hints and update docs: timer enabled does not prove schedule currently permits charging; phase telemetry already exists; LogoLED tested 0..100 remains.
- [ ] Route the existing writable `timer_state` capability listener through the same public `setTimerEnabled` method, so its declared control performs the actual write and propagates failures. No additional widget Timer control or scheduling editor.
- [ ] Release metadata version `2.1.0` for repairs plus new timer actions, clear changelog; retain compatibility >=12.13.0. Do not create/push a release tag or publish to Homey Store automatically.
- [ ] Run `node --test`, `homey app build`, then `homey app validate --level publish` sequentially; syntax/JSON checks and generated manifest consistency. Build must not run concurrently with another compose/validate mutation.
- [ ] Commit. Supply task report and release notes with tested user-visible changes and firmware uncertainties.

## Task gates and final delivery

Every implementer reads only its task brief and global constraints, uses test-first RED/GREEN, commits the task, and writes its report in this plan's SDD workspace. A fresh LUNA6MAX reviewer checks spec and quality against an immutable review package. Fix important findings with reviewed follow-ups; do not expand into unrelated features. Final whole-branch review independently checks Homey/V2C ownership, energy preservation, Flow compatibility, widgets and firmware caveats.

After all tasks are green, deliver a concrete reviewable branch/PR unless existing user authorization clearly covers integration. The prior request to keep a finished main concerns the completed cleanup; it is not authorization to publish a new Homey Store version. No repeat approval during implementation. Record task commits, source decisions, verification and any remaining physical-device checks in durable progress notes.

After final review, use the already installed Homey CLI 4.2.0 with Windows x64 Node to install on the selected Homey "Doma", without `--clean`. Record the current app version, paired wallbox identity, Homey Energy capabilities, and stored counter values before and after installation; verify availability, firmware 2.5.1 telemetry, Flow registration, and widget status through supported interfaces. The user has now connected the car for testing: perform a brief actual Start/Pause test through the public Homey/widget control path and restore the original pause state. Keep the existing charging strategy, desired power/current, lock, phase, and timer settings throughout.
