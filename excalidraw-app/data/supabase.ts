import { reconcileElements } from "@excalidraw/excalidraw";
import { MIME_TYPES } from "@excalidraw/common";
import { decompressData } from "@excalidraw/excalidraw/data/encode";
import {
    encryptData,
    decryptData,
} from "@excalidraw/excalidraw/data/encryption";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { getSceneVersion } from "@excalidraw/element";
import { createClient } from "@supabase/supabase-js";

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

import { FILE_CACHE_MAX_AGE_SEC } from "../app_constants";

import { getSyncableElements } from ".";

import type { SyncableExcalidrawElement } from ".";
import type Portal from "../collab/Portal";
import type { Socket } from "socket.io-client";
import type { RealtimeChannel } from "@supabase/supabase-js";

// private
// -----------------------------------------------------------------------------

let SUPABASE_URL: string;
let SUPABASE_ANON_KEY: string;

try {
    SUPABASE_URL = import.meta.env.VITE_APP_SUPABASE_URL || "";
    SUPABASE_ANON_KEY = import.meta.env.VITE_APP_SUPABASE_ANON_KEY || "";
} catch (error: any) {
    console.warn("Error loading Supabase config from environment");
    SUPABASE_URL = "";
    SUPABASE_ANON_KEY = "";
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const getSupabaseClient = () => supabase;

// -----------------------------------------------------------------------------

type SupabaseStoredScene = {
    room_id: string;
    scene_version: number;
    iv: string; // base64 encoded
    ciphertext: string; // base64 encoded
    updated_at: string;
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
    data: SupabaseStoredScene,
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

class SupabaseSceneVersionCache {
    private static cache = new WeakMap<Socket | RealtimeChannel, number>();
    static get = (socket: Socket | RealtimeChannel) => {
        return SupabaseSceneVersionCache.cache.get(socket);
    };
    static set = (
        socket: Socket | RealtimeChannel,
        elements: readonly SyncableExcalidrawElement[],
    ) => {
        SupabaseSceneVersionCache.cache.set(socket, getSceneVersion(elements));
    };
}

export const isSavedToSupabase = (
    portal: Portal,
    elements: readonly ExcalidrawElement[],
): boolean => {
    if (portal.socket && portal.roomId && portal.roomKey) {
        const sceneVersion = getSceneVersion(elements);

        return SupabaseSceneVersionCache.get(portal.socket) === sceneVersion;
    }
    // if no room exists, consider the room saved so that we don't unnecessarily
    // prevent unload (there's nothing we could do at that point anyway)
    return true;
};

export const saveFilesToSupabase = async ({
    prefix,
    files,
}: {
    prefix: string;
    files: { id: FileId; buffer: Uint8Array }[];
}) => {
    const erroredFiles: FileId[] = [];
    const savedFiles: FileId[] = [];

    await Promise.all(
        files.map(async ({ id, buffer }) => {
            try {
                const filePath = `${prefix.replace(/^\//, "")}/${id}`;
                const { error } = await supabase.storage
                    .from("excalidraw-files")
                    .upload(filePath, buffer, {
                        contentType: MIME_TYPES.binary,
                        cacheControl: `${FILE_CACHE_MAX_AGE_SEC}`,
                        upsert: true,
                    });

                if (error) {
                    throw error;
                }
                savedFiles.push(id);
            } catch (error: any) {
                console.error("Error saving file to Supabase:", error);
                erroredFiles.push(id);
            }
        }),
    );

    return { savedFiles, erroredFiles };
};

const createSupabaseSceneDocument = async (
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
        scene_version: sceneVersion,
        ciphertext: ciphertextBase64,
        iv: ivBase64,
    };
};

export const saveToSupabase = async (
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
        isSavedToSupabase(portal, elements)
    ) {
        return null;
    }

    // First, try to get existing scene
    const { data: existingScene } = await supabase
        .from("scenes")
        .select("*")
        .eq("room_id", roomId)
        .single();

    let storedScene: SupabaseStoredScene;

    if (!existingScene) {
        // Create new scene
        const sceneData = await createSupabaseSceneDocument(elements, roomKey);
        const { data, error } = await supabase
            .from("scenes")
            .insert({
                room_id: roomId,
                ...sceneData,
            })
            .select()
            .single();

        if (error) {
            throw error;
        }
        storedScene = data;
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

        const sceneData = await createSupabaseSceneDocument(
            reconciledElements,
            roomKey,
        );

        const { data, error } = await supabase
            .from("scenes")
            .update(sceneData)
            .eq("room_id", roomId)
            .select()
            .single();

        if (error) {
            throw error;
        }
        storedScene = data;
    }

    const storedElements = getSyncableElements(
        restoreElements(await decryptElements(storedScene, roomKey), null),
    );

    SupabaseSceneVersionCache.set(socket, storedElements);

    return storedElements;
};

export const loadFromSupabase = async (
    roomId: string,
    roomKey: string,
    socket: Socket | RealtimeChannel | null,
): Promise<readonly SyncableExcalidrawElement[] | null> => {
    const { data, error } = await supabase
        .from("scenes")
        .select("*")
        .eq("room_id", roomId)
        .single();

    if (error || !data) {
        return null;
    }

    const elements = getSyncableElements(
        restoreElements(await decryptElements(data, roomKey), null, {
            deleteInvisibleElements: true,
        }),
    );

    if (socket) {
        SupabaseSceneVersionCache.set(socket, elements);
    }

    return elements;
};

export const loadFilesFromSupabase = async (
    prefix: string,
    decryptionKey: string,
    filesIds: readonly FileId[],
) => {
    const loadedFiles: BinaryFileData[] = [];
    const erroredFiles = new Map<FileId, true>();

    await Promise.all(
        [...new Set(filesIds)].map(async (id) => {
            try {
                const filePath = `${prefix.replace(/^\//, "")}/${id}`;
                const { data, error } = await supabase.storage
                    .from("excalidraw-files")
                    .download(filePath);

                if (error || !data) {
                    throw error || new Error("No data returned");
                }

                const arrayBuffer = await data.arrayBuffer();

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

// Re-export with Firebase-compatible names for easier migration
export const loadFirebaseStorage = async () => supabase.storage;
export const isSavedToFirebase = isSavedToSupabase;
export const saveFilesToFirebase = saveFilesToSupabase;
export const saveToFirebase = saveToSupabase;
export const loadFromFirebase = loadFromSupabase;
export const loadFilesFromFirebase = loadFilesFromSupabase;
