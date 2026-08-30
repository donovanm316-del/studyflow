/**
 * GET — what the Settings page renders its connection card from.
 *
 * Never fails: an unconfigured deployment, a missing cookie and a tampered cookie all resolve to a
 * truthful "not connected" rather than an error, because a Settings page that 500s over an optional
 * integration is worse than one that says the integration isn't set up.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getConnectionStatus } from "@/lib/integrations/google-classroom/service";
import { SESSION_COOKIE } from "@/lib/integrations/google-classroom/session";

export const runtime = "nodejs"; // node:crypto opens the sealed cookie

export async function GET(request: NextRequest) {
  const status = getConnectionStatus(request.cookies.get(SESSION_COOKIE)?.value);
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
