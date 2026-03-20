/**
 * Lightweight Monochrome API client for the server-side Subsonic bridge.
 * Proxies requests to distributed Monochrome/TIDAL API instances with
 * automatic failover.
 */

const DEFAULT_INSTANCES = [
    'https://eu-central.monochrome.tf',
    'https://us-west.monochrome.tf',
    'https://api.monochrome.tf',
    'https://triton.squid.wtf',
    'https://monochrome-api.samidy.com',
    'https://arran.monochrome.tf',
];

const COVER_ART_BASE = 'https://resources.tidal.com/images';

export class MonochromeApiClient {
    constructor(instances) {
        this.instances =
            instances && instances.length > 0 ? instances.filter(Boolean).map((u) => u.trim()) : DEFAULT_INSTANCES;

        /** Simple in-memory cache keyed by "{namespace}:{key}" */
        this.cache = new Map();
        this.cacheTtl = 1000 * 60 * 30; // 30 minutes

        this._pruneTimer = setInterval(() => this._pruneCache(), 1000 * 60 * 5);
    }

    /** Stop the background cache-pruning timer (useful in tests or when recreating the client). */
    destroy() {
        clearInterval(this._pruneTimer);
    }

    // -------------------------------------------------------------------------
    // Cache helpers
    // -------------------------------------------------------------------------

    _cacheGet(ns, key) {
        const entry = this.cache.get(`${ns}:${key}`);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(`${ns}:${key}`);
            return null;
        }
        return entry.value;
    }

    _cacheSet(ns, key, value) {
        this.cache.set(`${ns}:${key}`, { value, expiresAt: Date.now() + this.cacheTtl });
    }

    _pruneCache() {
        const now = Date.now();
        for (const [k, v] of this.cache.entries()) {
            if (now > v.expiresAt) this.cache.delete(k);
        }
    }

    // -------------------------------------------------------------------------
    // HTTP fetch with instance failover
    // -------------------------------------------------------------------------

    async fetch(path) {
        let lastError = null;
        const startIndex = Math.floor(Math.random() * this.instances.length);

        for (let i = 0; i < this.instances.length; i++) {
            const base = this.instances[(startIndex + i) % this.instances.length];
            const url = base.endsWith('/') ? `${base}${path.replace(/^\//, '')}` : `${base}${path}`;

            try {
                const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
                if (res.ok) return res;
                if (res.status === 429 || res.status >= 500) continue;
                lastError = new Error(`HTTP ${res.status} from ${base}`);
            } catch (err) {
                lastError = err;
            }
        }

        throw lastError ?? new Error(`All API instances failed for: ${path}`);
    }

    async fetchJson(path) {
        const res = await this.fetch(path);
        const json = await res.json();
        return json.data ?? json;
    }

    // -------------------------------------------------------------------------
    // Search
    // -------------------------------------------------------------------------

    async searchTracks(query, offset = 0, count = 20) {
        const cacheKey = `${query}:${offset}:${count}`;
        const cached = this._cacheGet('search_tracks', cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchJson(`/search/?s=${encodeURIComponent(query)}`);
            const section = this._findSection(data, 'tracks');
            const tracks = (section?.items ?? []).map((t) => this._prepareTrack(t));
            const result = { items: tracks.slice(offset, offset + count), totalNumberOfItems: tracks.length };
            this._cacheSet('search_tracks', cacheKey, result);
            return result;
        } catch {
            return { items: [], totalNumberOfItems: 0 };
        }
    }

    async searchArtists(query, offset = 0, count = 20) {
        const cacheKey = `${query}:${offset}:${count}`;
        const cached = this._cacheGet('search_artists', cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchJson(`/search/?a=${encodeURIComponent(query)}`);
            const section = this._findSection(data, 'artists');
            const artists = (section?.items ?? []).map((a) => this._prepareArtist(a));
            const result = { items: artists.slice(offset, offset + count), totalNumberOfItems: artists.length };
            this._cacheSet('search_artists', cacheKey, result);
            return result;
        } catch {
            return { items: [], totalNumberOfItems: 0 };
        }
    }

    async searchAlbums(query, offset = 0, count = 20) {
        const cacheKey = `${query}:${offset}:${count}`;
        const cached = this._cacheGet('search_albums', cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchJson(`/search/?al=${encodeURIComponent(query)}`);
            const section = this._findSection(data, 'albums');
            const albums = (section?.items ?? []).map((a) => this._prepareAlbum(a));
            const result = { items: albums.slice(offset, offset + count), totalNumberOfItems: albums.length };
            this._cacheSet('search_albums', cacheKey, result);
            return result;
        } catch {
            return { items: [], totalNumberOfItems: 0 };
        }
    }

    // -------------------------------------------------------------------------
    // Album
    // -------------------------------------------------------------------------

    async getAlbum(id) {
        const cached = this._cacheGet('album', id);
        if (cached) return cached;

        const data = await this.fetchJson(`/album/?id=${id}`);
        const result = this._parseAlbumResponse(data);
        if (result) this._cacheSet('album', id, result);
        return result;
    }

    _parseAlbumResponse(data) {
        let album = null;
        let tracks = [];

        if (data && typeof data === 'object' && !Array.isArray(data)) {
            if ('numberOfTracks' in data || 'title' in data) {
                album = this._prepareAlbum(data);
            }
            if ('items' in data && Array.isArray(data.items)) {
                tracks = data.items.map((item) => this._prepareTrack(item.item ?? item));
                if (!album && data.items.length > 0) {
                    const first = data.items[0];
                    const t = first.item ?? first;
                    if (t?.album) album = this._prepareAlbum(t.album);
                }
            }
        }

        if (!album) return null;
        return { album, tracks };
    }

    // -------------------------------------------------------------------------
    // Artist
    // -------------------------------------------------------------------------

    async getArtist(id) {
        const cached = this._cacheGet('artist', id);
        if (cached) return cached;

        try {
            const [primaryData, contentData] = await Promise.all([
                this.fetchJson(`/artist/?id=${id}`),
                this.fetchJson(`/artist/?f=${id}&skip_tracks=true`).catch(() => null),
            ]);

            const rawArtist = primaryData.artist ?? (Array.isArray(primaryData) ? primaryData[0] : primaryData);
            if (!rawArtist) throw new Error('Artist not found');

            const artist = this._prepareArtist(rawArtist);

            // Try to extract albums from content response
            let albums = [];
            if (contentData) {
                const albumsSection = this._findSection(contentData, 'albums');
                if (albumsSection?.items) {
                    albums = albumsSection.items.map((item) => this._prepareAlbum(item.item ?? item));
                }
            }

            const result = { artist, albums };
            this._cacheSet('artist', id, result);
            return result;
        } catch (err) {
            throw new Error(`Failed to fetch artist ${id}: ${err.message}`);
        }
    }

    // -------------------------------------------------------------------------
    // Track
    // -------------------------------------------------------------------------

    async getTrackMetadata(id) {
        const cached = this._cacheGet('track_meta', id);
        if (cached) return cached;

        const data = await this.fetchJson(`/info/?id=${id}`);
        const items = Array.isArray(data) ? data : [data];
        const found = items.find((i) => String(i.id) === String(id) || (i.item && String(i.item.id) === String(id)));
        if (!found) throw new Error('Track not found');

        const track = this._prepareTrack(found.item ?? found);
        this._cacheSet('track_meta', id, track);
        return track;
    }

    /**
     * Returns a stream URL for the given track id and quality.
     * Tries to resolve from a manifest, or returns a direct URL.
     */
    async getStreamUrl(id, quality = 'HI_RES_LOSSLESS') {
        const cached = this._cacheGet('stream', `${id}_${quality}`);
        if (cached) return cached;

        const data = await this.fetchJson(`/track/?id=${id}&quality=${quality}`);
        const url = this._extractStreamUrl(data);
        if (!url) throw new Error('Could not resolve stream URL');

        this._cacheSet('stream', `${id}_${quality}`, url);
        return url;
    }

    _extractStreamUrl(data) {
        const entries = Array.isArray(data) ? data : [data];
        let info = null;
        let originalUrl = null;

        for (const entry of entries) {
            if (!entry || typeof entry !== 'object') continue;
            if (!info && 'manifest' in entry) info = entry;
            if (!originalUrl && 'OriginalTrackUrl' in entry && typeof entry.OriginalTrackUrl === 'string') {
                originalUrl = entry.OriginalTrackUrl;
            }
        }

        if (originalUrl) return originalUrl;
        if (info?.manifest) return this._extractUrlFromManifest(info.manifest);
        return null;
    }

    _extractUrlFromManifest(manifest) {
        try {
            // JSON manifest
            const parsed = JSON.parse(atob(manifest));
            if (parsed.urls?.[0]) return parsed.urls[0];
        } catch (err) {
            console.warn('[MonochromeApiClient] Failed to parse manifest as JSON:', err.message);
        }

        try {
            // DASH/HLS manifest: find first URL-like line
            const decoded = atob(manifest);
            const lines = decoded.split('\n');
            const urlLine = lines.find((l) => l.trim().startsWith('http'));
            if (urlLine) return urlLine.trim();
        } catch (err) {
            console.warn('[MonochromeApiClient] Failed to parse manifest as DASH/HLS:', err.message);
        }

        return null;
    }

    // -------------------------------------------------------------------------
    // Playlist
    // -------------------------------------------------------------------------

    async getPlaylist(id) {
        const cached = this._cacheGet('playlist', id);
        if (cached) return cached;

        const data = await this.fetchJson(`/playlist/?id=${id}`);
        const raw = data.playlist ?? data;
        const tracks = (data.items ?? data.tracks ?? []).map((item) => this._prepareTrack(item.item ?? item));
        const result = { playlist: raw, tracks };
        this._cacheSet('playlist', id, result);
        return result;
    }

    // -------------------------------------------------------------------------
    // Cover art helper
    // -------------------------------------------------------------------------

    /**
     * Resolves a cover art URL from a track/album image ID.
     * TIDAL image IDs look like "ab12cd34-ef56-...". We convert dashes to slashes.
     */
    static coverArtUrl(imageId, size = 640) {
        if (!imageId) return null;
        const path = imageId.replace(/-/g, '/');
        return `${COVER_ART_BASE}/${path}/${size}x${size}.jpg`;
    }

    // -------------------------------------------------------------------------
    // Data normalizers
    // -------------------------------------------------------------------------

    _prepareTrack(track) {
        if (!track) return track;
        const out = { ...track };
        if (!out.artist && Array.isArray(out.artists) && out.artists.length > 0) {
            out.artist = out.artists[0];
        }
        return out;
    }

    _prepareAlbum(album) {
        if (!album) return album;
        const out = { ...album };
        if (!out.artist && Array.isArray(out.artists) && out.artists.length > 0) {
            out.artist = out.artists[0];
        }
        return out;
    }

    _prepareArtist(artist) {
        if (!artist) return artist;
        return { ...artist };
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    _findSection(source, key, visited = new Set()) {
        if (!source || typeof source !== 'object') return null;
        if (visited.has(source)) return null;
        visited.add(source);

        if (Array.isArray(source)) {
            for (const e of source) {
                const f = this._findSection(e, key, visited);
                if (f) return f;
            }
            return null;
        }

        if ('items' in source && Array.isArray(source.items)) return source;

        if (key in source) {
            const f = this._findSection(source[key], key, visited);
            if (f) return f;
        }

        for (const v of Object.values(source)) {
            const f = this._findSection(v, key, visited);
            if (f) return f;
        }

        return null;
    }
}
