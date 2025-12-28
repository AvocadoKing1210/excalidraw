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

import type {
  SocketUpdateData,
  SocketUpdateDataSource,
  SyncableExcalidrawElement,
} from "../data";
import type { TCollabClass } from "./Collab";
import type { RealtimeChannel } from "@supabase/supabase-js";

class Portal {
  collab: TCollabClass;
  socket: RealtimeChannel | null = null;
  socketInitialized: boolean = false; // we don't want the socket to emit any updates until it is fully initialized
  roomId: string | null = null;
  roomKey: string | null = null;
  broadcastedElementVersions: Map<string, number> = new Map();

  constructor(collab: TCollabClass) {
    this.collab = collab;
  }

  open(socket: RealtimeChannel, id: string, key: string) {
    this.socket = socket;
    this.roomId = id;
    this.roomKey = key;

    // IMPORTANT: All .on() handlers must be attached BEFORE subscribe() is called
    // The actual subscribe() is done in Collab.startCollaboration() to avoid double-subscribe

    // Handle broadcast events
    this.socket
      .on("broadcast", { event: WS_EVENTS.SERVER_VOLATILE }, (payload) => this.handleBroadcast(payload))
      .on("broadcast", { event: WS_EVENTS.SERVER }, (payload) => this.handleBroadcast(payload))
      .on("broadcast", { event: WS_EVENTS.USER_FOLLOW_CHANGE }, (payload) => {
        if (this.onUserFollowChange && payload.payload) {
          this.onUserFollowChange(payload.payload);
        }
      });

    // Handle presence sync
    this.socket.on("presence", { event: "sync" }, () => {
      const state = this.socket?.presenceState();
      if (state) {
        const users = Object.values(state).flat() as any[];
        const clientIds = users.map(u => u.socketId).filter(Boolean);
        this.collab.setCollaborators(clientIds);

        // Trigger sync when presence changes (new user joined)
        this.broadcastScene(
          WS_SUBTYPES.INIT,
          this.collab.getSceneElementsIncludingDeleted(),
          /* syncAll */ true,
        );
      }
    });

    return socket;
  }

  // Helper to handle incoming broadcast payloads
  // We need to expose a way for Collab to register callbacks, or we call Collab methods directly.
  // The original code had Collab listening to `client-broadcast`.
  // The server used to emit `client-broadcast` when it received `SERVER` or `SERVER_VOLATILE`.
  // So here, we should receive the payload and trigger the handler.
  // CONSTANT: We'll need to update Collab to register a handler on Portal.

  handleBroadcast(payload: any) {
    // payload from Supabase has structure: { type, event, payload: { encryptedBuffer, iv } }
    // The encryptedBuffer and iv are Base64 encoded strings
    if (this.onBroadcast && payload.payload) {
      try {
        // Decode Base64 strings back to binary
        const encryptedBuffer = Uint8Array.from(
          atob(payload.payload.encryptedBuffer),
          (c) => c.charCodeAt(0)
        ).buffer;
        const iv = Uint8Array.from(
          atob(payload.payload.iv),
          (c) => c.charCodeAt(0)
        );
        this.onBroadcast(encryptedBuffer, iv);
      } catch (error) {
        console.error('[Portal] Failed to decode broadcast payload:', error);
      }
    }
  }

  onBroadcast: ((encryptedBuffer: ArrayBuffer, iv: Uint8Array) => void) | null = null;
  onUserFollowChange: ((payload: OnUserFollowedPayload) => void) | null = null;


  close() {
    if (!this.socket) {
      return;
    }
    this.queueFileUpload.flush();
    this.socket.unsubscribe();
    this.socket = null;
    this.roomId = null;
    this.roomKey = null;
    this.socketInitialized = false;
    this.broadcastedElementVersions = new Map();
  }

  isOpen() {
    return !!(
      this.socketInitialized &&
      this.socket &&
      this.roomId &&
      this.roomKey
    );
  }

  async _broadcastSocketData(
    data: SocketUpdateData,
    volatile: boolean = false,
    roomId?: string,
  ) {
    if (this.isOpen()) {
      const json = JSON.stringify(data);
      const encoded = new TextEncoder().encode(json);
      const { encryptedBuffer, iv } = await encryptData(this.roomKey!, encoded);

      // Map Arrays to regular arrays if needed? Supabase handles JSON.
      // ArrayBuffer might need to be Base64 encoded for JSON transport if Supabase doesn't handle mixed types well in `send`.
      // `socket.io` supports binary. Supabase Realtime sends JSON.
      // WE MUST BASE64 ENCODE BINARY DATA.

      const b64Buffer = btoa(String.fromCharCode(...new Uint8Array(encryptedBuffer)));
      const b64Iv = btoa(String.fromCharCode(...iv));

      this.socket?.send({
        type: 'broadcast',
        event: volatile ? WS_EVENTS.SERVER_VOLATILE : WS_EVENTS.SERVER,
        payload: {
          encryptedBuffer: b64Buffer,
          iv: b64Iv
        },
      });
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
      this.socket.send({
        type: 'broadcast',
        event: WS_EVENTS.USER_FOLLOW_CHANGE,
        payload: payload,
      });
    }
  };

  // Helper to get ephemeral socket ID
  getSocketId() {
    // Supabase doesn't assign a stable socket ID by default.
    // We can use the presence 'presence_ref' or a locally generated UUID.
    // ideally we generated one on init?
    // For now let's reuse the one we track in presence.
    // Or we can just use a random string since it's just for identification in this session.
    return this.socket?.topic || "unknown"; // Topic is usually `room:ID`
  }
}

export default Portal;
