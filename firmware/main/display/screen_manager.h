// main/display/screen_manager.h
#ifndef SCREEN_MANAGER_H
#define SCREEN_MANAGER_H

#include "screen.h"
#include "display.h"
#include <array>

class ScreenManager {
public:
    ScreenManager();
    ~ScreenManager();

    void AddScreen(ScreenId id, Screen* screen);

    void NavigateTo(ScreenId id);
    void NavigateNext();
    void NavigatePrev();
    ScreenId GetCurrentScreenId() const { return current_id_; }

    void HandleTap(int x, int y);
    void UpdateAll();
    void ShowNotification(const char* text);
    void HideNotification();

    Screen* GetScreen(ScreenId id) const { return screens_[id]; }

private:
    std::array<Screen*, kScreenCount> screens_ = {};
    ScreenId current_id_ = kScreenClock;
    bool animating_ = false;
};

#endif // SCREEN_MANAGER_H
