// Wristband firmware: ESP32 + MAX30102 (heart rate, SpO2) + MPU6050 (accelerometer) + vibration motor.
// Sends one JSON line per second over USB serial:  {"hr":72.0,"spo2":98.0,"acc":[50 values]}
// and vibrates when it receives the line BUZZ.  NOT yet run on hardware: check pins and sensor libraries first.
// Libraries (Arduino Library Manager): "SparkFun MAX3010x Pulse and Proximity Sensor Library", "Adafruit MPU6050".
#include <Wire.h>
#include "MAX30105.h"
#include "heartRate.h"
#include "spo2_algorithm.h"
#include <Adafruit_MPU6050.h>

const int MOTOR_PIN = 25;               // vibration motor through a transistor, never straight from the pin
MAX30105 ppg;
Adafruit_MPU6050 imu;
const int N_IMU = 50;                   // 50 Hz
float accMag[N_IMU];
uint32_t irBuf[100], redBuf[100];       // 4 s of PPG at 25 Hz for the SpO2 routine
int32_t spo2 = 98, hrAlgo = 70; int8_t spo2Ok, hrOk;
unsigned long buzzUntil = 0;

void setup() {
  Serial.begin(115200);
  pinMode(MOTOR_PIN, OUTPUT);
  Wire.begin(21, 22);                   // SDA 21, SCL 22
  if (!ppg.begin(Wire, I2C_SPEED_FAST)) { Serial.println("{\"error\":\"MAX30102 not found\"}"); while (1); }
  ppg.setup(60, 4, 2, 100, 411, 4096);  // LED brightness, averaging, red+IR, 100 samples/s, pulse width, ADC range
  if (!imu.begin()) { Serial.println("{\"error\":\"MPU6050 not found\"}"); while (1); }
  imu.setAccelerometerRange(MPU6050_RANGE_4_G);
  for (int i = 0; i < 100; i++) { while (!ppg.available()) ppg.check(); redBuf[i] = ppg.getRed(); irBuf[i] = ppg.getIR(); ppg.nextSample(); }
}

void loop() {
  unsigned long t0 = millis();
  for (int i = 0; i < N_IMU; i++) {                       // one second of accelerometer at 50 Hz
    sensors_event_t a, g, tmp; imu.getEvent(&a, &g, &tmp);
    accMag[i] = sqrt(a.acceleration.x * a.acceleration.x + a.acceleration.y * a.acceleration.y + a.acceleration.z * a.acceleration.z) / 9.81f;
    while (Serial.available()) { String c = Serial.readStringUntil('\n'); c.trim(); if (c == "BUZZ") buzzUntil = millis() + 5000; }
    digitalWrite(MOTOR_PIN, millis() < buzzUntil ? HIGH : LOW);
    delay(20);
  }
  for (int i = 25; i < 100; i++) { redBuf[i - 25] = redBuf[i]; irBuf[i - 25] = irBuf[i]; }   // slide window by 1 s
  for (int i = 75; i < 100; i++) { while (!ppg.available()) ppg.check(); redBuf[i] = ppg.getRed(); irBuf[i] = ppg.getIR(); ppg.nextSample(); }
  maxim_heart_rate_and_oxygen_saturation(irBuf, 100, redBuf, &spo2, &spo2Ok, &hrAlgo, &hrOk);
  Serial.print("{\"hr\":"); Serial.print(hrOk ? hrAlgo : 0); Serial.print(",\"spo2\":"); Serial.print(spo2Ok ? spo2 : 0); Serial.print(",\"acc\":[");
  for (int i = 0; i < N_IMU; i++) { Serial.print(accMag[i], 3); if (i < N_IMU - 1) Serial.print(","); }
  Serial.println("]}");
}
