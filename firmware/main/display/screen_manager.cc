// main/display/screen_manager.cc
#include "screen_manager.h"
#include <esp_log.h>
#include <esp_lvgl_port.h>

#define TAG "ScreenMgr"

ScreenManager::ScreenManager() {
    screens_.fill(nullptr);
}

ScreenManager::~ScreenManager() {
    for (auto screen : screens_) {
        delete screen;
    }
}

void ScreenManager::AddScreen(ScreenId id, Screen* screen) {
    screens_[id] = screen;
}

void ScreenManager::NavigateTo(ScreenId id) {
    if (id == current_id_ || screens_[id] == nullptr) {
        return;
    }

    auto* target = screens_[id]->GetScreen();
    if (target == nullptr) {
        ESP_LOGE(TAG, "Screen %d has no LVGL object", id);
        return;
    }

    lv_screen_load_anim_t anim = (id > current_id_)
        ? LV_SCR_LOAD_ANIM_MOVE_LEFT
        : LV_SCR_LOAD_ANIM_MOVE_RIGHT;

    screens_[current_id_]->OnExit();
    current_id_ = id;
    screens_[current_id_]->OnEnter();

    lvgl_port_lock(0);
    lv_screen_load_anim(target, anim, 200, 0, false);
    lvgl_port_unlock();
}

void ScreenManager::NavigateNext() {
    int next = (static_cast<int>(current_id_) + 1) % kScreenCount;
    for (int i = 0; i < kScreenCount; i++) {
        if (screens_[next] != nullptr) {
            break;
        }
        next = (next + 1) % kScreenCount;
    }
    if (screens_[next] != nullptr && next != static_cast<int>(current_id_)) {
        auto* target = screens_[next]->GetScreen();
        screens_[current_id_]->OnExit();
        current_id_ = static_cast<ScreenId>(next);
        screens_[current_id_]->OnEnter();
        lvgl_port_lock(0);
        lv_screen_load_anim(target, LV_SCR_LOAD_ANIM_MOVE_LEFT, 200, 0, false);
        lvgl_port_unlock();
    }
}

void ScreenManager::NavigatePrev() {
    int prev = (static_cast<int>(current_id_) - 1 + kScreenCount) % kScreenCount;
    for (int i = 0; i < kScreenCount; i++) {
        if (screens_[prev] != nullptr) {
            break;
        }
        prev = (prev - 1 + kScreenCount) % kScreenCount;
    }
    if (screens_[prev] != nullptr && prev != static_cast<int>(current_id_)) {
        auto* target = screens_[prev]->GetScreen();
        screens_[current_id_]->OnExit();
        current_id_ = static_cast<ScreenId>(prev);
        screens_[current_id_]->OnEnter();
        lvgl_port_lock(0);
        lv_screen_load_anim(target, LV_SCR_LOAD_ANIM_MOVE_RIGHT, 200, 0, false);
        lvgl_port_unlock();
    }
}

void ScreenManager::HandleTap(int x, int y) {
    if (screens_[current_id_] != nullptr) {
        screens_[current_id_]->OnTap(x, y);
    }
}

void ScreenManager::UpdateAll() {
    auto* screen = screens_[current_id_];
    if (screen != nullptr) {
        lvgl_port_lock(0);
        screen->Update();
        lvgl_port_unlock();
    }
}

void ScreenManager::ShowNotification(const char* text) {
    auto* screen = screens_[current_id_];
    if (screen != nullptr) {
        screen->ShowNotification(text);
    }
}

void ScreenManager::HideNotification() {
    auto* screen = screens_[current_id_];
    if (screen != nullptr) {
        screen->HideNotification();
    }
}
