/*
* Vencord, a modification for Discord's desktop app
* Copyright (c) 2024 Vendicated and contributors
* SPDX-License-Identifier: GPL-3.0-or-later
*/

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import {
    Constants,
    Menu,
    RestAPI,
    SelectedChannelStore,
    showToast,
    SnowflakeUtils,
    Toasts
} from "@webpack/common";

const DISCORD_SIZE_LIMIT = 10 * 1024 * 1024;
const R2_SIZE_LIMIT = 5 * 1024 * 1024 * 1024;

const settings = definePluginSettings({
    uploadApiUrl: {
        type: OptionType.STRING,
        description: "Your Vercel Upload API URL (e.g. https://your-project.vercel.app/api/upload-ticket).",
        default: "https://fileditch.vercel.app/api/upload-ticket"
    }
});

interface UploadEntry {
    id: number;
    filename: string;
    progress: number;
    canceled: boolean;
    abort?: () => void;
}

let uploadCounter = 0;
const activeUploads = new Map<number, UploadEntry>();
let overlayEl: HTMLDivElement | null = null;
let overlayClickBound = false;

function getOrCreateOverlay(): HTMLDivElement {
    if (!overlayEl || !document.body.contains(overlayEl)) {
        overlayEl = document.createElement("div");
        overlayEl.id = "r2-upload-overlay";

        Object.assign(overlayEl.style, {
            position: "fixed",
            bottom: "80px",
            right: "16px",
            zIndex: "9999",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            minWidth: "260px",
            maxWidth: "320px",
            fontFamily: "sans-serif",
            pointerEvents: "none"
        });

        document.body.appendChild(overlayEl);
        overlayClickBound = false;
    }

    if (!overlayClickBound) {
        overlayEl.addEventListener("click", e => {
            const target = (e.target as HTMLElement)?.closest("[data-cancel-id]");
            if (!target) return;

            const id = Number(target.getAttribute("data-cancel-id"));
            cancelUploadById(id);
        });
        overlayClickBound = true;
    }

    return overlayEl;
}

function renderOverlay() {
    const overlay = getOrCreateOverlay();
    overlay.innerHTML = "";

    for (const u of activeUploads.values()) {
        const card = document.createElement("div");

        Object.assign(card.style, {
            background: "var(--background-floating, #18191c)",
            border: "1px solid var(--background-modifier-accent, #4f545c)",
            borderRadius: "8px",
            padding: "10px 14px",
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
            color: "var(--text-normal, #dcddde)",
            fontSize: "13px",
            pointerEvents: "auto"
        });

        const icon = u.canceled ? "🚫" : u.progress === -1 ? "❌" : u.progress >= 100 ? "✅" : "⏫";
        const label = u.canceled
            ? "Upload canceled"
            : u.progress === -1
                ? "Upload failed"
                : u.progress >= 100
                    ? "Finishing..."
                    : `Uploading... ${u.progress}%`;

        const showCancel = !u.canceled && u.progress > -1 && u.progress < 100;

        card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <strong style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;" title="${u.filename}">
          ${icon} ${u.filename}
        </strong>
        ${showCancel ? `<button data-cancel-id="${u.id}" style="background: none; border: none; color: #ed4245; cursor: pointer; font-weight: bold; font-size: 12px; padding: 2px 6px;">Cancel</button>` : ""}
      </div>
      <div style="color: var(--text-muted, #a3a6aa); margin-bottom: 6px;">${label}</div>
    `;

        overlay.appendChild(card);
    }
}

function addUpload(filename: string): number {
    const id = ++uploadCounter;
    activeUploads.set(id, { id, filename, progress: 0, canceled: false });
    renderOverlay();
    return id;
}

function updateUpload(id: number, progress: number) {
    const upload = activeUploads.get(id);
    if (!upload || upload.canceled) return;

    upload.progress = progress;
    renderOverlay();
}

function finishUpload(id: number, error = false) {
    const upload = activeUploads.get(id);
    if (!upload) return;

    upload.progress = error ? -1 : 100;
    renderOverlay();

    setTimeout(() => {
        activeUploads.delete(id);
        renderOverlay();
    }, 3000);
}

function markCanceled(id: number) {
    const upload = activeUploads.get(id);
    if (!upload) return;

    upload.canceled = true;
    renderOverlay();

    setTimeout(() => {
        activeUploads.delete(id);
        renderOverlay();
    }, 2000);
}

function cancelUploadById(id: number) {
    const upload = activeUploads.get(id);
    if (!upload || upload.canceled) return;

    upload.abort?.();
}

function getNativeHelper(): any | null {
    const helpers = (globalThis as any).VencordNative?.pluginHelpers;
    if (!helpers) return null;

    for (const key of Object.keys(helpers)) {
        const helper = helpers[key];
        if (helper && typeof helper.uploadToR2 === "function") {
            return helper;
        }
    }

    return null;
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.message.startsWith("AbortError");
}

async function uploadFile(
    file: File,
    id: number,
    onProgress: (progress: number) => void
): Promise<string> {
    const helper = getNativeHelper();
    if (!helper) {
        throw new Error("uploadToR2 helper not found. Did you restart Discord?");
    }

    const apiUrl = settings.store.uploadApiUrl as string;
    if (!apiUrl) {
        throw new Error("Please configure your Vercel Upload API URL in the plugin settings.");
    }

    const uploadId = String(id);
    const upload = activeUploads.get(id);

    if (upload) {
        upload.abort = () => {
            void helper.cancelUpload?.(uploadId);
        };
    }

    const buffer = await file.arrayBuffer();
    onProgress(10); // Connecting to get ticket

    const url = await helper.uploadToR2(
        buffer,
        file.name,
        file.type,
        apiUrl,
        uploadId
    );

    onProgress(95);
    return url as string;
}

async function handleFiles(files: File[], channelId: string, forceUploadAll = false) {
    const candidateFiles = forceUploadAll
        ? files
        : files.filter(file => file.size > DISCORD_SIZE_LIMIT);

    if (!candidateFiles.length) return;

    const oversizedFiles = candidateFiles.filter(file => file.size > R2_SIZE_LIMIT);

    if (oversizedFiles.length) {
        showToast(
            `Skipped ${oversizedFiles.length} file(s) larger than 5 GB (R2 limit).`,
            Toasts.Type.FAILURE
        );
    }

    const validFiles = candidateFiles.filter(file => file.size <= R2_SIZE_LIMIT);

    for (const file of validFiles) {
        const id = addUpload(file.name);

        try {
            const uploadedUrl = await uploadFile(file, id, progress => updateUpload(id, progress));
            const content = `[\u2800](${uploadedUrl})`;

            await RestAPI.post({
                url: Constants.Endpoints.MESSAGES(channelId),
                body: {
                    content: content,
                    channel_id: channelId,
                    nonce: SnowflakeUtils.fromTimestamp(Date.now()),
                    tts: false
                }
            });

            finishUpload(id);
        } catch (error) {
            if (isAbortError(error)) {
                markCanceled(id);
                showToast(`Upload of ${file.name} canceled.`, Toasts.Type.MESSAGE);
            } else {
                console.error("[R2Upload]", error);
                finishUpload(id, true);
                showToast(`Upload failed: ${(error as Error).message}`, Toasts.Type.FAILURE);
            }
        }
    }
}

function triggerFileUpload() {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.style.display = "none";

    input.addEventListener("change", async () => {
        const files = Array.from(input.files ?? []);
        if (!files.length) return;

        const channelId = SelectedChannelStore.getChannelId();
        if (!channelId) return;

        await handleFiles(files, channelId, true);
    });

    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
}

const ctxMenuPatch: NavContextMenuPatchCallback = (children) => {
    if (!Array.isArray(children)) return;

    const alreadyAdded = children.some((child: any) => child?.props?.id === "upload-big-file");
    if (alreadyAdded) return;

    children.splice(
        1,
        0,
        <Menu.MenuItem
            id="upload-big-file"
            label="Upload Large File (R2)"
            action={triggerFileUpload}
        />
    );
};

export default definePlugin({
    name: "FileditchUpload",
    description: "upload big big file",
    authors: [{ name: "Kirk", id: 0n }],
    settings,

    contextMenus: {
        "channel-attach": ctxMenuPatch
    },

    _onDrop: null as ((e: DragEvent) => void) | null,
    _observer: null as MutationObserver | null,

    _patchFileInput(input: HTMLInputElement) {
        if ((input as any).__r2UploadPatched) return;
        (input as any).__r2UploadPatched = true;

        input.addEventListener(
            "change",
            e => {
                const files = Array.from(input.files ?? []);
                const largeFiles = files.filter(file => file.size > DISCORD_SIZE_LIMIT);
                if (!largeFiles.length) return;

                e.stopImmediatePropagation();

                try {
                    input.value = "";
                } catch { }

                const channelId = SelectedChannelStore.getChannelId();
                if (!channelId) return;

                void handleFiles(largeFiles, channelId, false);
            },
            { capture: true }
        );
    },

    start() {
        this._onDrop = (e: DragEvent) => {
            if (!e.dataTransfer?.files?.length) return;

            const largeFiles = Array.from(e.dataTransfer.files).filter(
                file => file.size > DISCORD_SIZE_LIMIT
            );

            if (!largeFiles.length) return;

            e.stopImmediatePropagation();
            e.preventDefault();

            const channelId = SelectedChannelStore.getChannelId();
            if (!channelId) return;

            void handleFiles(largeFiles, channelId, false);
        };

        window.addEventListener("drop", this._onDrop, { capture: true });

        this._observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of Array.from(mutation.addedNodes)) {
                    if (node instanceof HTMLInputElement && node.type === "file") {
                        this._patchFileInput(node);
                    }

                    if (node instanceof Element) {
                        node.querySelectorAll("input[type='file']").forEach(el => {
                            this._patchFileInput(el as HTMLInputElement);
                        });
                    }
                }
            }
        });

        this._observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        document.querySelectorAll("input[type='file']").forEach(el => {
            this._patchFileInput(el as HTMLInputElement);
        });
    },

    stop() {
        if (this._onDrop) {
            window.removeEventListener("drop", this._onDrop, { capture: true });
        }

        this._observer?.disconnect();
        this._observer = null;
        this._onDrop = null;

        overlayEl?.remove();
        overlayEl = null;
        overlayClickBound = false;
        activeUploads.clear();
    }
});