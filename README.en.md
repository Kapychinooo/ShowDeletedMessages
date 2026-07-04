# ShowDeletedMessages

A [BetterDiscord](https://betterdiscord.app) plugin that shows deleted messages directly in chat.

---

# Кликните [сюда](https://github.com/Kapychinooo/ShowDeletedMessages/blob/main/README.md), чтобы прочитать русскую версию.

## Features

- Displays deleted messages with a **DELETED** badge
- Restores message text, images and attachments
- Shows the author's avatar and username
- Messages persist after switching channels and coming back
- Supports bulk message deletion

## Preview

> A deleted message looks like this:

```
┌─ [avatar] Kakao<3 🌀 tag 👑  2:55  [ DELETED ]
│  this is the deleted message text
│  🖼️ (image if there was one)
```

---

## Installation

1. Make sure [BetterDiscord](https://betterdiscord.app) **1.9.0+** is installed
2. Download `ShowDeletedMessages.plugin.js`
3. Open your plugins folder:
   - In Discord: **Settings → Plugins → Open Plugins Folder**
   - Or manually: `%appdata%\BetterDiscord\plugins\`
4. Copy the file into the plugins folder
5. In Discord go to **Settings → Plugins** and enable **ShowDeletedMessages**

---

## Requirements

| Requirement | Version |
|---|---|
| BetterDiscord | 1.9.0+ |
| Discord | any current |

---

## Limitations

- Messages are cached **in memory only** — the deleted message history is cleared when Discord restarts
- The plugin can only show messages that were loaded in chat **while the channel was open**. If a message was deleted while you were in another channel, it won't be captured
- Does not work in channels you don't have access to

---

## How it works

The plugin hooks into Discord's Flux Dispatcher:
- `MESSAGE_CREATE` / `MESSAGE_UPDATE` — saves messages to an in-memory cache
- `MESSAGE_DELETE` — before Discord removes the element from the DOM, captures the data and inserts a custom element in its place
- `LOAD_MESSAGES_SUCCESS` — when you return to a channel, restores deleted messages from the cache in chronological order

---

## Author

Kapychinooo

## For developers

```
I did not use artificial intelligence to create the plugin, everything is signed in the plugin files so that it would be convenient for other people to redo something for themselves.
```

If you have any questions, write to diskord @kakao_cs
