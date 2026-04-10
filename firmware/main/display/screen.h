// main/display/screen.h
#ifndef SCREEN_H
#define SCREEN_H

#include <lvgl.h>
#include <esp_lvgl_port.h>

enum ScreenId {
    kScreenClock = 0,
    kScreenChat,
    kScreenNowPlaying,
    kScreenSettings,
    kScreenCount  // Must be last — used for array sizing
};

class Screen {
public:
    virtual ~Screen() = default;

    // Build the LVGL widget tree on the given screen object.
    // Called once during initialization.
    virtual void Create(lv_obj_t* parent) = 0;

    // Periodic update (called every second from the clock timer).
    virtual void Update() {}

    // Called when this screen becomes the active (visible) screen.
    virtual void OnEnter() {}

    // Called when navigating away from this screen.
    virtual void OnExit() {}

    // Handle a tap at the given coordinates.
    // Returns true if the tap was handled, false if ignored.
    virtual bool OnTap(int x, int y) { return false; }

    // Show a temporary notification in the top area of this screen.
    virtual void ShowNotification(const char* text) {
        if (screen_ == nullptr) return;
        lvgl_port_lock(0);
        if (notification_label_ == nullptr) {
            notification_label_ = lv_label_create(screen_);
            lv_obj_set_width(notification_label_, LV_HOR_RES - 8);
            lv_label_set_long_mode(notification_label_, LV_LABEL_LONG_SCROLL_CIRCULAR);
            lv_obj_set_style_text_align(notification_label_, LV_TEXT_ALIGN_CENTER, 0);
            lv_obj_set_style_text_color(notification_label_, lv_color_hex(0x888888), 0);
            lv_obj_set_style_bg_color(notification_label_, lv_color_hex(0x000000), 0);
            lv_obj_set_style_bg_opa(notification_label_, LV_OPA_80, 0);
            lv_obj_set_style_pad_all(notification_label_, 2, 0);
            lv_obj_align(notification_label_, LV_ALIGN_TOP_MID, 0, 0);
        }
        lv_label_set_text(notification_label_, text);
        lv_obj_clear_flag(notification_label_, LV_OBJ_FLAG_HIDDEN);
        lvgl_port_unlock();
    }

    // Hide the notification.
    void HideNotification() {
        if (notification_label_ == nullptr) return;
        lvgl_port_lock(0);
        lv_obj_add_flag(notification_label_, LV_OBJ_FLAG_HIDDEN);
        lvgl_port_unlock();
    }

    // Get the LVGL screen object for this screen.
    lv_obj_t* GetScreen() const { return screen_; }

protected:
    lv_obj_t* screen_ = nullptr;
    lv_obj_t* notification_label_ = nullptr;
};

#endif // SCREEN_H
