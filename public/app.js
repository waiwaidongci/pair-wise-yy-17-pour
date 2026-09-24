const state = {
  config: null,
  db: {},
  activeTab: ''
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fmtDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1800);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || '请求失败');
  }
  if (res.status === 204) return null;
  return res.json();
}

function valueByPath(source, pathName) {
  return pathName.split('.').reduce((value, key) => value?.[key], source);
}

function displayField(item, field) {
  const value = item[field.name] ?? '';
  if (field.type === 'select' && field.options) return value || field.options[0];
  return value;
}

function collectionLabel(collection) {
  return state.config.collections[collection]?.label || collection;
}

function relationLabel(relation, id) {
  const item = state.db[relation.collection]?.find((entry) => entry.id === id);
  if (!item) return '未关联';
  return relation.labelFields.map((field) => item[field]).filter(Boolean).join(' / ');
}

function optionList(items, labelFields) {
  return items.map((item) => {
    const label = labelFields.map((field) => item[field]).filter(Boolean).join(' / ');
    return `<option value="${item.id}">${escapeHtml(label)}</option>`;
  }).join('');
}

function formField(field) {
  const required = field.required ? 'required' : '';
  const value = field.default ? `value="${escapeHtml(field.default)}"` : '';
  if (field.type === 'textarea') {
    return `<label class="${field.wide ? 'wide' : ''}">${field.label}<textarea name="${field.name}" ${required}></textarea></label>`;
  }
  if (field.type === 'select') {
    return `<label class="${field.wide ? 'wide' : ''}">${field.label}<select name="${field.name}" ${required}>${field.options.map((option) => `<option>${escapeHtml(option)}</option>`).join('')}</select></label>`;
  }
  if (field.type === 'relation') {
    const items = state.db[field.collection] || [];
    return `<label class="${field.wide ? 'wide' : ''}">${field.label}<select name="${field.name}" ${required}>${optionList(items, field.labelFields)}</select></label>`;
  }
  return `<label class="${field.wide ? 'wide' : ''}">${field.label}<input type="${field.type || 'text'}" name="${field.name}" ${value} ${required}></label>`;
}

function pill(value, tone = '') {
  return `<span class="pill ${tone}">${escapeHtml(value || '-')}</span>`;
}

function toneFor(value) {
  return state.config.tones?.[value] || '';
}

// ---- 游客干扰处置 ----

const INCIDENT_OPS = {
  report: {
    title: '再次上报（沿用原记录，累加次数）',
    endpoint: () => '/api/incidents/register',
    fields: [
      { name: 'responder', label: '现场人员', required: true },
      { name: 'description', label: '现场情况', type: 'textarea' },
      { name: 'photos', label: '新增照片链接（逗号或换行分隔）', type: 'textarea' }
    ]
  },
  photos: {
    title: '补充照片',
    endpoint: (id) => `/api/incidents/${id}/photos`,
    fields: [
      { name: 'photos', label: '照片链接（逗号或换行分隔）', type: 'textarea', required: true },
      { name: 'who', label: '补充人', required: true }
    ]
  },
  note: {
    title: '补现场说明（值班负责人）',
    endpoint: (id) => `/api/incidents/${id}/note`,
    fields: [
      { name: 'leader', label: '值班负责人', required: true },
      { name: 'note', label: '现场说明', type: 'textarea', required: true }
    ]
  },
  confirm: {
    title: '确认环境恢复（须另一位巡测员，负责人不可自确认）',
    endpoint: (id) => `/api/incidents/${id}/confirm`,
    fields: [
      { name: 'confirmer', label: '确认巡测员', required: true },
      { name: 'confirmNote', label: '确认说明', type: 'textarea' }
    ]
  }
};

function localDatetimeValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fmtDuration(ms) {
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}天${hours % 24}小时`;
  if (hours > 0) return `${hours}小时`;
  return `${Math.max(1, Math.floor(ms / 60000))}分钟`;
}

function siteOf(item) {
  return (state.db.sites || []).find((site) => site.id === item.siteId);
}

function siteLine(item) {
  const site = siteOf(item);
  if (!site) return '样点已删除';
  return [site.cave, site.zone, site.pointCode].filter(Boolean).join(' / ');
}

function renderIncidentActions(item) {
  if (item.closed) return '';
  const buttons = [
    `<button class="ghost" data-incident-op="report" data-id="${item.id}">再次上报</button>`,
    `<button class="ghost" data-incident-op="photos" data-id="${item.id}">补充照片</button>`
  ];
  if (!item.noteReady) {
    buttons.push(`<button class="ghost" data-incident-op="note" data-id="${item.id}">补现场说明</button>`);
  }
  const confirmAttrs = item.canConfirm
    ? ''
    : ' disabled title="需照片齐全且值班负责人已补现场说明"';
  buttons.push(`<button data-incident-op="confirm" data-id="${item.id}"${confirmAttrs}>确认环境恢复</button>`);
  return `<div class="actions">${buttons.join('')}</div>`;
}

function renderIncidentCard(item) {
  const site = siteOf(item);
  const sitePill = site && site.protectedStatus !== '常规观察'
    ? pill(site.protectedStatus, toneFor(site.protectedStatus))
    : '';
  const overdue = !item.closed && item.overdueMs > 0
    ? `<span class="overdue">补证逾期 ${fmtDuration(item.overdueMs)}</span>`
    : '';
  const photos = (item.photos || []).length
    ? `<div class="photos">${item.photos.map((photo) => `<span class="photo-chip" title="${escapeHtml(photo.addedBy || '')} · ${fmtDate(photo.addedAt)}">${escapeHtml(photo.url)}</span>`).join('')}</div>`
    : '<div class="meta">暂无照片</div>';
  const noteBlock = item.noteReady
    ? `<p class="note-block"><strong>现场说明（负责人 ${escapeHtml(item.noteLeader)}）：</strong>${escapeHtml(item.dispositionNote)}</p>`
    : '';
  const confirmBlock = item.closed
    ? `<p class="note-block ok-text"><strong>已闭环：</strong>${escapeHtml(item.confirmer)} 于 ${fmtDate(item.confirmedAt)} 确认环境恢复${item.confirmNote ? ' · ' + escapeHtml(item.confirmNote) : ''}</p>`
    : '';
  return `<article class="card">
    <div class="card-head">
      <h3>${escapeHtml(siteLine(item))}</h3>
      <span class="pill-group">${pill(item.phase, toneFor(item.phase))}${sitePill}</span>
    </div>
    <div class="meta">发现 ${fmtDate(item.foundAt)} · 上报 ${item.reportCount} 次 · 现场人员：${escapeHtml(item.responderNames || '-')}</div>
    ${item.latestDescription ? `<p>${escapeHtml(item.latestDescription)}</p>` : ''}
    <div class="detail">
      <div>补证进度<br><strong>${escapeHtml(item.evidenceProgress)}</strong><br>${overdue || `<span class="meta">截止 ${fmtDate(item.deadline)}</span>`}</div>
      <div>说明进度<br><strong>${escapeHtml(item.noteProgress)}</strong></div>
      <div>确认进度<br><strong>${escapeHtml(item.confirmProgress)}</strong></div>
    </div>
    ${photos}
    ${noteBlock}
    ${confirmBlock}
    ${renderIncidentActions(item)}
    ${historyHtml(item)}
  </article>`;
}

function renderIncidentList(view) {
  const query = $(`#search-${view.id}`)?.value.trim() || '';
  const status = $(`#status-${view.id}`)?.value || '';
  let items = [...(state.db.incidents || [])];
  if (query) {
    items = items.filter((item) => view.searchFields.some((field) => String(item[field] || '').includes(query)));
  }
  if (status) {
    items = items.filter((item) => item.phase === status);
  }
  return items.length
    ? items.map((item) => renderIncidentCard(item)).join('')
    : '<div class="empty">暂无干扰处置记录</div>';
}

function renderIncidentView(view) {
  const sites = state.db.sites || [];
  return `<section class="view" id="${view.id}">
    <div class="grid">
      <form class="panel" data-incident-form>
        <h2>${escapeHtml(view.formTitle)}</h2>
        <div class="form-grid">
          <label class="wide">样点<select name="siteId" required>${optionList(sites, ['cave', 'zone', 'pointCode'])}</select></label>
          <label>发现时刻<input type="datetime-local" name="foundAt" value="${localDatetimeValue()}"></label>
          <label>现场人员<input name="responder" required placeholder="发现并处置的巡测员"></label>
          <label class="wide">现场情况<textarea name="description" placeholder="触碰 / 越线情况、位置、影响范围"></textarea></label>
          <label class="wide">现场照片<textarea name="photos" placeholder="照片链接，逗号或换行分隔；可后补，超过24小时未补将进入待补证"></textarea></label>
        </div>
        <div class="actions"><button>${escapeHtml(view.submitLabel)}</button></div>
        <p class="hint">同一样点未闭环前再次上报，将沿用原记录并累加次数，补证截止时间不重算。</p>
      </form>
      <div class="panel">
        <h2>${escapeHtml(view.listTitle)}</h2>
        <div class="toolbar">
          <input id="search-${view.id}" placeholder="${escapeHtml(view.searchPlaceholder)}">
          <select id="status-${view.id}">
            <option value="">全部状态</option>
            ${view.statusOptions.map((option) => `<option>${escapeHtml(option)}</option>`).join('')}
          </select>
        </div>
        <div class="list" id="list-${view.id}">${renderIncidentList(view)}</div>
      </div>
    </div>
  </section>`;
}

function openIncidentDialog(op, id) {
  const spec = INCIDENT_OPS[op];
  const item = (state.db.incidents || []).find((entry) => entry.id === id);
  if (!spec || !item) return;
  const modal = $('#modal');
  $('#modalTitle').textContent = `${spec.title} · ${siteLine(item)}`;
  $('#modalFields').innerHTML = spec.fields.map((field) => {
    const required = field.required ? 'required' : '';
    if (field.type === 'textarea') {
      return `<label class="wide">${field.label}<textarea name="${field.name}" ${required}></textarea></label>`;
    }
    return `<label class="wide">${field.label}<input name="${field.name}" ${required}></label>`;
  }).join('');
  $('#modalError').textContent = '';
  const form = $('#modalForm');
  form.dataset.op = op;
  form.dataset.id = id;
  modal.hidden = false;
  $('#modalFields input, #modalFields textarea')?.focus();
}

function closeIncidentDialog() {
  $('#modal').hidden = true;
  $('#modalForm').reset();
}

function historyHtml(item) {
  const history = item.history || [];
  if (!history.length) return '';
  return `<div class="history">${history.slice(0, 5).map((entry) => `
    <div class="history-item"><span>${fmtDate(entry.at)}</span><span>${escapeHtml(entry.action)}${entry.note ? '：' + escapeHtml(entry.note) : ''}</span></div>
  `).join('')}</div>`;
}

function values(form, view) {
  const payload = Object.fromEntries(new FormData(form).entries());
  for (const field of view.fields) {
    if (field.type === 'number') payload[field.name] = Number(payload[field.name] || 0);
  }
  return { ...view.defaults, ...payload };
}

function renderTabs() {
  $('#tabs').innerHTML = state.config.views.map((view, index) => `
    <button class="tab${index === 0 ? ' active' : ''}" data-tab="${view.id}">${escapeHtml(view.label)}</button>
  `).join('');
  state.activeTab = state.config.views[0].id;
}

function setTab(tabId) {
  state.activeTab = tabId;
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabId));
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === tabId));
}

function renderStats() {
  return `<div class="stats">${state.config.stats.map((stat) => {
    const items = state.db[stat.collection] || [];
    const value = stat.filter ? items.filter((item) => item[stat.filter.field] === stat.filter.value).length : items.length;
    return `<div class="stat"><span>${escapeHtml(stat.label)}</span><strong>${value}</strong></div>`;
  }).join('')}</div>`;
}

function renderCard(item, collection, view) {
  if (collection === 'incidents') return renderIncidentCard(item);
  const title = view.titleFields.map((field) => item[field]).filter(Boolean).join(' / ') || item.id;
  const statusValue = item[view.statusField];
  const relation = view.relation ? `<div class="meta">${escapeHtml(relationLabel(view.relation, item[view.relation.localKey]))}</div>` : '';
  const details = (view.detailFields || []).map((field) => {
    const raw = item[field.name];
    const value = field.type === 'relation' ? relationLabel(field, raw) : raw;
    return `<div>${escapeHtml(field.label)}<br><strong>${escapeHtml(value || '-')}</strong></div>`;
  }).join('');
  const summary = (view.summaryFields || []).map((field) => item[field]).filter(Boolean).join(' · ');
  const actions = state.config.actions
    .filter((action) => action.collection === collection)
    .map((action) => `<button class="${action.danger ? 'danger' : 'ghost'}" data-action="${action.id}" data-id="${item.id}">${escapeHtml(action.label)}</button>`)
    .join('');
  return `<article class="card">
    <div class="card-head"><h3>${escapeHtml(title)}</h3>${statusValue ? pill(statusValue, toneFor(statusValue)) : ''}</div>
    ${relation}
    ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
    ${details ? `<div class="detail">${details}</div>` : ''}
    ${actions ? `<div class="actions">${actions}</div>` : ''}
    ${historyHtml(item)}
  </article>`;
}

function renderList(view) {
  const collection = view.collection;
  const query = $(`#search-${view.id}`)?.value.trim() || '';
  const status = $(`#status-${view.id}`)?.value || '';
  let items = [...(state.db[collection] || [])];
  if (query) {
    items = items.filter((item) => view.searchFields.some((field) => String(item[field] || '').includes(query)));
  }
  if (status) {
    items = items.filter((item) => item[view.statusField] === status);
  }
  return items.length ? items.map((item) => renderCard(item, collection, view)).join('') : `<div class="empty">暂无${escapeHtml(collectionLabel(collection))}</div>`;
}

function renderDashboardView(view) {
  const source = view.focus;
  let items = [...(state.db[source.collection] || [])];
  if (source.field) items = items.filter((item) => source.values.includes(item[source.field]));
  items = items.slice(0, source.limit || 8);
  const cardView = state.config.views.find((entry) => entry.collection === source.collection) || source;
  return `<section class="view active" id="${view.id}">
    ${renderStats()}
    <div class="panel"><h2>${escapeHtml(view.focusTitle)}</h2><div class="list">${items.length ? items.map((item) => renderCard(item, source.collection, cardView)).join('') : '<div class="empty">暂无重点事项</div>'}</div></div>
  </section>`;
}

function renderCrudView(view) {
  const statusOptions = view.statusOptions || [];
  return `<section class="view" id="${view.id}">
    <div class="grid">
      <form class="panel" data-create="${view.collection}" data-view="${view.id}">
        <h2>${escapeHtml(view.formTitle)}</h2>
        <div class="form-grid">${view.fields.map(formField).join('')}</div>
        <div class="actions"><button>${escapeHtml(view.submitLabel || '保存')}</button></div>
      </form>
      <div class="panel">
        <h2>${escapeHtml(view.listTitle)}</h2>
        <div class="toolbar">
          <input id="search-${view.id}" placeholder="${escapeHtml(view.searchPlaceholder || '搜索')}">
          <select id="status-${view.id}">
            <option value="">全部状态</option>
            ${statusOptions.map((option) => `<option>${escapeHtml(option)}</option>`).join('')}
          </select>
        </div>
        <div class="list" id="list-${view.id}">${renderList(view)}</div>
      </div>
    </div>
  </section>`;
}

function render() {
  $('#title').textContent = state.config.title;
  document.title = state.config.title;
  $('#lede').textContent = state.config.lede;
  $('#main').innerHTML = state.config.views
    .map((view) => {
      if (view.type === 'dashboard') return renderDashboardView(view);
      if (view.type === 'incidents') return renderIncidentView(view);
      return renderCrudView(view);
    })
    .join('');
  setTab(state.activeTab || state.config.views[0].id);
}

async function load() {
  state.db = await api('/api/db');
  render();
}

document.addEventListener('click', async (event) => {
  const tab = event.target.closest('.tab');
  const action = event.target.closest('[data-action]');
  if (tab) setTab(tab.dataset.tab);
  if (action) {
    try {
      await api(`/api/action/${action.dataset.action}/${action.dataset.id}`, { method: 'POST' });
      await load();
      toast('已更新');
    } catch (error) {
      toast(error.message);
    }
  }
});

document.addEventListener('input', (event) => {
  const view = state.config.views.find((entry) => entry.id && (event.target.id === `search-${entry.id}` || event.target.id === `status-${entry.id}`));
  if (view) $(`#list-${view.id}`).innerHTML = view.type === 'incidents' ? renderIncidentList(view) : renderList(view);
});

document.addEventListener('submit', async (event) => {
  const incidentForm = event.target.closest('[data-incident-form]');
  if (incidentForm) {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(incidentForm).entries());
    try {
      const saved = await api('/api/incidents/register', { method: 'POST', body: JSON.stringify(payload) });
      incidentForm.reset();
      await load();
      toast(saved.reused ? `已沿用原记录，累计第 ${saved.reportCount} 次上报` : '已登记新处置记录');
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  const form = event.target.closest('[data-create]');
  if (!form) return;
  event.preventDefault();
  const view = state.config.views.find((entry) => entry.id === form.dataset.view);
  await api(`/api/${form.dataset.create}`, { method: 'POST', body: JSON.stringify(values(form, view)) });
  form.reset();
  await load();
  toast('已保存');
});

document.addEventListener('click', (event) => {
  const opButton = event.target.closest('[data-incident-op]');
  if (opButton && !opButton.disabled) openIncidentDialog(opButton.dataset.incidentOp, opButton.dataset.id);
});

$('#modalForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const spec = INCIDENT_OPS[form.dataset.op];
  const item = (state.db.incidents || []).find((entry) => entry.id === form.dataset.id);
  if (!spec || !item) return;
  const payload = Object.fromEntries(new FormData(form).entries());
  if (form.dataset.op === 'report') payload.siteId = item.siteId;
  try {
    const saved = await api(spec.endpoint(item.id), { method: 'POST', body: JSON.stringify(payload) });
    closeIncidentDialog();
    await load();
    toast(form.dataset.op === 'report' && saved.reused ? `已沿用原记录，累计第 ${saved.reportCount} 次上报` : '已更新');
  } catch (error) {
    $('#modalError').textContent = error.message;
  }
});

$('#modalCancel').addEventListener('click', closeIncidentDialog);
$('#modal').addEventListener('click', (event) => {
  if (event.target.id === 'modal') closeIncidentDialog();
});

$('#refreshBtn').addEventListener('click', () => load().then(() => toast('已刷新')));

async function boot() {
  state.config = await api('/api/config');
  renderTabs();
  await load();
}

boot().catch((error) => toast(error.message));
