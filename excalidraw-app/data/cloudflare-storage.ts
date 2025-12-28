import { reconcileElements } from "@excalidraw/excalidraw";
import { MIME_TYPES } from "@excalidraw/common";
import { decompressData } from "@excalidraw/excalidraw/data/encode";
import {
    encryptData,
    decryptData,
} from "@excalidraw/excalidraw/data/encryption";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { getSceneVersion } from "@excalidraw/element";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type {
    ExcalidrawElement,
    FileId,
    OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
    AppState,
    BinaryFileData,
    BinaryFileMetadata,
    DataURL,
} from "@excalidraw/excalidraw/types";



import { getSyncableElements } from ".";

import type { SyncableExcalidrawElement } from ".";
import type Portal from "../collab/Portal";
import type { CloudflareWSClient } from "./cloudflare-ws";

// Get the Cloudflare Worker URL from environment
const getWorkerUrl = (): string => {
    try {
        return import.meta.env.VITE_APP_CLOUDFLARE_WORKER_URL || "http://localhost:8787";
    } catch {
        return "http://localhost:8787";
    }
};

// -----------------------------------------------------------------------------

type CloudflareStoredScene = {
    iv: string; // base64 encoded
    ciphertext: string; // base64 encoded
    sceneVersion: number;
    updatedAt: number;
};

const encryptElements = async (
    key: string,
    elements: readonly ExcalidrawElement[],
): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> => {
    const json = JSON.stringify(elements);
    const encoded = new TextEncoder().encode(json);
    const { encryptedBuffer, iv } = await encryptData(key, encoded);

    return { ciphertext: encryptedBuffer, iv };
};

const decryptElements = async (
    data: CloudflareStoredScene,
    roomKey: string,
): Promise<readonly ExcalidrawElement[]> => {
    const ciphertext = Uint8Array.from(atob(data.ciphertext), (c) =>
        c.charCodeAt(0),
    ) as Uint8Array<ArrayBuffer>;
    const iv = Uint8Array.from(atob(data.iv), (c) =>
        c.charCodeAt(0),
    ) as Uint8Array<ArrayBuffer>;

    const decrypted = await decryptData(iv, ciphertext, roomKey);
    const decodedData = new TextDecoder("utf-8").decode(
        new Uint8Array(decrypted),
    );
    return JSON.parse(decodedData);
};

class CloudflareSceneVersionCache {
    private static cache = new WeakMap<CloudflareWSClient, number>();
    static get = (socket: CloudflareWSClient) => {
        return CloudflareSceneVersionCache.cache.get(socket);
    };
    static set = (
        socket: CloudflareWSClient,
        elements: readonly SyncableExcalidrawElement[],
    ) => {
        CloudflareSceneVersionCache.cache.set(socket, getSceneVersion(elements));
    };
}

export const isSavedToCloudflare = (
    portal: Portal,
    elements: readonly ExcalidrawElement[],
): boolean => {
    if (portal.socket && portal.roomId && portal.roomKey) {
        const sceneVersion = getSceneVersion(elements);

        return CloudflareSceneVersionCache.get(portal.socket) === sceneVersion;
    }
    // if no room exists, consider the room saved so that we don't unnecessarily
    // prevent unload (there's nothing we could do at that point anyway)
    return true;
};

export const saveFilesToCloudflare = async ({
    prefix,
    files,
}: {
    prefix: string;
    files: { id: FileId; buffer: Uint8Array }[];
}) => {
    const workerUrl = getWorkerUrl();
    const erroredFiles: FileId[] = [];
    const savedFiles: FileId[] = [];

    await Promise.all(
        files.map(async ({ id, buffer }) => {
            try {
                const filePath = `${prefix.replace(/^\//, "")}/${id}`;
                const response = await fetch(`${workerUrl}/files/${filePath}`, {
                    method: "PUT",
                    headers: {
                        "Content-Type": MIME_TYPES.binary,
                    },
                    body: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
                });

                if (!response.ok) {
                    throw new Error(`Upload failed: ${response.status}`);
                }
                savedFiles.push(id);
            } catch (error: any) {
                console.error("Error saving file to Cloudflare:", error);
                erroredFiles.push(id);
            }
        }),
    );

    return { savedFiles, erroredFiles };
};

const createCloudflareSceneDocument = async (
    elements: readonly SyncableExcalidrawElement[],
    roomKey: string,
) => {
    const sceneVersion = getSceneVersion(elements);
    const { ciphertext, iv } = await encryptElements(roomKey, elements);

    // Convert to base64 for storage
    const ciphertextBase64 = btoa(
        String.fromCharCode(...new Uint8Array(ciphertext)),
    );
    const ivBase64 = btoa(String.fromCharCode(...iv));

    return {
        sceneVersion,
        ciphertext: ciphertextBase64,
        iv: ivBase64,
    };
};

export const saveToCloudflare = async (
    portal: Portal,
    elements: readonly SyncableExcalidrawElement[],
    appState: AppState,
) => {
    const { roomId, roomKey, socket } = portal;
    if (
        // bail if no room exists as there's nothing we can do at this point
        !roomId ||
        !roomKey ||
        !socket ||
        isSavedToCloudflare(portal, elements)
    ) {
        return null;
    }

    const workerUrl = getWorkerUrl();

    // First, try to get existing scene
    let existingScene: CloudflareStoredScene | null = null;
    try {
        const response = await fetch(`${workerUrl}/room/${roomId}/scene`);
        if (response.ok) {
            existingScene = await response.json();
        }
    } catch (error) {
        console.warn("Error fetching existing scene:", error);
    }

    let storedScene: CloudflareStoredScene;

    if (!existingScene) {
        // Create new scene
        const sceneData = await createCloudflareSceneDocument(elements, roomKey);
        const response = await fetch(`${workerUrl}/room/${roomId}/scene`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sceneData),
        });

        if (!response.ok) {
            throw new Error(`Failed to save scene: ${response.status}`);
        }

        storedScene = {
            ...sceneData,
            updatedAt: Date.now(),
        };
    } else {
        // Update existing scene with reconciliation
        const prevStoredElements = getSyncableElements(
            restoreElements(await decryptElements(existingScene, roomKey), null),
        );
        const reconciledElements = getSyncableElements(
            reconcileElements(
                elements,
                prevStoredElements as OrderedExcalidrawElement[] as RemoteExcalidrawElement[],
                appState,
            ),
        );

        const sceneData = await createCloudflareSceneDocument(
            reconciledElements,
            roomKey,
        );

        const response = await fetch(`${workerUrl}/room/${roomId}/scene`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sceneData),
        });

        if (!response.ok) {
            throw new Error(`Failed to update scene: ${response.status}`);
        }

        storedScene = {
            ...sceneData,
            updatedAt: Date.now(),
        };
    }

    const storedElements = getSyncableElements(
        restoreElements(await decryptElements(storedScene, roomKey), null),
    );

    CloudflareSceneVersionCache.set(socket, storedElements);

    return storedElements;
};

export const loadFromCloudflare = async (
    roomId: string,
    roomKey: string,
    socket: CloudflareWSClient | null,
): Promise<readonly SyncableExcalidrawElement[] | null> => {
    const workerUrl = getWorkerUrl();

    try {
        const response = await fetch(`${workerUrl}/room/${roomId}/scene`);

        if (!response.ok) {
            return null;
        }

        const data: CloudflareStoredScene | null = await response.json();

        if (!data) {
            return null;
        }

        const elements = getSyncableElements(
            restoreElements(await decryptElements(data, roomKey), null, {
                deleteInvisibleElements: true,
            }),
        );

        if (socket) {
            CloudflareSceneVersionCache.set(socket, elements);
        }

        return elements;
    } catch (error) {
        console.error("Error loading from Cloudflare:", error);
        return null;
    }
};

export const loadFilesFromCloudflare = async (
    prefix: string,
    decryptionKey: string,
    filesIds: readonly FileId[],
) => {
    const workerUrl = getWorkerUrl();
    const loadedFiles: BinaryFileData[] = [];
    const erroredFiles = new Map<FileId, true>();

    await Promise.all(
        [...new Set(filesIds)].map(async (id) => {
            try {
                const filePath = `${prefix.replace(/^\//, "")}/${id}`;
                const response = await fetch(`${workerUrl}/files/${filePath}`);

                if (!response.ok) {
                    throw new Error(`File not found: ${response.status}`);
                }

                const arrayBuffer = await response.arrayBuffer();

                const { data: decompressedData, metadata } =
                    await decompressData<BinaryFileMetadata>(
                        new Uint8Array(arrayBuffer),
                        {
                            decryptionKey,
                        },
                    );

                const dataURL = new TextDecoder().decode(decompressedData) as DataURL;

                loadedFiles.push({
                    mimeType: metadata.mimeType || MIME_TYPES.binary,
                    id,
                    dataURL,
                    created: metadata?.created || Date.now(),
                    lastRetrieved: metadata?.created || Date.now(),
                });
            } catch (error: any) {
                erroredFiles.set(id, true);
                console.error(error);
            }
        }),
    );

    return { loadedFiles, erroredFiles };
};
