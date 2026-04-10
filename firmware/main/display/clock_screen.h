#ifndef CLOCK_SCREEN_H
#define CLOCK_SCREEN_H

#include "screen.h"
#include <cstdint>

class ClockScreen : public Screen {
public:
    void Create(lv_obj_t* parent) override;
    void Update() override;
    void OnEnter() override;

private:
    static void FetchWeatherTask(void* arg);
    bool DoFetchWeather();

    lv_obj_t* time_label_ = nullptr;
    lv_obj_t* date_label_ = nullptr;
    lv_obj_t* weather_label_ = nullptr;
    lv_obj_t* location_label_ = nullptr;

    // Weather cache (written by fetch task, read by Update)
    char weather_text_[64] = "";
    char location_text_[48] = "";
    int weather_code_ = -1;
    bool weather_ready_ = false;
    bool weather_fetching_ = false;
    int64_t last_weather_fetch_us_ = 0;
};

#endif // CLOCK_SCREEN_H
