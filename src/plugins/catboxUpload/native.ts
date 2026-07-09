import { IpcMainInvokeEvent, net } from "electron";

function getRandomString(length = 6) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let res = "";
    for (let i = 0; i < length; i++) {
        res += chars[Math.floor(Math.random() * chars.length)];
    }
    return res;
}

export async function uploadToLitterbox(
    _: IpcMainInvokeEvent,
    buffer: ArrayBuffer,
    originalFilename: string,
    mimeType: string
): Promise<string> {
    const boundary = "----LitterboxBoundary" + Date.now().toString(16);

    const extMatch = originalFilename.match(/\.[^.]+$/);
    const ext = extMatch ? extMatch[0] : "";
    const filename = getRandomString(6) + ext;

    const head = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="reqtype"\r\n\r\n` +
        `fileupload\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="time"\r\n\r\n` +
        `24h\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="fileToUpload"; filename="${filename}"\r\n` +
        `Content-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, Buffer.from(buffer), tail]);

    return new Promise((resolve, reject) => {
        const req = net.request({
            method: "POST",
            url: "https://litterbox.catbox.moe/resources/internals/api.php",
        });

        req.setHeader("Content-Type", `multipart/form-data; boundary=${boundary}`);

        req.setHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

        req.on("response", res => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => {
                const text = Buffer.concat(chunks).toString().trim();
                if (text.startsWith("https://")) resolve(text);
                else reject(new Error("Litterbox error: " + text));
            });
        });

        req.on("error", reject);

        req.end(body);
    });
}