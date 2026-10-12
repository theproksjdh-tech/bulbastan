// Бульбастан: сервер (Cloudflare Worker + D1).
// Все права проверяются здесь, браузеру ничего не доверяем.

const DAY = 864e5;
const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const pbk = async (pw, salt) => {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, k, 256));
};
const rnd = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const CH = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const code10 = () => [...crypto.getRandomValues(new Uint8Array(10))].map(x => CH[x % CH.length]).join('');
const J = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...h } });
class Err extends Error { constructor(m, s = 400) { super(m); this.s = s; } }
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const cookies = r => Object.fromEntries((r.headers.get('Cookie') || '').split(/;\s*/).filter(Boolean).map(s => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; }));
const COOKIE = (n, v, age, path = '/') => `${n}=${v}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const staff = u => !!u && (u.role === 'pres' || u.role === 'adm');
// Глава партии: аккаунт, который ввёл код партии. Рядовые участники (role='mem') попадают в партию через заявку.
const headOf = u => !!(u && u.party_id && u.role !== 'mem');
const jp = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };

async function hit(db, key, max, win) {
  const now = Date.now();
  const r = await db.prepare('SELECT n, reset FROM rate WHERE key=?').bind(key).first();
  if (!r || r.reset < now) { await db.prepare('INSERT OR REPLACE INTO rate(key,n,reset) VALUES(?,1,?)').bind(key, now + win).run(); return true; }
  if (r.n >= max) return false;
  await db.prepare('UPDATE rate SET n=n+1 WHERE key=?').bind(key).run();
  return true;
}
const clearHit = (db, key) => db.prepare('DELETE FROM rate WHERE key=?').bind(key).run();
const notify = (db, title, text) => db.prepare('INSERT INTO admin_notifications(title,text,timestamp) VALUES(?,?,?)').bind(title, text, Date.now()).run();

async function userFrom(env, req) {
  const t = cookies(req).sid;
  if (!t) return null;
  return await env.DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?').bind(await sha(t), Date.now()).first();
}
async function startSession(env, uid, extra = {}) {
  const tok = rnd(32), exp = Date.now() + 30 * DAY;
  await env.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(Date.now()).run();
  await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires) VALUES(?,?,?)').bind(await sha(tok), uid, exp).run();
  return COOKIE('sid', tok, 30 * 86400);
}
const meView = u => u && ({ id: u.id, nick: u.nick, r: u.role, p: u.party_id || null, discord: !!u.discord_id, avatar: u.avatar || null, h: headOf(u) });

async function dissolve(db, id) {
  await db.batch([
    db.prepare('DELETE FROM parties WHERE id=?').bind(id),
    db.prepare("UPDATE users SET role=CASE WHEN role IN ('own','mem') THEN 'user' ELSE role END, party_id=NULL WHERE party_id=?").bind(id),
  ]);
}

async function discord(env, method, path, body) {
  if (!env.DISCORD_BOT_TOKEN) throw new Err('Бот Discord не настроен (нет DISCORD_BOT_TOKEN)', 503);
  const r = await fetch('https://discord.com/api/v10' + path, { method, headers: { Authorization: 'Bot ' + env.DISCORD_BOT_TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); const d = jp(t, {});
  if (!r.ok) throw new Err('Discord: ' + (d.message || r.status), 502);
  return d;
}
const pollResult = m => {
  const cnt = {}; ((m.poll && m.poll.results && m.poll.results.answer_counts) || []).forEach(c => { cnt[c.id] = c.count; });
  return ((m.poll && m.poll.answers) || []).map(a => ({ name: (a.poll_media && a.poll_media.text) || '?', count: cnt[a.answer_id] || 0 }));
};
async function electionView(env) {
  const db = env.DB, e = await db.prepare('SELECT * FROM elections WHERE id=1').first();
  if (!e || !e.message_id) return null;
  let res = jp(e.results, null), closed = !!e.closed;
  if (!closed && env.DISCORD_BOT_TOKEN && (!res || Date.now() - e.fetched > 30000)) {
    try {
      const m = await discord(env, 'GET', `/channels/${e.channel_id}/messages/${e.message_id}`);
      res = pollResult(m);
      closed = !!(m.poll && m.poll.results && m.poll.results.is_finalized) || Date.now() > e.ends;
      await db.prepare('UPDATE elections SET results=?, fetched=?, closed=? WHERE id=1').bind(JSON.stringify(res), Date.now(), closed ? 1 : 0).run();
    } catch (x) { /* покажем то, что есть */ }
  }
  const cands = res || jp(e.candidates, []).map(n => ({ name: n, count: 0 }));
  return {
    open: !closed, candidates: cands, total: cands.reduce((s, c) => s + c.count, 0), ends: e.ends,
    link: env.DISCORD_GUILD_ID ? `https://discord.com/channels/${env.DISCORD_GUILD_ID}/${e.channel_id}/${e.message_id}` : null,
  };
}

async function state(env, u) {
  const db = env.DB;
  const [P, N, B] = await Promise.all([
    db.prepare('SELECT id,name,leader,members,color,goal,avatar FROM parties ORDER BY rowid').all(),
    db.prepare('SELECT id,timestamp,title,text FROM news ORDER BY timestamp DESC LIMIT 50').all(),
    db.prepare('SELECT id,party_id,title,text,timestamp,votes FROM bills ORDER BY timestamp DESC LIMIT 100').all(),
  ]);
  const out = {
    me: meView(u),
    parties: P.results.map(p => ({ id: p.id, n: p.name, l: p.leader, m: p.members, c: p.color, g: p.goal, a: p.avatar })),
    news: N.results.map(n => ({ id: n.id, ts: n.timestamp, t: n.title, x: n.text })),
    bills: B.results.map(b => ({ id: b.id, p: b.party_id, t: b.title, x: b.text, ts: b.timestamp, v: jp(b.votes, {}) })),
    election: await electionView(env),
  };
  if (u && u.party_id) {
    const head = headOf(u);
    const [M, JA] = await Promise.all([
      db.prepare('SELECT nick, role FROM users WHERE party_id=? ORDER BY id').bind(u.party_id).all(),
      head ? db.prepare("SELECT id,nick,why,timestamp FROM applications WHERE status='new' AND type='join' AND party_id=? ORDER BY timestamp DESC").bind(u.party_id).all() : Promise.resolve({ results: [] }),
    ]);
    out.party = {
      id: u.party_id, head,
      members: M.results.map(m => ({ n: m.nick, h: m.role !== 'mem' })),
      apps: JA.results.map(a => ({ id: a.id, nick: a.nick, why: a.why, ts: a.timestamp })),
    };
  }
  if (staff(u)) {
    const [A, C, M] = await Promise.all([
      db.prepare("SELECT * FROM applications WHERE status='new' ORDER BY timestamp DESC").all(),
      db.prepare('SELECT * FROM complaints ORDER BY timestamp DESC LIMIT 100').all(),
      db.prepare('SELECT * FROM admin_notifications ORDER BY timestamp DESC LIMIT 50').all(),
    ]);
    out.admin = {
      apps: A.results.map(a => ({ id: a.id, t: a.type, p: a.party_id, nick: a.nick, why: a.why, n: a.name, l: a.leader, m: a.members, g: a.goal, c: a.color, a: a.avatar, ts: a.timestamp })),
      cmp: C.results.map(c => ({ id: c.id, type: c.type, nick: c.nick, text: c.text, ts: c.timestamp })),
      notes: M.results.map(n => ({ id: n.id, title: n.title, text: n.text, ts: n.timestamp })),
    };
  }
  return out;
}

const okAvatar = a => { if (!a) return null; if (typeof a !== 'string' || a.length > 70000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(a)) throw new Err('Аватар: нужна небольшая картинка PNG, JPEG или WEBP'); return a; };

async function discordCallback(env, req, url) {
  const c = cookies(req);
  const clear = COOKIE('ostate', '', 0, '/api/auth');
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) throw new Err('Вход через Discord не настроен', 503);
  if (!url.searchParams.get('code') || !c.ostate || c.ostate !== url.searchParams.get('state')) throw new Err('Вход не удался: попробуй ещё раз', 400);
  const redirect = url.origin + '/api/auth/callback';
  const tr = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: redirect }),
  });
  if (!tr.ok) throw new Err('Discord не принял вход', 400);
  const tok = await tr.json();
  const H = { Authorization: 'Bearer ' + tok.access_token };
  const du = await (await fetch('https://discord.com/api/v10/users/@me', { headers: H })).json();
  if (!du.id) throw new Err('Не удалось получить аккаунт Discord', 400);
  let roles = [];
  if (env.DISCORD_GUILD_ID) {
    const mr = await fetch(`https://discord.com/api/v10/users/@me/guilds/${env.DISCORD_GUILD_ID}/member`, { headers: H });
    if (!mr.ok) throw new Err('Ты не состоишь на сервере Бульбастан', 403);
    roles = (await mr.json()).roles || [];
  }
  const db = env.DB;
  let dRole = null;
  if (env.DISCORD_ROLE_PRES && roles.includes(env.DISCORD_ROLE_PRES)) dRole = 'pres';
  else if (env.DISCORD_ROLE_ADM && roles.includes(env.DISCORD_ROLE_ADM)) dRole = 'adm';
  const avatar = du.avatar ? `https://cdn.discordapp.com/avatars/${du.id}/${du.avatar}.png?size=128` : null;
  let u = await db.prepare('SELECT * FROM users WHERE discord_id=?').bind(du.id).first();
  if (!u) {
    let nick = str(du.global_name || du.username, 24) || 'user', key = nick.toLowerCase();
    if (await db.prepare('SELECT 1 FROM users WHERE nick_key=?').bind(key).first()) { nick = nick.slice(0, 19) + '#' + du.id.slice(-4); key = nick.toLowerCase(); }
    const r = await db.prepare('INSERT INTO users(nick,nick_key,discord_id,avatar,role,role_src,created) VALUES(?,?,?,?,?,?,?)').bind(nick, key, du.id, avatar, dRole || 'user', dRole ? 'discord' : '', Date.now()).run();
    u = { id: r.meta.last_row_id };
  } else if (dRole) {
    await db.prepare("UPDATE users SET role=?, role_src='discord', avatar=? WHERE id=?").bind(dRole, avatar, u.id).run();
  } else {
    await db.prepare("UPDATE users SET avatar=?, role=CASE WHEN role_src='discord' THEN 'user' ELSE role END, role_src=CASE WHEN role_src='discord' THEN '' ELSE role_src END WHERE id=?").bind(avatar, u.id).run();
  }
  const sc = await startSession(env, u.id);
  const h = new Headers({ Location: '/' }); h.append('Set-Cookie', sc); h.append('Set-Cookie', clear);
  return new Response(null, { status: 302, headers: h });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(req) : J({ error: 'Не найдено' }, 404);
    try {
      const db = env.DB;
      if (req.method === 'POST') {
        const o = req.headers.get('Origin');
        if (o && new URL(o).host !== url.host) throw new Err('Запрос с чужого сайта', 403);
      }
      const b = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
      const route = req.method + ' ' + path;
      const u = await userFrom(env, req);
      const need = () => { if (!u) throw new Err('Нужно войти в аккаунт', 401); return u; };
      const needStaff = () => { need(); if (!staff(u)) throw new Err('Только для президента и администраторов', 403); };
      const post = async () => { if (!await hit(db, 'post:' + need().id, 20, 36e5)) throw new Err('Слишком часто, подожди немного', 429); };

      switch (route) {
        case 'GET /api/state': return J(await state(env, u));
        case 'GET /api/me': return J({ me: meView(u) });

        case 'POST /api/register': {
          const nick = str(b.nick, 24), pw = String(b.password ?? '');
          if (!/^[\p{L}\p{N} _.\-]{3,24}$/u.test(nick)) throw new Err('Ник: 3–24 символа, буквы, цифры, пробел, _ . -');
          if (pw.length < 6 || pw.length > 64) throw new Err('Пароль: от 6 до 64 символов');
          if (!await hit(db, 'reg:' + (req.headers.get('CF-Connecting-IP') || 'x'), 6, 36e5)) throw new Err('Слишком много регистраций, попробуй позже', 429);
          const k = nick.toLowerCase();
          if (await db.prepare('SELECT 1 FROM users WHERE nick_key=?').bind(k).first()) throw new Err('Этот ник уже занят');
          const salt = rnd(16), h = await pbk(pw, salt);
          const r = await db.prepare("INSERT INTO users(nick,nick_key,pass_hash,pass_salt,role,created) VALUES(?,?,?,?,'user',?)").bind(nick, k, h, salt, Date.now()).run();
          return J({ ok: true }, 200, { 'Set-Cookie': await startSession(env, r.meta.last_row_id) });
        }
        case 'POST /api/login': {
          const k = str(b.nick, 24).toLowerCase();
          if (!await hit(db, 'login:' + k, 8, 9e5)) throw new Err('Слишком много попыток, подожди 15 минут', 429);
          const x = await db.prepare('SELECT * FROM users WHERE nick_key=?').bind(k).first();
          if (!x || !x.pass_hash || await pbk(String(b.password ?? ''), x.pass_salt) !== x.pass_hash) throw new Err('Неверный ник или пароль', 401);
          await clearHit(db, 'login:' + k);
          return J({ ok: true }, 200, { 'Set-Cookie': await startSession(env, x.id) });
        }
        case 'POST /api/logout': {
          const t = cookies(req).sid;
          if (t) await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha(t)).run();
          return J({ ok: true }, 200, { 'Set-Cookie': COOKIE('sid', '', 0) });
        }

        case 'POST /api/redeem': {
          need();
          if (!await hit(db, 'code:' + u.id, 6, 9e5)) throw new Err('Слишком много попыток, подожди 15 минут', 429);
          const code = str(b.code, 70); if (!code) throw new Err('Введи код');
          const h = await sha(code);
          const rc = await db.prepare('SELECT role FROM role_codes WHERE code_hash=?').bind(h).first();
          if (rc) await db.prepare("UPDATE users SET role=?, role_src='code' WHERE id=?").bind(rc.role, u.id).run();
          else {
            const p = await db.prepare('SELECT id FROM parties WHERE code_hash=?').bind(h).first();
            if (!p) throw new Err('Код не подошёл');
            await db.prepare("UPDATE users SET party_id=?, role=CASE WHEN role IN ('user','mem') THEN 'own' ELSE role END WHERE id=?").bind(p.id, u.id).run();
          }
          await clearHit(db, 'code:' + u.id);
          return J({ ok: true });
        }

        case 'POST /api/bills': {
          await post();
          if (!headOf(u)) throw new Err('Законопроект вносит глава партии', 403);
          const title = str(b.title, 80), text = str(b.text, 600);
          if (!title || !text) throw new Err('Заполни название и текст');
          if (await db.prepare('SELECT 1 FROM bills WHERE party_id=? AND timestamp>?').bind(u.party_id, Date.now() - DAY).first()) throw new Err('Партия уже вносила законопроект за последние сутки');
          await db.prepare('INSERT INTO bills(party_id,title,text,timestamp,votes) VALUES(?,?,?,?,?)').bind(u.party_id, title, text, Date.now(), JSON.stringify({ [u.party_id]: 'y' })).run();
          await notify(db, 'Новый законопроект', `«${title}» (партия ${u.party_id})`);
          return J({ ok: true });
        }
        case 'POST /api/bills/vote': {
          need(); if (!headOf(u)) throw new Err('Голосуют только главы партий', 403);
          const bill = await db.prepare('SELECT * FROM bills WHERE id=?').bind(Number(b.id) || 0).first();
          if (!bill) throw new Err('Закон не найден', 404);
          if (Date.now() > bill.timestamp + DAY) throw new Err('Голосование по этому закону закончилось');
          if (b.vote !== 'y' && b.vote !== 'n') throw new Err('Нужно «за» или «против»');
          const v = jp(bill.votes, {}); v[u.party_id] = b.vote;
          await db.prepare('UPDATE bills SET votes=? WHERE id=?').bind(JSON.stringify(v), bill.id).run();
          return J({ ok: true });
        }

        case 'POST /api/applications': {
          await post();
          const t = b.type;
          if (t === 'join') {
            const p = await db.prepare('SELECT id FROM parties WHERE id=?').bind(str(b.party_id, 40)).first();
            if (!p) throw new Err('Партия не найдена');
            const why = str(b.why, 400); if (!why) throw new Err('Напиши, почему хочешь вступить');
            if (u.party_id === p.id) throw new Err('Ты уже в этой партии');
            if (await db.prepare("SELECT 1 FROM applications WHERE type='join' AND status='new' AND user_id=? AND party_id=?").bind(u.id, p.id).first()) throw new Err('Заявка в эту партию уже подана и ждёт решения');
            await db.prepare("INSERT INTO applications(type,user_id,party_id,nick,why,timestamp) VALUES('join',?,?,?,?,?)").bind(u.id, p.id, str(b.nick, 40) || u.nick, why, Date.now()).run();
            await notify(db, 'Заявка на вступление', `${u.nick} хочет в партию ${p.id}`);
          } else if (t === 'new') {
            const name = str(b.name, 40), leader = str(b.leader, 40), goal = str(b.goal, 400), members = Math.floor(Number(b.members));
            if (!name || !leader || !goal) throw new Err('Заполни название, лидера и цель');
            if (!(members >= 14 && members <= 500)) throw new Err('В партии должно быть минимум 14 человек');
            if (!/^#[0-9a-fA-F]{6}$/.test(b.color || '')) throw new Err('Некорректный цвет');
            await db.prepare("INSERT INTO applications(type,user_id,nick,name,leader,members,goal,color,avatar,timestamp) VALUES('new',?,?,?,?,?,?,?,?,?)").bind(u.id, u.nick, name, leader, members, goal, b.color, okAvatar(b.avatar), Date.now()).run();
            await notify(db, 'Заявка на создание партии', `«${name}», лидер ${leader}`);
          } else if (t === 'dis') {
            if (!headOf(u)) throw new Err('Распустить партию может только её глава', 403);
            await db.prepare("INSERT INTO applications(type,user_id,party_id,nick,timestamp) VALUES('dis',?,?,?,?)").bind(u.id, u.party_id, u.nick, Date.now()).run();
            await notify(db, 'Заявка на роспуск партии', `${u.nick} просит распустить ${u.party_id}`);
          } else throw new Err('Неизвестный тип заявки');
          return J({ ok: true });
        }
        case 'POST /api/applications/decide': {
          need();
          if (!staff(u) && !headOf(u)) throw new Err('Нет прав', 403);
          const a = await db.prepare("SELECT * FROM applications WHERE id=? AND status='new'").bind(Number(b.id) || 0).first();
          if (!a) throw new Err('Заявка не найдена или уже рассмотрена', 404);
          // Глава партии решает только заявки на вступление в свою партию. Остальное: президент и администраторы.
          if (!staff(u) && !(a.type === 'join' && a.party_id === u.party_id)) throw new Err('Нет прав', 403);
          let extra = {};
          if (b.ok) {
            if (a.type === 'join') {
              if (!await db.prepare('SELECT 1 FROM parties WHERE id=?').bind(a.party_id).first()) throw new Err('Партия уже не существует', 404);
              const t = a.user_id ? await db.prepare('SELECT id,role,party_id FROM users WHERE id=?').bind(a.user_id).first() : null;
              if (!t || t.party_id !== a.party_id) {
                const st = [db.prepare('UPDATE parties SET members=COALESCE(members,0)+1 WHERE id=?').bind(a.party_id)];
                if (t && (t.role === 'user' || t.role === 'mem')) {
                  if (t.party_id) st.push(db.prepare('UPDATE parties SET members=MAX(COALESCE(members,1)-1,0) WHERE id=?').bind(t.party_id));
                  st.push(db.prepare("UPDATE users SET party_id=?, role='mem' WHERE id=?").bind(a.party_id, t.id));
                }
                await db.batch(st);
              }
            } else if (a.type === 'new') {
              const id = 'p' + Date.now().toString(36), code = code10();
              await db.prepare('INSERT INTO parties(id,name,leader,members,color,goal,avatar,code_hash) VALUES(?,?,?,?,?,?,?,?)').bind(id, a.name, a.leader, a.members, a.color, a.goal, a.avatar ?? null, await sha(code)).run();
              extra = { code, name: a.name };
            } else if (a.type === 'dis') await dissolve(db, a.party_id);
          }
          await db.prepare('UPDATE applications SET status=? WHERE id=?').bind(b.ok ? 'approved' : 'rejected', a.id).run();
          return J({ ok: true, ...extra });
        }

        case 'POST /api/news': {
          needStaff();
          const title = str(b.title, 80), text = str(b.text, 600); if (!title || !text) throw new Err('Заполни заголовок и текст');
          await db.prepare('INSERT INTO news(timestamp,title,text) VALUES(?,?,?)').bind(Date.now(), title, text).run();
          return J({ ok: true });
        }
        case 'POST /api/complaints': {
          await post();
          const text = str(b.text, 800); if (!text) throw new Err('Напиши текст');
          await db.prepare('INSERT INTO complaints(type,nick,text,timestamp) VALUES(?,?,?,?)').bind(b.type === 'Предложение' ? 'Предложение' : 'Жалоба', u.nick, text, Date.now()).run();
          await notify(db, b.type === 'Предложение' ? 'Новое предложение' : 'Новая жалоба', `${u.nick}: ${text.slice(0, 80)}`);
          return J({ ok: true });
        }

        case 'POST /api/party/avatar': {
          need(); const id = str(b.party_id, 40);
          if (!staff(u) && !(headOf(u) && u.party_id === id)) throw new Err('Аватар меняет только глава партии', 403);
          const av = okAvatar(b.avatar); if (!av) throw new Err('Нужна картинка');
          await db.prepare('UPDATE parties SET avatar=? WHERE id=?').bind(av, id).run();
          return J({ ok: true });
        }
        case 'POST /api/party/reset-code': {
          needStaff(); const id = str(b.party_id, 40);
          if (!await db.prepare('SELECT 1 FROM parties WHERE id=?').bind(id).first()) throw new Err('Партия не найдена', 404);
          const code = code10();
          await db.prepare('UPDATE parties SET code_hash=? WHERE id=?').bind(await sha(code), id).run();
          return J({ ok: true, code });
        }
        case 'POST /api/party/dissolve': {
          needStaff(); await dissolve(db, str(b.party_id, 40)); return J({ ok: true });
        }

        case 'POST /api/election/start': {
          needStaff();
          const cands = [...new Set((Array.isArray(b.candidates) ? b.candidates : []).map(c => str(c, 55)).filter(Boolean))];
          if (cands.length < 2 || cands.length > 10) throw new Err('Нужно от 2 до 10 кандидатов');
          const hours = Math.floor(Number(b.hours)); if (!(hours >= 1 && hours <= 768)) throw new Err('Срок: от 1 часа до 32 дней');
          if (!env.DISCORD_CHANNEL_ID) throw new Err('Не указан канал для выборов (DISCORD_CHANNEL_ID)', 503);
          const cur = await electionView(env);
          if (cur && cur.open) throw new Err('Выборы уже идут. Сначала закрой их');
          const m = await discord(env, 'POST', `/channels/${env.DISCORD_CHANNEL_ID}/messages`, {
            content: '🗳️ **Выборы президента Бульбастана!** Голосуй в опросе ниже. Итоги также на сайте.',
            poll: { question: { text: 'Выборы президента Бульбастана' }, answers: cands.map(c => ({ poll_media: { text: c } })), duration: hours, allow_multiselect: false },
          });
          await db.prepare('INSERT OR REPLACE INTO elections(id,candidates,message_id,channel_id,ends,closed,results,fetched) VALUES(1,?,?,?,?,0,NULL,0)').bind(JSON.stringify(cands), m.id, env.DISCORD_CHANNEL_ID, Date.now() + hours * 36e5).run();
          await db.prepare('INSERT INTO news(timestamp,title,text) VALUES(?,?,?)').bind(Date.now(), 'Выборы начались', 'Голосование проходит в Discord, в канале новостей. Ход выборов смотри на странице «Выборы».').run();
          return J({ ok: true });
        }
        case 'POST /api/election/close': {
          needStaff();
          const e = await db.prepare('SELECT * FROM elections WHERE id=1').first();
          if (!e || !e.message_id || e.closed) throw new Err('Нет идущих выборов');
          try { await discord(env, 'POST', `/channels/${e.channel_id}/polls/${e.message_id}/expire`); } catch (x) { /* возможно, уже закрыт */ }
          const m = await discord(env, 'GET', `/channels/${e.channel_id}/messages/${e.message_id}`);
          await db.prepare('UPDATE elections SET results=?, fetched=?, closed=1 WHERE id=1').bind(JSON.stringify(pollResult(m)), Date.now()).run();
          return J({ ok: true });
        }

        case 'GET /api/auth/discord': {
          if (!env.DISCORD_CLIENT_ID) throw new Err('Вход через Discord не настроен', 503);
          const st = rnd(16);
          const q = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, response_type: 'code', redirect_uri: url.origin + '/api/auth/callback', scope: env.DISCORD_GUILD_ID ? 'identify guilds.members.read' : 'identify', state: st, prompt: 'none' });
          return new Response(null, { status: 302, headers: { Location: 'https://discord.com/oauth2/authorize?' + q, 'Set-Cookie': COOKIE('ostate', st, 600, '/api/auth') } });
        }
        case 'GET /api/auth/callback': return await discordCallback(env, req, url);
      }
      return J({ error: 'Не найдено' }, 404);
    } catch (e) {
      if (e instanceof Err) return J({ error: e.message }, e.s);
      console.error(e);
      return J({ error: 'Ошибка сервера' }, 500);
    }
  },
};
