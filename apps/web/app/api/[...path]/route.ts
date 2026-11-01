import { NextRequest, NextResponse } from "next/server";
const base = process.env.AUDIO_ENGINE_URL || "http://127.0.0.1:8000";
// Allow multipart overhead in addition to the engine's 25 MiB file limit.
const maxBody = 26 * 1024 * 1024;
async function forward(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  if (
    !(
      (req.method === "POST" && path.join("/") === "jobs") ||
      (req.method === "GET" && /^jobs\/[a-f0-9]{32}$/.test(path.join("/")))
    )
  )
    return NextResponse.json({ detail: "Not found" }, { status: 404 });
  try {
    let body: Blob | undefined;
    const headers: Record<string, string> = {};
    if (req.method === "POST") {
      const type = req.headers.get("content-type") || "";
      if (!type.toLowerCase().startsWith("multipart/form-data;"))
        return NextResponse.json(
          { detail: "Expected an audio file upload." },
          { status: 415 },
        );
      const length = Number(req.headers.get("content-length") || 0);
      if (length > maxBody)
        return NextResponse.json(
          { detail: "Upload exceeds the 25 MB file limit." },
          { status: 413 },
        );
      if (!req.body)
        return NextResponse.json(
          { detail: "The upload is empty." },
          { status: 400 },
        );
      const reader = req.body.getReader(),
        chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBody) {
          await reader.cancel();
          return NextResponse.json(
            { detail: "Upload exceeds the 25 MB file limit." },
            { status: 413 },
          );
        }
        chunks.push(value);
      }
      body = new Blob(chunks as BlobPart[], { type });
      headers["content-type"] = type;
    }
    const res = await fetch(`${base}/${path.join("/")}`, {
      method: req.method,
      body,
      headers,
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    });
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json(
      { detail: "Audio service is unavailable. Please try again." },
      { status: 503 },
    );
  }
}
export const GET = forward;
export const POST = forward;
