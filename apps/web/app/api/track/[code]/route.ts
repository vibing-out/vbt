import { NextResponse } from "next/server";
import { lookup } from "../../../../lib/demo-election";

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }): Promise<NextResponse> {
  const { code } = await params;
  const view = lookup(decodeURIComponent(code));
  if (!view) return NextResponse.json({ error: "No ballot matches that tracking code." }, { status: 404 });
  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
}
