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
const LITTERBOX_MAX_LIMIT = 1024 * 1024 * 1024;

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
        overlayEl.id = "litterbox-upload-overlay";
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
            <div style="height:6px; background:var(--background-modifier-active, #4f545c); border-radius:3px; overflow:hidden; margin-bottom:6px;">
                <div style="
                    height:100%;
                    width:${u.progress === -1 ? 100 : Math.max(0, u.progress)}%;
                    background:${u.progress === -1 ? "#ed4245" : u.progress >= 100 ? "#3ba55c" : "#5865f2"};
                    transition:width 0.3s ease;
                "></div>
            </div>
            <div style="color:var(--text-muted, #a3a6aa); font-size:11px;">
                ${label}
            </div>
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

async function uploadToLitterbox(file: File, onProgress: (p: number) => void): Promise<string> {
    const buffer = await file.arrayBuffer();
    onProgress(10);
    const url: string = await VencordNative.pluginHelpers.SizeLimitBypass.uploadToLitterbox(
        buffer, file.name, file.type
    );
    onProgress(95);
    return url;
}

async function handleFiles(files: File[], channelId: string) {
    const oversizedFiles = files.filter(f => f.size > LITTERBOX_MAX_LIMIT);
    if (oversizedFiles.length) {
        showToast(`Skipped ${oversizedFiles.length} file(s) larger than Litterbox's 1 GB limit.`, Toasts.Type.FAILURE);
    }

    const validFiles = files.filter(f => f.size <= LITTERBOX_MAX_LIMIT);

    for (const file of validFiles) {
        const id = addUpload(file.name);
        try {
            const litterboxUrl = await uploadToLitterbox(file, pct => updateUpload(id, pct));

            const filename = litterboxUrl.split("/").pop() ?? "";
            const ext = filename.split(".").pop()?.toLowerCase() ?? "";
            const isVideo = VIDEO_EXTENSIONS.includes(ext);

            let content: string;

            if (isVideo) {
                const payload = JSON.stringify([`*${filename}`, ""]);
                const encoded = LZString.compressToEncodedURIComponent(payload);
                const proxyUrl = `https://video.karimawi.me/${encoded}`;
                content = `[\u2800](${proxyUrl})`;
            } else {
                content = `[\u2800](${litterboxUrl})`;
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
    description: "Uploads files larger than 10MB .",
    authors: [{ name: "Kirk", id: 0n }],

    _onDrop: null as any,
    _observer: null as MutationObserver | null,

    _patchFileInput(input: HTMLInputElement) {
        if ((input as any).__litterboxPatched) return;
        (input as any).__litterboxPatched = true;

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