export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Автоматическое создание таблицы для СМС-уведомлений админов на сайте, если её еще нет
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS admin_notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT,
          text TEXT,
          timestamp INTEGER,
          is_read INTEGER DEFAULT 0
        )
      `).run();

      // --- ПАРТИИ ---
      if (path === "/api/parties" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM parties").all();
        return Response.json(results, { headers: corsHeaders });
      }

      // --- НОВОСТИ ---
      if (path === "/api/news" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM news ORDER BY timestamp DESC").all();
        return Response.json(results, { headers: corsHeaders });
      }

      // --- ЗАКОНОПРОЕКТЫ (Чтение) ---
      if (path === "/api/bills" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM bills ORDER BY timestamp DESC").all();
        const parsed = results.map(b => ({ ...b, v: JSON.parse(b.votes || "{}") }));
        return Response.json(parsed, { headers: corsHeaders });
      }

      // --- ЗАКОНОПРОЕКТЫ (Создание + СМС уведомление админам) ---
      if (path === "/api/bills" && request.method === "POST") {
        const { party_id, title, text } = await request.json();
        const timestamp = Date.now();
        
        await env.DB.prepare(
          "INSERT INTO bills (party_id, title, text, timestamp, votes) VALUES (?, ?, ?, ?, ?)"
        ).bind(party_id || "Независимый", title, text, timestamp, "{}").run();

        // Создаем СМС-уведомление для админов на сайте
        await env.DB.prepare(
          "INSERT INTO admin_notifications (title, text, timestamp) VALUES (?, ?, ?)"
        ).bind("Новый законопроект", `Подан закон: "${title}" (партия: ${party_id || "Независимый"})`, timestamp).run();

        return Response.json({ success: true }, { headers: corsHeaders });
      }

      // --- ЗАЯВКИ (Чтение) ---
      if (path === "/api/applications" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM applications ORDER BY timestamp DESC").all();
        return Response.json(results, { headers: corsHeaders });
      }

      // --- ЗАЯВКИ (Создание + СМС уведомление админам) ---
      if (path === "/api/applications" && request.method === "POST") {
        const { nick, text, party } = await request.json();
        const timestamp = Date.now();
        
        await env.DB.prepare(
          "INSERT INTO applications (user_id, nick, text, party, timestamp) VALUES (?, ?, ?, ?, ?)"
        ).bind("unknown", nick || "Аноним", text || "", party || "Не указана", timestamp).run();

        // Создаем СМС-уведомление для админов на сайте
        await env.DB.prepare(
          "INSERT INTO admin_notifications (title, text, timestamp) VALUES (?, ?, ?)"
        ).bind("Новая заявка", `Игрок ${nick || "Аноним"} подал заявку в партию: ${party || "Не указана"}`, timestamp).run();

        return Response.json({ success: true }, { headers: corsHeaders });
      }

      // --- СМС УВЕДОМЛЕНИЯ ДЛЯ АДМИНОВ НА САЙТЕ ---
      if (path === "/api/admin/notifications" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM admin_notifications ORDER BY timestamp DESC").all();
        return Response.json(results, { headers: corsHeaders });
      }

      // --- DISCORD OAUTH2 AUTHENTICATION ---
      if (path === "/api/auth/discord" && request.method === "POST") {
        const { code, redirect_uri } = await request.json();

        const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.DISCORD_CLIENT_ID,
            client_secret: env.DISCORD_CLIENT_SECRET,
            grant_type: "authorization_code",
            code: code,
            redirect_uri: redirect_uri,
          }),
        });

        if (!tokenResponse.ok) {
          const errData = await tokenResponse.text();
          return Response.json({ error: "Failed token exchange", details: errData }, { status: 400, headers: corsHeaders });
        }

        const tokenData = await tokenResponse.json();

        const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });

        const userData = await userResponse.json();

        await env.DB.prepare(`
          INSERT INTO users (discord_id, nick) VALUES (?, ?)
          ON CONFLICT(discord_id) DO UPDATE SET nick = excluded.nick
        `).bind(userData.id, userData.username).run();

        return Response.json({
          user: {
            id: userData.id,
            username: userData.username,
            avatar: userData.avatar,
          },
          token: tokenData.access_token
        }, { headers: corsHeaders });
      }

      // --- DISCORD BOT INTEGRATION ---
      if (path === "/api/bot/post-news" && request.method === "POST") {
        const { channel_id, content, poll } = await request.json();

        const botPayload = { content };
        if (poll) {
          botPayload.poll = poll;
        }

        const discordRes = await fetch(`https://discord.com/api/v10/channels/${channel_id}/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(botPayload),
        });

        const resData = await discordRes.json();
        return Response.json(resData, { headers: corsHeaders, status: discordRes.status });
      }

      return Response.json({ error: "Endpoint not found" }, { status: 404, headers: corsHeaders });

    } catch (err) {
      return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
    }
  }
};
