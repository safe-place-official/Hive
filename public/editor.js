/* ============================================================
   Логика редактора статей (frontend, без фреймворков)
   ============================================================ */

// ---------- Состояние ----------
let articles = [];         // все статьи
let current = null;        // текущая открытая статья
let dirty = false;         // есть несохранённые изменения

// ---------- DOM ----------
const $ = (sel) => document.querySelector(sel);
const els = {
  list: $('#articles-list'),
  blocks: $('#blocks'),
  blockType: $('#block-type'),
  emptyHint: $('#empty-hint'),
  toast: $('#toast'),
  title: $('#f-title'),
  category: $('#f-category'),
  date: $('#f-date'),
  coverUrl: $('#f-cover-url'),
  coverFile: $('#f-cover-file'),
  btnCover: $('#btn-cover'),
  hiddenFile: $('#hidden-file-input'),
};

// ---------- Утилиты ----------
function uid() {
  return 'id-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function toast(msg, isError = false) {
  els.toast.textContent = msg;
  els.toast.classList.toggle('error', isError);
  els.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

// Загрузка файла на сервер → возвращает URL
async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/upload', { method: 'POST', body: fd });
  if (!res.ok) throw new Error('Ошибка загрузки файла');
  const data = await res.json();
  return data.url;
}

// ---------- API ----------
async function loadArticles() {
  const res = await fetch('/api/articles');
  articles = await res.json();
  renderList();
}

async function saveArticle(article) {
  const res = await fetch('/api/articles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(article),
  });
  return res.json();
}

async function deleteArticle(id) {
  await fetch('/api/articles/' + id, { method: 'DELETE' });
}

async function rebuildIndex() {
  const res = await fetch('/save', { method: 'POST' });
  return res.json();
}

// ---------- Список статей ----------
function renderList() {
  els.list.innerHTML = '';
  if (!articles.length) {
    els.list.innerHTML = '<li style="color:var(--muted);cursor:default">Нет статей</li>';
    return;
  }
  // Сортировка по дате (новые сверху)
  [...articles]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .forEach((a) => {
      const li = document.createElement('li');
      li.textContent = a.title || 'Без названия';
      const small = document.createElement('small');
      small.textContent = `${a.category || '—'} · ${a.date || ''}`;
      li.appendChild(small);
      if (current && current.id === a.id) li.classList.add('active');
      li.addEventListener('click', () => openArticle(a.id));
      els.list.appendChild(li);
    });
}

// ---------- Открытие/создание статьи ----------
function openArticle(id) {
  const found = articles.find((a) => a.id === id);
  if (!found) return;
  current = JSON.parse(JSON.stringify(found)); // копия
  fillForm();
  renderList();
  els.emptyHint.classList.add('hidden');
}

function newArticle() {
  current = {
    id: '',
    title: '',
    category: '',
    date: new Date().toISOString().slice(0, 10),
    cover: '',
    blocks: [],
  };
  fillForm();
  renderList();
  els.emptyHint.classList.add('hidden');
}

// ---------- Форма метаданных ----------
function fillForm() {
  els.title.value = current.title || '';
  els.category.value = current.category || '';
  els.date.value = current.date || '';
  els.coverUrl.value = current.cover || '';
  renderBlocks();
  dirty = false;
}

// Привязка полей
[els.title, els.category, els.date].forEach((el) => {
  el.addEventListener('input', () => {
    if (!current) return;
    current.title = els.title.value;
    current.category = els.category.value;
    current.date = els.date.value;
    dirty = true;
    renderList();
  });
});

// Обложка — выбор файла
els.btnCover.addEventListener('click', () => els.coverFile.click());
els.coverFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !current) return;
  try {
    const url = await uploadFile(file);
    current.cover = url;
    els.coverUrl.value = url;
    dirty = true;
    toast('Обложка загружена');
  } catch (err) {
    toast('Не удалось загрузить обложку', true);
  }
});

// ---------- Блоки ----------
const BLOCK_LABELS = {
  h2: 'Заголовок H2',
  h3: 'Подзаголовок H3',
  p: 'Абзац текста',
  img: 'Картинка',
  gif: 'GIF',
  video: 'Видео',
  audio: 'Аудио',
  quote: 'Цитата',
  list: 'Список',
  code: 'Код',
};

function renderBlocks() {
  els.blocks.innerHTML = '';
  (current.blocks || []).forEach((block, idx) => {
    els.blocks.appendChild(renderBlock(block, idx));
  });
}

function renderBlock(block, idx) {
  const wrap = document.createElement('div');
  wrap.className = 'block';
  wrap.dataset.idx = idx;

  // --- шапка блока ---
  const header = document.createElement('div');
  header.className = 'block-header';
  header.innerHTML = `<span class="block-type">${BLOCK_LABELS[block.type] || block.type}</span>`;
  const controls = document.createElement('div');
  controls.className = 'block-controls';
  controls.innerHTML = `
    <button title="Вверх" data-act="up">▲</button>
    <button title="Вниз" data-act="down">▼</button>
    <button title="Удалить" class="del" data-act="del">✕</button>`;
  header.appendChild(controls);
  wrap.appendChild(header);

  controls.addEventListener('click', (e) => {
    const act = e.target.dataset.act;
    if (!act) return;
    if (act === 'up' && idx > 0) {
      [current.blocks[idx - 1], current.blocks[idx]] = [current.blocks[idx], current.blocks[idx - 1]];
    } else if (act === 'down' && idx < current.blocks.length - 1) {
      [current.blocks[idx + 1], current.blocks[idx]] = [current.blocks[idx], current.blocks[idx + 1]];
    } else if (act === 'del') {
      current.blocks.splice(idx, 1);
    }
    dirty = true;
    renderBlocks();
  });

  // --- содержимое блока по типу ---
  switch (block.type) {
    case 'h2':
    case 'h3':
    case 'p':
    case 'quote': {
      const ta = document.createElement('textarea');
      ta.placeholder = block.type === 'quote' ? 'Текст цитаты' : 'Текст';
      ta.value = block.text || '';
      ta.addEventListener('input', () => {
        block.text = ta.value;
        dirty = true;
      });
      wrap.appendChild(ta);
      break;
    }

    case 'img':
    case 'gif': {
      wrap.appendChild(buildFileRow(block, block.type === 'gif' ? 'GIF' : 'Картинка'));
      const cap = document.createElement('input');
      cap.type = 'text';
      cap.placeholder = 'Подпись (необязательно)';
      cap.value = block.caption || '';
      cap.addEventListener('input', () => { block.caption = cap.value; dirty = true; });
      wrap.appendChild(cap);
      if (block.url) {
        const img = document.createElement('img');
        img.className = 'preview';
        img.src = block.url;
        wrap.appendChild(img);
      }
      break;
    }

    case 'video': {
      const inp = document.createElement('input');
      inp.type = 'url';
      inp.placeholder = 'https://youtube.com/watch?v=... или https://rutube.ru/video/...';
      inp.value = block.url || '';
      inp.addEventListener('input', () => { block.url = inp.value; dirty = true; });
      wrap.appendChild(inp);
      break;
    }

    case 'audio': {
      wrap.appendChild(buildFileRow(block, 'Аудио (mp3/wav)'));
      if (block.url) {
        const au = document.createElement('audio');
        au.controls = true;
        au.src = block.url;
        wrap.appendChild(au);
      }
      break;
    }

    case 'list': {
      const box = document.createElement('div');
      box.className = 'list-items';
      const items = block.items || (block.items = ['']);
      const rerenderItems = () => {
        box.innerHTML = '';
        items.forEach((it, i) => {
          const row = document.createElement('div');
          row.className = 'li-row';
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.value = it;
          inp.placeholder = 'Пункт ' + (i + 1);
          inp.addEventListener('input', () => { items[i] = inp.value; dirty = true; });
          const del = document.createElement('button');
          del.textContent = '✕';
          del.addEventListener('click', () => {
            items.splice(i, 1);
            if (!items.length) items.push('');
            dirty = true;
            rerenderItems();
          });
          row.appendChild(inp);
          row.appendChild(del);
          box.appendChild(row);
        });
        const add = document.createElement('button');
        add.className = 'btn';
        add.textContent = '+ пункт';
        add.addEventListener('click', () => { items.push(''); dirty = true; rerenderItems(); });
        box.appendChild(add);
      };
      rerenderItems();
      wrap.appendChild(box);
      break;
    }

    case 'code': {
      const lang = document.createElement('input');
      lang.type = 'text';
      lang.placeholder = 'Язык (javascript, csharp, ...)';
      lang.value = block.lang || 'javascript';
      lang.addEventListener('input', () => { block.lang = lang.value; dirty = true; });
      const ta = document.createElement('textarea');
      ta.placeholder = 'Код';
      ta.style.fontFamily = 'ui-monospace, Menlo, Consolas, monospace';
      ta.value = block.text || '';
      ta.addEventListener('input', () => { block.text = ta.value; dirty = true; });
      wrap.appendChild(lang);
      wrap.appendChild(ta);
      break;
    }
  }

  return wrap;
}

// Строка «загрузить файл» + URL для блоков
function buildFileRow(block, label) {
  const row = document.createElement('div');
  row.className = 'row';
  const url = document.createElement('input');
  url.type = 'text';
  url.readOnly = true;
  url.placeholder = 'Файл не выбран';
  url.value = block.url || '';
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = 'Загрузить ' + label;
  btn.addEventListener('click', () => {
    const fi = document.createElement('input');
    fi.type = 'file';
    let accept = 'image/*';
    if (block.type === 'audio') accept = 'audio/*';
    fi.accept = accept;
    fi.addEventListener('change', async () => {
      const file = fi.files[0];
      if (!file) return;
      try {
        const u = await uploadFile(file);
        block.url = u;
        url.value = u;
        dirty = true;
        renderBlocks();
        toast('Файл загружен');
      } catch (e) {
        toast('Ошибка загрузки', true);
      }
    });
    fi.click();
  });
  row.appendChild(url);
  row.appendChild(btn);
  return row;
}

// ---------- Добавление блока ----------
$('#btn-add-block').addEventListener('click', () => {
  if (!current) {
    toast('Сначала создайте статью', true);
    return;
  }
  const type = els.blockType.value;
  const block = { type };
  if (['h2', 'h3', 'p', 'quote'].includes(type)) block.text = '';
  if (['img', 'gif', 'audio', 'video'].includes(type)) block.url = '';
  if (type === 'list') block.items = [''];
  if (type === 'code') { block.lang = 'javascript'; block.text = ''; }
  current.blocks.push(block);
  dirty = true;
  renderBlocks();
});

// ---------- Кнопки ----------
$('#btn-new').addEventListener('click', () => {
  newArticle();
  toast('Новая статья');
});

$('#btn-save').addEventListener('click', async () => {
  if (!current) { toast('Нет открытой статьи', true); return; }
  if (!current.title.trim()) { toast('Укажите заголовок', true); return; }

  try {
    // 1) сохраняем статью
    const res = await saveArticle(current);
    if (!res.ok) throw new Error('Ошибка сохранения');
    if (!current.id) current.id = res.article.id;

    // 2) обновляем локальный список
    const idx = articles.findIndex((a) => a.id === current.id);
    if (idx === -1) articles.push({ ...current });
    else articles[idx] = { ...current };

    // 3) пересобираем index.html
    await rebuildIndex();

    dirty = false;
    renderList();
    toast('Сохранено ✓');
  } catch (e) {
    console.error(e);
    toast('Ошибка сохранения', true);
  }
});

$('#btn-preview').addEventListener('click', async () => {
  // Сначала сохраняем черновик на сервер, потом открываем /preview
  if (current) {
    try {
      const res = await saveArticle(current);
      if (!current.id) current.id = res.article.id;
      const idx = articles.findIndex((a) => a.id === current.id);
      if (idx === -1) articles.push({ ...current });
      else articles[idx] = { ...current };
      await rebuildIndex();
    } catch (e) { /* открываем как есть */ }
  }
  window.open('/preview', '_blank');
});

$('#btn-delete').addEventListener('click', async () => {
  if (!current || !current.id) { toast('Нет статьи для удаления', true); return; }
  if (!confirm('Удалить статью «' + current.title + '»?')) return;
  await deleteArticle(current.id);
  articles = articles.filter((a) => a.id !== current.id);
  current = null;
  els.blocks.innerHTML = '';
  els.title.value = els.category.value = els.date.value = els.coverUrl.value = '';
  els.emptyHint.classList.remove('hidden');
  renderList();
  await rebuildIndex();
  toast('Удалено');
});

// ---------- Горячие клавиши ----------
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    $('#btn-save').click();
  }
});

// ---------- Старт ----------
loadArticles();