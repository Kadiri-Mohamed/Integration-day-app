import QRCode from "qrcode";
import { zipSync, strToU8 } from "fflate";
import { connectDb } from "@/lib/db";
import { requireStaff } from "@/lib/permissions";
import { assertSensitiveRateLimit } from "@/lib/security";
import { Team } from "@/lib/models";
import { publicTeamUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await requireStaff(["SUPER_ADMIN", "ADMIN"]);
    await assertSensitiveRateLimit(actor.id, "team-qr-export", 10);
    await connectDb();
    const teams = await Team.find({ status: "ACTIVE" }).select("name slug color").sort({ name: 1 }).lean() as { name: string; slug: string; color: string }[];
    const files: Record<string, Uint8Array> = {};
    const rows = ["team_name,slug,team_page_url,color"];
    for (const team of teams) {
      const url = publicTeamUrl(team.slug, request.url);
      const filename = `${team.slug.replace(/[^a-z0-9-]/gi, "-") || "team"}.png`;
      files[filename] = new Uint8Array(await QRCode.toBuffer(url, { type: "png", errorCorrectionLevel: "H", margin: 2, width: 600 }));
      rows.push([team.name, team.slug, url, team.color].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","));
    }
    files["teams.csv"] = strToU8(rows.join("\r\n"));
    files["README.txt"] = strToU8("YouPulse public team QR codes. Each QR encodes only the canonical public team page URL; no credentials or tokens are included.\n");
    const archive = zipSync(files, { level: 6 });
    return new Response(archive, { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="youpulse-team-qr-codes.zip"', "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL";
    const status = message === "UNAUTHENTICATED" ? 401 : message === "FORBIDDEN" ? 403 : message === "RATE_LIMITED" ? 429 : 503;
    return Response.json({ error: status === 503 ? "QR_EXPORT_UNAVAILABLE" : message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
