#include "now_playing_screen.h"
#include "application.h"
#include "board.h"
#include "display/lvgl_display/lvgl_theme.h"

#include <esp_log.h>
#include <esp_lvgl_port.h>
#include <cstring>

#define TAG "NowPlayingScreen"

void NowPlayingScreen::Create(lv_obj_t* parent) {
    screen_ = parent;

    auto* theme = static_cast<LvglTheme*>(Board::GetInstance().GetDisplay()->GetTheme());

    lv_obj_set_style_bg_color(screen_, theme->background_color(), 0);

    // Reserve top 22px for the global top bar overlay (lv_layer_top)
    static const int TOP_BAR_H = 22;

    // "Now Playing" header
    lv_obj_t* header = lv_label_create(screen_);
    lv_label_set_text(header, "Now Playing");
    lv_obj_set_style_text_color(header, theme->system_text_color(), 0);
    lv_obj_align(header, LV_ALIGN_TOP_MID, 0, TOP_BAR_H + 4);

    // Track title — centered, larger area, wrapping
    title_label_ = lv_label_create(screen_);
    lv_label_set_text(title_label_, "");
    lv_obj_set_width(title_label_, LV_HOR_RES - 32);
    lv_label_set_long_mode(title_label_, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_align(title_label_, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(title_label_, theme->text_color(), 0);
    lv_obj_align(title_label_, LV_ALIGN_CENTER, 0, -16);

    // Artist name — below title, smaller/dimmer
    artist_label_ = lv_label_create(screen_);
    lv_label_set_text(artist_label_, "");
    lv_obj_set_width(artist_label_, LV_HOR_RES - 32);
    lv_label_set_long_mode(artist_label_, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_align(artist_label_, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(artist_label_, theme->system_text_color(), 0);
    lv_obj_align(artist_label_, LV_ALIGN_CENTER, 0, 20);

    // "Tap to stop" hint at bottom
    hint_label_ = lv_label_create(screen_);
    lv_label_set_text(hint_label_, "Tap to stop");
    lv_obj_set_style_text_color(hint_label_, theme->system_text_color(), 0);
    lv_obj_align(hint_label_, LV_ALIGN_BOTTOM_MID, 0, -12);
    lv_obj_add_flag(hint_label_, LV_OBJ_FLAG_HIDDEN);

    // "No music" label shown when nothing is playing
    idle_label_ = lv_label_create(screen_);
    lv_label_set_text(idle_label_, "No music");
    lv_obj_set_style_text_color(idle_label_, theme->system_text_color(), 0);
    lv_obj_align(idle_label_, LV_ALIGN_CENTER, 0, 0);
}

bool NowPlayingScreen::OnTap(int x, int y) {
    auto& app = Application::GetInstance();
    app.ToggleChatState();
    return true;
}

void NowPlayingScreen::SetTrack(const char* title, const char* artist) {
    if (title_label_ == nullptr) return;

    lvgl_port_lock(0);

    lv_label_set_text(title_label_, title);
    lv_label_set_text(artist_label_, artist);

    // Show track info, hide idle label
    lv_obj_clear_flag(title_label_, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(artist_label_, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(hint_label_, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(idle_label_, LV_OBJ_FLAG_HIDDEN);

    lvgl_port_unlock();
}
