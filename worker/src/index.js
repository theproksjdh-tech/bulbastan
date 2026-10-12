export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Получение списка партий
      if (path === "/api/parties" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM parties").all();
        return Response.json(results, { headers: corsHeaders });
      }

      // Получение новостей
      if (path === "/api/news" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM news ORDER BY timestamp DESC").all();
        return Response.json(results, { headers: corsHeaders });
      }

      // Получение законопроектов
      if (path === "/api/bills" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM bills ORDER BY timestamp DESC").all();
        // Парсим JSON голосов обратно в объекты перед отправкой на сайт
        const parsed = results.map(b => ({ ...b, v: JSON.parse(b.votes || "{}") }));
        return Response.json(parsed, { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
