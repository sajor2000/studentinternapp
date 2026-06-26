import { NextResponse } from "next/server";
import { getSession } from "../../lib/auth";

export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

export async function GET() {
  const user = await getSession();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401, headers: noStoreHeaders });
  }

  return NextResponse.json({ ok: true, user }, { headers: noStoreHeaders });
}
