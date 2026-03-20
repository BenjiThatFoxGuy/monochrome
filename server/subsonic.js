/**
 * Subsonic REST API handler.
 *
 * Implements enough of the Subsonic/OpenSubsonic specification to be
 * compatible with popular Navidrome-compatible clients (Symfonium,
 * Substreamer, DSub, etc.).
 *
 * Spec reference: http://www.subsonic.org/pages/api.jsp
 *                 https://opensubsonic.netlify.app/
 */

import { createHash } from 'node:crypto';
import { MonochromeApiClient } from './api-client.js';

const SUBSONIC_API_VERSION = '1.16.1';
const SERVER_VERSION = '2.5.0';
const SERVER_NAME = 'Monochrome';

// Quality mapping: Subsonic maxBitRate → Monochrome quality
const QUALITY_MAP = {
    0: 'HI_RES_LOSSLESS',
    320: 'HIGH',
    192: 'HIGH',
    128: 'HIGH',
    96: 'LOW',
    64: 'LOW',
};

// Nominal bitrate reported to Subsonic clients per quality tier
const BITRATE_BY_QUALITY = {
    HI_RES_LOSSLESS: 9999,
    HIGH: 320,
    LOW: 96,
};

/** Fisher-Yates shuffle (in-place, returns the array). */
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

export class SubsonicHandler {
    /**
     * @param {object} opts
     * @param {string[]} opts.apiInstances   - Monochrome API base URLs
     * @param {string}   opts.username       - Subsonic username
     * @param {string}   opts.password       - Subsonic password
     */
    constructor({ apiInstances, username, password }) {
        this.username = username;
        this.password = password;
        this.api = new MonochromeApiClient(apiInstances);
    }

    // =========================================================================
    // Main request dispatcher
    // =========================================================================

    async handle(req) {
        const url = new URL(req.url);

        // Extract action from path: /rest/ping.view → ping
        const pathParts = url.pathname.replace(/^\/+/, '').split('/');
        const restIndex = pathParts.indexOf('rest');
        const actionRaw = restIndex >= 0 ? pathParts[restIndex + 1] : pathParts[pathParts.length - 1];
        const action = (actionRaw ?? '').replace(/\.view$/, '');

        const params = Object.fromEntries(url.searchParams);

        // Authentication
        if (action !== '') {
            const authError = this._authenticate(params);
            if (authError) return this._respond(params, authError);
        }

        try {
            return await this._dispatch(action, params, req);
        } catch (err) {
            console.error(`[Subsonic] Error handling ${action}:`, err);
            return this._respond(params, this._error(0, `Internal server error: ${err.message}`));
        }
    }

    async _dispatch(action, params, req) {
        switch (action) {
            case 'ping':
                return this._respond(params, {});

            case 'getLicense':
                return this._respond(params, {
                    license: { valid: true, email: 'admin@monochrome', licenseExpires: '2099-12-31T00:00:00.000Z' },
                });

            case 'getMusicFolders':
                return this._respond(params, {
                    musicFolders: { musicFolder: [{ id: 1, name: 'Monochrome / TIDAL' }] },
                });

            case 'getIndexes':
                return this._handleGetIndexes(params);

            case 'getMusicDirectory':
                return this._handleGetMusicDirectory(params);

            case 'getGenres':
                return this._respond(params, { genres: { genre: [] } });

            case 'getArtists':
                return this._handleGetArtists(params);

            case 'getArtist':
                return this._handleGetArtist(params);

            case 'getArtistInfo':
            case 'getArtistInfo2':
                return this._handleGetArtistInfo(params);

            case 'getAlbum':
                return this._handleGetAlbum(params);

            case 'getSong':
                return this._handleGetSong(params);

            case 'getAlbumList':
            case 'getAlbumList2':
                return this._handleGetAlbumList(params, action);

            case 'getRandomSongs':
                return this._handleGetRandomSongs(params);

            case 'getSongsByGenre':
                return this._respond(params, { songsByGenre: { song: [] } });

            case 'search':
            case 'search2':
                return this._handleSearch2(params);

            case 'search3':
                return this._handleSearch3(params);

            case 'getPlaylists':
                return this._respond(params, { playlists: { playlist: [] } });

            case 'getPlaylist':
                return this._handleGetPlaylist(params);

            case 'createPlaylist':
            case 'updatePlaylist':
            case 'deletePlaylist':
                // Read-only API – clients that always call these will get an
                // empty-success rather than a hard error.
                return this._respond(params, {});

            case 'stream':
            case 'download':
                return this._handleStream(params, req);

            case 'getCoverArt':
                return this._handleGetCoverArt(params, req);

            case 'getLyrics':
                return this._respond(params, { lyrics: { artist: '', title: '', value: '' } });

            case 'scrobble':
                // Accept the call but don't forward - clients that scrobble won't break.
                return this._respond(params, {});

            case 'getUser':
                return this._handleGetUser(params);

            case 'getUsers':
                return this._respond(params, {
                    users: { user: [this._buildUser()] },
                });

            case 'getSimilarSongs':
            case 'getSimilarSongs2':
                return this._respond(params, { similarSongs: { song: [] } });

            case 'getTopSongs':
                return this._respond(params, { topSongs: { song: [] } });

            case 'getNowPlaying':
                return this._respond(params, { nowPlaying: {} });

            case 'getStarred':
            case 'getStarred2':
                return this._respond(params, { starred: {} });

            case 'star':
            case 'unstar':
            case 'setRating':
                return this._respond(params, {});

            case 'getBookmarks':
                return this._respond(params, { bookmarks: {} });

            case 'createBookmark':
            case 'deleteBookmark':
                return this._respond(params, {});

            case 'getInternetRadioStations':
                return this._respond(params, { internetRadioStations: {} });

            case 'getScanStatus':
                return this._respond(params, { scanStatus: { scanning: false, count: 0 } });

            default:
                return this._respond(params, this._error(70, `Method not found: ${action}`));
        }
    }

    // =========================================================================
    // Handler implementations
    // =========================================================================

    async _handleGetIndexes(params) {
        // Return a placeholder index; browsers that need it for "recent" lists
        // can still search via search2/search3.
        return this._respond(params, {
            indexes: {
                lastModified: Date.now(),
                ignoredArticles: 'The El La Los Las Le Les',
                index: [],
                shortcut: [],
                child: [],
            },
        });
    }

    async _handleGetMusicDirectory(params) {
        const id = params.id;
        if (!id) return this._respond(params, this._error(10, 'Missing required parameter: id'));

        // IDs are prefixed: "artist-{id}", "album-{id}"
        if (id.startsWith('artist-')) {
            return this._getMusicDirectoryArtist(params, id.slice(7));
        }
        if (id.startsWith('album-')) {
            return this._getMusicDirectoryAlbum(params, id.slice(6));
        }

        return this._respond(params, this._error(70, 'Not found'));
    }

    async _getMusicDirectoryArtist(params, artistId) {
        try {
            const { artist, albums } = await this.api.getArtist(artistId);
            const children = albums.map((al) => this._albumToDirectory(al));
            return this._respond(params, {
                directory: {
                    id: `artist-${artistId}`,
                    parent: '1',
                    name: artist.name,
                    child: children,
                },
            });
        } catch {
            return this._respond(params, this._error(70, 'Artist not found'));
        }
    }

    async _getMusicDirectoryAlbum(params, albumId) {
        try {
            const { album, tracks } = await this.api.getAlbum(albumId);
            const children = tracks.map((t) => this._trackToChild(t));
            return this._respond(params, {
                directory: {
                    id: `album-${albumId}`,
                    parent: `artist-${album.artist?.id ?? 0}`,
                    name: album.title,
                    child: children,
                },
            });
        } catch {
            return this._respond(params, this._error(70, 'Album not found'));
        }
    }

    async _handleGetArtists(params) {
        // We don't have a global artist list, so return an empty index.
        // Clients will mostly use search3 to find artists.
        return this._respond(params, {
            artists: {
                ignoredArticles: 'The El La Los Las Le Les',
                index: [],
            },
        });
    }

    async _handleGetArtist(params) {
        const id = params.id;
        if (!id) return this._respond(params, this._error(10, 'Missing required parameter: id'));

        const artistId = id.startsWith('artist-') ? id.slice(7) : id;
        try {
            const { artist, albums } = await this.api.getArtist(artistId);
            return this._respond(params, {
                artist: this._buildArtist(artist, albums),
            });
        } catch (err) {
            return this._respond(params, this._error(70, `Artist not found: ${err.message}`));
        }
    }

    async _handleGetArtistInfo(params) {
        const id = params.id;
        if (!id) return this._respond(params, this._error(10, 'Missing required parameter: id'));

        return this._respond(params, { artistInfo: {} });
    }

    async _handleGetAlbum(params) {
        const id = params.id;
        if (!id) return this._respond(params, this._error(10, 'Missing required parameter: id'));

        const albumId = id.startsWith('album-') ? id.slice(6) : id;
        try {
            const { album, tracks } = await this.api.getAlbum(albumId);
            const built = this._buildAlbum(album, tracks);
            return this._respond(params, { album: built });
        } catch (err) {
            return this._respond(params, this._error(70, `Album not found: ${err.message}`));
        }
    }

    async _handleGetSong(params) {
        const id = params.id;
        if (!id) return this._respond(params, this._error(10, 'Missing required parameter: id'));

        try {
            const track = await this.api.getTrackMetadata(id);
            return this._respond(params, { song: this._buildSong(track) });
        } catch (err) {
            return this._respond(params, this._error(70, `Song not found: ${err.message}`));
        }
    }

    async _handleGetAlbumList(params, action) {
        const type = params.type || 'random';
        const size = Math.min(parseInt(params.size ?? '10', 10), 500);
        const offset = parseInt(params.offset ?? '0', 10);

        if (type === 'random') {
            return this._handleGetRandomSongs({ ...params, count: size });
        }

        // For other types (newest, recent, starred, etc.) we can't easily
        // implement them without user-specific data. Return empty list.
        const key = action === 'getAlbumList' ? 'albumList' : 'albumList2';
        return this._respond(params, { [key]: { album: [] } });
    }

    async _handleGetRandomSongs(params) {
        const count = Math.min(parseInt(params.count ?? '10', 10), 500);
        const query = params.genre ?? '';

        // Note: The Monochrome API doesn't expose a random-track endpoint, so
        // we approximate randomness by picking a random common search term and
        // then shuffling the results with a Fisher-Yates shuffle.
        const queries = ['a', 'e', 'i', 'o', 'the', 'love', 'night', 'time', 'day', 'life'];
        const q = queries[Math.floor(Math.random() * queries.length)];
        const { items } = await this.api.searchTracks(query || q, 0, count * 2);
        const shuffled = shuffleArray([...items]).slice(0, count);

        return this._respond(params, { randomSongs: { song: shuffled.map((t) => this._buildSong(t)) } });
    }

    async _handleSearch2(params) {
        const query = params.query ?? '';
        const artistCount = parseInt(params.artistCount ?? '20', 10);
        const artistOffset = parseInt(params.artistOffset ?? '0', 10);
        const albumCount = parseInt(params.albumCount ?? '20', 10);
        const albumOffset = parseInt(params.albumOffset ?? '0', 10);
        const songCount = parseInt(params.songCount ?? '20', 10);
        const songOffset = parseInt(params.songOffset ?? '0', 10);

        if (!query) return this._respond(params, { searchResult2: {} });

        const [tracks, albums, artists] = await Promise.allSettled([
            query ? this.api.searchTracks(query, songOffset, songCount) : { items: [] },
            query ? this.api.searchAlbums(query, albumOffset, albumCount) : { items: [] },
            query ? this.api.searchArtists(query, artistOffset, artistCount) : { items: [] },
        ]);

        return this._respond(params, {
            searchResult2: {
                artist: (artists.value?.items ?? []).map((a) => this._buildDirectory(a)),
                album: (albums.value?.items ?? []).map((al) => this._trackToChild({ album: al, ...al })),
                song: (tracks.value?.items ?? []).map((t) => this._buildSong(t)),
            },
        });
    }

    async _handleSearch3(params) {
        const query = params.query ?? '';
        const artistCount = parseInt(params.artistCount ?? '20', 10);
        const artistOffset = parseInt(params.artistOffset ?? '0', 10);
        const albumCount = parseInt(params.albumCount ?? '20', 10);
        const albumOffset = parseInt(params.albumOffset ?? '0', 10);
        const songCount = parseInt(params.songCount ?? '20', 10);
        const songOffset = parseInt(params.songOffset ?? '0', 10);

        if (!query) return this._respond(params, { searchResult3: {} });

        const [tracks, albums, artists] = await Promise.allSettled([
            query ? this.api.searchTracks(query, songOffset, songCount) : { items: [] },
            query ? this.api.searchAlbums(query, albumOffset, albumCount) : { items: [] },
            query ? this.api.searchArtists(query, artistOffset, artistCount) : { items: [] },
        ]);

        return this._respond(params, {
            searchResult3: {
                artist: (artists.value?.items ?? []).map((a) => this._buildArtist(a)),
                album: (albums.value?.items ?? []).map((al) => this._buildAlbum(al)),
                song: (tracks.value?.items ?? []).map((t) => this._buildSong(t)),
            },
        });
    }

    async _handleGetPlaylist(params) {
        const id = params.id;
        if (!id) return this._respond(params, this._error(10, 'Missing required parameter: id'));

        try {
            const { playlist, tracks } = await this.api.getPlaylist(id);
            return this._respond(params, {
                playlist: {
                    id: String(playlist.uuid ?? playlist.id ?? id),
                    name: playlist.title ?? playlist.name ?? 'Playlist',
                    comment: playlist.description ?? '',
                    owner: this.username,
                    public: false,
                    songCount: tracks.length,
                    duration: tracks.reduce((s, t) => s + (t.duration ?? 0), 0),
                    created: playlist.created ?? new Date().toISOString(),
                    changed: playlist.lastUpdated ?? new Date().toISOString(),
                    entry: tracks.map((t) => this._buildSong(t)),
                },
            });
        } catch (err) {
            return this._respond(params, this._error(70, `Playlist not found: ${err.message}`));
        }
    }

    async _handleStream(params, req) {
        const id = params.id;
        if (!id) return this._respond(params, this._error(10, 'Missing required parameter: id'));

        const maxBitRate = parseInt(params.maxBitRate ?? '0', 10);
        const quality = QUALITY_MAP[maxBitRate] ?? 'HI_RES_LOSSLESS';

        try {
            const streamUrl = await this.api.getStreamUrl(id, quality);

            // Proxy the stream to avoid CORS issues for the client
            const upstream = await fetch(streamUrl, {
                headers: { Range: req.headers.get('Range') ?? '' },
                signal: AbortSignal.timeout(30000),
            });

            const headers = new Headers();
            const contentType = upstream.headers.get('content-type');
            const contentLength = upstream.headers.get('content-length');
            const contentRange = upstream.headers.get('content-range');
            const acceptRanges = upstream.headers.get('accept-ranges');

            if (contentType) headers.set('content-type', contentType);
            if (contentLength) headers.set('content-length', contentLength);
            if (contentRange) headers.set('content-range', contentRange);
            if (acceptRanges) headers.set('accept-ranges', acceptRanges);

            return new Response(upstream.body, {
                status: upstream.status,
                headers,
            });
        } catch (err) {
            return this._respond(params, this._error(70, `Stream unavailable: ${err.message}`));
        }
    }

    async _handleGetCoverArt(params, req) {
        // id format: "track-{trackId}", "album-{albumId}", "artist-{artistId}"
        // or a raw TIDAL image UUID
        let imageId = params.id ?? '';
        const size = parseInt(params.size ?? '640', 10);
        const clampedSize = [75, 160, 320, 640, 1280].reduce((prev, curr) =>
            Math.abs(curr - size) < Math.abs(prev - size) ? curr : prev
        );

        // Strip type prefix if present
        imageId = imageId.replace(/^(track|album|artist)-/, '');

        // If imageId looks like a TIDAL image UUID (contains dashes/slashes),
        // build the URL directly. Otherwise try to fetch track metadata first.
        let coverUrl = null;

        if (imageId.includes('-') || imageId.includes('/')) {
            coverUrl = MonochromeApiClient.coverArtUrl(imageId, clampedSize);
        } else {
            // Treat as track id and try to get its cover
            try {
                const track = await this.api.getTrackMetadata(imageId);
                const imgId = track.album?.imagePath ?? track.album?.cover ?? track.imagePath;
                if (imgId) coverUrl = MonochromeApiClient.coverArtUrl(imgId, clampedSize);
            } catch {
                // fall through
            }
        }

        if (!coverUrl) {
            return new Response('Cover not found', { status: 404 });
        }

        try {
            const upstream = await fetch(coverUrl, { signal: AbortSignal.timeout(10000) });
            if (!upstream.ok) return new Response('Cover not found', { status: 404 });

            const headers = new Headers();
            const ct = upstream.headers.get('content-type');
            if (ct) headers.set('content-type', ct);
            const cl = upstream.headers.get('content-length');
            if (cl) headers.set('content-length', cl);

            return new Response(upstream.body, { status: 200, headers });
        } catch {
            return new Response('Cover fetch failed', { status: 502 });
        }
    }

    async _handleGetUser(params) {
        const username = params.username ?? this.username;
        if (username !== this.username) {
            return this._respond(params, this._error(70, 'User not found'));
        }
        return this._respond(params, { user: this._buildUser() });
    }

    // =========================================================================
    // Data builders  (Monochrome objects → Subsonic schema)
    // =========================================================================

    _buildSong(track) {
        const artistName = track.artist?.name ?? track.artistName ?? '';
        const albumTitle = track.album?.title ?? '';
        const albumId = track.album?.id ? String(track.album.id) : undefined;
        const imageId = track.album?.imagePath ?? track.album?.cover ?? track.imagePath;
        const year = this._extractYear(track.album?.releaseDate ?? track.streamStartDate);
        const trackNumber = track.trackNumber ?? track.volumeNumber ?? undefined;

        return {
            id: String(track.id),
            parent: albumId ? `album-${albumId}` : undefined,
            title: track.title ?? 'Unknown',
            isDir: false,
            album: albumTitle || undefined,
            albumId: albumId ? `album-${albumId}` : undefined,
            artist: artistName || undefined,
            artistId: track.artist?.id ? `artist-${track.artist.id}` : undefined,
            track: trackNumber,
            year: year,
            coverArt: imageId ?? (albumId ? `album-${albumId}` : undefined),
            size: undefined,
            contentType: 'audio/flac',
            suffix: 'flac',
            duration: Math.round(track.duration ?? 0),
            bitRate: BITRATE_BY_QUALITY[track.audioQuality] ?? BITRATE_BY_QUALITY.LOW,
            path: `${artistName}/${albumTitle}/${track.title ?? 'track'}.flac`,
            isVideo: false,
            type: 'music',
        };
    }

    _buildAlbum(album, tracks = []) {
        const artistName = album.artist?.name ?? '';
        const imageId = album.imagePath ?? album.cover;
        const year = this._extractYear(album.releaseDate);

        const built = {
            id: `album-${album.id}`,
            name: album.title ?? 'Unknown',
            artist: artistName || undefined,
            artistId: album.artist?.id ? `artist-${album.artist.id}` : undefined,
            coverArt: imageId ?? `album-${album.id}`,
            songCount: album.numberOfTracks ?? tracks.length,
            duration: tracks.reduce((s, t) => s + (t.duration ?? 0), 0),
            created: album.releaseDate ?? undefined,
            year: year,
            genre: undefined,
        };

        if (tracks.length > 0) {
            built.song = tracks.map((t) => this._buildSong(t));
        }

        return built;
    }

    _buildArtist(artist, albums = []) {
        const built = {
            id: `artist-${artist.id}`,
            name: artist.name ?? 'Unknown',
            albumCount: albums.length,
            coverArt: artist.picture ? `artist-${artist.picture}` : undefined,
        };

        if (albums.length > 0) {
            built.album = albums.map((al) => this._buildAlbum(al));
        }

        return built;
    }

    _buildDirectory(artist) {
        return {
            id: `artist-${artist.id}`,
            name: artist.name ?? 'Unknown',
        };
    }

    _albumToDirectory(album) {
        return {
            id: `album-${album.id}`,
            parent: album.artist?.id ? `artist-${album.artist.id}` : undefined,
            title: album.title ?? 'Unknown',
            isDir: true,
            artist: album.artist?.name ?? undefined,
            year: this._extractYear(album.releaseDate),
            coverArt: album.imagePath ?? album.cover ?? `album-${album.id}`,
        };
    }

    _trackToChild(track) {
        return this._buildSong(track);
    }

    _buildUser() {
        return {
            username: this.username,
            email: `${this.username}@monochrome`,
            scrobblingEnabled: false,
            adminRole: true,
            settingsRole: true,
            downloadRole: true,
            uploadRole: false,
            playlistRole: true,
            coverArtRole: true,
            commentRole: false,
            podcastRole: false,
            streamRole: true,
            jukeboxRole: false,
            shareRole: false,
            videoConversionRole: false,
            folder: [1],
        };
    }

    // =========================================================================
    // Authentication
    // =========================================================================

    _authenticate(params) {
        const { u, p, t, s } = params;

        if (!u) return this._error(10, 'Missing required parameter: u');

        if (u !== this.username) return this._error(40, 'Wrong username or password');

        if (t && s) {
            // Token-based auth: MD5(password + salt)
            const expected = createHash('md5')
                .update(this.password + s)
                .digest('hex');
            if (t !== expected) return this._error(40, 'Wrong username or password');
            return null;
        }

        if (p) {
            let pass = p;
            if (pass.startsWith('enc:')) {
                pass = Buffer.from(pass.slice(4), 'hex').toString('utf8');
            }
            if (pass !== this.password) return this._error(40, 'Wrong username or password');
            return null;
        }

        return this._error(10, 'Missing required parameter: p or t/s');
    }

    // =========================================================================
    // Response helpers
    // =========================================================================

    _error(code, message) {
        return { error: { code, message } };
    }

    _respond(params, data) {
        const format = params.f === 'json' ? 'json' : 'xml';
        const hasError = 'error' in data;
        const status = hasError ? 'failed' : 'ok';

        if (format === 'json') {
            const body = {
                'subsonic-response': {
                    xmlns: 'http://subsonic.org/restapi',
                    status,
                    version: SUBSONIC_API_VERSION,
                    type: SERVER_NAME,
                    serverVersion: SERVER_VERSION,
                    openSubsonic: true,
                    ...data,
                },
            };
            return new Response(JSON.stringify(body), {
                status: 200,
                headers: { 'content-type': 'application/json; charset=utf-8' },
            });
        }

        // XML response
        const xml = this._toXml({ 'subsonic-response': { status, version: SUBSONIC_API_VERSION, ...data } });
        return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`, {
            status: 200,
            headers: { 'content-type': 'text/xml; charset=utf-8' },
        });
    }

    // =========================================================================
    // Tiny XML serializer
    // =========================================================================

    _toXml(obj, indent = '') {
        if (obj === null || obj === undefined) return '';

        if (typeof obj !== 'object') return this._escapeXml(String(obj));

        if (Array.isArray(obj)) {
            return obj.map((item) => this._toXml(item, indent)).join('');
        }

        let out = '';
        for (const [key, value] of Object.entries(obj)) {
            if (value === undefined || value === null) continue;

            if (Array.isArray(value)) {
                for (const item of value) {
                    out += this._renderElement(key, item, indent);
                }
            } else {
                out += this._renderElement(key, value, indent);
            }
        }
        return out;
    }

    _renderElement(tag, value, indent) {
        if (value === null || value === undefined) return '';

        const next = indent + '  ';

        if (typeof value !== 'object') {
            return `${indent}<${tag}>${this._escapeXml(String(value))}</${tag}>\n`;
        }

        // Separate attributes (primitives) from child elements (objects/arrays)
        const attrs = [];
        const children = {};

        for (const [k, v] of Object.entries(value)) {
            if (v === null || v === undefined) continue;
            if (Array.isArray(v) || typeof v === 'object') {
                children[k] = v;
            } else {
                attrs.push(`${k}="${this._escapeXml(String(v))}"`);
            }
        }

        const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

        if (Object.keys(children).length === 0) {
            return `${indent}<${tag}${attrStr}/>\n`;
        }

        const childXml = this._toXml(children, next);
        return `${indent}<${tag}${attrStr}>\n${childXml}${indent}</${tag}>\n`;
    }

    _escapeXml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    // =========================================================================
    // Misc helpers
    // =========================================================================

    _extractYear(dateStr) {
        if (!dateStr) return undefined;
        const m = String(dateStr).match(/(\d{4})/);
        return m ? parseInt(m[1], 10) : undefined;
    }
}
