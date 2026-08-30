/**
 * POST — ends the connection.
 *
 * Disconnecting does three things and, just as importantly, does not do three others.
 *
 * It does: revoke the grant at Google, so the token is dead on Google's side and not merely
 * forgotten on ours; delete the session cookie, so StudyFlow holds no credential; and make every
 * future Classroom call fail with "not connected".
 *
 * It does not: touch anything in Google Classroom — no coursework is modified, submitted, or
 * deleted, and this app has no code path capable of doing so. It does not sign the student out of
 * Google. And **it does not delete any StudyFlow work.** A future phase will import assignments
 * from Classroom; once imported, they are the student's own items, with their own estimates,
 * sessions and history. Disconnecting a data source must not reach into a student's planner and
 * remove their work — it only stops new data arriving.
 *
 * POST rather than GET so a link or prefetch can't disconnect someone by accident.
 */
import { NextResponse, type NextRequest } from "next/server";
import { readGoogleConfig } from "@/lib/integrations/google-classroom/config";
import { revokeToken } from "@/lib/integrations/google-classroom/oauth";
import { cookieOptions, openSession, SESSION_COOKIE } from "@/lib/integrations/google-classroom/session";
import { isSecureRequest } from "../shared";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const configResult = readGoogleConfig();
  const sealed = request.cookies.get(SESSION_COOKIE)?.value;

  let revoked = false;
  if (configResult.ok) {
    const session = openSession(sealed, configResult.config.sessionSecret);
    if (session) revoked = await revokeToken(session.refreshToken);
  }

  // The cookie is cleared unconditionally. If revocation failed — Google unreachable, token already
  // revoked from the student's account page — StudyFlow must still let go of it. Reporting an error
  // and keeping the credential would be the worst of both outcomes.
  const response = NextResponse.json({ disconnected: true, revokedAtGoogle: revoked });
  response.cookies.set(SESSION_COOKIE, "", cookieOptions(0, isSecureRequest(request)));
  return response;
}
