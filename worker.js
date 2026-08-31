/**
 * SpeedTOEIC 600 RTA - Cloudflare Worker API
 * Endpoints:
 *   GET  /api/questions?mode=part5|part67|all
 *   POST /api/rankings
 *   GET  /api/rankings?mode=part5|part67|all
 */

const SECRET_SALT = "speed_toeic_rta_hmac_secret_2026";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json; charset=utf-8"
  };
}

async function signToken(dataStr) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(SECRET_SALT),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(dataStr));
  const hex = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return `${btoa(dataStr)}.${hex}`;
}

async function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [b64Data, signature] = token.split(".");
  try {
    const dataStr = atob(b64Data);
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(SECRET_SALT),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const sigBytes = new Uint8Array(
      signature.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
    );
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(dataStr));
    if (!valid) return null;
    return JSON.parse(dataStr);
  } catch (e) {
    return null;
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 1. GET /api/questions
      if (path === "/api/questions" && request.method === "GET") {
        const mode = url.searchParams.get("mode") || "part5";
        let query = "";
        if (mode === "part5") {
          query = "SELECT * FROM questions WHERE part = 5 ORDER BY RANDOM() LIMIT 10;";
        } else if (mode === "part67") {
          query = "SELECT * FROM questions WHERE part IN (6, 7) ORDER BY RANDOM() LIMIT 10;";
        } else {
          query = "SELECT * FROM questions ORDER BY RANDOM() LIMIT 10;";
        }

        const stmt = env.DB.prepare(query);
        const { results } = await stmt.all();

        const formatted = (results || []).map(r => ({
          id: r.id,
          q: r.question_text,
          options: [r.option_0, r.option_1, r.option_2, r.option_3],
          answer: r.answer_index,
          trigger: r.trigger_text
        }));

        const sessionPayload = {
          mode,
          qIds: formatted.map(f => f.id),
          issued_at: Date.now()
        };
        const token = await signToken(JSON.stringify(sessionPayload));

        return new Response(
          JSON.stringify({ success: true, questions: formatted, session_token: token }),
          { headers: corsHeaders() }
        );
      }

      // 2. GET /api/rankings
      if (path === "/api/rankings" && request.method === "GET") {
        const mode = url.searchParams.get("mode") || "part5";
        const stmt = env.DB.prepare(
          "SELECT player_name, mode, clear_time_ms, streak_count, created_at FROM rankings WHERE mode = ? ORDER BY clear_time_ms ASC LIMIT 30;"
        ).bind(mode);
        const { results } = await stmt.all();

        return new Response(
          JSON.stringify({ success: true, rankings: results || [] }),
          { headers: corsHeaders() }
        );
      }

      // 3. POST /api/rankings
      if (path === "/api/rankings" && request.method === "POST") {
        const body = await request.json();
        const { player_name, mode, clear_time_ms, streak_count, session_token } = body;

        // Anti-Cheat: Validate token
        if (session_token) {
          const session = await verifyToken(session_token);
          if (!session) {
            return new Response(
              JSON.stringify({ success: false, error: "Invalid session signature." }),
              { status: 403, headers: corsHeaders() }
            );
          }
          const elapsed = Date.now() - session.issued_at;
          // 10 questions physical limit: at least 4.0 seconds (4000ms)
          if (elapsed < 4000 || clear_time_ms < 4000) {
            return new Response(
              JSON.stringify({ success: false, error: "Abnormal completion speed detected." }),
              { status: 400, headers: corsHeaders() }
            );
          }
        }

        const cleanName = (player_name || "–¼–³‚µ").toString().slice(0, 16);
        const cleanMode = ["part5", "part67", "all"].includes(mode) ? mode : "part5";
        const id = crypto.randomUUID();

        const insertStmt = env.DB.prepare(
          "INSERT INTO rankings (id, player_name, mode, clear_time_ms, streak_count) VALUES (?, ?, ?, ?, ?);"
        ).bind(id, cleanName, cleanMode, parseInt(clear_time_ms, 10), parseInt(streak_count, 10) || 10);

        await insertStmt.run();

        // Return updated top 30
        const queryStmt = env.DB.prepare(
          "SELECT player_name, mode, clear_time_ms, streak_count, created_at FROM rankings WHERE mode = ? ORDER BY clear_time_ms ASC LIMIT 30;"
        ).bind(cleanMode);
        const { results } = await queryStmt.all();

        return new Response(
          JSON.stringify({ success: true, rankings: results || [] }),
          { headers: corsHeaders() }
        );
      }

      return new Response(JSON.stringify({ error: "Endpoint not found" }), {
        status: 404,
        headers: corsHeaders()
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, error: err.message }),
        { status: 500, headers: corsHeaders() }
      );
    }
  }
};
