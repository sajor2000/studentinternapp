import { canAccessNeon, getSession } from "../../lib/auth";
import { getHealthmapSchema } from "../../lib/schema-context";

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

    const schema = await getHealthmapSchema();

    return Response.json(
      {
        ok: true,
        schema: schema.schema,
        tableCount: schema.tables.length,
        tables: schema.tables,
      },
      { headers: noStoreHeaders },
    );
  } catch {
    return Response.json(
      {
        ok: false,
        error: "Neon read-only schema is not configured.",
      },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
