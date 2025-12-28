/**
 * Cloudflare Durable Objects WebSocket Client
 * Handles real-time collaboration via WebSocket connections to Cloudflare Workers.
 */

export interface CloudflareWSOptions {
    roomId: string;
    socketId: string;
    username?: string;
    onMessage: (data: ArrayBuffer | string) => void;
    onPresenceSync: (users: UserPresence[]) => void;
    onUserJoin: (user: UserPresence) => void;
    onUserLeave: (user: UserPresence) => void;
    onOpen?: () => void;
    onClose?: (event: CloseEvent) => void;
    onError?: (error: Event) => void;
}

export interface UserPresence {
    socketId: string;
    username?: string;
    joinedAt: number;
}

interface PresenceMessage {
    type: 'presence';
    event: 'join' | 'leave' | 'sync';
    users: UserPresence[];
}

interface BroadcastMessage {
    type: 'broadcast';
    event: string;
    payload: unknown;
    senderId?: string;
}

type WSMessage = PresenceMessage | BroadcastMessage;

let CLOUDFLARE_WS_URL: string;
let COLLAB_SECRET: string;

try {
    CLOUDFLARE_WS_URL = import.meta.env.VITE_APP_CLOUDFLARE_WS_URL || 'ws://localhost:8787';
    COLLAB_SECRET = import.meta.env.VITE_APP_COLLAB_SECRET || '';
} catch {
    CLOUDFLARE_WS_URL = 'ws://localhost:8787';
    COLLAB_SECRET = '';
}

export class CloudflareWSClient {
    private ws: WebSocket | null = null;
    private options: CloudflareWSOptions;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectDelay = 1000;
    private reconnectTimer: number | null = null;
    private isIntentionallyClosed = false;

    constructor(options: CloudflareWSOptions) {
        this.options = options;
    }

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                resolve();
                return;
            }

            this.isIntentionallyClosed = false;

            const wsUrl = new URL(`${CLOUDFLARE_WS_URL}/room/${this.options.roomId}`);
            wsUrl.searchParams.set('socketId', this.options.socketId);
            if (this.options.username) {
                wsUrl.searchParams.set('username', this.options.username);
            }
            // Add secret token for authentication
            if (COLLAB_SECRET) {
                wsUrl.searchParams.set('token', COLLAB_SECRET);
            }

            // Convert http(s) to ws(s) if needed
            const protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
            wsUrl.protocol = protocol;

            console.log('[CloudflareWS] Connecting to:', wsUrl.toString());

            this.ws = new WebSocket(wsUrl.toString());
            this.ws.binaryType = 'arraybuffer';

            this.ws.onopen = () => {
                console.log('[CloudflareWS] Connected');
                this.reconnectAttempts = 0;
                this.options.onOpen?.();

                // Request current presence state
                this.requestPresenceSync();
                resolve();
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(event.data);
            };

            this.ws.onclose = (event) => {
                console.log('[CloudflareWS] Disconnected:', event.code, event.reason);
                this.options.onClose?.(event);

                if (!this.isIntentionallyClosed) {
                    this.scheduleReconnect();
                }
            };

            this.ws.onerror = (error) => {
                console.error('[CloudflareWS] Error:', error);
                this.options.onError?.(error);
                reject(error);
            };
        });
    }

    private handleMessage(data: ArrayBuffer | string): void {
        // Binary data - pass directly to handler (encrypted scene data)
        if (data instanceof ArrayBuffer) {
            this.options.onMessage(data);
            return;
        }

        // JSON messages
        try {
            const message = JSON.parse(data) as WSMessage;

            if (message.type === 'presence') {
                switch (message.event) {
                    case 'sync':
                        this.options.onPresenceSync(message.users);
                        break;
                    case 'join':
                        message.users.forEach(user => this.options.onUserJoin(user));
                        break;
                    case 'leave':
                        message.users.forEach(user => this.options.onUserLeave(user));
                        break;
                }
            } else if (message.type === 'broadcast') {
                // Pass broadcast messages to the general handler
                this.options.onMessage(data);
            }
        } catch (error) {
            console.error('[CloudflareWS] Error parsing message:', error);
        }
    }

    private requestPresenceSync(): void {
        this.sendJSON({
            type: 'presence',
            event: 'sync',
            users: [],
        });
    }

    private scheduleReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[CloudflareWS] Max reconnection attempts reached');
            return;
        }

        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
        console.log(`[CloudflareWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);

        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectAttempts++;
            this.connect().catch(console.error);
        }, delay);
    }

    sendBinary(data: ArrayBuffer): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(data);
        } else {
            console.warn('[CloudflareWS] Cannot send, WebSocket not open');
        }
    }

    sendJSON(data: unknown): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
            console.warn('[CloudflareWS] Cannot send, WebSocket not open');
        }
    }

    broadcast(event: string, payload: unknown): void {
        this.sendJSON({
            type: 'broadcast',
            event,
            payload,
        });
    }

    close(): void {
        this.isIntentionallyClosed = true;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    get isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    get socketId(): string {
        return this.options.socketId;
    }
}

export function createCloudflareWSClient(options: CloudflareWSOptions): CloudflareWSClient {
    return new CloudflareWSClient(options);
}
