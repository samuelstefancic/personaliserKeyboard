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

The current generated VIA definition set does not contain EVO75, Evoworks, or
Ticktype entries. Public [ANSI](https://github.com/swagkey/swagkey.github.io/blob/142fa09fbcd3b81bc05ed8ec74392c12d9e764f4/definitions/v3/917516457.json)
and [ISO](https://github.com/swagkey/swagkey.github.io/blob/142fa09fbcd3b81bc05ed8ec74392c12d9e764f4/definitions/v3/917516574.json)
EVO75 definitions are vendor-hosted rather than part of the official VIA
keyboard database. The published ISO candidate is VID:PID `36B0:311E`, with a
`6 × 16` matrix and 82 keys; this is definition metadata, not an observation of
the user's physical device.

The inspected ISO definition describes physical/matrix coordinates and global
RGB Matrix menu controls, but provides no `li` per-key LED indices. Its menu
label “Per-Key RGB” does not by itself prove a temporary arbitrary-color
protocol. The vendor configurator also contains
[proprietary HID animation commands](https://github.com/tabkb/via-app/blob/f1a784aa9af0dc5ed9df59b3aae6e1b79771b25c/src/utils/keyboard-api.ts#L49-L50),
but its current configuration has no EVO75 entry; Lighting Lab therefore does
not import or send them.

Consequently, safe device streaming on the EVO75 remains blocked until a
connected, WebHID-authorized board provides all of the following evidence:

- resolved active definition and protocol version;
- matrix polling response;
- complete, unique `row/col -> li` mapping;
- successful same-value per-key read/write/read probe without a save;
- measured command latency that supports a bounded update rate;
- successful best-effort restoration.

No EVO75 was visible to the local operating-system HID inventory during the
implementation session, so no hardware result or performance number is claimed.
The vendor ISO JSON can be sideloaded through VIA's existing Design tab for a
controlled test; inventing the missing LED order in that JSON would not be safe.

## Manual EVO75 checklist

1. Connect the EVO75 by USB and put its hardware selector in USB mode.
2. Open the local app in Chrome and authorize the device through WebHID.
3. Confirm the detected product, VID/PID, protocol, matrix dimensions, and
   selected definition in the capability panel.
4. Open **Configure → Lighting → Lab** and keep
   **Live output on next Start** off.
5. Start preview, press keys slowly, then use **Trigger test ripple**.
6. Press A, Z, E, R, T quickly. Confirm five independent waves and that earlier
   waves continue after T starts.
7. Hold one key. Confirm it creates only one ripple until an `up` followed by a
   new `down`.
8. Test rapid and simultaneous presses, then the same key repeatedly.
9. Stop preview, enable **Live output on next Start**, then select **Start**.
   Wait while the Lab captures the existing per-key colors and performs its
   reversible probe.
10. Confirm the probe only if the indicated LED visibly changed. Once the UI
    enters live mode, record measured latency, effective update rate, average
    changed LEDs, and dropped frames.
11. Stop and verify the UI reports restoration success or an explicit failure.
12. Disconnect/reconnect, then close/reopen the page. Confirm no old stream
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
