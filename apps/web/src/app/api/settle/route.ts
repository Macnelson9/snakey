// POST /settle — reloads the session, replays (seed + inputs) on the shared
// engine for an authoritative score (the client-claimed score is never trusted),
// runs the integrity gates, and on success returns a signed EIP-712 voucher the
// client redeems on GameRewards for gas-sponsored G$ (CLAUDE.md settle flow 3-4).
import { NextResponse } from "next/server";
import { parseSettleBody, serializeSettle, settleHttpStatus } from "@/lib/api.ts";
import { getSettleParams } from "@/lib/config.ts";
import { settle } from "@/lib/settle.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = parseSettleBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const result = await settle(getSettleParams(), parsed.value);
  return NextResponse.json(serializeSettle(result), { status: settleHttpStatus(result) });
}
