// Gym Tracker sensor firmware — ESP8266 + SW-420 vibration switch module.
//
// Cheaper variant of the ESP32+MPU6050 sketch: an SW-420 (or similar
// comparator-based vibration switch) module costs about $1 and an ESP8266
// board (e.g. Wemos D1 mini) about $3, versus ~$2-4 for an MPU6050 + $5-8
// for an ESP32. Detection logic is different (edge-counting a digital
// switch instead of integrating accelerometer magnitude) but the rest of
// the contract with the backend is identical — same config.h fields, same
// status model, same HTTP endpoint.
//
// Required libraries: none beyond the ESP8266 board package itself
// (ESP8266WiFi, ESP8266HTTPClient ship with it) plus ArduinoJson from the
// Arduino Library Manager.
//
// Wiring (see docs/HARDWARE_GUIDE.md for the full writeup):
//   SW-420 VCC -> 3V3      SW-420 GND -> GND      SW-420 DO -> D5 (GPIO14)
//
// Setup: copy config.h.example to config.h and fill in your WiFi + backend
// + device credentials before flashing.

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include "config.h"

// --- Pin ------------------------------------------------------------------

// Avoid D0/D3/D4/D8 (GPIO16/0/2/15) — those have special boot-time roles on
// most ESP8266 boards. D1/D2/D5/D6/D7 are safe general-purpose choices.
const uint8_t VIBRATION_PIN = D5;

// --- Tunables ---------------------------------------------------------

// How often to snapshot the edge counter into the moving window.
const unsigned long SAMPLE_INTERVAL_MS = 200;

// Edge counts are summed over this trailing window to decide "is this
// machine moving right now". Larger = smoother/less twitchy, slower to react.
const unsigned long MOTION_WINDOW_MS = 3000;

// Ignore edges within this many microseconds of the last counted one —
// mechanical vibration switches chatter (bounce) on a single physical
// shock, which would otherwise register as dozens of "hits" per rep.
const unsigned long DEBOUNCE_US = 15000; // 15ms

// Total (debounced) edges within MOTION_WINDOW_MS above this count means
// "the machine is moving". This is the main dial to calibrate per machine
// type — see docs/HARDWARE_GUIDE.md. The SW-420's onboard potentiometer is
// a second, hardware-level sensitivity dial: turn it to change how easily
// the module itself fires before this software threshold ever sees it.
const unsigned int PULSE_THRESHOLD = 4;

// Once motion is seen, hold "busy" for this long after the last motion
// before falling back to "open" — smooths over the pauses between
// reps/sets so the status doesn't flicker every few seconds.
const unsigned long IN_USE_HOLD_MS = 90UL * 1000UL;

// Send a status report at least this often even if nothing changed, so the
// backend's offline-detection sweep doesn't mark a healthy device offline.
const unsigned long HEARTBEAT_INTERVAL_MS = 30UL * 1000UL;

// --- State ------------------------------------------------------------

// Written from the ISR, read from loop(). A 32-bit counter read/written as
// a whole is a single instruction on this single-core chip, so this is safe
// without disabling interrupts around the read — the standard pattern used
// throughout ESP8266 example code (same reasoning as reading millis()).
volatile unsigned long pulseCount = 0;
volatile unsigned long lastEdgeMicros = 0;

unsigned long prevPulseCount = 0;

// Ring buffer of recent per-sample edge counts used to compute the moving sum.
const int MAX_SAMPLES = (MOTION_WINDOW_MS / SAMPLE_INTERVAL_MS) + 1;
unsigned int countSamples[MAX_SAMPLES];
int sampleCount = 0;
int sampleIndex = 0;

unsigned long lastSampleAt = 0;
unsigned long lastMotionAt = 0;
bool everMoved = false; // guards against "now - lastMotionAt" looking recent before any real motion sample
unsigned long lastReportAt = 0;
String lastReportedStatus = "";

// BACKEND_URL is http:// when the backend runs on the same LAN, but a
// hosted one is https:// and usually redirects http:// away. A plain
// WiFiClient cannot speak TLS at all, so the scheme decides which client
// this sketch hands to HTTPClient.
WiFiClient plainClient;
WiFiClientSecure secureClient;

bool backendUsesTls() {
  return String(BACKEND_URL).startsWith("https://");
}

// Counts transitions in either direction, not just one polarity — cheap
// SW-420 clones are inconsistent about whether DO idles high or low, but
// either way it should sit still (no transitions) when nothing is
// vibrating, so edge-counting works regardless of which level means
// "triggered".
void ICACHE_RAM_ATTR onVibrationEdge() {
  unsigned long now = micros();
  if (now - lastEdgeMicros < DEBOUNCE_US) return;
  lastEdgeMicros = now;
  pulseCount++;
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected, IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi connect timed out, will retry in loop()");
  }
}

unsigned int sampleEdgeCount() {
  unsigned long current = pulseCount; // single-instruction read, see note above
  unsigned long delta = current - prevPulseCount; // unsigned wraparound-safe, same trick as millis()
  prevPulseCount = current;

  countSamples[sampleIndex] = (unsigned int)delta;
  sampleIndex = (sampleIndex + 1) % MAX_SAMPLES;
  if (sampleCount < MAX_SAMPLES) sampleCount++;

  unsigned int total = 0;
  for (int i = 0; i < sampleCount; i++) total += countSamples[i];
  return total;
}

void reportStatus(const char* status) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Skipping report, WiFi not connected");
    return;
  }

  HTTPClient http;
  String url = String(BACKEND_URL) + "/api/devices/" + DEVICE_ID + "/status";
  http.begin(backendUsesTls() ? (WiFiClient&)secureClient : plainClient, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_KEY);

  JsonDocument doc;
  doc["status"] = status;
  int batteryPct = readBatteryPct();
  if (batteryPct >= 0) doc["batteryPct"] = batteryPct; // omitted (-> null) when not wired up
  doc["rssi"] = WiFi.RSSI();
  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  Serial.printf("POST %s -> %d\n", status, code);
  http.end();

  lastReportedStatus = status;
  lastReportAt = millis();
}

// Optional: wire a battery voltage divider to the ADC pin (A0) and
// calibrate this. Returns -1 (omitted from payload as null) if not wired up.
int readBatteryPct() {
  return -1;
}

void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(VIBRATION_PIN, INPUT);
  attachInterrupt(digitalPinToInterrupt(VIBRATION_PIN), onVibrationEdge, CHANGE);

  if (backendUsesTls()) {
    // Skip certificate validation. The alternative on an ESP8266 is
    // pinning a fingerprint or a CA, and hosts renew certificates every
    // few months — a pinned sensor would go silent on renewal day, in a
    // gym, with no console to tell you why. What this connection carries
    // is one machine's busy/open state, and the device key it sends can
    // only push status for that same machine, so an intercepted or forged
    // report costs a wrong icon rather than access to anything.
    secureClient.setInsecure();
    // TLS buffers are allocated from the same small heap as everything
    // else on an ESP8266. The defaults ask for 16 KB of receive buffer
    // and the allocation simply fails; these cover the tiny JSON replies
    // this sketch actually gets back.
    secureClient.setBufferSizes(1024, 512);
  }

  connectWiFi();
}

void loop() {
  connectWiFi();

  unsigned long now = millis();
  if (now - lastSampleAt < SAMPLE_INTERVAL_MS) return;
  lastSampleAt = now;

  unsigned int edgesInWindow = sampleEdgeCount();
  if (edgesInWindow > PULSE_THRESHOLD) {
    lastMotionAt = now;
    everMoved = true;
  }

  // everMoved guards startup: millis() is small right after boot, so
  // "now - lastMotionAt" (with lastMotionAt still 0) would otherwise look
  // like recent motion and falsely report busy before any real sample.
  bool inUse = everMoved && (now - lastMotionAt) < IN_USE_HOLD_MS;
  const char* status = inUse ? "busy" : "open";

  bool statusChanged = lastReportedStatus != String(status);
  bool heartbeatDue = now - lastReportAt >= HEARTBEAT_INTERVAL_MS;
  if (statusChanged || heartbeatDue) {
    reportStatus(status);
  }
}
