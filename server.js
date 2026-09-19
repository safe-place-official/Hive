// ============================================================
// Локальный редактор статей — серверная часть
// Express + multer + uuid. Порт 3000.
// ============================================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;

// ---------- Пути ----------
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const PUBLIC_DIR = path.join(ROOT, 'public');
const ARTICLES_FILE = path.join(DATA_DIR, 'articles.json');
const INDEX_FILE = path.join(ROOT, 'index.html');

// ---------- Гарантируем наличие папок и файлов ----------
[DATA_DIR, UPLOADS_DIR, PUBLIC_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
if (!fs.existsSync(ARTICLES_FILE)) fs.writeFileSync(ARTICLES_FILE, '[]', 'utf8');

// ---------- Middleware ----------
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(PUBLIC_DIR));

// Корень — редактор
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'editor.html')));

// ---------- Multer (загрузка файлов) ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .slice(0, 40);
    cb(null, `${Date.now()}-${base}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  // Возвращаем ОТНОСИТЕЛЬНЫЙ путь — чтобы работало и на GitHub Pages в подпапке
  res.json({ url: `uploads/${req.file.filename}` });
});

// ---------- Хелперы работы с хранилищем ----------
function readArticles() {
  try {
    return JSON.parse(fs.readFileSync(ARTICLES_FILE, 'utf8'));
  } catch {
    return [];
  }
}
function writeArticles(list) {
  fs.writeFileSync(ARTICLES_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// ---------- API статей ----------
// Все статьи
app.get('/api/articles', (req, res) => {
  res.json(readArticles());
});

// Одна статья
app.get('/api/articles/:id', (req, res) => {
  const list = readArticles();
  const item = list.find((a) => a.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Не найдена' });
  res.json(item);
});

// Создать/обновить статью
app.post('/api/articles', (req, res) => {
  const article = req.body || {};
  const list = readArticles();

  if (!article.id) {
    article.id = uuidv4();
    article.date = article.date || new Date().toISOString().slice(0, 10);
    article.blocks = article.blocks || [];
    list.push(article);
  } else {
    const idx = list.findIndex((a) => a.id === article.id);
    if (idx === -1) list.push(article);
    else list[idx] = { ...list[idx], ...article };
  }
  writeArticles(list);
  res.json({ ok: true, article });
});

// Удалить статью
app.delete('/api/articles/:id', (req, res) => {
  const list = readArticles().filter((a) => a.id !== req.params.id);
  writeArticles(list);
  res.json({ ok: true });
});

// ---------- Пересобрать index.html ----------
app.post('/save', (req, res) => {
  try {
    const list = readArticles();
    const html = buildIndexHtml(list);
    fs.writeFileSync(INDEX_FILE, html, 'utf8');
    res.json({ ok: true, path: INDEX_FILE });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---------- Предпросмотр — отдаём текущий index.html ----------
app.get('/preview', (req, res) => {
  const list = readArticles();
  const html = buildIndexHtml(list);
  res.type('text/html').send(html);
});

// ============================================================
// Генерация автономного index.html
// ============================================================
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str = '') {
  return String(str).replace(/"/g, '&quot;');
}

// Приводим любой путь к uploads к относительному виду:
// "/uploads/x.png" → "uploads/x.png", "uploads/x.png" → "uploads/x.png"
function normalizeUploadUrl(url) {
  if (!url) return '';
  return String(url).replace(/^\/+/, '');
}

// Рендер одного блока в HTML
function renderBlock(block) {
  if (!block || !block.type) return '';
  switch (block.type) {
    case 'h2':
      return `<h2>${escapeHtml(block.text || '')}</h2>`;
    case 'h3':
      return `<h3>${escapeHtml(block.text || '')}</h3>`;
    case 'p':
      return `<p>${escapeHtml(block.text || '').replace(/\n/g, '<br>')}</p>`;
    case 'img':
      return block.url
        ? `<figure><img src="${escapeAttr(normalizeUploadUrl(block.url))}" alt="${escapeAttr(block.caption || '')}">${
            block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ''
          }</figure>`
        : '';
    case 'gif':
      return block.url
        ? `<figure><img class="gif" src="${escapeAttr(normalizeUploadUrl(block.url))}" alt="GIF">${
            block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ''
          }</figure>`
        : '';
    case 'video': {
      const embed = youtubeEmbed(block.url || '');
      return embed ? `<div class="video-wrap">${embed}</div>` : '';
    }
    case 'audio':
      return block.url
        ? `<audio controls src="${escapeAttr(normalizeUploadUrl(block.url))}"></audio>`
        : '';
    case 'quote':
      return `<blockquote>${escapeHtml(block.text || '')}</blockquote>`;
    case 'list': {
      const items = Array.isArray(block.items) ? block.items : [];
      return `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
    }
    case 'code':
      return `<pre><code class="language-${escapeAttr(
        block.lang || 'plaintext'
      )}">${escapeHtml(block.text || '')}</code></pre>`;
    default:
      return '';
  }
}

// YouTube/Rutube → iframe
function youtubeEmbed(url) {
  if (!url) return '';
  // YouTube
  let m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/);
  if (m) {
    return `<iframe src="https://www.youtube.com/embed/${m[1]}" allowfullscreen loading="lazy"></iframe>`;
  }
  // Rutube
  m = url.match(/rutube\.ru\/video\/([\w-]+)/);
  if (m) {
    return `<iframe src="https://rutube.ru/play/embed/${m[1]}" allowfullscreen loading="lazy"></iframe>`;
  }
  return '';
}

// Полный HTML документа
function buildIndexHtml(articles) {
  // Данные встраиваем как JSON — index.html полностью автономен
  const jsonData = JSON.stringify(articles).replace(/</g, '\\u003c');

  // Собираем HTML всех статей заранее — рендер на клиенте тоже возможен,
  // но так надёжнее без сервера: рендерим блоки прямо в разметку.
  const articlesHtml = articles
    .map((a) => {
      const blocksHtml = (a.blocks || []).map(renderBlock).join('\n');
      return `
        <article class="article" id="article-${escapeAttr(a.id)}" data-id="${escapeAttr(a.id)}">
          <header class="article-header">
            ${a.cover ? `<img class="article-cover" src="${escapeAttr(normalizeUploadUrl(a.cover))}" alt="">` : ''}
            <div class="article-meta">
              <span class="cat">${escapeHtml(a.category || '')}</span>
              <time>${escapeHtml(a.date || '')}</time>
            </div>
            <h1>${escapeHtml(a.title || '')}</h1>
          </header>
          <div class="article-body">
            ${blocksHtml}
          </div>
        </article>`;
    })
    .join('\n');

  // Категории
  const categories = Array.from(
    new Set(articles.map((a) => a.category).filter(Boolean))
  );

  const catsHtml = categories
    .map((c) => `<li><a href="#" data-cat="${escapeAttr(c)}">${escapeHtml(c)}</a></li>`)
    .join('');

  // Карточки
  const cardsHtml = articles
    .map(
      (a) => `
      <a class="card" href="#article-${escapeAttr(a.id)}" data-id="${escapeAttr(a.id)}" data-cat="${escapeAttr(
        a.category || ''
      )}" data-title="${escapeAttr((a.title || '').toLowerCase())}">
        ${
          a.cover
            ? `<img class="card-cover" src="${escapeAttr(normalizeUploadUrl(a.cover))}" alt="">`
            : `<div class="card-cover placeholder"></div>`
        }
        <div class="card-body">
          <span class="cat">${escapeHtml(a.category || '')}</span>
          <h3>${escapeHtml(a.title || 'Без названия')}</h3>
          <time>${escapeHtml(a.date || '')}</time>
        </div>
      </a>`
    )
    .join('');

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hive - GameDevelopment — статьи</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<style>
/* ============ Тёмная чёрно-зелёная тема ============ */
:root{
  --bg:#0d0d0d; --panel:#1a1a1a; --panel2:#141414;
  --accent:#00ff88; --text:#e0e0e0; --muted:#8a8a8a; --border:#2a2a2a;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--text);
  font-family:system-ui,-apple-system,"Inter","Segoe UI",Roboto,sans-serif;line-height:1.6}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
img{max-width:100%;display:block;border-radius:8px}

header.top{
  position:sticky;top:0;z-index:20;display:flex;gap:12px;align-items:center;
  padding:12px 20px;background:var(--panel);border-bottom:1px solid var(--border);
}
header.top .brand{font-weight:700;color:var(--accent);letter-spacing:.5px;white-space:nowrap}
header.top .search{flex:1}
header.top input[type=search]{
  width:100%;padding:10px 14px;background:var(--panel2);color:var(--text);
  border:1px solid var(--border);border-radius:8px;outline:none;font-size:14px;
}
header.top input[type=search]:focus{border-color:var(--accent)}
.burger{display:none;background:transparent;border:1px solid var(--border);
  color:var(--text);padding:8px 12px;border-radius:8px;cursor:pointer}

.layout{display:grid;grid-template-columns:260px 1fr;min-height:calc(100vh - 61px)}
aside.side{background:var(--panel);border-right:1px solid var(--border);padding:16px}
aside.side h4{margin:0 0 8px;color:var(--muted);font-size:12px;
  text-transform:uppercase;letter-spacing:1px}
aside.side ul{list-style:none;padding:0;margin:0 0 18px}
aside.side li a{display:block;padding:8px 10px;border-radius:6px;color:var(--text);font-size:14px}
aside.side li a:hover,aside.side li a.active{background:rgba(0,255,136,.08);color:var(--accent);text-decoration:none}

main{padding:24px 32px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:12px;
  overflow:hidden;transition:transform .15s,border-color .15s;color:var(--text)}
.card:hover{transform:translateY(-3px);border-color:var(--accent);text-decoration:none}
.card .card-cover{width:100%;height:140px;object-fit:cover;border-radius:0}
.card .card-cover.placeholder{background:linear-gradient(135deg,#1a1a1a,#0f1f18)}
.card .card-body{padding:12px 14px}
.card h3{margin:4px 0;font-size:16px;color:var(--text)}
.card .cat{color:var(--accent);font-size:12px;text-transform:uppercase;letter-spacing:1px}
.card time{color:var(--muted);font-size:12px}

/* Статья (полный вид) */
.article{display:none;max-width:820px;margin:0 auto;padding:24px 0 80px}
.article.active{display:block}
.article-header{margin-bottom:24px;border-bottom:1px solid var(--border);padding-bottom:16px}
.article-header h1{margin:8px 0 0;font-size:32px;color:#fff}
.article-cover{width:100%;max-height:420px;object-fit:cover;border-radius:12px;margin-bottom:16px}
.article-meta{display:flex;gap:12px;align-items:center;font-size:13px}
.article-meta .cat{color:var(--accent);text-transform:uppercase;letter-spacing:1px}
.article-meta time{color:var(--muted)}
.article-body h2{margin-top:32px;color:#fff;border-left:3px solid var(--accent);padding-left:12px}
.article-body h3{margin-top:24px;color:#fff}
.article-body blockquote{margin:20px 0;padding:12px 20px;border-left:3px solid var(--accent);
  background:var(--panel);color:#c8c8c8;font-style:italic;border-radius:0 8px 8px 0}
.article-body ul{padding-left:22px}
.article-body pre{background:#111;border:1px solid var(--border);border-radius:10px;
  padding:16px;overflow:auto;font-size:13px}
.article-body code{font-family:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace}
.article-body figure{margin:20px 0;text-align:center}
.article-body figcaption{color:var(--muted);font-size:13px;margin-top:6px}
.article-body audio{width:100%;margin:12px 0}
.video-wrap{position:relative;padding-bottom:56.25%;height:0;margin:20px 0;border-radius:10px;overflow:hidden}
.video-wrap iframe{position:absolute;inset:0;width:100%;height:100%;border:0}

.back-link{display:inline-block;margin-bottom:16px;color:var(--muted)}
.back-link:hover{color:var(--accent)}

.empty{color:var(--muted);text-align:center;padding:60px 20px}

@media (max-width:820px){
  .layout{grid-template-columns:1fr}
  aside.side{position:fixed;left:0;top:61px;bottom:0;width:250px;
    transform:translateX(-100%);transition:transform .2s;z-index:15;overflow-y:auto}
  aside.side.open{transform:translateX(0)}
  .burger{display:inline-block}
  main{padding:16px}
}
</style>
</head>
<body>

<header class="top">
  <button class="burger" id="burger" aria-label="Меню">☰</button>
  <div class="brand">Hive - GameDevelopment</div>
  <div class="search">
    <input type="search" id="search" placeholder="Поиск статей…">
  </div>
</header>

<div class="layout">
  <aside class="side" id="sidebar">
    <h4>Категории</h4>
    <ul id="cats">
      <li><a href="#" data-cat="" class="active">Все статьи</a></li>
      ${catsHtml}
    </ul>
  </aside>

  <main>
    <section id="list">
      <div class="grid" id="grid">
        ${cardsHtml || '<div class="empty">Пока нет статей. Добавьте первую в редакторе.</div>'}
      </div>
      <div class="empty" id="listEmpty" style="display:none">Ничего не найдено</div>
    </section>

    <section id="reader">
      <a class="back-link" href="#">← Ко всем статьям</a>
      ${articlesHtml}
    </section>
  </main>
</div>

<script id="articles-data" type="application/json">${jsonData}</script>
<script>
// ============ Хеш-роутинг без сервера ============
(function(){
  const listEl = document.getElementById('list');
  const readerEl = document.getElementById('reader');
  const articles = Array.from(document.querySelectorAll('.article'));
  const cards = Array.from(document.querySelectorAll('.card'));

  function show(id){
    if(!id){
      listEl.style.display = '';
      readerEl.querySelectorAll('.article.active').forEach(a=>a.classList.remove('active'));
      document.title = 'Hive - GameDevelopment — статьи';
      window.scrollTo({top:0});
      return;
    }
    listEl.style.display = 'none';
    readerEl.querySelectorAll('.article').forEach(a=>a.classList.remove('active'));
    const art = document.getElementById('article-'+id);
    if(art){
      art.classList.add('active');
      const t = art.querySelector('h1');
      document.title = (t?t.textContent:'Статья') + ' — Hive - GameDevelopment';
      window.scrollTo({top:0});
    } else {
      listEl.style.display = '';
    }
  }

  function route(){
    const h = location.hash.replace(/^#/,'');
    if(h.startsWith('article-')) show(h.slice('article-'.length));
    else show('');
  }
  window.addEventListener('hashchange', route);
  route();

  // Подсветка кода
  if(window.hljs) document.querySelectorAll('pre code').forEach(el=>hljs.highlightElement(el));

  // Бургер
  const burger = document.getElementById('burger');
  const sidebar = document.getElementById('sidebar');
  burger && burger.addEventListener('click', ()=>sidebar.classList.toggle('open'));

  // Категории
  document.querySelectorAll('#cats a').forEach(a=>{
    a.addEventListener('click', (e)=>{
      e.preventDefault();
      document.querySelectorAll('#cats a').forEach(x=>x.classList.remove('active'));
      a.classList.add('active');
      filter();
      sidebar.classList.remove('open');
    });
  });
  function activeCat(){
    const a = document.querySelector('#cats a.active');
    return a ? (a.dataset.cat || '') : '';
  }

  // Поиск
  const search = document.getElementById('search');
  search && search.addEventListener('input', filter);

  function filter(){
    const q = (search?.value || '').trim().toLowerCase();
    const cat = activeCat();
    let visible = 0;
    cards.forEach(c=>{
      const okCat = !cat || c.dataset.cat === cat;
      const okQ = !q || c.dataset.title.includes(q);
      const ok = okCat && okQ;
      c.style.display = ok ? '' : 'none';
      if(ok) visible++;
    });
    document.getElementById('listEmpty').style.display = visible ? 'none' : '';
  }
})();
</script>
</body>
</html>`;
}

// ---------- Запуск ----------
app.listen(PORT, () => {
  console.log(`\n🚀 Редактор запущен: http://localhost:${PORT}\n`);
  console.log(`   Предпросмотр: http://localhost:${PORT}/preview`);
  console.log(`   Сохранение генерирует: ${INDEX_FILE}\n`);
});