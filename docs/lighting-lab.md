# Lighting Lab

Lighting Lab is the experimental, host-driven lighting area in
`personaliserKeyboard`. Its first effect, **Concurrent Reactive Ripple**, turns
physical matrix transitions into independent waves while the app remains open.
It does not add an effect to keyboard firmware.

## Safety contract

Lighting Lab separates three operations that have very different risk profiles:

1. **Preview** computes frames locally and renders them with VIA's existing
   keyboard renderer. It does not require per-key RGB support.
2. **Matrix input** polls the documented VIA switch-matrix command and derives
   explicit `down` and `up` transitions. The first response is only a baseline,
   so opening the Lab cannot synthesize presses.
3. **Live output** is available only after the current definition supplies an
   unambiguous LED mapping and a reversible, temporary per-key color probe
   succeeds. A failed or incomplete probe leaves preview running and disables
   device writes.

The animation path never calls `saveLighting`, `commitCustomMenu`, or another
persistent-save operation. It never sends the proprietary matrix-animation
commands found in vendor forks. Unknown capabilities remain unknown rather than
being guessed.

## Architecture

The implementation has deliberately separate responsibilities:

- `engine.ts` is a pure, deterministic time-based ripple engine.
- `matrix-transitions.ts` compares matrix snapshots and emits `down`/`up`.
- `matrix-state-source.ts` shares one polling source per connected keyboard.
- `mapping.ts` maps `row/col` to an active VIA key, its physical center, and its
  optional `li` LED index. Matrix, key, and LED indices are never conflated.
- `frame-diff.ts` suppresses unchanged colors and can group contiguous LED
  indices when a proven protocol supports batching.
- `latest-frame-writer.ts` permits one in-flight device frame and retains at
  most one newer pending frame. Intermediate stale frames are replaced.
- `per-key-device.ts` captures, probes, writes, measures, and restores only
  through the understood temporary hue/saturation commands.
- `lighting-lab.tsx` owns scheduling, controls, status, preview, and teardown.

The selected layout's active keys are used, including option keys such as an ISO
Enter. Physical centers account for key size and rotation. Missing or duplicate
matrix/LED mappings are surfaced as capability reasons instead of silently
falling back to `matrixIndex === ledIndex`.

## Concurrent Reactive Ripple

Each physical `down` transition appends a new immutable ripple containing its
own identifier, origin, `startedAt`, duration, and RGB color. Progress is derived
from `(now - startedAt) / durationMs`, never from a frame counter.

For every LED, the engine computes the distance from each active origin,
normalizes it by the keyboard diagonal, evaluates a smooth wave band and
end-of-life fade, then combines overlaps deterministically. Preview-only mode
uses a bounded screen blend over black; after a hardware background is
captured, the engine uses bounded background-to-active-color interpolation.
Completed ripples are pruned individually.

Adding a second ripple cannot rewrite the first ripple. If A starts at `0 ms`
and B at `200 ms`, evaluation at `300 ms` sees A at `300 ms` and B at `100 ms`.
If the safety cap is reached, the newest attempted ripple is rejected; existing
unfinished ripples are not reset or evicted.

## Scheduling and backpressure

Preview frames follow `requestAnimationFrame`. Device output starts with a
15 FPS target, but its actual ceiling is recalculated from the measured
count=1 command latency, a worst-case write count equal to the mapped LED
count, and a 1.5× safety margin. The scheduler uses that measured interval and
sends only colors whose channel difference crosses the configured threshold.
Runtime metrics distinguish the calculated safe ceiling from write-bearing
frames and actual HID commands per second; no-diff frames are not reported as
device throughput.

Device output is serialized through VIA's existing HID command queue. Lighting
Lab adds bounded backpressure before that queue: one frame may be in flight and
only the newest waiting frame is retained. Stopping first prevents new work and
closes the temporary session, which immediately reserves all restore commands
behind the one active VIA command. The Lab then drains that command and awaits
the best-effort restoration, so a later user command in another pane is queued
after the restore transaction rather than overwritten by it.

The Lab stops on component unmount, selected-device change, disconnect/error,
permission loss reported as a HID error, or when the document becomes hidden.
No timer, animation frame, subscriber callback, or queued Lab frame is allowed
to continue after teardown.

## Color-channel limitation

The per-key API currently understood by this app reads and writes only hue and
saturation. It has no proven per-LED value/brightness byte. Preview-only mode
uses a screen blend over black. Once live colors have been captured, both the
preview and hardware frame instead interpolate from each captured background
color toward the active ripple color; this keeps a visible hue/saturation
change even on a white background without inventing a value channel. Live mode
then converts changed colors to the supported channels and preserves all
captured values needed for a best-effort restore. Batch `count > 1` remains
disabled until firmware documentation or a controlled hardware test proves it.

If temporary `set` does not visibly apply without a save, live streaming is
classified unsafe and remains disabled. The Lab will not trade EEPROM safety
for a false live result.

## EVO75 status

The official VIA definition set still does not advertise the EVO75 at
VID:PID `36B0:311E`. `personaliserKeyboard` now carries the exact vendor V3
definition as a validated local fallback. Its provenance, immutable matching
source and SHA-256 are recorded in `src/definitions/README.md`. A sideloaded
user definition remains higher priority, and a future valid official definition
supersedes the fallback.

The local definition resolves the keyboard name, its `6 × 16` matrix, 82 keys,
custom transport keycodes and RGB menu controls. Loading it adds no HID command
and does not alter firmware. Once a board is connected, the existing VIA
initialization still performs documented reads; changing a menu or key remains
an immediate device write.

The inspected ISO definition describes physical/matrix coordinates and global
RGB Matrix menu controls, but provides no `li` per-key LED indices. Its menu
label “Per-Key RGB” does not by itself prove a temporary arbitrary-color
protocol. The vendor configurator also contains
[proprietary HID animation commands](https://github.com/tabkb/via-app/blob/f1a784aa9af0dc5ed9df59b3aae6e1b79771b25c/src/utils/keyboard-api.ts#L49-L50),
but its current configuration has no EVO75 entry; Lighting Lab therefore does
not import or send them.

Consequently, safe live device streaming on the EVO75 remains blocked until a
connected, WebHID-authorized board provides all of the following evidence:

- resolved active definition and protocol version;
- matrix polling response;
- complete, unique `row/col -> li` mapping;
- successful same-value per-key read/write/read probe without a save;
- measured command latency that supports a bounded update rate;
- successful best-effort restoration.

The EVO75 definition has no `li` values, so the strict live mapping deliberately
contains zero writable LEDs while the virtual 82-key preview remains available.
Inventing LED order from matrix order would be unsafe. During the integrated
browser check, the app showed no already-authorized keyboard, so no hardware
result or performance number is claimed.

## Transport and host profiles

The Gold topology is explicit:

- **USB → Windows PC**, with a French host-layout expectation;
- **2,4 GHz receiver → Mac**;
- **Bluetooth → Mac**.

Settings exposes these three contexts and stores the active choice locally in
the browser. Switching context also restores that context's saved host-layout
label. The choice is an intent supplied by the user, not a detected firmware
state: standard WebHID exposes VID, PID, product name and HID collections but no
reliable `USB / 2,4 GHz / Bluetooth` transport field. A 2,4 GHz receiver is a
USB HID device from the host's point of view.

Configuration in a wireless context is therefore enabled by capability, not by
an optimistic transport guess. It works only if that mode exposes the same VIA
Raw HID collection (`usagePage 0xFF60`, `usage 0x61`) and responds to the VIA
protocol. This project contains no WebBluetooth or undocumented wireless
command adapter. The browser's first device grant always requires its native
chooser; later reconnects reuse an already granted device automatically and do
not add an application confirmation dialog.

Profiles never auto-write or swap a full keymap when the hardware selector is
changed. The EVO75 definition describes transport-switch keycodes, but does not
expose a query for the current transport or prove separate onboard keymaps per
transport.

## Windows AltGr diagnostic

**Key Tester → Diagnostic AltGr Windows** adds a guarded workflow:

1. a focused input captures the host's `AltRight` versus `MetaRight` signal and
   the text actually inserted, without treating the app's language badge as an
   operating-system setting;
2. a one-shot matrix probe captures the physical row/column instead of assuming
   a hard-coded EVO75 position;
3. a read of layer 0 records the exact current keycode;
4. correction is offered only when the Windows profile, host `Right GUI` signal
   and stored GUI keycode agree;
5. the transaction performs `GET → one SET_KEYCODE → GET`. If the SET may have
   applied but reports an error, it reconciles and restores the original value;
6. a verified manual rollback remains available for the current session.

If the stored code is already `KC_RALT`, the doctor performs no write and points
to a possible Win/Mac mode or global Alt/GUI swap. It never imports a full
keymap, assigns a QMK Magic swap, saves a custom menu, resets EEPROM, enters the
bootloader or flashes firmware.

## Manual EVO75 checklist

1. On Windows, connect the EVO75 by USB and select **USB → Windows** in Settings.
2. Open the local app in Chrome and grant the native WebHID chooser once.
3. Confirm the detected product, VID/PID `36B0:311E`, protocol, matrix, and
   selected definition in the capability panel.
4. In **Key Tester → Diagnostic AltGr Windows**, capture AltGr alone and verify
   whether the host reports `AltRight` or `MetaRight`.
5. Arm the matrix probe, press only the physical AltGr key, read its layer-0
   keycode, and apply the unit correction only if all three proofs agree.
6. Validate `AltGr + 0 → @` with the Windows French historical layout, verify
   that `Win + chiffre` still works only from the real Win key, then power-cycle
   and read the same coordinate again.
7. Open **Configure → Lighting → Lab** and keep
   **Live output on next Start** off.
8. Start preview, press keys slowly, then use **Trigger test ripple**.
9. Press A, Z, E, R, T quickly. Confirm five independent waves and that earlier
   waves continue after T starts.
10. Hold one key. Confirm it creates only one ripple until an `up` followed by a
    new `down`.
11. Test rapid and simultaneous presses, then the same key repeatedly.
12. Do not enable live output on EVO75 until a verified `row/col → li` mapping
    exists. Preview-only is the expected safe state for the bundled definition.
13. On the Mac, repeat authorization and read-only configuration checks first
    with **Récepteur 2,4 GHz → macOS**, then **Bluetooth → macOS**. For each mode,
    record whether the browser sees the VIA Raw HID collection and protocol.
14. If a future verified definition enables live output, stop preview, enable
    **Live output on next Start**, then select **Start**.
    Wait while the Lab captures the existing per-key colors and performs its
    reversible probe.
15. Confirm the probe only if the indicated LED visibly changed. Once the UI
    enters live mode, record measured latency, effective update rate, average
    changed LEDs, and dropped frames.
16. Stop and verify the UI reports restoration success or an explicit failure.
17. Disconnect/reconnect, then close/reopen the page. Confirm no old stream
    resumes automatically.

## Performance results

Pure engine, mapping, transition, diff, cap, overlap, backpressure, and stop
behavior are covered by deterministic unit tests. The production build is also
the integration gate.

Hardware measurements intentionally remain “not measured”: the EVO75 was not
available to Chrome/WebHID in this session. The UI must display measured values
only after an actual live probe and stream; it must not substitute configured
targets for observed throughput.

## Firmware path

A robust firmware implementation would expose a documented volatile frame
buffer or a standard host-effect command with:

- explicit RGB/HSV channel semantics;
- a documented maximum batch length;
- immediate non-persistent application;
- bounded transfer and acknowledgement behavior;
- a way to snapshot and restore the prior effect;
- no EEPROM write in the frame path.

Until such a contract exists, the portable engine, matrix transitions, mapping,
preview, diffing, and backpressure are reasonable upstream candidates. EVO75
definitions and proprietary commands require vendor evidence and should be
discussed separately before any upstream pull request.
