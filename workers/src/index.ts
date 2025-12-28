/**
 * Excalidraw Collaboration Worker
 * Routes WebSocket upgrade requests to Room Durable Objects.
 */

import { Room } from './room';

export { Room };

export interface Env {
    ROOM: DurableObjectNamespace;
    FILES_BUCKET: R2Bucket;
    ENVIRONMENT: string;
    COLLAB_SECRET: string;
    ALLOWED_ORIGINS: string;
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const timestamp = new Date().toISOString();

        // Log all requests in development
        if (env.ENVIRONMENT === 'development') {
            const isWebSocket = request.headers.get('Upgrade') === 'websocket';
            console.log(`${timestamp} [Worker] ${request.method} ${url.pathname}${isWebSocket ? ' (WebSocket upgrade)' : ''}`);
        }

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return handleCORS();
        }

        // Health check
        if (url.pathname === '/health') {
            return Response.json({ status: 'ok', timestamp: Date.now() });
        }

        // Route: /room/:roomId
        const roomMatch = url.pathname.match(/^\/room\/([a-zA-Z0-9_-]+)/);
        if (roomMatch) {
            // Validate origin and secret token
            const validationError = validateRequest(request, url, env);
            if (validationError) {
                console.log(`${timestamp} [Worker] Access denied: ${validationError}`);
                return new Response(validationError, { status: 403 });
            }

            const roomId = roomMatch[1];

            if (env.ENVIRONMENT === 'development') {
                console.log(`${timestamp} [Worker] Routing to Room DO: ${roomId.substring(0, 8)}...`);
            }

            // Get or create Durable Object for this room
            const id = env.ROOM.idFromName(roomId);
            const room = env.ROOM.get(id);

            // Forward request to the Durable Object
            const response = await room.fetch(request);

            // Add CORS headers to response
            return addCORSHeaders(response, env);
        }

        // Route: /files/* - R2 file storage
        const filesMatch = url.pathname.match(/^\/files\/(.+)$/);
        if (filesMatch) {
            // Validate origin
            const origin = request.headers.get('Origin');
            const allowedOrigins = (env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map(o => o.trim());
            if (origin && !allowedOrigins.some(allowed => origin.startsWith(allowed) || allowed === '*')) {
                return new Response('Origin not allowed', { status: 403 });
            }

            const filePath = filesMatch[1];

            if (request.method === 'PUT') {
                // Upload file
                const body = await request.arrayBuffer();
                const contentType = request.headers.get('Content-Type') || 'application/octet-stream';

                await env.FILES_BUCKET.put(filePath, body, {
                    httpMetadata: { contentType },
                });

                if (env.ENVIRONMENT === 'development') {
                    console.log(`${timestamp} [Worker] File uploaded: ${filePath} (${body.byteLength} bytes)`);
                }

                return addCORSHeaders(Response.json({ success: true }), env);
            }

            if (request.method === 'GET') {
                // Download file
                const object = await env.FILES_BUCKET.get(filePath);

                if (!object) {
                    return new Response('File not found', { status: 404 });
                }

                const headers = new Headers();
                object.writeHttpMetadata(headers);
                headers.set('Cache-Control', 'public, max-age=31536000');

                return addCORSHeaders(new Response(object.body, { headers }), env);
            }

            return new Response('Method not allowed', { status: 405 });
        }

        // List of features/docs
        if (url.pathname === '/') {
            return Response.json({
                name: 'Excalidraw Collaboration Server',
                version: '1.0.0',
                environment: env.ENVIRONMENT,
                endpoints: {
                    '/health': 'Health check',
                    '/room/:roomId': 'WebSocket connection for collaboration room',
                    '/room/:roomId/info': 'Get room info (user count, etc.)',
                    '/room/:roomId/scene': 'GET/POST scene data for persistence',
                    '/files/*': 'GET/PUT file storage (R2)',
                },
            });
        }

        return new Response('Not found', { status: 404 });
    },
} satisfies ExportedHandler<Env>;

function validateRequest(request: Request, url: URL, env: Env): string | null {
    // Check origin
    const origin = request.headers.get('Origin');
    const allowedOrigins = (env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map(o => o.trim());

    if (origin && !allowedOrigins.some(allowed => origin.startsWith(allowed) || allowed === '*')) {
        return `Origin not allowed: ${origin}`;
    }

    // Only check secret token for WebSocket connections (not HTTP requests)
    const isWebSocket = request.headers.get('Upgrade') === 'websocket';
    if (isWebSocket) {
        const token = url.searchParams.get('token');
        if (env.COLLAB_SECRET && token !== env.COLLAB_SECRET) {
            return 'Invalid or missing token';
        }
    }

    return null;
}

function handleCORS(): Response {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version, Sec-WebSocket-Protocol',
            'Access-Control-Max-Age': '86400',
        },
    });
}

function addCORSHeaders(response: Response, env: Env): Response {
    const newHeaders = new Headers(response.headers);
    // In production, we could restrict this to ALLOWED_ORIGINS
    newHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
        webSocket: response.webSocket,
    });
}
