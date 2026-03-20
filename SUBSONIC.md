# Subsonic / Navidrome API

Monochrome ships a **Subsonic-compatible REST API** server that lets you use
any Subsonic or Navidrome-compatible music client to browse and stream the same
music available through the Monochrome web interface.

The Subsonic API server is **bundled into the main Monochrome Docker image** and
starts automatically alongside the web UI. No extra containers or profiles are
needed.

## Supported Clients

Any client that speaks the [Subsonic REST API](http://www.subsonic.org/pages/api.jsp) (v1.16.1)
or the [OpenSubsonic](https://opensubsonic.netlify.app/) extension should work, including:

- **Symfonium** (Android)
- **Substreamer** (iOS)
- **DSub** (Android)
- **Ultrasonic** (Android)
- **Feishin** (Desktop)
- **Navidrome Web UI** (configure as a Subsonic server)
- **Rhythmbox** / **Clementine** (Linux desktop)

## Pre-built Images

Images are automatically built and published to GitHub Container Registry on
every push to `main` and on every release:

| Image                                                | Description                                    |
| ---------------------------------------------------- | ---------------------------------------------- |
| `ghcr.io/benjithatfoxguy/monochrome:latest`          | Main image — web UI **+ bundled Subsonic API** |
| `ghcr.io/benjithatfoxguy/monochrome-subsonic:latest` | Standalone Subsonic API only (no web UI)       |

## Quick Start

```bash
# The standard Monochrome compose file already exposes the Subsonic API.
docker compose up -d
```

The Subsonic API is available at:

- **Direct:** `http://localhost:4533/rest/`
- **Via nginx proxy:** `http://localhost:3000/rest/` (same port as the web UI)

## Configuration

All settings are controlled via environment variables (`.env` file or shell exports).

| Variable                   | Default               | Description                                      |
| -------------------------- | --------------------- | ------------------------------------------------ |
| `SUBSONIC_PORT`            | `4533`                | Internal port the Subsonic server listens on     |
| `SUBSONIC_USER`            | `admin`               | Subsonic username                                |
| `SUBSONIC_PASS`            | `admin`               | Subsonic password                                |
| `MONOCHROME_API_INSTANCES` | _(built-in defaults)_ | Comma-separated list of Monochrome API base URLs |

> **Important:** Change the default username and password before exposing the
> service to the internet.

Example `.env`:

```env
SUBSONIC_USER=myuser
SUBSONIC_PASS=a-very-strong-password
```

### Running alongside PocketBase

```bash
docker compose --profile pocketbase up -d
```

## Client Configuration

Point your Subsonic client at:

| Field    | Value                                                                             |
| -------- | --------------------------------------------------------------------------------- |
| Server   | `http://<your-host>:3000` (via nginx proxy) or `http://<your-host>:4533` (direct) |
| Username | _(value of `SUBSONIC_USER`)_                                                      |
| Password | _(value of `SUBSONIC_PASS`)_                                                      |

## Standalone Subsonic-Only Container

If you only want the Subsonic API without the web UI (e.g. to run it separately),
use the standalone image:

```bash
docker run -d \
  -e SUBSONIC_USER=myuser \
  -e SUBSONIC_PASS=secret \
  -p 4533:4533 \
  ghcr.io/benjithatfoxguy/monochrome-subsonic:latest
```

Or with Docker Compose using the `subsonic` profile (still builds from source):

```bash
docker compose --profile subsonic up -d
```

## Supported Endpoints

| Endpoint              | Notes                                                |
| --------------------- | ---------------------------------------------------- |
| `ping`                | Connectivity check                                   |
| `getLicense`          | Always returns valid                                 |
| `getMusicFolders`     | Returns a single virtual "Monochrome / TIDAL" folder |
| `getIndexes`          | Returns an empty index (use search)                  |
| `getArtists`          | Returns an empty index (use search)                  |
| `getMusicDirectory`   | Resolves `artist-{id}` and `album-{id}` directories  |
| `getArtist`           | Full artist info with album list                     |
| `getArtistInfo2`      | Stub (returns empty info)                            |
| `getAlbum`            | Album with full track list                           |
| `getSong`             | Single track metadata                                |
| `search2` / `search3` | Search tracks, albums, artists                       |
| `getAlbumList2`       | Random album list                                    |
| `getRandomSongs`      | Random songs via search                              |
| `stream`              | Proxy audio stream to the client                     |
| `download`            | Same as `stream`                                     |
| `getCoverArt`         | Proxy cover art from TIDAL CDN                       |
| `getPlaylist`         | Retrieve a TIDAL/Monochrome playlist by ID           |
| `getPlaylists`        | Returns empty list (no user session)                 |
| `scrobble`            | Accepted (no-op)                                     |
| `getUser`             | Returns configured user info                         |
| `star` / `unstar`     | Accepted (no-op)                                     |
| `setRating`           | Accepted (no-op)                                     |

## Limitations

- **No personal library**: Favorites, user playlists, and play history are
  managed by the Monochrome web frontend (IndexedDB) and are not exposed
  through the Subsonic API.
- **Streaming format**: Audio is served in whatever format the upstream TIDAL
  API provides (FLAC/MPEG-DASH). Some clients may require transcoding.
- **Transcoding**: No server-side transcoding is performed. The `maxBitRate`
  parameter maps to a Monochrome quality level:
    - `0` or unset → `HI_RES_LOSSLESS`
    - `320` / `192` → `HIGH`
    - `96` / `64` → `LOW`
- **Playlist management**: Creating/editing playlists via the Subsonic API is
  not persisted.

## Running Without Docker

```bash
# From the repository root
SUBSONIC_USER=admin SUBSONIC_PASS=secret bun server/index.js
```

Requires [Bun](https://bun.sh/) ≥ 1.3.
