#include "clock_screen.h"
#include "application.h"
#include "board.h"
#include "display/lvgl_display/lvgl_theme.h"
#include "assets/lang_config.h"

#include <font_awesome.h>
#include <esp_log.h>
#include <esp_timer.h>
#include <cJSON.h>
#include <ctime>
#include <cstring>

#define TAG "ClockScreen"

// Fetch weather every 10 minutes
static const int64_t WEATHER_INTERVAL_US = 10LL * 60 * 1000 * 1000;

// Map WMO weather code to FontAwesome icon UTF-8 string
static const char* WmoIcon(int code) {
    switch (code) {
        case 0:            return FONT_AWESOME_SUN;              // Clear sky
        case 1:            return FONT_AWESOME_CLOUD_SUN;        // Mainly clear
        case 2:            return FONT_AWESOME_CLOUD_SUN;        // Partly cloudy
        case 3:            return FONT_AWESOME_CLOUD;            // Overcast
        case 45: case 48:  return FONT_AWESOME_CLOUD_FOG;        // Fog
        case 51: case 53: case 55:
                           return FONT_AWESOME_CLOUD_DRIZZLE;    // Drizzle
        case 61: case 63:  return FONT_AWESOME_CLOUD_RAIN;       // Rain
        case 65:           return FONT_AWESOME_CLOUD_SHOWERS_HEAVY; // Heavy rain
        case 71: case 73: case 75:
                           return FONT_AWESOME_SNOWFLAKE;        // Snow
        case 80: case 81:  return FONT_AWESOME_CLOUD_SHOWERS;    // Rain showers
        case 82:           return FONT_AWESOME_CLOUD_SHOWERS_HEAVY;
        case 85: case 86:  return FONT_AWESOME_SNOWFLAKE;        // Snow showers
        case 95:           return FONT_AWESOME_CLOUD_BOLT;       // Thunderstorm
        case 96: case 99:  return FONT_AWESOME_CLOUD_HAIL;       // Thunderstorm + hail
        default:           return FONT_AWESOME_CLOUD;
    }
}

LV_FONT_DECLARE(font_puhui_basic_30_4);
LV_FONT_DECLARE(BUILTIN_ICON_FONT);

// Derive server base URL from OTA URL (e.g. "http://192.168.50.122:8000/xiaozhi/ota/" → "http://192.168.50.122:8000")
static std::string GetServerBaseUrl() {
    std::string url = CONFIG_OTA_URL;
    // Find third '/' (after "http://host:port/")
    int slashes = 0;
    for (size_t i = 0; i < url.size(); i++) {
        if (url[i] == '/') {
            slashes++;
            if (slashes == 3) {
                return url.substr(0, i);
            }
        }
    }
    return url;
}

void ClockScreen::Create(lv_obj_t* parent) {
    screen_ = parent;

    auto* theme = static_cast<LvglTheme*>(Board::GetInstance().GetDisplay()->GetTheme());
    auto bg_color = theme->background_color();
    auto text_color = theme->text_color();

    lv_obj_set_style_bg_color(screen_, bg_color, 0);

    // Status icons handled by the global top bar (CreateGlobalTopBar on lv_layer_top)

    // Time label — large centered text
    time_label_ = lv_label_create(screen_);
    lv_obj_set_style_text_font(time_label_, &font_puhui_basic_30_4, 0);
    lv_obj_set_style_text_color(time_label_, text_color, 0);
    lv_label_set_text(time_label_, "--:--");
    lv_obj_align(time_label_, LV_ALIGN_CENTER, 0, -25);

    // Date label — smaller text below time
    date_label_ = lv_label_create(screen_);
    lv_obj_set_style_text_color(date_label_, text_color, 0);
    lv_label_set_text(date_label_, "");
    lv_obj_align(date_label_, LV_ALIGN_CENTER, 0, 10);

    // Weather icon (uses large FontAwesome font)
    weather_label_ = lv_label_create(screen_);
    lv_obj_set_style_text_font(weather_label_, theme->large_icon_font()->font(), 0);
    lv_obj_set_style_text_color(weather_label_, text_color, 0);
    lv_obj_set_style_text_align(weather_label_, LV_TEXT_ALIGN_CENTER, 0);
    lv_label_set_text(weather_label_, "");
    lv_obj_align(weather_label_, LV_ALIGN_CENTER, 0, 45);

    // Temperature + location
    location_label_ = lv_label_create(screen_);
    lv_obj_set_style_text_color(location_label_, theme->system_text_color(), 0);
    lv_obj_set_style_text_align(location_label_, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_width(location_label_, LV_HOR_RES - 10);
    lv_label_set_long_mode(location_label_, LV_LABEL_LONG_DOT);
    lv_label_set_text(location_label_, "");
    lv_obj_align(location_label_, LV_ALIGN_CENTER, 0, 80);
}

void ClockScreen::Update() {
    if (time_label_ == nullptr) {
        return;
    }

    time_t now;
    time(&now);
    struct tm timeinfo;
    localtime_r(&now, &timeinfo);

    char time_buf[8];
    strftime(time_buf, sizeof(time_buf), "%H:%M", &timeinfo);
    lv_label_set_text(time_label_, time_buf);

    char date_buf[32];
    strftime(date_buf, sizeof(date_buf), "%a, %b %d", &timeinfo);
    lv_label_set_text(date_label_, date_buf);

    // Status icons (WiFi, battery, server) handled by global top bar via UpdateStatusBar()

    // Apply weather data if a fetch just completed
    if (weather_ready_) {
        weather_ready_ = false;
        if (weather_label_) lv_label_set_text(weather_label_, weather_text_);
        if (location_label_) lv_label_set_text(location_label_, location_text_);
    }

    // Trigger weather fetch periodically — only when the server is connected
    int64_t now_us = esp_timer_get_time();
    if (!weather_fetching_
        && Application::GetInstance().GetServerConnectionState() == 2
        && (now_us - last_weather_fetch_us_ > WEATHER_INTERVAL_US || last_weather_fetch_us_ == 0)) {
        weather_fetching_ = true;
        xTaskCreate(FetchWeatherTask, "weather", 16384, this, 5, nullptr);
    }
}

void ClockScreen::OnEnter() {
    Update();
}

void ClockScreen::FetchWeatherTask(void* arg) {
    auto* self = static_cast<ClockScreen*>(arg);
    bool ok = self->DoFetchWeather();
    if (ok) {
        self->last_weather_fetch_us_ = esp_timer_get_time();
    } else {
        // Retry in 15 seconds, not 10 minutes
        self->last_weather_fetch_us_ = esp_timer_get_time() - WEATHER_INTERVAL_US + (15LL * 1000 * 1000);
    }
    self->weather_fetching_ = false;
    vTaskDelete(nullptr);
}

bool ClockScreen::DoFetchWeather() {
    auto& board = Board::GetInstance();
    auto* network = board.GetNetwork();
    if (!network) {
        ESP_LOGW(TAG, "Weather: no network interface");
        return false;
    }

    auto http = network->CreateHttp(0);
    if (!http) {
        ESP_LOGW(TAG, "Weather: failed to create HTTP client");
        return false;
    }

    std::string url = GetServerBaseUrl() + "/api/weather";
    ESP_LOGI(TAG, "Weather: fetching %s", url.c_str());
    http->SetTimeout(10000);
    http->SetHeader("Content-Type", "application/json");

    if (!http->Open("GET", url)) {
        ESP_LOGW(TAG, "Weather: could not connect to %s", url.c_str());
        http->Close();
        return false;
    }

    int status = http->GetStatusCode();
    if (status != 200) {
        ESP_LOGW(TAG, "Weather: HTTP %d from %s", status, url.c_str());
        http->Close();
        return false;
    }

    std::string body = http->ReadAll();
    http->Close();

    if (body.empty()) {
        ESP_LOGW(TAG, "Weather: empty response");
        return false;
    }

    cJSON* root = cJSON_Parse(body.c_str());
    if (!root) {
        ESP_LOGW(TAG, "Weather: invalid JSON");
        return false;
    }

    cJSON* location = cJSON_GetObjectItem(root, "location");
    cJSON* current = cJSON_GetObjectItem(root, "current");

    if (cJSON_IsObject(current) && cJSON_IsString(location)) {
        cJSON* temp = cJSON_GetObjectItem(current, "temperature");
        cJSON* unit = cJSON_GetObjectItem(current, "unit");
        cJSON* code = cJSON_GetObjectItem(current, "code");

        const char* unit_str = cJSON_IsString(unit) ? unit->valuestring : "°C";
        int temp_val = cJSON_IsNumber(temp) ? (int)temp->valuedouble : 0;
        weather_code_ = cJSON_IsNumber(code) ? (int)code->valuedouble : -1;

        // weather_text_ = icon UTF-8 string (rendered with FontAwesome font)
        snprintf(weather_text_, sizeof(weather_text_), "%s", WmoIcon(weather_code_));
        // location_text_ = "18°C · Lecce, IT"
        snprintf(location_text_, sizeof(location_text_), "%d%s \xc2\xb7 %s", temp_val, unit_str, location->valuestring);
        weather_ready_ = true;

        ESP_LOGI(TAG, "Weather: code=%d, %s", weather_code_, location_text_);
        cJSON_Delete(root);
        return true;
    }

    ESP_LOGW(TAG, "Weather: missing current/location in JSON");
    cJSON_Delete(root);
    return false;
}
