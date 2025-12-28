/**
 * Room Durable Object
 * Manages WebSocket connections, message broadcasting, and scene persistence for a single collaboration room.
 */

interface UserPresence {
    socketId: string;
    username?: string;
    joinedAt: number;
}

interface BroadcastMessage {
    type: 'broadcast';
    event: string;
    payload: unknown;
    senderId?: string;
}

interface PresenceMessage {
    type: 'presence';
    event: 'join' | 'leave' | 'sync';
    users: UserPresence[];
}

type WSMessage = BroadcastMessage | PresenceMessage;

interface Env {
    ROOM: DurableObjectNamespace;
    ENVIRONMENT: string;
}

interface StoredScene {
    iv: string;
    ciphertext: string;
    sceneVersion: number;
    updatedAt: number;
}

// Message stats for logging
interface MessageStats {
    binary: number;
    json: number;
    lastLogTime: number;
}

const LOG_INTERVAL_MS = 1000; // Log high-frequency events every second

export class Room implements DurableObject {
    private sessions: Map<WebSocket, UserPresence> = new Map();
    private state: DurableObjectState;
    private env: Env;
    private messageStats: MessageStats = { binary: 0, json: 0, lastLogTime: Date.now() };
    private roomId: string = 'unknown';

    constructor(state: DurableObjectState, env: Env) {
        this.state = state;
        this.env = env;

        // Restore any WebSocket connections that survived hibernation
        this.state.getWebSockets().forEach((ws) => {
            const metadata = ws.deserializeAttachment() as UserPresence | null;
            if (metadata) {
                this.sessions.set(ws, metadata);
            }
        });
    }

    private log(level: 'info' | 'warn' | 'error', message: string, data?: unknown) {
        const timestamp = new Date().toISOString();
        const prefix = `[Room:${this.roomId}]`;
        const logMessage = `${timestamp} ${prefix} ${message}`;

        if (this.env.ENVIRONMENT === 'development') {
            if (data !== undefined) {
                console[level](logMessage, data);
            } else {
                console[level](logMessage);
            }
        }
    }

    private logStats() {
        const now = Date.now();
        if (now - this.messageStats.lastLogTime >= LOG_INTERVAL_MS) {
            const elapsed = (now - this.messageStats.lastLogTime) / 1000;
            const binaryFps = Math.round(this.messageStats.binary / elapsed);
            const jsonFps = Math.round(this.messageStats.json / elapsed);

            if (this.messageStats.binary > 0 || this.messageStats.json > 0) {
                this.log('info', `📊 Stats: ${binaryFps} binary/s, ${jsonFps} json/s | Users: ${this.sessions.size}`);
            }

            this.messageStats = { binary: 0, json: 0, lastLogTime: now };
        }
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        // Extract room ID from the URL path
        const roomMatch = url.pathname.match(/\/room\/([^/]+)/);
        if (roomMatch) {
            this.roomId = roomMatch[1].substring(0, 8); // Truncate for readability
        }

        // Handle scene persistence endpoints
        if (url.pathname.endsWith('/scene')) {
            if (request.method === 'GET') {
                return this.handleGetScene();
            }
            if (request.method === 'POST') {
                return this.handleSaveScene(request);
            }
            return new Response('Method not allowed', { status: 405 });
        }

        // Handle WebSocket upgrade
        if (request.headers.get('Upgrade') === 'websocket') {
            this.log('info', '🔌 WebSocket upgrade request');
            return this.handleWebSocketUpgrade(request);
        }

        // Handle HTTP requests for room info
        if (url.pathname.endsWith('/info')) {
            return Response.json({
                userCount: this.sessions.size,
                users: Array.from(this.sessions.values()),
            });
        }

        return new Response('Not found', { status: 404 });
    }

    // Scene persistence methods
    private async handleGetScene(): Promise<Response> {
        try {
            const scene = await this.state.storage.get<StoredScene>('scene');

            if (!scene) {
                this.log('info', '📄 Scene requested but not found');
                return Response.json(null);
            }

            this.log('info', `📄 Scene loaded (version: ${scene.sceneVersion})`);
            return Response.json(scene);
        } catch (error) {
            this.log('error', '❌ Error loading scene:', error);
            return new Response('Error loading scene', { status: 500 });
        }
    }

    private async handleSaveScene(request: Request): Promise<Response> {
        try {
            const body = await request.json() as { iv: string; ciphertext: string; sceneVersion: number };

            // Get existing scene to check version
            const existingScene = await this.state.storage.get<StoredScene>('scene');

            // Only save if new version is higher (prevents race conditions)
            if (existingScene && body.sceneVersion <= existingScene.sceneVersion) {
                this.log('info', `📄 Scene save skipped (version ${body.sceneVersion} <= ${existingScene.sceneVersion})`);
                return Response.json({
                    success: true,
                    sceneVersion: existingScene.sceneVersion,
                    skipped: true
                });
            }

            const scene: StoredScene = {
                iv: body.iv,
                ciphertext: body.ciphertext,
                sceneVersion: body.sceneVersion,
                updatedAt: Date.now(),
            };

            await this.state.storage.put('scene', scene);

            this.log('info', `📄 Scene saved (version: ${scene.sceneVersion})`);
            return Response.json({ success: true, sceneVersion: scene.sceneVersion });
        } catch (error) {
            this.log('error', '❌ Error saving scene:', error);
            return new Response('Error saving scene', { status: 500 });
        }
    }

    private handleWebSocketUpgrade(request: Request): Response {
        const url = new URL(request.url);
        const socketId = url.searchParams.get('socketId') || crypto.randomUUID();
        const username = url.searchParams.get('username') || undefined;

        // Close any existing connection with the same socketId (e.g., from a page refresh)
        for (const [existingWs, existingPresence] of this.sessions) {
            if (existingPresence.socketId === socketId) {
                this.log('info', `🔄 Replacing existing connection for ${socketId.substring(0, 8)}`);
                this.sessions.delete(existingWs);
                try {
                    existingWs.close(1000, 'Replaced by new connection');
                } catch (e) {
                    // Socket may already be closed
                }
                break;
            }
        }

        // Create WebSocket pair
        const pair = new WebSocketPair();
        const [client, server] = [pair[0], pair[1]];

        // Accept the WebSocket with hibernation support
        this.state.acceptWebSocket(server);

        // Store user presence
        const presence: UserPresence = {
            socketId,
            username,
            joinedAt: Date.now(),
        };

        server.serializeAttachment(presence);
        this.sessions.set(server, presence);

        this.log('info', `✅ User connected: ${username || 'anonymous'} (${socketId.substring(0, 8)})`);
        this.log('info', `👥 Total users: ${this.sessions.size}`);

        // Notify others of new user after a brief delay to ensure socket is ready
        setTimeout(() => {
            this.broadcastPresence('join', presence);
        }, 100);

        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    }

    // WebSocket event handlers (Hibernation API)
    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
        const sender = this.sessions.get(ws);
        if (!sender) {
            this.log('warn', '⚠️ Message from unknown WebSocket');
            return;
        }

        // Track stats and log periodically
        this.logStats();

        try {
            // Handle binary messages (encrypted scene data)
            if (message instanceof ArrayBuffer) {
                this.messageStats.binary++;
                this.broadcastBinary(message, ws);
                return;
            }

            // Handle JSON messages
            this.messageStats.json++;
            const data = JSON.parse(message) as WSMessage;

            switch (data.type) {
                case 'broadcast':
                    // Log non-frequent broadcast events
                    if (data.event !== 'server-volatile-broadcast') {
                        this.log('info', `📤 Broadcast from ${sender.username || sender.socketId.substring(0, 8)}: ${data.event}`);
                    }
                    // Broadcast to all other clients
                    this.broadcastJSON({
                        ...data,
                        senderId: sender.socketId,
                    }, ws);
                    break;

                case 'presence':
                    if (data.event === 'sync') {
                        this.log('info', `🔄 Presence sync request from ${sender.username || sender.socketId.substring(0, 8)}`);
                        // Send current presence state to requesting client
                        const syncMessage: PresenceMessage = {
                            type: 'presence',
                            event: 'sync',
                            users: Array.from(this.sessions.values()),
                        };
                        ws.send(JSON.stringify(syncMessage));
                    }
                    break;

                default:
                    this.log('warn', `⚠️ Unknown message type: ${(data as any).type}`);
            }
        } catch (error) {
            this.log('error', '❌ Error processing message:', error);
        }
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
        const presence = this.sessions.get(ws);
        this.sessions.delete(ws);

        if (presence) {
            this.log('info', `👋 User disconnected: ${presence.username || presence.socketId.substring(0, 8)} (code: ${code}, clean: ${wasClean})`);
            this.log('info', `👥 Remaining users: ${this.sessions.size}`);
            this.broadcastPresence('leave', presence);
        }
    }

    async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
        const presence = this.sessions.get(ws);
        this.log('error', `❌ WebSocket error for user ${presence?.socketId?.substring(0, 8) || 'unknown'}:`, error);

        this.sessions.delete(ws);
        if (presence) {
            this.broadcastPresence('leave', presence);
        }
    }

    // Broadcast helpers
    private broadcastJSON(message: unknown, exclude?: WebSocket): void {
        const json = JSON.stringify(message);
        let sent = 0;
        for (const [ws] of this.sessions) {
            if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(json);
                    sent++;
                } catch (error) {
                    this.log('error', '❌ Error sending to WebSocket:', error);
                }
            }
        }
    }

    private broadcastBinary(data: ArrayBuffer, exclude?: WebSocket): void {
        let sent = 0;
        for (const [ws] of this.sessions) {
            if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(data);
                    sent++;
                } catch (error) {
                    this.log('error', '❌ Error sending binary to WebSocket:', error);
                }
            }
        }
    }

    private broadcastPresence(event: 'join' | 'leave', user: UserPresence): void {
        this.log('info', `📢 Broadcasting presence: ${event} - ${user.username || user.socketId.substring(0, 8)}`);
        const message: PresenceMessage = {
            type: 'presence',
            event,
            users: [user],
        };
        this.broadcastJSON(message);
    }
}
