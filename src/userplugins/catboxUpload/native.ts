import { IpcMainInvokeEvent, net } from "electron";

export async function uploadToHosters(
    _: IpcMainInvokeEvent,
    buffer: ArrayBuffer,
    originalFilename: string,
    mimeType: string
): Promise<string> {
    const boundary = "----UploadBoundary" + Date.now().toString(16);

    // We add the 'expire' field before the file field to tell tmpfiles.org to keep it for 48 hours (172800 seconds)
    const head = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="expire"\r\n\r\n` +
        `172800\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${originalFilename}"\r\n` +
        `Content-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, Buffer.from(buffer), tail]);

    // Try tmpfiles.org first
    try {
        return await new Promise((resolve, reject) => {
            const req = net.request({ method: "POST", url: "https://tmpfiles.org/api/v1/upload" });
            req.setHeader("Content-Type", `multipart/form-data; boundary=${boundary}`);
            req.setHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");

            req.on("response", res => {
                const chunks: Buffer[] = [];
                res.on("data", chunk => chunks.push(chunk));
                res.on("end", () => {
                    const text = Buffer.concat(chunks).toString();
                    try {
                        const data = JSON.parse(text);
                        if (data.status === "success" && data.data?.url) {
                            // Convert the page URL to a direct media URL for Discord embeds
                            const directUrl = data.data.url.replace("tmpfiles.org/", "tmpfiles.org/dl/");
                            resolve(directUrl);
                        } else {
                            reject(new Error("tmpfiles.org failed"));
                        }
                    } catch (e) {
                        reject(new Error("Invalid JSON from tmpfiles.org"));
                    }
                });
            });
            req.on("error", reject);
            req.end(body);
        });
    } catch (e) {
        console.warn("tmpfiles.org failed, falling back to file.io", e);
    }

    // Fallback to file.io, also updated to 2 days (48 hours)
    return new Promise((resolve, reject) => {
        const req = net.request({ method: "POST", url: "https://file.io/?expires=2d" });
        req.setHeader("Content-Type", `multipart/form-data; boundary=${boundary}`);
        req.setHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");

        req.on("response", res => {
            const chunks: Buffer[] = [];
            res.on("data", chunk => chunks.push(chunk));
            res.on("end", () => {
                const text = Buffer.concat(chunks).toString();
                try {
                    const data = JSON.parse(text);
                    if (data.success && data.link) {
                        resolve(data.link);
                    } else {
                        reject(new Error(`file.io failed: ${text}`));
                    }
                } catch (e) {
                    reject(new Error("Invalid JSON from file.io"));
                }
            });
        });
        req.on("error", reject);
        req.end(body);
    });
}