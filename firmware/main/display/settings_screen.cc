#include "settings_screen.h"
#include "board.h"
#include "display/lvgl_display/lvgl_theme.h"
#include "settings.h"

#include <esp_log.h>
#include <esp_heap_caps.h>

#define TAG "SettingsScreen"

static const int ROW_HEIGHT = 40;
static const int LABEL_X = 10;

void SettingsScreen::Create(lv_obj_t* parent) {
    screen_ = parent;

    auto* theme = static_cast<LvglTheme*>(Board::GetInstance().GetDisplay()->GetTheme());
    auto bg_color = theme->background_color();
    auto text_color = theme->text_color();

    lv_obj_set_style_bg_color(screen_, bg_color, 0);

    // Reserve top 22px for the global top bar overlay (lv_layer_top)
    static const int TOP_BAR_H = 22;

    lv_obj_t* title = lv_label_create(screen_);
    lv_label_set_text(title, "Settings");
    lv_obj_set_style_text_color(title, text_color, 0);
    lv_obj_align(title, LV_ALIGN_TOP_MID, 0, TOP_BAR_H + 4);

    int y = TOP_BAR_H + 28;

    // WiFi row
    wifi_label_ = lv_label_create(screen_);
    lv_label_set_text(wifi_label_, "WiFi: --");
    lv_obj_set_style_text_color(wifi_label_, text_color, 0);
    lv_obj_set_pos(wifi_label_, LABEL_X, y + 4);
    y += ROW_HEIGHT;

    // Internal DRAM
    mem_int_label_ = lv_label_create(screen_);
    lv_label_set_text(mem_int_label_, "DRAM: --");
    lv_obj_set_style_text_color(mem_int_label_, text_color, 0);
    lv_obj_set_pos(mem_int_label_, LABEL_X, y + 4);
    y += ROW_HEIGHT;

    // PSRAM
    mem_ps_label_ = lv_label_create(screen_);
    lv_label_set_text(mem_ps_label_, "PSRAM: --");
    lv_obj_set_style_text_color(mem_ps_label_, text_color, 0);
    lv_obj_set_pos(mem_ps_label_, LABEL_X, y + 4);
}

void SettingsScreen::OnEnter() {
    RefreshStatus();
}

void SettingsScreen::Update() {
    RefreshStatus();
}

void SettingsScreen::RefreshStatus() {
    if (wifi_label_) {
        Settings wifi_settings("wifi", false);
        std::string ssid = wifi_settings.GetString("ssid", "");
        char buf[48];
        snprintf(buf, sizeof(buf), "WiFi: %s", ssid.empty() ? "N/A" : ssid.c_str());
        lv_label_set_text(wifi_label_, buf);
    }

    if (mem_int_label_) {
        size_t free_kb = heap_caps_get_free_size(MALLOC_CAP_INTERNAL) / 1024;
        size_t min_kb = heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL) / 1024;
        char buf[32];
        snprintf(buf, sizeof(buf), "DRAM: %uK (min %uK)", (unsigned)free_kb, (unsigned)min_kb);
        lv_label_set_text(mem_int_label_, buf);
    }

    if (mem_ps_label_) {
        size_t free_kb = heap_caps_get_free_size(MALLOC_CAP_SPIRAM) / 1024;
        size_t min_kb = heap_caps_get_minimum_free_size(MALLOC_CAP_SPIRAM) / 1024;
        char buf[32];
        snprintf(buf, sizeof(buf), "PSRAM: %uK (min %uK)", (unsigned)free_kb, (unsigned)min_kb);
        lv_label_set_text(mem_ps_label_, buf);
    }
}
