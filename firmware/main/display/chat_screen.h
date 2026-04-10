#ifndef CHAT_SCREEN_H
#define CHAT_SCREEN_H

#include "screen.h"

// Forward-declare to avoid circular includes (Application -> Display -> ChatScreen -> Application)
class Application;

class ChatScreen : public Screen {
public:
    void Create(lv_obj_t* parent) override;
    bool OnTap(int x, int y) override;
    void OnEnter() override;

    void SetChatMessage(const char* role, const char* content);
    void ClearChatMessages();
    void SetStatus(const char* status);
    void SetAlertIcon(const char* icon);

private:
    lv_obj_t* status_label_ = nullptr;
    lv_obj_t* content_ = nullptr;
    lv_obj_t* chat_message_label_ = nullptr;
};

#endif // CHAT_SCREEN_H
