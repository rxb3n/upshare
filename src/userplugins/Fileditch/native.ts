import { IpcMainInvokeEvent, net, ClientRequest } from "electron";

const activeRequests = new Map<string, ClientRequest>();

interface TicketResponse {
    uploadUrl: string;
    publicUrl: string;
}

async function fetchUploadTicket(apiUrl: string, filename: string, mimeType: string): Promise<TicketResponse> {
    const url = new URL(apiUrl);
    url.searchParams.set("filename", filename);
    url.searchParams.set("mimeType", mimeType);

    return new Promise((resolve, reject) => {
        const req = net.request({ method: "GET", url: url.toString() });

        req.on("response", res => {
            let body = "";
            res.on("data", chunk => (body += chunk));
            res.on("end", () => {
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(`API Error ${res.statusCode}: ${body}`));
                } else {
                    try {
                        const parsed = JSON.parse(body);
                        if (!parsed.uploadUrl || !parsed.publicUrl) {
                            reject(new Error("Vercel API returned invalid ticket structure"));
                        } else {
                            resolve(parsed);
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse ticket response: ${body}`));
                    }
                }
            });
        });

        req.on("error", reject);
        req.end();
    });
}

export async function uploadToR2(
    _: IpcMainInvokeEvent,
    buffer: ArrayBuffer,
    originalFilename: string,
    mimeType: string,
    apiUrl: string,
    uploadId: string
): Promise<string> {
    const mime = mimeType || "application/octet-stream";

    try {
        const ticket = await fetchUploadTicket(apiUrl, originalFilename, mime);

        return new Promise((resolve, reject) => {
            try {
                const req = net.request({ method: "PUT", url: ticket.uploadUrl });

                activeRequests.set(uploadId, req);

                req.setHeader("Content-Type", mime);
                req.setHeader("Content-Disposition", "inline");

                req.on("response", res => {
                    activeRequests.delete(uploadId);
                    if (res.statusCode && res.statusCode >= 400) {
                        let errText = "";
                        res.on("data", chunk => (errText += chunk));
                        res.on("end", () => {
                            reject(new Error(`Cloudflare R2 HTTP ${res.statusCode}: ${errText}`));
                        });
                        return;
                    }

                    resolve(ticket.publicUrl);
                });

                req.on("abort", () => {
                    activeRequests.delete(uploadId);
                    reject(new Error("AbortError: Upload canceled by user"));
                });

                req.on("error", err => {
                    activeRequests.delete(uploadId);
                    if (err.message.includes("ABORTED")) {
                        reject(new Error("AbortError: Upload canceled by user"));
                    } else {
                        reject(err);
                    }
                });

                req.end(Buffer.from(buffer));
            } catch (e) {
                activeRequests.delete(uploadId);
                reject(e as Error);
            }
        });
    } catch (error) {
        throw error;
    }
}

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