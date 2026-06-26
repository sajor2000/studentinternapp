import type { UIMessage } from "ai";
import { getSession } from "@/app/lib/auth";
import { getAppSql } from "@/app/lib/db";
import { inspectMessagesForPii, maskPiiText } from "@/app/lib/pii-guard";
import { rejectCrossSiteRequest } from "@/app/lib/request-security";
import { validateAppMetadataRequestContentLength } from "@/app/lib/request-size";

export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

type ChatSessionRow = {
  id: string;
  username: string;
  title: string;
  messages: unknown;
  updated_at: string | Date;
};

type SaveChatSessionRequest = {
  id?: unknown;
  title?: unknown;
  messages?: unknown;
};

function sanitizeTitle(value: unknown): string {
  if (typeof value !== "string") {
    return "New chat";
  }

  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "New chat";
}

function validateSessionId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,120}$/.test(value)) {
    throw new Error("Valid chat session id is required.");
  }

  return value;
}

function validateMessages(value: unknown): UIMessage[] {
  if (!Array.isArray(value)) {
    throw new Error("Chat messages must be an array.");
  }

  const serialized = JSON.stringify(value);

  if (serialized.length > 300000) {
    throw new Error("Chat session is too large to save.");
  }

  return value as UIMessage[];
}

function toChatSession(row: ChatSessionRow) {
  return {
    id: row.id,
    ownerUsername: row.username,
    title: row.title,
    messages: Array.isArray(row.messages) ? row.messages : [],
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

export async function GET(request: Request) {
  const user = await getSession();

  if (!user) {
    return Response.json({ ok: false, error: "Not authenticated." }, { status: 401, headers: noStoreHeaders });
  }

  const sql = getAppSql();

  if (!sql) {
    return Response.json({ ok: false, error: "Chat session database is not configured." }, { status: 503, headers: noStoreHeaders });
  }

  const scope = new URL(request.url).searchParams.get("scope");
  const rows = (user.role === "admin" && scope === "admin"
    ? await sql`
        select id, username, title, messages, updated_at
        from app_private.chat_sessions
        order by updated_at desc
        limit 100
      `
    : await sql`
        select id, username, title, messages, updated_at
        from app_private.chat_sessions
        where username = ${user.username}
        order by updated_at desc
        limit 24
      `) as ChatSessionRow[];

  return Response.json({ ok: true, sessions: rows.map(toChatSession) }, { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  const crossSiteResponse = rejectCrossSiteRequest(request);

  if (crossSiteResponse) {
    return crossSiteResponse;
  }

  const user = await getSession();

  if (!user) {
    return Response.json({ ok: false, error: "Not authenticated." }, { status: 401, headers: noStoreHeaders });
  }

  const sql = getAppSql();

  if (!sql) {
    return Response.json({ ok: false, error: "Chat session database is not configured." }, { status: 503, headers: noStoreHeaders });
  }

  try {
    validateAppMetadataRequestContentLength(request);
    const body = (await request.json().catch(() => ({}))) as SaveChatSessionRequest;
    const id = validateSessionId(body.id);
    const title = maskPiiText(sanitizeTitle(body.title)).text;
    const messages = validateMessages(body.messages);

    if (messages.length === 0) {
      return Response.json({ ok: true, skipped: true }, { headers: noStoreHeaders });
    }

    const piiCheck = inspectMessagesForPii(messages);

    const rows = (await sql`
      insert into app_private.chat_sessions (
        id,
        username,
        title,
        messages,
        created_at,
        updated_at
      )
      values (
        ${id},
        ${user.username},
        ${title},
        ${JSON.stringify(piiCheck.messages)}::jsonb,
        now(),
        now()
      )
      on conflict (username, id)
      do update set
        title = excluded.title,
        messages = excluded.messages,
        updated_at = now()
      returning id, username, title, messages, updated_at
    `) as ChatSessionRow[];

    return Response.json({ ok: true, session: toChatSession(rows[0]) }, { headers: noStoreHeaders });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Chat session could not be saved." },
      { status: 400, headers: noStoreHeaders },
    );
  }
}
