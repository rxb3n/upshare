/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent, net, ClientRequest } from "electron";

interface FileDitchResponse {
    success?: boolean;
    url?: string;
    filename?: string;
    size?: number;
    error?: string;
}

// Map to keep track of active requests so we can abort them by ID
const activeRequests = new Map<string, ClientRequest>();

export async function uploadToFileditch(
    _: IpcMainInvokeEvent,
    buffer: ArrayBuffer,
    originalFilename: string,
    mimeType: string,
    permanent: boolean,
    uploadId: string // <-- Added parameter to match index.tsx
): Promise<string> {
    const host = permanent ? "new.fileditch.com" : "temp.fileditch.com";
    const boundary = "----FileditchBoundary" + Date.now().toString(16);
    const mime = mimeType || "application/octet-stream";

    const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${originalFilename}"\r\nContent-Type: ${mime}\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, Buffer.from(buffer), tail]);

    const url = `https://${host}/upload.php`;

    return new Promise((resolve, reject) => {
        try {
            const req = net.request({ method: "POST", url });

            // Store the request so it can be canceled later
            activeRequests.set(uploadId, req);

            req.setHeader("Content-Type", `multipart/form-data; boundary=${boundary}`);

            req.on("response", res => {
                let text = "";
                res.on("data", chunk => (text += chunk));
                res.on("end", () => {
                    activeRequests.delete(uploadId);
                    if (res.statusCode && res.statusCode >= 400) {
                        try {
                            const errJson: FileDitchResponse = JSON.parse(text);
                            reject(new Error(errJson.error ?? `FileDitch HTTP ${res.statusCode}`));
                        } catch {
                            reject(new Error(`FileDitch HTTP ${res.statusCode}: ${text}`));
                        }
                        return;
                    }

                    try {
                        const json: FileDitchResponse = JSON.parse(text);
                        if (!json.success || !json.url) {
                            reject(new Error(json.error ?? "FileDitch upload failed with no error message."));
                            return;
                        }
                        resolve(json.url);
                    } catch (e) {
                        reject(new Error(`FileDitch response parse error: ${text}`));
                    }
                });
            });

            // Handle the abort event gracefully
            req.on("abort", () => {
                activeRequests.delete(uploadId);
                // Prefix with "AbortError" so index.tsx's isAbortError() recognizes it
                reject(new Error("AbortError: Upload canceled by user"));
            });

            req.on("error", err => {
                activeRequests.delete(uploadId);
                // Electron's net module can sometimes emit an error directly upon abort
                if (err.message.includes("ABORTED")) {
                    reject(new Error("AbortError: Upload canceled by user"));
                } else {
                    reject(err);
                }
            });

            req.end(body);
        } catch (e) {
            activeRequests.delete(uploadId);
            reject(e as Error);
        }
    });
}

// New function exported for the Vencord IPC bridge
export async function cancelUpload(
    _: IpcMainInvokeEvent,
    uploadId: string
): Promise<void> {
    const req = activeRequests.get(uploadId);
    if (req) {
        req.abort();
        activeRequests.delete(uploadId);
    }
}