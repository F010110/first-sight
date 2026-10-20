#pragma once
// Copy to cam/local/wifi-config.h ONLY when preparing a specific device.
// This template is not an active configuration. Never commit actual credentials.
#define WIFI_SSID "REPLACE_WITH_TRUSTED_WIFI"
#define WIFI_PASSWORD "REPLACE_WITH_WIFI_PASSWORD"
#define CAMERA_SERVER "http://192.168.1.100:8890"
#define CAMERA_TOKEN "REPLACE_WITH_RANDOM_TOKEN_AT_LEAST_24_CHARACTERS"
// Each physical board must use exactly one assigned ID:
// cam-front, cam-left, cam-right. The host owns the direction mapping.
#define CAMERA_ID "cam-front"
