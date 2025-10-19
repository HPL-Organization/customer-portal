export async function POST(req: Request) {
  try {
    const { email, password, nsId } = await req.json();

    if (
      email !== process.env.ADMIN_EMAIL ||
      password !== process.env.ADMIN_PASSWORD ||
      !nsId
    ) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const secure = process.env.NODE_ENV === "production";
    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append(
      "Set-Cookie",
      `imp=1; Path=/; Max-Age=86400; SameSite=Lax; ${
        secure ? "Secure; " : ""
      }HttpOnly`
    );
    headers.append(
      "Set-Cookie",
      `nsId=${encodeURIComponent(nsId)}; Path=/; Max-Age=86400; SameSite=Lax; ${
        secure ? "Secure; " : ""
      }HttpOnly`
    );

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ error: "Bad Request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
