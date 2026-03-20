/**
 * Monochrome Subsonic API server entry point.
 *
 * Usage:
 *   bun server/index.js
 *
 * Environment variables:
 *   SUBSONIC_PORT             - Port to listen on (default: 4533)
 *   SUBSONIC_USER             - Username for authentication (default: admin)
 *   SUBSONIC_PASS             - Password for authentication (default: admin)
 *   MONOCHROME_API_INSTANCES  - Comma-separated list of Monochrome API base URLs
 *                               Defaults to the public Monochrome API instances.
 */

import { SubsonicHandler } from './subsonic.js';

const PORT = parseInt(process.env.SUBSONIC_PORT ?? '4533', 10);
const SUBSONIC_USER = process.env.SUBSONIC_USER ?? 'admin';
const SUBSONIC_PASS = process.env.SUBSONIC_PASS ?? 'admin';

const MONOCHROME_API_INSTANCES = process.env.MONOCHROME_API_INSTANCES
    ? process.env.MONOCHROME_API_INSTANCES.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

const handler = new SubsonicHandler({
    apiInstances: MONOCHROME_API_INSTANCES,
    username: SUBSONIC_USER,
    password: SUBSONIC_PASS,
});

const server = Bun.serve({
    port: PORT,
    hostname: '0.0.0.0',
    async fetch(req) {
        const url = new URL(req.url);
        // Health check endpoint
        if (url.pathname === '/health') {
            return new Response('OK', { status: 200 });
        }
        return handler.handle(req);
    },
});

console.log(`Monochrome Subsonic API listening on http://0.0.0.0:${PORT}`);
console.log(`  Username : ${SUBSONIC_USER}`);
console.log(`  API instances: ${MONOCHROME_API_INSTANCES.length > 0 ? MONOCHROME_API_INSTANCES.join(', ') : '(using defaults)'}`);
