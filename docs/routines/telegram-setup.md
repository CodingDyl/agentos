# Connect Telegram to AgentOS routines

Hermes sends the messages. AgentOS only writes them. So you connect Telegram
to **Hermes**, not to AgentOS.

## Your state on 2026-11-13

| Part | State |
|---|---|
| Telegram bot | Made. Its token is in `~/.hermes/.env` |
| Hermes gateway | Running. Telegram shows "connected" |
| Home chat (where scheduled messages go) | Set. It is a private chat |
| Who may chat with the bot (`TELEGRAM_ALLOWED_USERS`) | **Not set** |

This means: routines can send you messages now. You cannot chat back to
Hermes until you do Part 3.

If all of this is true for you, start at Part 2.

## Part 1: Make the bot (skip this if the table says "Made")

1. Open Telegram. Search for `@BotFather`.
2. Send `/newbot`.
3. Give a display name, for example `Hermes`.
4. Give a username that ends in `bot`, for example `dylan_hermes_bot`.
5. BotFather replies with a token. Keep it secret.
6. In Terminal, run:

   ```bash
   hermes gateway setup
   ```

7. Choose **Telegram**. Paste the token when it asks.
8. Restart the gateway:

   ```bash
   hermes gateway restart
   ```

## Part 2: Find your bot and get a test message

1. Open Telegram. Search for `@BotFather`.
2. Send `/mybots`. It shows the username of your bot.
3. Tap the username. Open the chat with your bot.
4. Tap **Start**. A bot cannot message you before you do this.
5. Open AgentOS. Go to Operations → Scheduled tasks.
6. Find the job `AgentOS: Follow-ups due`. Click **Run now**.
7. Wait one minute. A message arrives in the chat with your bot.

A routine sends nothing when it has nothing to say. To see what a routine
would send, click **Preview** in the Routines section first.

## Part 3: Let yourself chat with Hermes (optional)

Without this step, Hermes refuses every chat message, also yours.

1. In Telegram, search for `@userinfobot`. Send it any message.
2. It replies with your user ID. This is a number, for example `123456789`.
3. Open `~/.hermes/.env` in an editor.
4. Add this line, with your number:

   ```bash
   TELEGRAM_ALLOWED_USERS=123456789
   ```

5. Save the file. Then run:

   ```bash
   hermes gateway restart
   ```

6. Send `hello` to your bot. Hermes answers.

Only put your own ID there. Anyone on that list can give Hermes commands on
your Mac.

## Part 4: Change where scheduled messages go (optional)

1. Do Part 3 first.
2. Open the chat (or group) that must receive the messages.
3. Send `/sethome`.

## Checks

| Command | What a good result looks like |
|---|---|
| `hermes gateway status` | The gateway runs |
| `hermes cron list` | Each routine shows `Deliver: telegram` |
| AgentOS → Operations → Scheduled tasks → Routines | The tag reads "Telegram connected" |

## Problems

| Problem | Cause | Fix |
|---|---|---|
| No message after **Run now** | The routine had nothing to say | Click **Preview**. If it says "It would send nothing now", that is correct |
| No message, and Preview shows text | You did not tap **Start** in the bot chat | Do Part 2, step 4 |
| No message, and AgentOS is closed | The routine asks AgentOS for its text | Keep AgentOS running |
| The bot replies "unauthorized" | Your ID is not in `TELEGRAM_ALLOWED_USERS` | Do Part 3 |
| The tag reads "Telegram not connected" | The gateway is down or the token is wrong | Run `hermes gateway restart`, then `hermes gateway status` |
| The gateway reports "degraded" | Discord and WhatsApp are switched on but not set up | Not a Telegram problem, and routines still work. If you do not use them: in `~/.hermes/.env`, put `#` before the `DISCORD_BOT_TOKEN` line and set `WHATSAPP_ENABLED=false`, then restart the gateway. (Not tested on this Mac) |

Source: the Hermes guide at
`~/.hermes/hermes-agent/website/docs/user-guide/messaging/telegram.md`.
