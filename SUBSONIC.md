# Subsonic / Navidrome API

Monochrome ships an optional **Subsonic-compatible REST API** server that lets
you use any Subsonic or Navidrome-compatible music client to browse and stream
the same music available through the Monochrome web interface.

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

## Enabling the API

The Subsonic server is an **optional** Docker Compose service that can be
enabled with the `subsonic` profile.

### Quick Start

```bash
# Start Monochrome + Subsonic API
docker compose --profile subsonic up -d
```

The Subsonic API is now available at **http://localhost:4533/rest/**.

### Configuration

All settings are controlled via environment variables (`.env` file or shell
exports).

| Variable                    | Default   | Description |
|-----------------------------|-----------|-------------|
| `SUBSONIC_PORT`             | `4533`    | Host port the API listens on |
| `SUBSONIC_USER`             | `admin`   | Subsonic username |
| `SUBSONIC_PASS`             | `admin`   | Subsonic password |
| `MONOCHROME_API_INSTANCES`  | *(built-in defaults)* | Comma-separated list of Monochrome API base URLs |

> **Important:** Change the default username and password before exposing the
> service to the internet.

Example `.env`:

```env
SUBSONIC_USER=myuser
SUBSONIC_PASS=a-very-strong-password
```

### Running alongside PocketBase

```bash
docker compose --profile subsonic --profile pocketbase up -d
```

## Client Configuration

Point your Subsonic client at:

| Field    | Value |
|----------|-------|
| Server   | `http://<your-host>:4533` |
| Username | *(value of `SUBSONIC_USER`)* |
| Password | *(value of `SUBSONIC_PASS`)* |

## Supported Endpoints

| Endpoint           | Notes |
|--------------------|-------|
| `ping`             | Connectivity check |
| `getLicense`       | Always returns valid |
| `getMusicFolders`  | Returns a single virtual "Monochrome / TIDAL" folder |
| `getIndexes`       | Returns an empty index (use search) |
| `getArtists`       | Returns an empty index (use search) |
| `getMusicDirectory`| Resolves `artist-{id}` and `album-{id}` directories |
| `getArtist`        | Full artist info with album list |
| `getArtistInfo2`   | Stub (returns empty info) |
| `getAlbum`         | Album with full track list |
| `getSong`          | Single track metadata |
| `search2` / `search3` | Search tracks, albums, artists |
| `getAlbumList2`    | Random album list |
| `getRandomSongs`   | Random songs via search |
| `stream`           | Proxy audio stream to the client |
| `download`         | Same as `stream` |
| `getCoverArt`      | Proxy cover art from TIDAL CDN |
| `getPlaylist`      | Retrieve a TIDAL/Monochrome playlist by ID |
| `getPlaylists`     | Returns empty list (no user session) |
| `scrobble`         | Accepted (no-op) |
| `getUser`          | Returns configured user info |
| `star` / `unstar`  | Accepted (no-op) |
| `setRating`        | Accepted (no-op) |

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
