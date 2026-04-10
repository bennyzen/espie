#ifndef NOW_PLAYING_SCREEN_H
#define NOW_PLAYING_SCREEN_H

#include "screen.h"

class NowPlayingScreen : public Screen {
public:
    void Create(lv_obj_t* parent) override;
    bool OnTap(int x, int y) override;

    void SetTrack(const char* title, const char* artist);

private:
    lv_obj_t* title_label_ = nullptr;
    lv_obj_t* artist_label_ = nullptr;
    lv_obj_t* hint_label_ = nullptr;
    lv_obj_t* idle_label_ = nullptr;
};

#endif // NOW_PLAYING_SCREEN_H
