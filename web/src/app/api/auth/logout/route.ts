import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST() {
  const store = await cookies();
  store.delete("qsa_session");
  return NextResponse.json({ ok: true });
}