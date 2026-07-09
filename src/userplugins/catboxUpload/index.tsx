/*
* Vencord, a modification for Discord's desktop app
* Copyright (c) 2024 Vendicated and contributors
* SPDX-License-Identifier: GPL-3.0-or-later
*/

import definePlugin from "@utils/types";
import { Constants, RestAPI, SelectedChannelStore, showToast, SnowflakeUtils, Toasts } from "@webpack/common";

// @ts-ignore
const LZString = function () { var r = String.fromCharCode, n = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$", e = {}; function t(r, n) { if (!e[r]) { e[r] = {}; for (var t = 0; t < r.length; t++)e[r][r.charAt(t)] = t; } return e[r][n]; } var i = { compressToEncodedURIComponent: function (r) { return null == r ? "" : i._compress(r, 6, function (r) { return n.charAt(r); }); }, _compress: function (r, n, t) { if (null == r) return ""; var e, i, o, s = {}, u = {}, a = "", p = "", c = "", l = 2, f = 3, h = 2, d = [], m = 0, v = 0; for (o = 0; o < r.length; o += 1)if (a = r.charAt(o), Object.prototype.hasOwnProperty.call(s, a) || (s[a] = f++, u[a] = !0), p = c + a, Object.prototype.hasOwnProperty.call(s, p)) c = p; else { if (Object.prototype.hasOwnProperty.call(u, c)) { if (c.charCodeAt(0) < 256) { for (e = 0; e < h; e++)m <<= 1, v == n - 1 ? (v = 0, d.push(t(m)), m = 0) : v++; for (i = c.charCodeAt(0), e = 0; e < 8; e++)m = m << 1 | 1 & i, v == n - 1 ? (v = 0, d.push(t(m)), m = 0) : v++, i >>= 1; } else { for (i = 1, e = 0; e < h; e++)m = m << 1 | i, v == n - 1 ? (v = 0, d.push(t(m)), m = 0) : v++, i = 0; for (i = c.charCodeAt(0), e = 0; e < 16; e++)m = m << 1 | 1 & i, v == n - 1 ? (v = 0, d.push(t(m)), m = 0) : v++, i >>= 1; } 0 == --l && (l = Math.pow(2, h), h++), delete u[c]; } else for (i = s[c], e = 0; e < h; e++)m = m << 1 | 1 & i, v == n - 1 ? (v = 0, d.push(t(m)), m = 0) : v++, i >>= 1; 0 == --l && (l = Math.pow(2, h), h++), s[p] = f++, c = String(a); } if ("" !== c) { if (Object.prototype.hasOwnProperty.call(u, c)) { if (c.charCodeAt(0) < 256) { for (e = 0; e < h; e++)m <<= 1, v == n - 1 ? (v = 0, d.push(t(m)), m = 0) : v++; for (i = c.charCodeAt(0), e = 0; e < 8; e++)m = m << 1 | 1 & i, v == n - 1 ? (v = 0, d.push(t(m)), m = 0) : v++, i >>= 1; } else { for (i = 1, e = 0; e < h; e++)m = m << 1 | i, v == n - 1 ? (v = 0, d.push(t(m)), m = 0) : v++, i = 0; for (i = c.charCodeAt(0), e = 0; e < 16; e++)m = m << 1 | 1 & i, v == n - 1 ? (v = 0, d.push(t(m)), m = 0) : v++, i >>= 1; } 0 == --l && (l = Math.pow(2, h), h++), delete u[c]; } else for (i = s[c], e = 0; e < h; e++)m = m << 1 | 1 & i, v == n - 1 ? (v = 0, d.push(t(m)), m = 0) : v++, i >>= 1; 0 == --l && (l = Math.pow(2, h), h++); } for (i = 2, e = 0; e < h; e++)m = m << 1 | 1 & i, v == n - 1 ? (v = 0, d.push(t(m)), m = 0) : v++, i >>= 1; for (; ;) { if (m <<= 1, v == n - 1) { d.push(t(m)); break; } v++; } return d.join(""); } }; return i; }();

const DISCORD_SIZE_LIMIT = 10 * 1024 * 1024;
// 0x0.st and envs.sh max limit is 512MB
const HOSTERS_MAX_LIMIT = 512 * 1024 * 1024;

const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "mkv"];

interface UploadEntry {
    id: number;
    filename: string;
    progress: number;
}

let uploadCounter = 0;
const activeUploads = new Map<number, UploadEntry>();
let overlayEl: HTMLDivElement | null = null;

function getOrCreateOverlay(): HTMLDivElement {
    if (!overlayEl || !document.body.contains(overlayEl)) {
        overlayEl = document.createElement("div");
        overlayEl.id = "hosters-upload-overlay";
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
            pointerEvents: "none",
        });
        document.body.appendChild(overlayEl);
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
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            color: "var(--text-normal, #dcddde)",
            fontSize: "13px",
        });

        const icon = u.progress === -1 ? "❌" : u.progress >= 100 ? "✅" : "⏫";
        const label = u.progress === -1
            ? "Upload failed"
            : u.progress >= 100
                ? "Getting ready"
                : `Uploading... ${u.progress}%`;

        card.innerHTML = `
            <div style="font-weight:600; margin-bottom:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                ${icon} ${u.filename}
            </div>
            <div style="height:4px; background:var(--background-modifier-active, #36393f); border-radius:2px; overflow:hidden;">
                <div style="
                    height:100%; 
                    width:${u.progress === -1 ? 100 : u.progress}%; 
                    background:${u.progress === -1 ? "#ed4245" : u.progress >= 100 ? "#3ba55c" : "#5865f2"};
                    transition:width 0.3s ease;
                "></div>
            </div>
            <div style="margin-top:6px; font-size:11px; opacity:0.8;">${label}</div>
        `;
        overlay.appendChild(card);
    }
}

function addUpload(filename: string): number {
    const id = ++uploadCounter;
    activeUploads.set(id, { id, filename, progress: 0 });
    renderOverlay();
    return id;
}

function updateUpload(id: number, progress: number) {
    const u = activeUploads.get(id);
    if (u) { u.progress = progress; renderOverlay(); }
}

function finishUpload(id: number, error = false) {
    const u = activeUploads.get(id);
    if (u) { u.progress = error ? -1 : 100; renderOverlay(); }
    setTimeout(() => { activeUploads.delete(id); renderOverlay(); }, 3000);
}

async function uploadFile(file: File, onProgress: (p: number) => void): Promise<string> {
    const buffer = await file.arrayBuffer();
    onProgress(10);
    // Updated IPC call to match the new native.ts implementation
    const url: string = await VencordNative.pluginHelpers.SizeLimitBypass.uploadToHosters(
        buffer, file.name, file.type
    );
    onProgress(95);
    return url;
}

async function handleFiles(files: File[], channelId: string) {
    const oversizedFiles = files.filter(f => f.size > HOSTERS_MAX_LIMIT);
    if (oversizedFiles.length) {
        showToast(`Skipped ${oversizedFiles.length} file(s) larger than the 512 MB limit.`, Toasts.Type.FAILURE);
    }

    const validFiles = files.filter(f => f.size <= HOSTERS_MAX_LIMIT);

    for (const file of validFiles) {
        const id = addUpload(file.name);
        try {
            const uploadedUrl = await uploadFile(file, pct => updateUpload(id, pct));

            const filename = uploadedUrl.split("/").pop() ?? "";
            const ext = filename.split(".").pop()?.toLowerCase() ?? "";
            const isVideo = VIDEO_EXTENSIONS.includes(ext);

            let content: string;

            if (isVideo) {
                // Uses the invisible braille pattern to hide the text, 
                // but points directly to the file so Discord can embed it!
                content = `[\u2800](${uploadedUrl})`;
            } else {
                // For images or zips, just paste the raw URL
                content = uploadedUrl;
            }

            await RestAPI.post({
                url: Constants.Endpoints.MESSAGES(channelId),
                body: {
                    content,
                    channel_id: channelId,
                    nonce: SnowflakeUtils.fromTimestamp(Date.now()),
                    tts: false,
                },
            });

            finishUpload(id);
        } catch (e) {
            console.error("[SizeLimitBypass]", e);
            finishUpload(id, true);
            showToast(`Upload failed: ${(e as Error).message}`, Toasts.Type.FAILURE);
        }
    }
}

export default definePlugin({
    name: "SizeLimitBypass",
    description: "uploads files larger than 10MB",
    authors: [{ name: "Kirk", id: 0n }],

    _onDrop: null as any,
    _observer: null as MutationObserver | null,

    _patchFileInput(input: HTMLInputElement) {
        if ((input as any).__hostersPatched) return;
        (input as any).__hostersPatched = true;

        input.addEventListener("change", e => {
            const files = Array.from(input.files ?? []);
            const largeFiles = files.filter(f => f.size > DISCORD_SIZE_LIMIT);
            if (!largeFiles.length) return;

            e.stopImmediatePropagation();
            try { input.value = ""; } catch { }

            const channelId = SelectedChannelStore.getChannelId();
            handleFiles(largeFiles, channelId);
        }, { capture: true });
    },

    start() {
        this._onDrop = (e: DragEvent) => {
            if (!e.dataTransfer?.files.length) return;
            const largeFiles = Array.from(e.dataTransfer.files).filter(f => f.size > DISCORD_SIZE_LIMIT);
            if (!largeFiles.length) return;

            e.stopImmediatePropagation();
            e.preventDefault();

            const channelId = SelectedChannelStore.getChannelId();
            handleFiles(largeFiles, channelId);
        };

        window.addEventListener("drop", this._onDrop, { capture: true });

        this._observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of Array.from(mutation.addedNodes)) {
                    if (node instanceof HTMLInputElement && node.type === "file") {
                        this._patchFileInput(node);
                    }
                    if (node instanceof Element) {
                        node.querySelectorAll("input[type=file]").forEach(
                            el => this._patchFileInput(el as HTMLInputElement)
                        );
                    }
                }
            }
        });

        this._observer.observe(document.body, { childList: true, subtree: true });

        document.querySelectorAll("input[type=file]").forEach(
            el => this._patchFileInput(el as HTMLInputElement)
        );
    },

    stop() {
        window.removeEventListener("drop", this._onDrop, { capture: true });
        this._observer?.disconnect();
        overlayEl?.remove();
        overlayEl = null;
        activeUploads.clear();
    },
});