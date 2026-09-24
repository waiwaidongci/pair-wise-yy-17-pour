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

function fmtDuration(ms) {
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const mins = Math.floor((abs % 3600000) / 60000);
  const text = days ? `${days}天${hours}小时` : hours ? `${hours}小时${mins}分` : `${mins}分钟`;
  return ms >= 0 ? text : text;
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
  const placeholder = field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : '';
  if (field.type === 'textarea') {
    return `<label class="${field.wide ? 'wide' : ''}">${field.label}<textarea name="${field.name}" ${placeholder} ${required}></textarea></label>`;
  }
  if (field.type === 'select') {
    return `<label class="${field.wide ? 'wide' : ''}">${field.label}<select name="${field.name}" ${required}>${field.options.map((option) => `<option>${escapeHtml(option)}</option>`).join('')}</select></label>`;
  }
  if (field.type === 'relation') {
    const items = state.db[field.collection] || [];
    return `<label class="${field.wide ? 'wide' : ''}">${field.label}<select name="${field.name}" ${required}>${optionList(items, field.labelFields)}</select></label>`;
  }
  return `<label class="${field.wide ? 'wide' : ''}">${field.label}<input type="${field.type || 'text'}" name="${field.name}" ${value} ${placeholder} ${required}></label>`;
}

function pill(value, tone = '') {
  return `<span class="pill ${tone}">${escapeHtml(value || '-')}</span>`;
}

function toneFor(value) {
  return state.config.tones?.[value] || '';
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

function actionHtml(action, item) {
  if (action.showInStatuses && !action.showInStatuses.includes(item.status)) return '';
  if (action.inputs?.length) {
    const inputs = action.inputs.map((field) => {
      const required = field.required ? 'required' : '';
      const placeholder = field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : '';
      if (field.type === 'textarea') {
        return `<label class="action-field wide">${escapeHtml(field.label)}<textarea name="${field.name}" ${placeholder} ${required}></textarea></label>`;
      }
      return `<label class="action-field">${escapeHtml(field.label)}<input name="${field.name}" ${placeholder} ${required}></label>`;
    }).join('');
    return `<form class="action-form" data-action="${action.id}" data-id="${item.id}">
      <div class="action-inputs">${inputs}</div>
      <button class="${action.danger ? 'danger' : 'ghost'}">${escapeHtml(action.label)}</button>
    </form>`;
  }
  return `<button class="ghost ${action.danger ? 'danger' : ''}" data-action="${action.id}" data-id="${item.id}">${escapeHtml(action.label)}</button>`;
}

function actionsHtml(collection, item) {
  return state.config.actions
    .filter((action) => action.collection === collection)
    .map((action) => actionHtml(action, item))
    .filter(Boolean)
    .join('');
}

const INCIDENT_STAGES = ['待补证', '处置中', '待确认', '已恢复'];

function incidentStagesHtml(item) {
  // 进度分两段看：补证 → 处置 → 双人确认 → 已恢复
  const labels = ['登记', '照片补齐', '负责人说明', '另一位确认'];
  const reached = {
    '登记': true,
    '照片补齐': !!item.photoUrl,
    '负责人说明': !!item.handler,
    '另一位确认': item.status === '已恢复'
  };
  return `<div class="steps">${labels.map((label) => `
    <span class="step ${reached[label] ? 'done' : ''}">${escapeHtml(label)}</span>
  `).join('<span class="step-sep">→</span>')}</div>`;
}

function incidentBannerHtml(item) {
  const now = Date.now();
  if (item.status === '待补证') {
    const due = Date.parse(item.evidenceDueAt);
    if (Number.isFinite(due) && now > due) {
      return `<div class="banner bad">补证已逾期 ${fmtDuration(now - due)}，样点继续重点保护，请尽快补照片</div>`;
    }
    if (Number.isFinite(due)) {
      return `<div class="banner warn">距补证期限还有 ${fmtDuration(due - now)}（发现后 24 小时内）</div>`;
    }
  }
  if (item.status === '待确认') {
    const since = Date.parse(item.handledAt || item.updatedAt);
    if (Number.isFinite(since)) {
      return `<div class="banner warn">已等待另一位巡测员确认 ${fmtDuration(now - since)}，负责人不能自行结束</div>`;
    }
  }
  if (item.status === '处置中') {
    return `<div class="banner warn">照片已齐，等待值班负责人补充现场说明</div>`;
  }
  if (item.status === '已恢复') {
    return `<div class="banner ok">环境恢复已由 ${escapeHtml(item.confirmer || '-')} 双人确认，样点恢复为「${escapeHtml(item.priorStatus)}」${item.priorStatus === '暂停开放' ? '（原暂停开放，仍不开放）' : ''}</div>`;
  }
  return '';
}

function reportsHtml(item) {
  const reports = item.reports || [];
  if (reports.length <= 1) return '';
  return `<div class="history">
    <div class="reports-title">同一样点累计上报 ${item.reportCount} 次，沿用本记录：</div>
    ${reports.map((entry, index) => `
      <div class="history-item"><span>${fmtDate(entry.at)}</span><span>第${index + 1}次 · ${escapeHtml(entry.staff || '-')}${entry.photoUrl ? ' · 带照片' : ' · 无照片'}${entry.note ? '：' + escapeHtml(entry.note) : ''}</span></div>
    `).join('')}
  </div>`;
}

function detailValueHtml(item, field) {
  if (field.type === 'relation') return escapeHtml(relationLabel(field, item[field.name]) || '-');
  if (field.type === 'datetime') return escapeHtml(fmtDate(item[field.name]));
  if (field.type === 'photo') return item[field.name] ? `<a href="${escapeHtml(item[field.name])}" target="_blank" rel="noreferrer">已附照片</a>` : '<span class="missing">缺失（待补证）</span>';
  return escapeHtml(item[field.name] ?? '-');
}

function renderIncidentCard(item, view) {
  const siteLabel = relationLabel(view.relation, item.siteId);
  const details = (view.detailFields || []).map((field) => `
    <div>${escapeHtml(field.label)}<br><strong>${detailValueHtml(item, field)}</strong></div>
  `).join('');
  const handleNote = item.handleNote
    ? `<p class="handle-note">负责人说明（${escapeHtml(item.handler || '-')}）：${escapeHtml(item.handleNote)}</p>`
    : '';
  return `<article class="card incident-card">
    <div class="card-head"><h3>${escapeHtml(siteLabel)}</h3>${pill(item.status, toneFor(item.status))}</div>
    <div class="meta">发现时刻 ${escapeHtml(fmtDate(item.discoveredAt))} · 初次登记 ${escapeHtml(fmtDate(item.createdAt))}</div>
    ${incidentBannerHtml(item)}
    ${incidentStagesHtml(item)}
    ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ''}
    ${handleNote}
    <div class="detail">${details}</div>
    <div class="actions">${actionsHtml('incidents', item)}</div>
    ${reportsHtml(item)}
    ${historyHtml(item)}
  </article>`;
}

function renderCard(item, collection, view) {
  if (view.cardType === 'incident') return renderIncidentCard(item, view);
  const title = view.titleFields.map((field) => item[field]).filter(Boolean).join(' / ') || item.id;
  const statusValue = item[view.statusField];
  const relation = view.relation ? `<div class="meta">${escapeHtml(relationLabel(view.relation, item[view.relation.localKey]))}</div>` : '';
  const details = (view.detailFields || []).map((field) => {
    const value = field.type === 'relation' ? relationLabel(field, item[field.name]) : item[field.name];
    return `<div>${escapeHtml(field.label)}<br><strong>${escapeHtml(value || '-')}</strong></div>`;
  }).join('');
  const summary = (view.summaryFields || []).map((field) => item[field]).filter(Boolean).join(' · ');
  return `<article class="card">
    <div class="card-head"><h3>${escapeHtml(title)}</h3>${statusValue ? pill(statusValue, toneFor(statusValue)) : ''}</div>
    ${relation}
    ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
    ${details ? `<div class="detail">${details}</div>` : ''}
    <div class="actions">${actionsHtml(collection, item)}</div>
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
  else if (source.values) items = items.filter((item) => source.values.includes(item[source.field] || item.status));
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
  $('#main').innerHTML = state.config.views.map((view) => view.type === 'dashboard' ? renderDashboardView(view) : renderCrudView(view)).join('');
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
  // 带输入的动作用 action-form 提交处理，这里只管无表单按钮
  if (action && action.tagName === 'BUTTON') {
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
  if (view) $(`#list-${view.id}`).innerHTML = renderList(view);
});

document.addEventListener('submit', async (event) => {
  const actionForm = event.target.closest('.action-form');
  if (actionForm) {
    event.preventDefault();
    const inputs = Object.fromEntries(new FormData(actionForm).entries());
    try {
      await api(`/api/action/${actionForm.dataset.action}/${actionForm.dataset.id}`, {
        method: 'POST',
        body: JSON.stringify({ inputs })
      });
      await load();
      toast('已更新');
    } catch (error) {
      toast(error.message);
    }
    return;
  }

  const form = event.target.closest('[data-create]');
  if (!form) return;
  event.preventDefault();
  const view = state.config.views.find((entry) => entry.id === form.dataset.view);
  const collection = form.dataset.create;
  try {
    let result;
    if (collection === 'incidents') {
      // 同一样点未结案时沿用原记录并累加次数
      result = await api('/api/incidents/report', { method: 'POST', body: JSON.stringify(values(form, view)) });
      toast(result.merged ? '该样点已有处置记录，已沿用并累加为第 ' + result.reportCount + ' 次上报' : '已登记干扰，样点转为重点保护');
    } else {
      await api(`/api/${collection}`, { method: 'POST', body: JSON.stringify(values(form, view)) });
      toast('已保存');
    }
    form.reset();
    await load();
  } catch (error) {
    toast(error.message);
  }
});

$('#refreshBtn').addEventListener('click', () => load().then(() => toast('已刷新')));

async function boot() {
  state.config = await api('/api/config');
  renderTabs();
  await load();
}

boot().catch((error) => toast(error.message));
