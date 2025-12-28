import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { trackEvent } from "@excalidraw/excalidraw/analytics";
import { encryptData } from "@excalidraw/excalidraw/data/encryption";
import { newElementWith } from "@excalidraw/element";
import throttle from "lodash.throttle";

import type { UserIdleState } from "@excalidraw/common";
import type { OrderedExcalidrawElement } from "@excalidraw/element/types";
import type {
  OnUserFollowedPayload,
  SocketId,
} from "@excalidraw/excalidraw/types";

import { WS_EVENTS, FILE_UPLOAD_TIMEOUT, WS_SUBTYPES } from "../app_constants";
import { isSyncableElement } from "../data";
import { CloudflareWSClient } from "../data/cloudflare-ws";

import type {
  SocketUpdateData,
  SocketUpdateDataSource,
  SyncableExcalidrawElement,
} from "../data";
import type { TCollabClass } from "./Collab";

class Portal {
  collab: TCollabClass;
  socket: CloudflareWSClient | null = null;
  socketInitialized: boolean = false; // we don't want the socket to emit any updates until it is fully initialized
  roomId: string | null = null;
  roomKey: string | null = null;
  broadcastedElementVersions: Map<string, number> = new Map();
  private _socketId: string | null = null;

  constructor(collab: TCollabClass) {
    this.collab = collab;
  }

  open(wsClient: CloudflareWSClient, id: string, key: string) {
    this.socket = wsClient;
    this.roomId = id;
    this.roomKey = key;
    this._socketId = wsClient.socketId;

    return wsClient;
  }

  // Handler for broadcast messages (called from Collab)
  onBroadcast: ((encryptedBuffer: ArrayBuffer, iv: Uint8Array) => void) | null = null;
  onUserFollowChange: ((payload: OnUserFollowedPayload) => void) | null = null;

  // Handle incoming message from WebSocket
  handleMessage = (data: ArrayBuffer | string) => {
    if (data instanceof ArrayBuffer) {
      // Binary data - extract IV and encrypted data
      // Format: [4 bytes IV length][IV bytes][encrypted data]
      const view = new DataView(data);
      const ivLength = view.getUint32(0, true);
      const iv = new Uint8Array(data, 4, ivLength);
      const encryptedBuffer = data.slice(4 + ivLength);

      if (this.onBroadcast) {
        this.onBroadcast(encryptedBuffer, iv);
      }
      return;
    }

    // JSON message
    try {
      const message = JSON.parse(data);
      if (message.type === 'broadcast') {
        if (message.event === WS_EVENTS.USER_FOLLOW_CHANGE && this.onUserFollowChange) {
          this.onUserFollowChange(message.payload);
        } else if (message.payload?.encryptedBuffer && message.payload?.iv) {
          // Legacy base64 encoded format
          const encryptedBuffer = Uint8Array.from(
            atob(message.payload.encryptedBuffer),
            (c) => c.charCodeAt(0)
          ).buffer;
          const iv = Uint8Array.from(
            atob(message.payload.iv),
            (c) => c.charCodeAt(0)
          );
          if (this.onBroadcast) {
            this.onBroadcast(encryptedBuffer, iv);
          }
        }
      }
    } catch (error) {
      console.error('[Portal] Failed to parse message:', error);
    }
  };

  close() {
    if (!this.socket) {
      return;
    }
    this.queueFileUpload.flush();
    this.socket.close();
    this.socket = null;
    this.roomId = null;
    this.roomKey = null;
    this._socketId = null;
    this.socketInitialized = false;
    this.broadcastedElementVersions = new Map();
  }

  isOpen() {
    return !!(
      this.socketInitialized &&
      this.socket?.isConnected &&
      this.roomId &&
      this.roomKey
    );
  }

  async _broadcastSocketData(
    data: SocketUpdateData,
    volatile: boolean = false,
    roomId?: string,
  ) {
    if (this.isOpen() && this.socket) {
      const json = JSON.stringify(data);
      const encoded = new TextEncoder().encode(json);
      const { encryptedBuffer, iv } = await encryptData(this.roomKey!, encoded);

      // Pack IV length + IV + encrypted data into single binary message
      const ivLength = iv.byteLength;
      const totalLength = 4 + ivLength + encryptedBuffer.byteLength;
      const packed = new ArrayBuffer(totalLength);
      const view = new DataView(packed);
      view.setUint32(0, ivLength, true);
      new Uint8Array(packed, 4, ivLength).set(iv);
      new Uint8Array(packed, 4 + ivLength).set(new Uint8Array(encryptedBuffer));

      this.socket.sendBinary(packed);
    }
  }

  queueFileUpload = throttle(async () => {
    try {
      await this.collab.fileManager.saveFiles({
        elements: this.collab.excalidrawAPI.getSceneElementsIncludingDeleted(),
        files: this.collab.excalidrawAPI.getFiles(),
      });
    } catch (error: any) {
      if (error.name !== "AbortError") {
        this.collab.excalidrawAPI.updateScene({
          appState: {
            errorMessage: error.message,
          },
        });
      }
    }

    let isChanged = false;
    const newElements = this.collab.excalidrawAPI
      .getSceneElementsIncludingDeleted()
      .map((element) => {
        if (this.collab.fileManager.shouldUpdateImageElementStatus(element)) {
          isChanged = true;
          // this will signal collaborators to pull image data from server
          // (using mutation instead of newElementWith otherwise it'd break
          // in-progress dragging)
          return newElementWith(element, { status: "saved" });
        }
        return element;
      });

    if (isChanged) {
      this.collab.excalidrawAPI.updateScene({
        elements: newElements,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
  }, FILE_UPLOAD_TIMEOUT);

  broadcastScene = async (
    updateType: WS_SUBTYPES.INIT | WS_SUBTYPES.UPDATE,
    elements: readonly OrderedExcalidrawElement[],
    syncAll: boolean,
  ) => {
    if (updateType === WS_SUBTYPES.INIT && !syncAll) {
      throw new Error("syncAll must be true when sending SCENE.INIT");
    }

    // sync out only the elements we think we need to to save bandwidth.
    // periodically we'll resync the whole thing to make sure no one diverges
    // due to a dropped message (server goes down etc).
    const syncableElements = elements.reduce((acc, element) => {
      if (
        (syncAll ||
          !this.broadcastedElementVersions.has(element.id) ||
          element.version > this.broadcastedElementVersions.get(element.id)!) &&
        isSyncableElement(element)
      ) {
        acc.push(element);
      }
      return acc;
    }, [] as SyncableExcalidrawElement[]);

    const data: SocketUpdateDataSource[typeof updateType] = {
      type: updateType,
      payload: {
        elements: syncableElements,
      },
    };

    for (const syncableElement of syncableElements) {
      this.broadcastedElementVersions.set(
        syncableElement.id,
        syncableElement.version,
      );
    }

    this.queueFileUpload();

    await this._broadcastSocketData(data as SocketUpdateData);
  };

  broadcastIdleChange = (userState: UserIdleState) => {
    if (this.socket) {
      const data: SocketUpdateDataSource["IDLE_STATUS"] = {
        type: WS_SUBTYPES.IDLE_STATUS,
        payload: {
          socketId: this.getSocketId() as SocketId,
          userState,
          username: this.collab.state.username,
        },
      };
      return this._broadcastSocketData(
        data as SocketUpdateData,
        true, // volatile
      );
    }
  };

  broadcastMouseLocation = (payload: {
    pointer: SocketUpdateDataSource["MOUSE_LOCATION"]["payload"]["pointer"];
    button: SocketUpdateDataSource["MOUSE_LOCATION"]["payload"]["button"];
  }) => {
    if (this.socket) {
      const data: SocketUpdateDataSource["MOUSE_LOCATION"] = {
        type: WS_SUBTYPES.MOUSE_LOCATION,
        payload: {
          socketId: this.getSocketId() as SocketId,
          pointer: payload.pointer,
          button: payload.button || "up",
          selectedElementIds:
            this.collab.excalidrawAPI.getAppState().selectedElementIds,
          username: this.collab.state.username,
        },
      };

      return this._broadcastSocketData(
        data as SocketUpdateData,
        true, // volatile
      );
    }
  };

  broadcastVisibleSceneBounds = (
    payload: {
      sceneBounds: SocketUpdateDataSource["USER_VISIBLE_SCENE_BOUNDS"]["payload"]["sceneBounds"];
    },
    roomId: string,
  ) => {
    if (this.socket) {
      const data: SocketUpdateDataSource["USER_VISIBLE_SCENE_BOUNDS"] = {
        type: WS_SUBTYPES.USER_VISIBLE_SCENE_BOUNDS,
        payload: {
          socketId: this.getSocketId() as SocketId,
          username: this.collab.state.username,
          sceneBounds: payload.sceneBounds,
        },
      };

      return this._broadcastSocketData(
        data as SocketUpdateData,
        true, // volatile
        roomId,
      );
    }
  };

  broadcastUserFollowed = (payload: OnUserFollowedPayload) => {
    if (this.socket) {
      this.socket.broadcast(WS_EVENTS.USER_FOLLOW_CHANGE, payload);
    }
  };

  // Helper to get ephemeral socket ID
  getSocketId(): string {
    return this._socketId || "unknown";
  }
}

export default Portal;
