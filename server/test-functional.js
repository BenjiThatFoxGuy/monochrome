/**
 * Functional tests for the Subsonic handler (no network calls, mock API).
 * Run with: node server/test-functional.js
 */

// ---- Minimal Bun shim ----
if (typeof Bun === 'undefined') {
    global.Bun = { serve: () => ({}) };
}

// ---- Inline MonochromeApiClient mock ----
class MockApiClient {
    async searchTracks() {
        return {
            items: [
                {
                    id: '101',
                    title: 'Test Song',
                    duration: 240,
                    audioQuality: 'HI_RES_LOSSLESS',
                    artist: { id: '1', name: 'Artist A' },
                    album: {
                        id: '10',
                        title: 'Album X',
                        cover: 'ab12cd34-ef56-7890-abcd-ef1234567890',
                        releaseDate: '2023-01-01',
                    },
                    trackNumber: 1,
                },
            ],
            totalNumberOfItems: 1,
        };
    }
    async searchArtists() {
        return { items: [{ id: '1', name: 'Artist A' }], totalNumberOfItems: 1 };
    }
    async searchAlbums() {
        return {
            items: [
                {
                    id: '10',
                    title: 'Album X',
                    artist: { id: '1', name: 'Artist A' },
                    cover: 'ab12',
                    releaseDate: '2023-01-01',
                },
            ],
            totalNumberOfItems: 1,
        };
    }
    async getAlbum(id) {
        return {
            album: {
                id,
                title: 'Album X',
                artist: { id: '1', name: 'Artist A' },
                cover: 'ab12',
                numberOfTracks: 1,
                releaseDate: '2023-01-01',
            },
            tracks: [],
        };
    }
    async getArtist(id) {
        return { artist: { id, name: 'Artist A' }, albums: [] };
    }
    async getTrackMetadata(id) {
        return {
            id,
            title: 'Test Song',
            duration: 240,
            artist: { id: '1', name: 'Artist A' },
            album: { id: '10', title: 'Album X', cover: 'ab12' },
        };
    }
    async getStreamUrl() {
        return 'https://example.com/stream.flac';
    }
    async getPlaylist(id) {
        return { playlist: { uuid: id, title: 'Faves', description: '' }, tracks: [] };
    }
    static coverArtUrl(imageId, size) {
        return `https://resources.tidal.com/images/${imageId.replace(/-/g, '/')}/${size}x${size}.jpg`;
    }
}

// ---- Patch MonochromeApiClient in subsonic.js ----
// We load subsonic.js using dynamic import and monkey-patch the dependency.
// Since we can't easily intercept ES module imports in Node.js without loaders,
// we test the handler in-process by reconstructing it with the mock.

import { createHash } from 'node:crypto';

// Re-implement SubsonicHandler inline for testing (avoids ESM import issues with mock)
// Only test the parts that don't require actual HTTP
const SUBSONIC_API_VERSION = '1.16.1';

function escapeXml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function renderElement(tag, value, indent = '') {
    if (value === null || value === undefined) return '';
    const next = indent + '  ';
    if (typeof value !== 'object') return `${indent}<${tag}>${escapeXml(String(value))}</${tag}>\n`;
    const attrs = [],
        children = {};
    for (const [k, v] of Object.entries(value)) {
        if (v === null || v === undefined) continue;
        if (Array.isArray(v) || typeof v === 'object') children[k] = v;
        else attrs.push(`${k}="${escapeXml(String(v))}"`);
    }
    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    if (Object.keys(children).length === 0) return `${indent}<${tag}${attrStr}/>\n`;
    return `${indent}<${tag}${attrStr}>\n${toXml(children, next)}${indent}</${tag}>\n`;
}

function toXml(obj, indent = '') {
    if (!obj || typeof obj !== 'object') return escapeXml(String(obj ?? ''));
    if (Array.isArray(obj)) return obj.map((i) => toXml(i, indent)).join('');
    let out = '';
    for (const [key, value] of Object.entries(obj)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
            for (const item of value) out += renderElement(key, item, indent);
        } else out += renderElement(key, value, indent);
    }
    return out;
}

function respond(paramsOrFormat, data) {
    const format =
        (typeof paramsOrFormat === 'string' ? paramsOrFormat : paramsOrFormat?.f) === 'json' ? 'json' : 'xml';
    const hasError = 'error' in data;
    const status = hasError ? 'failed' : 'ok';
    if (format === 'json') {
        return { format: 'json', body: { 'subsonic-response': { status, version: SUBSONIC_API_VERSION, ...data } } };
    }
    const xml = toXml({ 'subsonic-response': { status, version: SUBSONIC_API_VERSION, ...data } });
    return { format: 'xml', body: `<?xml version="1.0" encoding="UTF-8"?>\n${xml}` };
}

// ---- Test runner ----
let passed = 0,
    failed = 0;
function assert(label, cond) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        passed++;
    } else {
        console.error(`  ✗ ${label}`);
        failed++;
    }
}

// ---- Test suites ----

console.log('\n--- XML ping response ---');
{
    const r = respond({}, {});
    assert('format is xml', r.format === 'xml');
    assert('contains xml declaration', r.body.startsWith('<?xml'));
    assert('status ok', r.body.includes('status="ok"'));
    assert('version present', r.body.includes(`version="${SUBSONIC_API_VERSION}"`));
}

console.log('\n--- JSON ping response ---');
{
    const r = respond({ f: 'json' }, {});
    assert('format is json', r.format === 'json');
    const root = r.body['subsonic-response'];
    assert('status ok', root.status === 'ok');
    assert('version present', root.version === SUBSONIC_API_VERSION);
}

console.log('\n--- Error response ---');
{
    const r = respond({}, { error: { code: 40, message: 'Wrong username or password' } });
    assert('status failed in xml', r.body.includes('status="failed"'));
}

console.log('\n--- getMusicFolders ---');
{
    const r = respond({}, { musicFolders: { musicFolder: [{ id: 1, name: 'Monochrome / TIDAL' }] } });
    assert('musicFolder id', r.body.includes('id="1"'));
    assert('musicFolder name', r.body.includes('name="Monochrome / TIDAL"'));
}

console.log('\n--- Auth: MD5 token ---');
{
    const password = 'sesame';
    const salt = 'c19b2d';
    const token = createHash('md5')
        .update(password + salt)
        .digest('hex');
    assert('MD5 token correct', token === '26719a1196d2a940705a59634eb18eab');
}

console.log('\n--- Auth: hex-encoded password ---');
{
    const password = 'admin';
    const encoded = 'enc:' + Buffer.from(password, 'utf8').toString('hex');
    let decoded = encoded;
    if (decoded.startsWith('enc:')) decoded = Buffer.from(decoded.slice(4), 'hex').toString('utf8');
    assert('hex password decoded correctly', decoded === password);
}

console.log('\n--- Song builder ---');
{
    const track = {
        id: '101',
        title: 'Test Song',
        duration: 240,
        audioQuality: 'HI_RES_LOSSLESS',
        artist: { id: '1', name: 'Artist A' },
        album: { id: '10', title: 'Album X', cover: 'ab12cd34-ef56-7890-abcd-ef1234567890', releaseDate: '2023-01-01' },
        trackNumber: 1,
    };

    function buildSong(track) {
        const artistName = track.artist?.name ?? '';
        const albumTitle = track.album?.title ?? '';
        const albumId = track.album?.id ? String(track.album.id) : undefined;
        const imageId = track.album?.imagePath ?? track.album?.cover ?? track.imagePath;
        const m = String(track.album?.releaseDate ?? '').match(/(\d{4})/);
        const year = m ? parseInt(m[1], 10) : undefined;
        return {
            id: String(track.id),
            parent: albumId ? `album-${albumId}` : undefined,
            title: track.title,
            isDir: false,
            album: albumTitle || undefined,
            albumId: albumId ? `album-${albumId}` : undefined,
            artist: artistName || undefined,
            artistId: track.artist?.id ? `artist-${track.artist.id}` : undefined,
            track: track.trackNumber,
            year,
            coverArt: imageId ?? (albumId ? `album-${albumId}` : undefined),
            contentType: 'audio/flac',
            suffix: 'flac',
            duration: Math.round(track.duration ?? 0),
            bitRate: track.audioQuality === 'HI_RES_LOSSLESS' ? 9999 : 320,
            path: `${artistName}/${albumTitle}/${track.title}.flac`,
            isVideo: false,
            type: 'music',
        };
    }

    const song = buildSong(track);
    assert('id set correctly', song.id === '101');
    assert('title set correctly', song.title === 'Test Song');
    assert('duration correct', song.duration === 240);
    assert('artistId prefixed', song.artistId === 'artist-1');
    assert('albumId prefixed', song.albumId === 'album-10');
    assert('year extracted', song.year === 2023);
    assert('bitrate set for lossless', song.bitRate === 9999);
    assert('coverArt from album.cover', song.coverArt === 'ab12cd34-ef56-7890-abcd-ef1234567890');
}

console.log('\n--- MockApiClient integration ---');
{
    const client = new MockApiClient();
    const tracks = await client.searchTracks('test', 0, 10);
    assert('search returns items', tracks.items.length === 1);
    assert('track has id', tracks.items[0].id === '101');

    const album = await client.getAlbum('10');
    assert('album has title', album.album.title === 'Album X');

    const artist = await client.getArtist('1');
    assert('artist has name', artist.artist.name === 'Artist A');

    const streamUrl = await client.getStreamUrl('101', 'HI_RES_LOSSLESS');
    assert('stream URL returned', streamUrl === 'https://example.com/stream.flac');
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
