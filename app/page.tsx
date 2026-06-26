import { ChatShell } from "./components/chat-shell";
import { LoginShell } from "./components/login-shell";
import { getSession } from "./lib/auth";

export default async function Page() {
  const session = await getSession();

  return session ? <ChatShell session={session} /> : <LoginShell />;
}
