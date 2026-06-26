import { canAccessNeon, getSession } from "../../lib/auth";
import { getWardSummaries } from "../../lib/schema-context";

export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

export async function GET() {
  try {
    const user = await getSession();

    if (!user) {
      return Response.json({ ok: false, error: "Not authenticated." }, { status: 401, headers: noStoreHeaders });
    }

    if (!canAccessNeon(user)) {
      return Response.json({ ok: false, error: "Neon access is not enabled for this account." }, { status: 403, headers: noStoreHeaders });
    }

    const wardIndex = await getWardSummaries();

    return Response.json(
      {
        ok: true,
        schema: wardIndex.schema,
        wardCount: wardIndex.wards.length,
        wards: wardIndex.wards,
      },
      { headers: noStoreHeaders },
    );
  } catch {
    return Response.json(
      {
        ok: false,
        error: "Ward index is not configured.",
      },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
