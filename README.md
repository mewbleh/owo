# owotify

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Yarn](https://img.shields.io/badge/Yarn-1.22-2C8EBB?logo=yarn&logoColor=white)](https://yarnpkg.com/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](./Dockerfile)
[![Render](https://img.shields.io/badge/Render-selfbot_service-46E3B7?logo=render&logoColor=white)](./render.yaml)
[![Railway](https://img.shields.io/badge/Railway-ready-0B0D0E?logo=railway&logoColor=white)](./railway.json)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)

`owotify` is a TypeScript Discord selfbot that watches your current Spotify playback and sends
synced lyric lines to a configured Discord channel in near real time.

Spotify playback is read through the Spotify Web API. Lyrics are resolved through LRCLIB.
Discord delivery is handled by a small raw REST/Gateway transport instead of an archived
selfbot framework.

## Features

- Polls Spotify for the currently playing track.
- Looks up synchronized lyrics from LRCLIB.
- Sends lyric lines to Discord with configurable pacing.
- Supports custom message templates.
- Includes raw Discord REST/Gateway transport.
- Supports Discord selfbot control commands.
- Supports manual lyric posting and Discord custom-status output mode.
- Avoids accidental mentions with `allowed_mentions: { parse: [] }`.
- Retries Discord `429` responses with the returned delay.
- Ships Docker, Docker Compose, Render, Railway, Nixpacks, and Procfile metadata.

## Important Notice

This project uses a Discord user token, not a normal Discord bot token.

- Account automation can trigger Discord account flags, locks, or termination.
- A leaked `DISCORD_TOKEN` grants access to the account. Keep it only in `.env` or host
  secret storage.
- Never commit `.env`, paste tokens into chat, or print tokens in logs.
- Discord API/client changes can break user-token automation even with the raw transport.
- Lyrics can send many messages quickly. Tune `OWOTIFY_MIN_MESSAGE_INTERVAL_MS` and
  `OWOTIFY_MAX_LINES_PER_TICK` for your target channel.

## Architecture

```text
Spotify Web API -> owotify poller -> LRCLIB lyrics lookup -> Discord REST messages
                                      |
                                      +-> Discord Gateway session check
```

Core modules:

- `src/spotify/spotifyClient.ts`: Spotify token refresh and current playback polling.
- `src/lyrics/lrclibClient.ts`: LRCLIB lookup and response caching.
- `src/lyrics/lrcParser.ts`: synchronized LRC parsing.
- `src/discord/discordMessenger.ts`: raw Discord REST/Gateway client.
- `src/owotifyRunner.ts`: playback session tracking and lyric dispatch loop.

## Quick Start

Install dependencies:

```bash
yarn install
```

Create local environment config:

```bash
cp .env.example .env
```

Fill your Spotify app values:

```env
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://127.0.0.1:4377/callback
```

Generate a Spotify refresh token:

```bash
yarn spotify:auth
```

Fill runtime secrets:

```env
DISCORD_TOKEN=
DISCORD_CHANNEL_ID=
DISCORD_DM_RECIPIENT_ID=
SPOTIFY_REFRESH_TOKEN=
```

For DM mode, leave `DISCORD_CHANNEL_ID` empty and set `DISCORD_DM_RECIPIENT_ID`:

```env
DISCORD_CHANNEL_ID=
DISCORD_DM_RECIPIENT_ID=123456789012345678
```

`DISCORD_DM_RECIPIENT_ID` must be the target user's ID. If you already have an existing DM
channel ID, put that value in `DISCORD_CHANNEL_ID` instead.

Discord DM URLs are channel URLs. For example:

```text
https://discord.com/channels/@me/1521022683905523834
```

Use either the full URL or the last ID as `DISCORD_CHANNEL_ID`:

```env
DISCORD_CHANNEL_ID=https://discord.com/channels/@me/1521022683905523834
DISCORD_DM_RECIPIENT_ID=
```

or:

```env
DISCORD_CHANNEL_ID=1521022683905523834
DISCORD_DM_RECIPIENT_ID=
```

Run locally:

```bash
yarn dev
```

## Selfbot Commands

Commands are sent in the configured Discord channel or DM from the same account running the
selfbot. The default prefix is `owo`.

Lyric posting is manual by default. Start the process, then send `owo start` when you want
owotify to begin posting for the next active Spotify playback.

| Command | Description |
| --- | --- |
| `owo start` | Arm lyric posting. Lyrics begin when Spotify reports active playback. |
| `owo stop` | Stop lyric posting while keeping the process online. |
| `owo pause` | Alias for `stop`. |
| `owo resume` | Alias for `start`. |
| `owo status` | Show whether lyric posting is enabled and what track is loaded. |
| `owo mode` | Show the current output mode. |
| `owo mode message` | Send lyrics as Discord messages. |
| `owo mode status` | Update Discord custom status instead of sending lyric messages. |
| `owo mode both` | Send messages and update Discord custom status. |
| `owo target show` | Show the current lyric output target. |
| `owo target here` | Override the lyric output target to the channel or DM where you typed the command. |
| `owo target channel <id/url>` | Override the lyric output target to a channel ID or Discord channel URL. |
| `owo target dm <user_id>` | Override the lyric output target by creating/reusing a DM with a user ID. |
| `owo target reset` | Reset the lyric output target back to `.env`. |
| `owo skip` | Clear the current track session and reload lyrics on the next poll. |
| `owo reload` | Alias for `skip`. |
| `owo help` | Show available commands. |
| `owo shutdown` | Stop lyric posting and shut down the process. |

Commands require `DISCORD_GATEWAY_ENABLED=true`, because they are received through Gateway
`MESSAGE_CREATE` events.

Target overrides are runtime-only. Restarting owotify or running `owo target reset` returns to
the target configured in `.env`.

## Getting Credentials

### Discord

- `DISCORD_TOKEN`: user account token from an account you control. Store it in `.env` for
  local use or secret storage in production.
- `DISCORD_CHANNEL_ID`: enable Discord Developer Mode, right-click the target channel, then
  copy the channel ID.
- `DISCORD_DM_RECIPIENT_ID`: optional alternative to `DISCORD_CHANNEL_ID`. Set this to a user
  ID, not a DM channel ID, and owotify will create/reuse that DM channel at startup.
- `DISCORD_GATEWAY_ENABLED`: keep this `true` for a Gateway session check. Set it to `false`
  if you only want REST sending.

### Spotify

- Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
- Add `SPOTIFY_REDIRECT_URI` from `.env` as an allowed redirect URI.
- Fill `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`.
- Run `yarn spotify:auth` and paste the printed `SPOTIFY_REFRESH_TOKEN` into `.env`.

## Configuration

All runtime configuration is environment-based.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | Yes | - | Discord user token used for REST and Gateway auth. |
| `DISCORD_CHANNEL_ID` | Conditional | - | Target guild/text/DM channel ID or Discord `/channels/...` URL. Required unless `DISCORD_DM_RECIPIENT_ID` is set. |
| `DISCORD_DM_RECIPIENT_ID` | Conditional | - | User ID to DM. Used only when `DISCORD_CHANNEL_ID` is empty. |
| `DISCORD_API_BASE_URL` | No | `https://discord.com/api/v10` | Discord REST API base URL. |
| `DISCORD_GATEWAY_URL` | No | `wss://gateway.discord.gg/?v=10&encoding=json` | Discord Gateway URL. |
| `DISCORD_GATEWAY_ENABLED` | No | `true` | Enables Gateway session validation. |
| `DISCORD_GATEWAY_INTENTS` | No | `37377` | Gateway intents used for selfbot command messages. |
| `SPOTIFY_CLIENT_ID` | Yes | - | Spotify application client ID. |
| `SPOTIFY_CLIENT_SECRET` | Yes | - | Spotify application client secret. |
| `SPOTIFY_REFRESH_TOKEN` | Yes | - | Refresh token from `yarn spotify:auth`. |
| `SPOTIFY_MARKET` | No | `US` | Spotify market for playback metadata. |
| `SPOTIFY_REDIRECT_URI` | No | `http://127.0.0.1:4377/callback` | Redirect URI used by the auth helper. |
| `LRCLIB_BASE_URL` | No | `https://lrclib.net` | Lyrics provider base URL. |
| `OWOTIFY_LOG_LEVEL` | No | `info` | Pino log level. |
| `OWOTIFY_POLL_INTERVAL_MS` | No | `2000` | Spotify polling interval. |
| `OWOTIFY_LYRIC_LOOKAHEAD_MS` | No | `350` | Sends lines slightly ahead of playback time. |
| `OWOTIFY_REWIND_RESET_THRESHOLD_MS` | No | `3000` | Rewind threshold before lyric index resets. |
| `OWOTIFY_MIN_MESSAGE_INTERVAL_MS` | No | `1100` | Minimum delay between Discord messages. |
| `OWOTIFY_MAX_LINES_PER_TICK` | No | `4` | Maximum lyric lines sent per poll tick. |
| `OWOTIFY_MAX_MESSAGE_LENGTH` | No | `1900` | Maximum Discord message chunk length. |
| `OWOTIFY_AUTO_START` | No | `false` | When `false`, lyrics wait for `owo start`. |
| `OWOTIFY_OUTPUT_MODE` | No | `message` | `message`, `status`, or `both`. |
| `OWOTIFY_PRESENCE_STATUS` | No | `online` | Presence state for status mode: `online`, `idle`, `dnd`, or `invisible`. |
| `OWOTIFY_STATUS_TEMPLATE` | No | `{line}` | Discord custom-status template for lyric lines. |
| `OWOTIFY_STATUS_IDLE_TEMPLATE` | No | `owotify idle` | Custom status shown when stopped or no Spotify playback is active. |
| `OWOTIFY_COMMANDS_ENABLED` | No | `true` | Enables Discord selfbot commands. |
| `OWOTIFY_COMMAND_PREFIX` | No | `owo` | Prefix used for Discord selfbot commands. |
| `OWOTIFY_SEND_TRACK_HEADER` | No | `true` | Sends a header when a new track starts. |
| `OWOTIFY_TRACK_HEADER_TEMPLATE` | No | `Now playing: {track} - {artist}` | New-track message template. |
| `OWOTIFY_LYRIC_LINE_TEMPLATE` | No | `{line}` | Lyric line template. |
| `OWOTIFY_NO_LYRICS_TEMPLATE` | No | `No synced lyrics found for {track} - {artist}.` | Missing-lyrics message. |
| `OWOTIFY_PLAIN_LYRICS_MODE` | No | `off` | Set to `once` to send plain lyrics when synced lyrics are unavailable. |
| `OWOTIFY_PLAIN_LYRICS_TEMPLATE` | No | `{plainLyrics}` | Plain lyrics fallback template. |
| `OWOTIFY_SEND_NO_LYRICS_MESSAGE` | No | `true` | Enables missing-lyrics messages. |

Template variables:

- `{track}`
- `{artist}` or `{artists}`
- `{album}`
- `{line}`
- `{plainLyrics}`
- `{spotifyUrl}`
- `{progressMs}`
- `{durationMs}`
- `{timeMs}`

## Deployment

`owotify` is a long-running Discord selfbot process. It does not expose an HTTP port, so some
hosting providers label the deployment as a `worker`; that is only the platform process type,
not the project identity.

| Platform | Metadata | Notes |
| --- | --- | --- |
| Docker | `Dockerfile`, `.dockerignore` | Multi-stage production image. |
| Docker Compose | `compose.yaml` | Reads local `.env` and restarts unless stopped. |
| Render | `render.yaml` | Defines a Docker-backed selfbot service using Render's `worker` type. |
| Railway | `railway.json` | Uses the Dockerfile builder and selfbot start command. |
| Nixpacks | `nixpacks.toml` | Buildpack-style install, build, and start phases. |
| Procfile platforms | `Procfile` | Defines `worker: yarn start` for hosts that require a non-web process name. |

### Docker

Build and run:

```bash
docker build -t owotify .
docker run --env-file .env --name owotify owotify
```

Docker Compose:

```bash
docker compose up --build
```

### Render

Use `render.yaml` as a Blueprint. The service is configured as a Docker-backed selfbot process
using Render's `worker` service type. Add secret values in the Render dashboard for every
variable marked `sync: false`.

Required secrets:

- `DISCORD_TOKEN`
- `DISCORD_CHANNEL_ID` or `DISCORD_DM_RECIPIENT_ID`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REFRESH_TOKEN`

### Railway

Railway can build from the included Dockerfile using `railway.json`. Add the same required
secrets in Railway Variables, then deploy the repository.

### Nixpacks and Procfile Hosts

Hosts that support Nixpacks can use `nixpacks.toml`. Heroku-style hosts can use the
`Procfile` command. The `worker` label is the process type those hosts expect for long-running
non-web services.

## Scripts

```bash
yarn dev        # run with tsx watch
yarn build      # compile src/ to dist/
yarn start      # run compiled output
yarn test       # run unit tests
yarn lint       # run ESLint
yarn typecheck  # TypeScript check without emitting
yarn spotify:auth # generate a Spotify refresh token
```

## References

- [Spotify currently playing endpoint](https://developer.spotify.com/documentation/web-api/reference/get-the-users-currently-playing-track)
- [Spotify authorization code flow](https://developer.spotify.com/documentation/web-api/tutorials/code-flow)
- [LRCLIB docs](https://lrclib.net/docs)
- [Discord Gateway docs](https://discord.com/developers/docs/topics/gateway)
- [Discord Gateway events](https://discord.com/developers/docs/events/gateway-events)
- [Discord create message endpoint](https://discord.com/developers/docs/resources/message#create-message)
- [Render Blueprint spec](https://render.com/docs/blueprint-spec)
- [Railway config-as-code](https://docs.railway.com/reference/config-as-code)
- [Nixpacks configuration](https://nixpacks.com/docs/configuration/file)
