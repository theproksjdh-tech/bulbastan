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
      // --- PUBLIC ENDPOINTS ---

      // Партии
      if (path === "/api/parties" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM parties").all();
        return Response.json(results, { headers: corsHeaders });
      }

      // Новости
      if (path === "/api/news" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM news ORDER BY timestamp DESC").all();
        return Response.json(results, { headers: corsHeaders });
      }

      // Законопроекты
      if (path === "/api/bills" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM bills ORDER BY timestamp DESC").all();
        const parsed = results.map(b => ({ ...b, v: JSON.parse(b.votes || "{}") }));
        return Response.json(parsed, { headers: corsHeaders });
      }

      // --- DISCORD OAUTH2 AUTHENTICATION ---

      // Обработка авторизации через Discord
      if (path === "/api/auth/discord" && request.method === "POST") {
        const { code, redirect_uri } = await request.json();

        // 1. Обмениваем code на access_token
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

        // 2. Получаем данные профиля пользователя из Discord
        const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });

        const userData = await userResponse.json();

        // 3. Сохраняем или обновляем пользователя в D1
        await env.DB.prepare(`
          INSERT INTO users (discord_id, nick) VALUES (?, ?)
          ON CONFLICT(discord_id) DO UPDATE SET nick = excluded.nick
        `).bind(userData.id, userData.username).run();

        // Возвращаем данные профиля на сайт
        return Response.json({
          user: {
            id: userData.id,
            username: userData.username,
            avatar: userData.avatar,
          },
          token: tokenData.access_token
        }, { headers: corsHeaders });
      }

      // --- DISCORD BOT INTEGRATION (POST NEWS/POLLS) ---

      // Отправка сообщения или опроса в Discord канал
      if (path === "/api/bot/post-news" && request.method === "POST") {
        const { channel_id, content, poll } = await request.json();

        const botPayload = { content };
        if (poll) {
          botPayload.poll = poll; // структура опроса Discord API
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
