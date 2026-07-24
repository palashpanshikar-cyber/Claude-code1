// Gym Tracker sensor firmware — ESP32 + MPU6050 accelerometer.
//
// Detects whether a machine is in use by watching for vibration/motion,
// then reports "open" / "busy" to the gym-tracker backend over WiFi.
//
// Required libraries (Arduino Library Manager):
//   - Adafruit MPU6050
//   - Adafruit Unified Sensor
//   - ArduinoJson
//
// Setup: copy config.h.example to config.h and fill in your WiFi + backend
// + device credentials before flashing.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <ArduinoJson.h>
#include "config.h"

// --- Tunables -----------------------------------------------------------

// How often to sample the accelerometer.
const unsigned long SAMPLE_INTERVAL_MS = 100;

// Motion energy is a moving RMS of sample-to-sample acceleration deltas
// over this window. Larger = smoother/less twitchy, slower to react.
const unsigned long MOTION_WINDOW_MS = 3000;

// Energy above this (m/s^2, roughly) counts as "the machine is moving".
// Start here and recalibrate per machine type — see docs/HARDWARE_GUIDE.md.
const float MOTION_THRESHOLD = 0.6;

// Once motion is seen, hold "busy" for this long after the last motion
// before falling back to "open" — smooths over the pauses between
// reps/sets so the status doesn't flicker every few seconds.
const unsigned long IN_USE_HOLD_MS = 90UL * 1000UL;

// Send a status report at least this often even if nothing changed, so the
// backend's offline-detection sweep doesn't mark a healthy device offline.
const unsigned long HEARTBEAT_INTERVAL_MS = 30UL * 1000UL;

// --- State ----------------------------------------------------------------

Adafruit_MPU6050 mpu;

float lastMagnitude = 0;
bool haveLastMagnitude = false;

// Ring buffer of recent |delta| samples used to compute the moving RMS.
const int MAX_SAMPLES = (MOTION_WINDOW_MS / SAMPLE_INTERVAL_MS) + 1;
float deltaSamples[MAX_SAMPLES];
int sampleCount = 0;
int sampleIndex = 0;

unsigned long lastSampleAt = 0;
unsigned long lastMotionAt = 0;
bool everMoved = false; // guards against "now - lastMotionAt" looking recent before any real motion sample
unsigned long lastReportAt = 0;
String lastReportedStatus = "";

// BACKEND_URL is http:// when the backend runs on the same LAN, but a
// hosted one is https:// and usually redirects http:// away. The scheme
// decides which client this sketch hands to HTTPClient.
WiFiClient plainClient;
WiFiClientSecure secureClient;

bool backendUsesTls() {
  return String(BACKEND_URL).startsWith("https://");
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

float readMotionEnergy() {
  sensors_event_t accel, gyro, temp;
  mpu.getEvent(&accel, &gyro, &temp);

  float magnitude = sqrt(
    accel.acceleration.x * accel.acceleration.x +
    accel.acceleration.y * accel.acceleration.y +
    accel.acceleration.z * accel.acceleration.z
  );

  if (!haveLastMagnitude) {
    lastMagnitude = magnitude;
    haveLastMagnitude = true;
    return 0;
  }

  float delta = fabs(magnitude - lastMagnitude);
  lastMagnitude = magnitude;

  deltaSamples[sampleIndex] = delta;
  sampleIndex = (sampleIndex + 1) % MAX_SAMPLES;
  if (sampleCount < MAX_SAMPLES) sampleCount++;

  float sumSquares = 0;
  for (int i = 0; i < sampleCount; i++) sumSquares += deltaSamples[i] * deltaSamples[i];
  return sqrt(sumSquares / sampleCount);
}

void reportStatus(const char* status) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Skipping report, WiFi not connected");
    return;
  }

  HTTPClient http;
  String url = String(BACKEND_URL) + "/api/devices/" + DEVICE_ID + "/status";
  // Pass the client explicitly rather than letting HTTPClient pick one
  // from the URL: what begin(url) does for https:// varies by ESP32 core
  // version, and the failure mode is a sensor that silently stops
  // reporting. See the setInsecure() note in setup() for the tradeoff.
  if (backendUsesTls()) {
    http.begin(secureClient, url);
  } else {
    http.begin(plainClient, url);
  }
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

// Optional: wire a battery voltage divider to an ADC pin and calibrate
// this. Returns -1 (omitted from payload as null) if not wired up.
int readBatteryPct() {
  return -1;
}

void setup() {
  Serial.begin(115200);
  delay(300);

  Wire.begin();
  if (!mpu.begin()) {
    Serial.println("MPU6050 not found — check wiring. Halting.");
    while (true) delay(1000);
  }
  mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);

  if (backendUsesTls()) {
    // Skip certificate validation. Pinning a CA or fingerprint instead
    // would mean the sensor goes silent whenever the host renews its
    // certificate, in a gym, with no console to explain why. This
    // connection carries one machine's busy/open state, and the device
    // key it sends can only push status for that same machine, so an
    // intercepted or forged report costs a wrong icon and nothing more.
    secureClient.setInsecure();
  }

  connectWiFi();
}

void loop() {
  connectWiFi();

  unsigned long now = millis();
  if (now - lastSampleAt < SAMPLE_INTERVAL_MS) return;
  lastSampleAt = now;

  float energy = readMotionEnergy();
  if (energy > MOTION_THRESHOLD) {
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
