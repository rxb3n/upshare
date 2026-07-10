/*
 * Vencord, a Discord client mod
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
const FILEDITCH_SIZE_LIMIT = 100 * 1024 * 1024 * 1024; // 100 GB
const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "mkv"] as const;

const MIME_MAP: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mkv: "video/x-matroska"
};

type Retention = "permanent" | "temp";

const settings = definePluginSettings({
    retention: {
        type: OptionType.SELECT,
        description: "Whether uploads are kept permanently or deleted after 72 hours.",
        options: [
            { label: "Permanent (new.fileditch.com)", value: "permanent" },
            { label: "Temporary — 72h (temp.fileditch.com)", value: "temp" }
        ],
        default: "permanent"
    },
    embedderBase: {
        type: OptionType.STRING,
        description: "Your Vercel embed proxy base URL (e.g. https://fileditch.vercel.app/api/embed).",
        default: "https://fileditch.vercel.app/api/video"
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
        overlayEl.id = "fileditch-upload-overlay";

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

    // Event delegation for cancel buttons — bound once per overlay element
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

        const barWidth = u.canceled || u.progress === -1 ? 100 : u.progress;
        const barColor = u.canceled
            ? "#747f8d"
            : u.progress === -1
                ? "#ed4245"
                : u.progress >= 100
                    ? "#3ba55c"
                    : "#5865f2";

        // Only show cancel button while actively uploading (not finished, failed, or canceled)
        const showCancel = !u.canceled && u.progress > -1 && u.progress < 100;

        card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px;">
                <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;">
                    ${icon} ${u.filename}
                </div>
                ${showCancel ? `<button data-cancel-id="${u.id}" style="background:#4f545c;border:none;color:#fff;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;flex-shrink:0;">Cancel</button>` : ""}
            </div>
            <div style="background:#2f3136;border-radius:4px;height:6px;overflow:hidden;margin-bottom:4px;">
                <div style="height:100%;width:${barWidth}%;background:${barColor};transition:width 0.3s ease;"></div>
            </div>
            <div style="font-size:11px;color:var(--text-muted,#a3a6aa);">${label}</div>
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

function getCurrentRetention(): Retention {
    const r = settings.store.retention as Retention;
    return r === "temp" ? "temp" : "permanent";
}

function getNativeHelper(): any | null {
    const helpers = (globalThis as any).VencordNative?.pluginHelpers;
    if (!helpers) return null;

    for (const key of Object.keys(helpers)) {
        const helper = helpers[key];
        if (helper && typeof helper.uploadToFileditch === "function") {
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
        throw new Error("uploadToFileditch helper not found.");
    }

    const isPermanent = getCurrentRetention() === "permanent";
    const uploadId = String(id);

    const upload = activeUploads.get(id);
    if (upload) {
        // Wire the abort action to call the native cancelUpload IPC
        upload.abort = () => {
            void helper.cancelUpload?.(uploadId);
        };
    }

    const buffer = await file.arrayBuffer();
    onProgress(10);

    const url = await helper.uploadToFileditch(
        buffer,
        file.name,
        file.type,
        isPermanent,
        uploadId
    );

    onProgress(95);
    return url as string;
}

function toUrlSafeBase64(input: string): string {
    return btoa(input)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function buildMessageContent(uploadedUrl: string): string {
    const base = (settings.store.embedderBase as string || "").trim().replace(/\/+$/, "");
    const filename = uploadedUrl.split("/").pop() ?? "";
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const isVideo = VIDEO_EXTENSIONS.includes(ext as any);

    if (isVideo && base) {
        const encoded = toUrlSafeBase64(uploadedUrl);
        const proxied = `${base}/${encoded}.mp4`;
        return `[\u2800](${proxied})`;
    }

    return uploadedUrl;
}

async function handleFiles(files: File[], channelId: string, forceUploadAll = false) {
    const candidateFiles = forceUploadAll
        ? files
        : files.filter(file => file.size > DISCORD_SIZE_LIMIT);

    if (!candidateFiles.length) return;

    const oversizedFiles = candidateFiles.filter(file => file.size > FILEDITCH_SIZE_LIMIT);

    if (oversizedFiles.length) {
        showToast(
            `Skipped ${oversizedFiles.length} file(s) larger than 100 GB (FileDitch limit).`,
            Toasts.Type.FAILURE
        );
    }

    const validFiles = candidateFiles.filter(file => file.size <= FILEDITCH_SIZE_LIMIT);

    for (const file of validFiles) {
        const id = addUpload(file.name);

        try {
            const uploadedUrl = await uploadFile(file, id, progress => updateUpload(id, progress));
            const content = buildMessageContent(uploadedUrl);

            await RestAPI.post({
                url: Constants.Endpoints.MESSAGES(channelId),
                body: {
                    content,
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
                console.error("[FileditchUpload]", error);
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

const ctxMenuPatch: NavContextMenuPatchCallback = children => {
    if (!Array.isArray(children)) return;

    const alreadyAdded = children.some((child: any) => child?.props?.id === "upload-big-file");
    if (alreadyAdded) return;

    children.splice(
        1,
        0,
        <Menu.MenuItem
            id="upload-big-file"
            label="Upload big big File"
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
        if ((input as any).__fileditchUploadPatched) return;
        (input as any).__fileditchUploadPatched = true;

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
