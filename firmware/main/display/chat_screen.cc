#include "chat_screen.h"
#include "application.h"
#include "board.h"
#include "display/lvgl_display/lvgl_theme.h"

#include <esp_log.h>
#include <esp_lvgl_port.h>
#include <cstring>

#define TAG "ChatScreen"

#if CONFIG_IDF_TARGET_ESP32P4
#define MAX_MESSAGES 40
#else
#define MAX_MESSAGES 20
#endif

void ChatScreen::Create(lv_obj_t* parent) {
    screen_ = parent;

    auto* theme = static_cast<LvglTheme*>(Board::GetInstance().GetDisplay()->GetTheme());

    lv_obj_set_style_bg_color(screen_, theme->background_color(), 0);

    // Reserve top 22px for the global top bar overlay (lv_layer_top)
    static const int TOP_BAR_H = 22;

    status_label_ = lv_label_create(screen_);
    lv_obj_set_width(status_label_, LV_HOR_RES * 0.8);
    lv_label_set_long_mode(status_label_, LV_LABEL_LONG_SCROLL_CIRCULAR);
    lv_obj_set_style_text_align(status_label_, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(status_label_, theme->text_color(), 0);
    lv_label_set_text(status_label_, "Ready");
    lv_obj_align(status_label_, LV_ALIGN_TOP_MID, 0, TOP_BAR_H + 2);

    content_ = lv_obj_create(screen_);
    lv_obj_set_style_radius(content_, 0, 0);
    lv_obj_set_size(content_, LV_HOR_RES, LV_VER_RES - TOP_BAR_H - 24);
    lv_obj_align(content_, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_obj_set_style_pad_all(content_, theme->spacing(4), 0);
    lv_obj_set_style_border_width(content_, 0, 0);
    lv_obj_set_style_bg_color(content_, theme->background_color(), 0);
    lv_obj_set_scrollbar_mode(content_, LV_SCROLLBAR_MODE_OFF);
    lv_obj_set_scroll_dir(content_, LV_DIR_VER);
    lv_obj_set_flex_flow(content_, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(content_, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    lv_obj_set_style_pad_row(content_, theme->spacing(4), 0);
}

bool ChatScreen::OnTap(int x, int y) {
    ESP_LOGI(TAG, "OnTap(%d, %d) — calling ToggleChatState", x, y);
    auto& app = Application::GetInstance();
    app.ToggleChatState();
    return true;
}

void ChatScreen::OnEnter() {
}

void ChatScreen::SetStatus(const char* status) {
    if (status_label_ != nullptr) {
        lvgl_port_lock(0);
        lv_label_set_text(status_label_, status);
        lvgl_port_unlock();
    }
}

void ChatScreen::SetAlertIcon(const char* icon) {
    if (content_ == nullptr || icon == nullptr || icon[0] == '\0') return;
    auto* theme = static_cast<LvglTheme*>(Board::GetInstance().GetDisplay()->GetTheme());

    lvgl_port_lock(0);

    // Check if an icon container already exists (update in place).
    // Never delete/recreate LVGL objects from non-LVGL tasks — lv_obj_del
    // crashes in lv_event_mark_deleted due to stale global event state.
    uint32_t count = lv_obj_get_child_cnt(content_);
    for (uint32_t i = 0; i < count; i++) {
        lv_obj_t* child = lv_obj_get_child(content_, i);
        if (child && lv_obj_get_user_data(child) == (void*)"icon") {
            lv_obj_t* lbl = lv_obj_get_child(child, 0);
            if (lbl) lv_label_set_text(lbl, icon);
            lv_obj_clear_flag(child, LV_OBJ_FLAG_HIDDEN);
            lvgl_port_unlock();
            return;
        }
    }

    // First time: create icon container in the content flow.
    lv_obj_t* container = lv_obj_create(content_);
    lv_obj_set_width(container, LV_HOR_RES);
    lv_obj_set_height(container, LV_SIZE_CONTENT);
    lv_obj_set_style_bg_opa(container, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(container, 0, 0);
    lv_obj_set_style_pad_all(container, 0, 0);
    lv_obj_set_style_pad_top(container, theme->spacing(8), 0);

    lv_obj_t* lbl = lv_label_create(container);
    lv_obj_set_style_text_font(lbl, theme->large_icon_font()->font(), 0);
    lv_obj_set_style_text_color(lbl, theme->text_color(), 0);
    lv_label_set_text(lbl, icon);
    lv_obj_align(lbl, LV_ALIGN_CENTER, 0, 0);
    lv_obj_set_user_data(container, (void*)"icon");
    lvgl_port_unlock();
}

void ChatScreen::ClearChatMessages() {
    if (content_ == nullptr) {
        return;
    }
    lvgl_port_lock(0);
    lv_obj_clean(content_);
    lvgl_port_unlock();
    chat_message_label_ = nullptr;
}

void ChatScreen::SetChatMessage(const char* role, const char* content) {
    if (content_ == nullptr) {
        return;
    }

    lvgl_port_lock(0);
    auto* theme = static_cast<LvglTheme*>(Board::GetInstance().GetDisplay()->GetTheme());

    uint32_t child_count = lv_obj_get_child_cnt(content_);
    if (child_count >= MAX_MESSAGES) {
        lv_obj_t* first_child = lv_obj_get_child(content_, 0);
        if (first_child != nullptr) {
            lv_obj_del(first_child);
            child_count = lv_obj_get_child_cnt(content_);
        }
        if (child_count > 0) {
            lv_obj_t* last_child = lv_obj_get_child(content_, child_count - 1);
            if (last_child != nullptr && lv_obj_is_valid(last_child)) {
                lv_obj_scroll_to_view_recursive(last_child, LV_ANIM_OFF);
            }
        }
    }

    if (strcmp(role, "system") == 0) {
        child_count = lv_obj_get_child_cnt(content_);
        if (child_count > 0) {
            lv_obj_t* last_container = lv_obj_get_child(content_, child_count - 1);
            if (last_container != nullptr && lv_obj_is_valid(last_container) && lv_obj_get_child_cnt(last_container) > 0) {
                lv_obj_t* last_bubble = lv_obj_get_child(last_container, 0);
                if (last_bubble != nullptr && lv_obj_is_valid(last_bubble)) {
                    void* bubble_type_ptr = lv_obj_get_user_data(last_bubble);
                    if (bubble_type_ptr != nullptr && strcmp((const char*)bubble_type_ptr, "system") == 0) {
                        // Update existing system message in place instead of
                        // delete-and-recreate. lv_obj_del() from a non-LVGL task
                        // crashes in lv_event_mark_deleted (stale event pointers).
                        if (strlen(content) > 0) {
                            lv_obj_t* msg_text = lv_obj_get_child(last_bubble, 0);
                            if (msg_text != nullptr) {
                                lv_label_set_text(msg_text, content);
                                lv_obj_scroll_to_view_recursive(last_container, LV_ANIM_ON);
                                chat_message_label_ = msg_text;
                                lvgl_port_unlock();
                                return;
                            }
                        } else {
                            // Empty content = clear the system message
                            lv_obj_add_flag(last_container, LV_OBJ_FLAG_HIDDEN);
                            lvgl_port_unlock();
                            return;
                        }
                    }
                }
            }
        }
    }

    if (strlen(content) == 0) {
        lvgl_port_unlock();
        return;
    }

    lv_obj_t* msg_bubble = lv_obj_create(content_);
    lv_obj_set_style_radius(msg_bubble, 8, 0);
    lv_obj_set_scrollbar_mode(msg_bubble, LV_SCROLLBAR_MODE_OFF);
    lv_obj_set_style_border_width(msg_bubble, 0, 0);
    lv_obj_set_style_pad_all(msg_bubble, theme->spacing(4), 0);

    lv_obj_t* msg_text = lv_label_create(msg_bubble);
    lv_label_set_text(msg_text, content);

    lv_coord_t max_width = LV_HOR_RES * 85 / 100 - 16;
    lv_coord_t min_width = 20;
    lv_obj_set_width(msg_text, LV_SIZE_CONTENT);
    lv_obj_update_layout(msg_text);
    lv_coord_t text_width = lv_obj_get_width(msg_text);
    if (text_width < min_width) text_width = min_width;
    lv_coord_t bubble_width = (text_width < max_width) ? text_width : max_width;

    lv_obj_set_width(msg_text, bubble_width);
    lv_label_set_long_mode(msg_text, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(msg_bubble, LV_SIZE_CONTENT);
    lv_obj_set_height(msg_bubble, LV_SIZE_CONTENT);
    lv_obj_set_style_flex_grow(msg_bubble, 0, 0);

    if (strcmp(role, "user") == 0) {
        lv_obj_set_style_bg_color(msg_bubble, theme->user_bubble_color(), 0);
        lv_obj_set_style_bg_opa(msg_bubble, LV_OPA_70, 0);
        lv_obj_set_style_text_color(msg_text, theme->text_color(), 0);
        lv_obj_set_user_data(msg_bubble, (void*)"user");

        lv_obj_t* container = lv_obj_create(content_);
        lv_obj_set_width(container, LV_HOR_RES);
        lv_obj_set_height(container, LV_SIZE_CONTENT);
        lv_obj_set_style_bg_opa(container, LV_OPA_TRANSP, 0);
        lv_obj_set_style_border_width(container, 0, 0);
        lv_obj_set_style_pad_all(container, 0, 0);
        lv_obj_set_parent(msg_bubble, container);
        lv_obj_align(msg_bubble, LV_ALIGN_RIGHT_MID, -25, 0);
        lv_obj_scroll_to_view_recursive(container, LV_ANIM_ON);
    } else if (strcmp(role, "system") == 0) {
        lv_obj_set_style_bg_color(msg_bubble, theme->system_bubble_color(), 0);
        lv_obj_set_style_bg_opa(msg_bubble, LV_OPA_70, 0);
        lv_obj_set_style_text_color(msg_text, theme->system_text_color(), 0);
        lv_obj_set_user_data(msg_bubble, (void*)"system");

        lv_obj_t* container = lv_obj_create(content_);
        lv_obj_set_width(container, LV_HOR_RES);
        lv_obj_set_height(container, LV_SIZE_CONTENT);
        lv_obj_set_style_bg_opa(container, LV_OPA_TRANSP, 0);
        lv_obj_set_style_border_width(container, 0, 0);
        lv_obj_set_style_pad_all(container, 0, 0);
        lv_obj_set_parent(msg_bubble, container);
        lv_obj_align(msg_bubble, LV_ALIGN_CENTER, 0, 0);
        lv_obj_scroll_to_view_recursive(container, LV_ANIM_ON);
    } else if (strcmp(role, "schedule") == 0) {
        lv_obj_set_style_bg_color(msg_bubble, lv_color_hex(0x3b82f6), 0);  // blue
        lv_obj_set_style_bg_opa(msg_bubble, LV_OPA_70, 0);
        lv_obj_set_style_text_color(msg_text, lv_color_white(), 0);
        lv_obj_set_user_data(msg_bubble, (void*)"schedule");
        lv_obj_align(msg_bubble, LV_ALIGN_LEFT_MID, 0, 0);
        lv_obj_scroll_to_view_recursive(msg_bubble, LV_ANIM_ON);
    } else {
        lv_obj_set_style_bg_color(msg_bubble, theme->assistant_bubble_color(), 0);
        lv_obj_set_style_bg_opa(msg_bubble, LV_OPA_70, 0);
        lv_obj_set_style_text_color(msg_text, theme->text_color(), 0);
        lv_obj_set_user_data(msg_bubble, (void*)"assistant");
        lv_obj_align(msg_bubble, LV_ALIGN_LEFT_MID, 0, 0);
        lv_obj_scroll_to_view_recursive(msg_bubble, LV_ANIM_ON);
    }

    chat_message_label_ = msg_text;
    lvgl_port_unlock();
}
