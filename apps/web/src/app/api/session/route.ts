// POST /session — issues a CSPRNG seed-bound, single-use, time-boxed,
// identity-bound session (CLAUDE.md settle flow step 1). No scoreable run can
// start without one, which closes seed precomputation.
import { NextResponse } from "next/server";
import { parseSessionBody, serializeSession } from "@/lib/api.ts";
import { getSessionTtlMs, getStore } from "@/lib/config.ts";

// Session issuance must not be cached.
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = parseSessionBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const session = await getStore().create({
    player: parsed.value.player,
    identity: parsed.value.identity,
    ttlMs: getSessionTtlMs(),
  });

  return NextResponse.json(serializeSession(session), { status: 201 });
}
