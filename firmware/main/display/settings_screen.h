#ifndef SETTINGS_SCREEN_H
#define SETTINGS_SCREEN_H

#include "screen.h"

class SettingsScreen : public Screen {
public:
    void Create(lv_obj_t* parent) override;
    void Update() override;
    void OnEnter() override;

private:
    void RefreshStatus();

    lv_obj_t* wifi_label_ = nullptr;
    lv_obj_t* mem_int_label_ = nullptr;
    lv_obj_t* mem_ps_label_ = nullptr;
};

#endif // SETTINGS_SCREEN_H
