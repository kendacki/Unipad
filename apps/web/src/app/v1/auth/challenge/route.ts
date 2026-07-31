import { NextResponse } from "next/server";
import { issueChallenge } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const chainPubkey = new URL(request.url).searchParams.get("chainPubkey");
  if (!chainPubkey) {
    return NextResponse.json(
      { error: "chainPubkey required", code: "UPAD_VALIDATION" },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await issueChallenge(chainPubkey));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    const code = (err as { code?: string }).code ?? "UPAD_VALIDATION";
    return NextResponse.json(
      { error: (err as Error).message, code },
      { status: status as 400 },
    );
  }
}
