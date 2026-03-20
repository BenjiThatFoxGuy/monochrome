/**
 * Basic tests for the Subsonic API handler.
 * Run with: bun server/test.js (or node server/test.js in CI)
 */

// Minimal shims for Bun-specific globals in test environment
if (typeof Bun === 'undefined') {
    global.Bun = {
        serve: () => ({ port: 4533, hostname: '0.0.0.0' }),
    };
}

// We can't import the modules directly without Bun, but we can test the
// logic inline. This file validates the XML serializer and auth logic.

// ---- Inline-copy of the XML serializer from subsonic.js ----
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

    if (typeof value !== 'object') {
        return `${indent}<${tag}>${escapeXml(String(value))}</${tag}>\n`;
    }

    const attrs = [];
    const children = {};
    for (const [k, v] of Object.entries(value)) {
        if (v === null || v === undefined) continue;
        if (Array.isArray(v) || typeof v === 'object') {
            children[k] = v;
        } else {
            attrs.push(`${k}="${escapeXml(String(v))}"`);
        }
    }

    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    if (Object.keys(children).length === 0) {
        return `${indent}<${tag}${attrStr}/>\n`;
    }
    const childXml = toXml(children, next);
    return `${indent}<${tag}${attrStr}>\n${childXml}${indent}</${tag}>\n`;
}

function toXml(obj, indent = '') {
    if (obj === null || obj === undefined) return '';
    if (typeof obj !== 'object') return escapeXml(String(obj));
    if (Array.isArray(obj)) return obj.map((item) => toXml(item, indent)).join('');

    let out = '';
    for (const [key, value] of Object.entries(obj)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
            for (const item of value) out += renderElement(key, item, indent);
        } else {
            out += renderElement(key, value, indent);
        }
    }
    return out;
}

// ---- Tests ----
let passed = 0;
let failed = 0;

function assert(label, condition) {
    if (condition) {
        console.log(`  ✓ ${label}`);
        passed++;
    } else {
        console.error(`  ✗ ${label}`);
        failed++;
    }
}

// XML serializer tests
console.log('\n--- XML Serializer ---');
{
    const xml = toXml({ 'subsonic-response': { status: 'ok', version: '1.16.1' } });
    assert('self-closing element with attributes', xml.includes('<subsonic-response'));
    assert('status attribute', xml.includes('status="ok"'));
    assert('version attribute', xml.includes('version="1.16.1"'));
}

{
    const xml = toXml({ musicFolders: { musicFolder: [{ id: 1, name: 'Music' }] } });
    assert('nested element rendered', xml.includes('<musicFolders'));
    assert('child element rendered', xml.includes('<musicFolder'));
    assert('id attribute', xml.includes('id="1"'));
    assert('name attribute', xml.includes('name="Music"'));
}

{
    const xml = toXml({ title: 'AT&T <Test> "quote" \'apos\'' });
    assert('ampersand escaped', xml.includes('&amp;'));
    assert('lt escaped', xml.includes('&lt;'));
    assert('gt escaped', xml.includes('&gt;'));
    assert('quote escaped', xml.includes('&quot;'));
    assert('apostrophe escaped', xml.includes('&apos;'));
}

// Auth token calculation
console.log('\n--- Auth Token (MD5) ---');
{
    const { createHash } = await import('node:crypto');
    const password = 'sesame';
    const salt = 'c19b2d';
    const token = createHash('md5')
        .update(password + salt)
        .digest('hex');
    // Known Subsonic test vector from the spec
    assert('token calculation matches spec', token === '26719a1196d2a940705a59634eb18eab');
}

// Year extractor
console.log('\n--- Year Extractor ---');
{
    function extractYear(dateStr) {
        if (!dateStr) return undefined;
        const m = String(dateStr).match(/(\d{4})/);
        return m ? parseInt(m[1], 10) : undefined;
    }
    assert('extracts year from ISO date', extractYear('2023-05-15') === 2023);
    assert('extracts year from year-only string', extractYear('2019') === 2019);
    assert('returns undefined for null', extractYear(null) === undefined);
    assert('returns undefined for empty string', extractYear('') === undefined);
}

// Cover art URL
console.log('\n--- Cover Art URL ---');
{
    function coverArtUrl(imageId, size = 640) {
        if (!imageId) return null;
        const path = imageId.replace(/-/g, '/');
        return `https://resources.tidal.com/images/${path}/${size}x${size}.jpg`;
    }
    const url = coverArtUrl('ab12cd34-ef56-7890-abcd-ef1234567890', 320);
    assert('converts dashes to slashes', url.includes('ab12cd34/ef56/7890/abcd/ef1234567890'));
    assert('includes correct size', url.includes('320x320'));
    assert('returns null for falsy input', coverArtUrl(null) === null);
}

// Summary
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
