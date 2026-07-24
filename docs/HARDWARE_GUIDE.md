# Hardware Guide: Gym Machine Occupancy Sensor

A small battery/USB-powered pod that straps or magnet-mounts to a machine,
watches for vibration, and reports "open" / "busy" to the backend
over WiFi.

Two firmware/hardware variants are provided:

| | Recommended: ESP8266 + SW-420 | Alternative: ESP32 + MPU6050 |
|---|---|---|
| Firmware | `firmware/gym_tracker_esp8266_vibration/` | `firmware/gym_tracker_esp32/` |
| Per-unit cost | ~$8-14 | ~$12-20 |
| Sensor | $1 vibration switch module (digital on/off) | $2-4 accelerometer (3-axis, I2C) |
| Board | $3 ESP8266 (e.g. Wemos D1 mini) | $5-8 ESP32 |
| Firmware complexity | Simpler — counts digital edges | More code — reads/integrates accelerometer values |
| When to use | Default choice, especially on a budget | You already have MPU6050s, or want finer-grained motion data later |

This guide leads with the cheap ESP8266 + SW-420 build. Section 9 covers
what's different for the MPU6050 alternative — everything else (mounting,
backend, provisioning) is identical between the two.

## 1. Bill of materials (per device, recommended build)

| Part | Example | Approx. cost | Notes |
|---|---|---|---|
| Microcontroller | ESP8266 dev board (e.g. Wemos D1 mini / NodeMCU) | $3 | Built-in WiFi, cheaper and simpler than an ESP32 for this job |
| Vibration sensor | SW-420 vibration switch module | $1 | Digital output, onboard sensitivity potentiometer + LED |
| Power | 1x 18650 Li-ion cell + TP4056 USB-C charge/protection board, OR just a USB cable to a wall adapter | $3-6 (battery) / $1 (cable only) | Battery gives you a fully wireless pod; USB is simpler for a first prototype |
| Enclosure | Small snap-fit project box (~60x40x20mm) or 3D-printed shell | $2-5 | Needs to be non-metallic so WiFi isn't blocked |
| Mounting | Strong strap-style hook-and-loop strap, or neodymium magnets (2x 10mm disc) epoxied to the case | $1-3 | Depends on machine: straps for round bars/handles, magnets for flat steel frames |
| Misc | Jumper wires, 1x on/off slide switch (optional), perfboard or small breadboard for the prototype | $2 | |

Tools: soldering iron + solder, wire strippers, hot glue gun (for strain
relief and securing the sensor against the case wall), a multimeter, a
computer with the Arduino IDE.

## 2. Wiring

The SW-420 is a simple digital switch — 3 pins, no I2C:

```
SW-420         ESP8266 (Wemos D1 mini)
------         -----------------------
VCC     -----> 3V3
GND     -----> GND
DO      -----> D5 (GPIO14)
```

Avoid D0/D3/D4/D8 for the sensor pin — those have special boot-time roles
on most ESP8266 boards. D1/D2/D5/D6/D7 are all safe general-purpose choices
if you want to use a different pin than the firmware's default (D5).

If you're adding battery power via a TP4056 module:

```
18650 cell (+) -> TP4056 B+
18650 cell (-) -> TP4056 B-
TP4056 OUT+    -> ESP8266 5V / VIN (through the on/off switch if you added one)
TP4056 OUT-    -> ESP8266 GND
```

Optional battery-level monitoring: run a 2-resistor voltage divider from
the battery's positive terminal into the ESP8266's ADC pin (A0) so
`readBatteryPct()` in the firmware has something to read. Skip this for
the first prototype — the firmware treats a missing reading as "unknown"
and everything else still works.

## 3. Assembly steps

1. **Bench-test on a breadboard first.** Wire the SW-420 to the ESP8266 as
   above with jumper wires — don't solder or box anything up yet.
2. Flash the firmware (see `firmware/gym_tracker_esp8266_vibration/`) and
   confirm over the Serial Monitor that WiFi connects. Tap the SW-420
   board directly to confirm its onboard LED lights up on a tap (this
   tells you the module and its sensitivity pot are working before you
   even look at the ESP8266 side).
3. Once the logic is confirmed, solder the SW-420 and ESP8266 onto a small
   piece of perfboard (or solder the jumper wires directly and hot-glue the
   strain relief points) — no code changes needed, this is just making the
   breadboard wiring permanent.
4. Wire in the battery + TP4056 + switch if you're going battery-powered.
5. Hot-glue the SW-420 board flat against the inside wall of the enclosure
   that will face the machine — it needs to be mechanically coupled to the
   case, not dangling on wires, or it will pick up its own rattle instead
   of the machine's vibration.
6. Close up the enclosure. Attach the mounting strap or epoxy the magnets
   to the outside face that will contact the machine.
7. Label the device (write the `device_id` on it with a marker/label maker)
   — with 10+ units on a gym floor you will not remember which is which.

## 4. Mounting per machine type

- **Machines with a moving weight stack or cable** (lat pulldown, cable
  crossover): mount on the frame near the stack/pulley, not on the handle
  itself — the handle can be removed/swapped and the frame vibrates
  whenever the stack moves.
- **Plate-loaded machines** (leg press, hack squat): mount on the main
  frame near the carriage rails.
- **Racks/benches with no moving parts of their own** (squat rack, flat
  bench): mount on a point that transmits vibration from barbell
  contact — e.g., the upright near where the bar rests, or the underside
  of a bench.
- **Cardio machines** (treadmill, rower, bike): these already vibrate
  heavily when idle (motor hum, belt) — expect to raise the sensitivity
  threshold significantly for these, see calibration below.
- Always mount with the sensor's face flush against a rigid part of the
  frame — foam tape or loose straps damp the vibration you're trying to
  measure.

## 5. Calibration

The SW-420 build has **two** sensitivity dials, one hardware and one
software — tune the hardware one first:

1. **Hardware: the onboard potentiometer.** Turning it clockwise/
   counter-clockwise (check the silkscreen on your specific board) raises
   or lowers how much physical vibration it takes to trip the switch at
   all. With the sensor mounted on a real, idle machine, adjust it so the
   onboard LED does **not** light up from ambient noise but **does** light
   up when the machine is actually used. This alone gets you most of the
   way there.
2. **Software: `PULSE_THRESHOLD` in the firmware.** This is a second,
   finer-grained filter on top of the hardware trigger — how many
   debounced edges within the `MOTION_WINDOW_MS` window count as "in use".
   To tune it:
   - Temporarily add `Serial.println(edgesInWindow);` right after the
     `sampleEdgeCount()` call in `loop()` and reflash.
   - With the sensor mounted and the potentiometer set per step 1, watch
     the Serial Monitor for ~30 seconds while idle, then have someone use
     the machine for a set. Note the counts in both cases.
   - Set `PULSE_THRESHOLD` comfortably above the idle count and comfortably
     below the in-use count.
   - Remove the debug `Serial.println` before final deployment.
3. Re-check `IN_USE_HOLD_MS` (default 90s) against real usage patterns —
   e.g. if lifters at your gym rest 3+ minutes between sets, either raise
   this or accept that the status will flip to "open" mid-rest.

Calibrate per machine type, not per individual unit — once you've dialed
in the potentiometer position and `PULSE_THRESHOLD` for "squat rack" or
"cardio machine", reuse those settings for every unit of that type.

## 6. Power & battery life

- USB power (wall adapter) is simplest for a first deployment: no battery
  management, no charge cycle to think about, works indefinitely. Downside:
  a visible cable, and you need mains power near every machine.
- Battery (18650 + TP4056): fully wireless. The SW-420 variant is already
  more battery-friendly than a polling accelerometer, since the sensor
  itself does the vibration detection in hardware — the ESP8266 only wakes
  its CPU on an actual edge interrupt rather than continuously sampling an
  I2C sensor. It still stays WiFi-connected continuously in this starter
  firmware, though, which dominates power draw. For longer battery life,
  the next engineering step (not implemented here) is deep-sleep between
  heartbeats, waking briefly to send status and back on any vibration
  interrupt.

## 7. Networking

- Each device needs the gym's WiFi credentials baked into `config.h`
  (see `firmware/gym_tracker_esp8266_vibration/config.h.example`). For a
  gym with guest-portal WiFi (captive portal), you'll need a dedicated
  IoT/device SSID with a normal WPA2 password instead — captive portals
  don't work with a headless device.
- The backend needs to be reachable from the gym's network: either run it
  on a machine on the same LAN (simplest for a pilot at one gym) or deploy
  it to the internet with HTTPS (needed once you have multiple gym
  locations on different networks) — see the top-level README for how the
  device posts over plain HTTP today and where you'd add TLS.

## 8. Rollout checklist per device

1. Run `npm run seed` (or your provisioning flow) to get a `device_id` /
   `device_key` pair, and create the corresponding machine row in the gym
   you're installing at.
2. Copy `config.h.example` to `config.h`, fill in WiFi + backend URL + that
   device's id/key.
3. Flash, bench-confirm over Serial that it connects and reports.
4. Mount per Section 4, calibrate per Section 5 if it's a new machine type.
5. Confirm in the app that the machine shows a live status within the
   heartbeat interval (30s default).

## 9. Alternative: ESP32 + MPU6050

If you already have MPU6050 accelerometers on hand, or want continuous
motion magnitude data (not just an on/off vibration signal) for future
tuning, use `firmware/gym_tracker_esp32/` instead. Everything in Sections
1-8 above still applies conceptually (mounting, provisioning, rollout),
except:

- **BOM**: swap the ESP8266 ($3) + SW-420 ($1) for an ESP32 ($5-8) +
  MPU6050 breakout ($2-4).
- **Wiring**: MPU6050 is I2C — `VCC->3V3`, `GND->GND`, `SCL->GPIO22`,
  `SDA->GPIO21` on a standard ESP32 dev board.
- **Calibration**: tune `MOTION_THRESHOLD` (a continuous motion-energy
  value) instead of `PULSE_THRESHOLD` (an edge count) — the firmware
  comments walk through the same idle-vs-in-use sampling procedure.
- There's no hardware sensitivity potentiometer on this path — all tuning
  is in software.
