import { NextResponse } from "next/server";
import { buildLocalAnnotations, validateBlocks } from "../../../lib/contracts";
import { requestAiAnnotations } from "../../../lib/providers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      mode?: "local" | "ai";
      providerId?: string;
      blocks?: unknown;
    };
    const blocks = validateBlocks(body.blocks);
    const annotations =
      body.mode === "ai"
        ? await requestAiAnnotations(blocks, body.providerId)
        : buildLocalAnnotations(blocks);

    return NextResponse.json({ annotations });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法处理该文本。";
    const status = /无效|不能|超过|至少|重复/.test(message) ? 400 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
