-- Бульбастан: полная схема базы D1 (сбрасывает старые таблицы!)
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS rate;
DROP TABLE IF EXISTS role_codes;
DROP TABLE IF EXISTS parties;
DROP TABLE IF EXISTS bills;
DROP TABLE IF EXISTS news;
DROP TABLE IF EXISTS applications;
DROP TABLE IF EXISTS complaints;
DROP TABLE IF EXISTS elections;
DROP TABLE IF EXISTS admin_notifications;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nick TEXT NOT NULL,
  nick_key TEXT NOT NULL UNIQUE,
  pass_hash TEXT,
  pass_salt TEXT,
  discord_id TEXT UNIQUE,
  avatar TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  role_src TEXT NOT NULL DEFAULT '',
  party_id TEXT,
  created INTEGER NOT NULL
);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE rate (key TEXT PRIMARY KEY, n INTEGER NOT NULL, reset INTEGER NOT NULL);
CREATE TABLE role_codes (role TEXT PRIMARY KEY, code_hash TEXT NOT NULL);
CREATE TABLE parties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  leader TEXT NOT NULL,
  members INTEGER DEFAULT 1,
  color TEXT NOT NULL,
  goal TEXT,
  avatar TEXT,
  code_hash TEXT
);
CREATE TABLE bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party_id TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  votes TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE news (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL);
CREATE TABLE applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  user_id INTEGER,
  party_id TEXT,
  nick TEXT,
  why TEXT,
  name TEXT,
  leader TEXT,
  members INTEGER,
  goal TEXT,
  color TEXT,
  avatar TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  timestamp INTEGER NOT NULL
);
CREATE TABLE complaints (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, nick TEXT NOT NULL, text TEXT NOT NULL, timestamp INTEGER NOT NULL);
CREATE TABLE elections (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  candidates TEXT,
  message_id TEXT,
  channel_id TEXT,
  ends INTEGER,
  closed INTEGER DEFAULT 0,
  results TEXT,
  fetched INTEGER DEFAULT 0
);
CREATE TABLE admin_notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, text TEXT, timestamp INTEGER);

-- Коды ролей (хранятся только хэши)
INSERT INTO role_codes(role, code_hash) VALUES ('pres', '2923c09fe02de729c807ac939b5941f246cc0dc0cb5e26dd99da3ba7cce6aaaa');
INSERT INTO role_codes(role, code_hash) VALUES ('adm', '50f1c037cdba49bbfbd1661af7ce47fe04244d2648bf8c0ee793e7ac1374f1a6');

-- Партии (коды владельцев тоже только хэши)
INSERT INTO parties(id,name,leader,members,color,goal,code_hash) VALUES('eb','Единый Барзян','Pidr GriffinTC',2,'#e3c53a','Боготворить Барзяна и всё, что с ним связано. Обещают голод и безработицу и хотят тоталитарный режим с Барзяном во главе.','8511e30d3e1fb36ce79dc1dda0dba5bfdcc4afdf26ec7e9626dfc2042dc81904');
INSERT INTO parties(id,name,leader,members,color,goal,code_hash) VALUES('gs','Groove Street','@suzukaaa',1,'#3fae4f','Играть капты и жёстко фармить вирты в скине CJ, сделать руму для троллинга, добавить крутые банды и забить Барзяну капт.','0d66274e3fa210c74aa2ab50b58ce738e30e284e49806d09d7b5eb86cac2a743');
INSERT INTO parties(id,name,leader,members,color,goal,code_hash) VALUES('il','Единый Израиль','𝓨𝓪𝓻𝓸𝓼𝓵𝓪𝓿𝓬𝓱𝓮',4,'#3b6fd8','Хотят вместо президента одного диктатора навсегда: так привычнее пользователям из РФ и Беларуси. Девиз: застой, скучно, хочется движухи.','90345c83e28a126c7cf2de3cba0b721c6a61c21e9c11c47087f32cd1d32e782d');
INSERT INTO parties(id,name,leader,members,color,goal,code_hash) VALUES('c4','CLAN 404','Данёк',3,'#7f8c9a','Партия для решения проблем. Обещают принести воды.','aaa701dce7f21923120981583d117f38acecf3e16efb2551c7f846d789b8a8e1');
INSERT INTO parties(id,name,leader,members,color,goal,code_hash) VALUES('mt','Mettlers','Tow_Mett [Deⅵl]',1,'#a066e0','Изменить интерфейс партии, помогать с отбором адекватных людей и с модерацией.','95bc69323058282e6ade9e657858b53aef95d4ca153fc9a49a9cd59b6780b177');
INSERT INTO parties(id,name,leader,members,color,goal,code_hash) VALUES('mi','Бульбастановская Мияби','Barzyanchik',2,'#e5568c','Сделать сервер свободнее, развивать турниры и розыгрыши, сменить правила и сделать сервер лучшим. Обещают свободу, счастье и мирные законы.','887e0bb37453f3ce0e2f9840e85bd8f991b9c86a8b449a08a7316601fe70fa46');
INSERT INTO parties(id,name,leader,members,color,goal,code_hash) VALUES('ps','Клуб Секретно-обьебаные псы','Андрюша',3,'#b5835a','Чтобы весь сервер был в картинках псов. Обещают соревнование: кто первым принесёт чекушку на четвереньках с хвостом.','c6472be20775b774bfacf6882855134321e8ac2784cd9e03919cee2bd6b0b366');
INSERT INTO parties(id,name,leader,members,color,goal,code_hash) VALUES('al','Алабаи','уточняется',1,'#4fb8c4','Подробности о партии скоро появятся.','9257d37023503d86ddcfba9ce14c194d32584579440181f22bfffa94ef4db388');

INSERT INTO news(timestamp,title,text) VALUES (1760200000000,'Сайт Бульбастана открыт','Теперь у государства есть свой сайт: Госдума, партии, заявки и новости.');
INSERT INTO news(timestamp,title,text) VALUES (1760250000000,'Выборы скоро','Скоро выборы президента. Голосование пройдёт в Discord, а ход выборов будет виден на сайте.');
