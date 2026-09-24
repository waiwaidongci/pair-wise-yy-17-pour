const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const app = express();
const config = require('./project.config');
const PORT = process.env.PORT || config.port || 3900;
const DB_FILE = path.join(__dirname, 'data', 'db.json');

// 游客干扰处置：补证期限、未结案状态、结案状态
const EVIDENCE_WINDOW_MS = 24 * 60 * 60 * 1000;
const INCIDENT_OPEN_STATUSES = ['处置中', '待补证', '待确认'];
const INCIDENT_DONE_STATUS = '已恢复';
const FAR_FUTURE = 9e15;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function readDb() {
  const raw = await fs.readFile(DB_FILE, 'utf8');
  return JSON.parse(raw);
}

async function writeDb(db) {
  // queueSort 只是读盘时临时算的排序键，不落盘
  await fs.writeFile(DB_FILE, JSON.stringify(db, (key, value) => (key === 'queueSort' ? undefined : value), 2) + '\n');
}

function newId(collection) {
  return `${collection}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
}

function stamp(action, note) {
  return {
    at: new Date().toISOString(),
    action,
    note: note || ''
  };
}

function sortNewest(a, b) {
  return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
}

function toIso(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// 照片与现场说明齐备后的下一个状态
function nextStage(item) {
  if (item.photoUrl && item.handler) return '待确认';
  if (item.photoUrl) return '处置中';
  return '待补证';
}

// 未结案记录的排序键：各阶段"自何时起在等"——待补证按补证期限、待确认按说明完成时刻、处置中按最近更新；已结案沉底
function incidentQueueSort(item) {
  if (item.status === INCIDENT_DONE_STATUS) return FAR_FUTURE;
  if (item.status === '待补证') return Date.parse(item.evidenceDueAt) || Date.parse(item.discoveredAt) + EVIDENCE_WINDOW_MS;
  if (item.status === '待确认') return Date.parse(item.handledAt) || Date.parse(item.updatedAt);
  return Date.parse(item.updatedAt) || Date.parse(item.createdAt);
}

// 惰性流转：处置中但照片缺失（或超过一天未补证）的记录进入待补证；返回是否有落盘变更
function refreshIncidents(db) {
  let changed = false;
  for (const item of db.incidents || []) {
    if (item.status === '处置中' && !item.photoUrl) {
      item.status = '待补证';
      item.updatedAt = new Date().toISOString();
      item.history = item.history || [];
      item.history.unshift(stamp('进入待补证', '照片缺失，超过一天未补充则持续计逾期'));
      changed = true;
    }
    if (item.status !== INCIDENT_DONE_STATUS && !item.evidenceDueAt && item.discoveredAt) {
      item.evidenceDueAt = new Date(Date.parse(item.discoveredAt) + EVIDENCE_WINDOW_MS).toISOString();
      changed = true;
    }
    item.queueSort = incidentQueueSort(item);
  }
  return changed;
}

app.get('/api/config', (req, res) => {
  res.json(config);
});

app.get('/api/db', async (req, res) => {
  const db = await readDb();
  const changed = refreshIncidents(db);
  if (changed) await writeDb(db);
  for (const key of Object.keys(db)) {
    if (!Array.isArray(db[key])) continue;
    if (key === 'incidents') {
      db[key].sort((a, b) => (a.queueSort ?? FAR_FUTURE) - (b.queueSort ?? FAR_FUTURE) || sortNewest(a, b));
    } else {
      db[key].sort(sortNewest);
    }
  }
  res.json(db);
});

app.post('/api/:collection', async (req, res) => {
  const db = await readDb();
  const { collection } = req.params;
  // 干扰处置统一走 /api/incidents/report，保证"同样点沿用原记录、累加次数"
  if (collection === 'incidents') return res.status(405).json({ error: '请使用 /api/incidents/report 登记游客干扰' });
  if (!Array.isArray(db[collection])) return res.status(404).json({ error: 'unknown collection' });
  const now = new Date().toISOString();
  const item = {
    id: newId(collection),
    ...req.body,
    createdAt: now,
    updatedAt: now,
    history: [stamp('创建', req.body.note || req.body.memo || '')]
  };
  db[collection].push(item);
  await writeDb(db);
  res.status(201).json(item);
});

// 游客干扰上报：同一样点有未结案记录时只累加次数，沿用原记录
app.post('/api/incidents/report', async (req, res) => {
  const db = await readDb();
  const { siteId, staff, photoUrl = '', note = '' } = req.body || {};
  const discoveredAt = toIso(req.body.discoveredAt);
  if (!siteId) return res.status(400).json({ error: '请选择样点' });
  if (!staff || !String(staff).trim()) return res.status(400).json({ error: '请登记现场人员' });
  if (!discoveredAt) return res.status(400).json({ error: '发现时刻格式不正确' });
  const site = (db.sites || []).find((entry) => entry.id === siteId);
  if (!site) return res.status(404).json({ error: '样点不存在' });

  refreshIncidents(db);
  const now = new Date().toISOString();
  const existing = (db.incidents || []).find(
    (entry) => entry.siteId === siteId && INCIDENT_OPEN_STATUSES.includes(entry.status)
  );

  if (existing) {
    existing.reportCount += 1;
    existing.reports = existing.reports || [];
    existing.reports.push({ at: discoveredAt, staff: staff.trim(), note, photoUrl });
    existing.lastReportAt = now;
    let note2 = note;
    if (photoUrl && !existing.photoUrl) {
      existing.photoUrl = photoUrl;
      existing.photoSuppliedAt = now;
      existing.photoSuppliedBy = staff.trim();
      note2 = `${note} 已随本次上报补照片`.trim();
    }
    existing.status = nextStage(existing);
    existing.updatedAt = now;
    existing.history.unshift(stamp('再次上报', `第${existing.reportCount}次，现场人员：${staff.trim()}${note ? `；${note}` : ''}`));
    // 处置未结束，样点保持重点保护
    if (site.protectedStatus !== '重点保护') {
      site.protectedStatus = '重点保护';
      site.updatedAt = now;
      site.history = site.history || [];
      site.history.unshift(stamp('游客干扰上报', '处置未结束，保持重点保护'));
    }
    await writeDb(db);
    existing.queueSort = incidentQueueSort(existing);
    return res.json({ ...existing, merged: true });
  }

  const item = {
    id: newId('incidents'),
    siteId,
    discoveredAt,
    staff: staff.trim(),
    photoUrl,
    note,
    reports: [{ at: discoveredAt, staff: staff.trim(), note, photoUrl }],
    reportCount: 1,
    lastReportAt: now,
    status: photoUrl ? '处置中' : '待补证',
    priorStatus: site.protectedStatus || '常规观察',
    evidenceDueAt: new Date(Date.parse(discoveredAt) + EVIDENCE_WINDOW_MS).toISOString(),
    photoSuppliedAt: photoUrl ? now : '',
    photoSuppliedBy: photoUrl ? staff.trim() : '',
    handler: '',
    handleNote: '',
    handledAt: '',
    confirmer: '',
    confirmedAt: '',
    createdAt: now,
    updatedAt: now,
    history: [stamp('登记游客干扰', `${discoveredAt} 现场人员：${staff.trim()}`)]
  };
  db.incidents = db.incidents || [];
  db.incidents.push(item);

  // 处置期间样点锁定重点保护，原状态记在 priorStatus，结案时恢复
  if (site.protectedStatus !== '重点保护') {
    site.protectedStatus = '重点保护';
    site.updatedAt = now;
    site.history = site.history || [];
    site.history.unshift(stamp('游客干扰上报', `原状态「${item.priorStatus}」已记录，处置期间重点保护`));
  }
  await writeDb(db);
  item.queueSort = incidentQueueSort(item);
  res.status(201).json({ ...item, merged: false });
});

app.patch('/api/:collection/:id', async (req, res) => {
  const db = await readDb();
  const { collection, id } = req.params;
  if (!Array.isArray(db[collection])) return res.status(404).json({ error: 'unknown collection' });
  const item = db[collection].find((entry) => entry.id === id);
  if (!item) return res.status(404).json({ error: 'not found' });
  const historyAction = req.body.historyAction;
  delete req.body.historyAction;
  Object.assign(item, req.body, { updatedAt: new Date().toISOString() });
  item.history = item.history || [];
  if (historyAction || req.body.note || req.body.memo || req.body.status) {
    item.history.unshift(stamp(historyAction || req.body.status || '更新', req.body.note || req.body.memo || ''));
  }
  await writeDb(db);
  res.json(item);
});

app.delete('/api/:collection/:id', async (req, res) => {
  const db = await readDb();
  const { collection, id } = req.params;
  if (!Array.isArray(db[collection])) return res.status(404).json({ error: 'unknown collection' });
  const before = db[collection].length;
  db[collection] = db[collection].filter((entry) => entry.id !== id);
  if (db[collection].length === before) return res.status(404).json({ error: 'not found' });
  await writeDb(db);
  res.status(204).end();
});

app.post('/api/action/:actionId/:id', async (req, res) => {
  const db = await readDb();
  refreshIncidents(db);
  const action = config.actions.find((entry) => entry.id === req.params.actionId);
  if (!action) return res.status(404).json({ error: 'unknown action' });
  const item = db[action.collection]?.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  // 动作表单输入（补照片、负责人、确认人等），仅接收 action 声明过的字段；guards 通过后才写入
  const inputs = req.body?.inputs || {};
  const normalized = {};
  for (const field of action.inputs || []) {
    const raw = inputs[field.name];
    if (raw === undefined || raw === null) {
      if (field.required) return res.status(400).json({ error: `请填写${field.label}` });
      continue;
    }
    normalized[field.name] = String(raw).trim();
    if (field.required && !normalized[field.name]) return res.status(400).json({ error: `请填写${field.label}` });
  }
  const result = runAction(db, action, item, normalized);
  if (result.error) return res.status(409).json({ error: result.error });
  await writeDb(db);
  if (action.collection === 'incidents') item.queueSort = incidentQueueSort(item);
  res.json(item);
});

function getValue(source, pathName) {
  return pathName.split('.').reduce((value, key) => value?.[key], source);
}

function setValue(target, pathName, value) {
  const keys = pathName.split('.');
  let cursor = target;
  while (keys.length > 1) {
    const key = keys.shift();
    cursor[key] = cursor[key] || {};
    cursor = cursor[key];
  }
  cursor[keys[0]] = value;
}

const RESOLVERS = {
  'incident:nextStage': ({ item }) => nextStage(item)
};

function findRelated(db, relation, item) {
  return db[relation.collection]?.find((entry) => entry.id === item[relation.localKey]);
}

function runAction(db, action, item, inputs = {}) {
  const related = action.relation ? findRelated(db, action.relation, item) : null;
  const context = { item, related, inputs };
  const levelRank = { '低': 1, '中': 2, '高': 3 };
  for (const guard of action.guards || []) {
    const left = getValue(context, guard.left);
    const right = guard.rightPath ? getValue(context, guard.rightPath) : guard.right;
    if (guard.op === 'missing' && left) continue;
    if (guard.op === 'missing' && !left) return { error: guard.message };
    if (guard.op === 'present' && left) return { error: guard.message };
    if (guard.op === 'present' && !left) continue;
    if (guard.op === 'eq' && left !== right) return { error: guard.message };
    if (guard.op === 'neq' && left === right) return { error: guard.message };
    if (guard.op === 'gte' && Number(left) < Number(right)) return { error: guard.message };
    if (guard.op === 'levelGte' && (levelRank[left] || 0) < (levelRank[right] || 0)) return { error: guard.message };
    if (guard.op === 'notIn' && guard.values.includes(left)) return { error: guard.message };
  }
  // 校验通过后才把表单输入写入记录
  for (const [name, value] of Object.entries(inputs)) item[name] = value;
  const stamped = new Set();
  const stampTarget = (target) => {
    if (!target || stamped.has(target)) return;
    stamped.add(target);
    target.updatedAt = new Date().toISOString();
    target.history = target.history || [];
    target.history.unshift(stamp(action.label, action.note || '状态流转'));
  };
  for (const patch of action.patches || []) {
    const target = patch.target === 'related' ? related : item;
    if (!target) continue;
    let next;
    if (patch.resolve) next = RESOLVERS[patch.resolve](context);
    else if (patch.valueNow) next = new Date().toISOString();
    else next = patch.valuePath ? getValue(context, patch.valuePath) : patch.value;
    setValue(target, patch.field, next);
    stampTarget(target);
  }
  for (const delta of action.deltas || []) {
    const target = delta.target === 'related' ? related : item;
    if (!target) continue;
    const sourceAmount = delta.amountPath ? Number(getValue(context, delta.amountPath)) : 1;
    const multiplier = delta.amount === undefined ? 1 : Number(delta.amount);
    const amount = sourceAmount * multiplier;
    const current = Number(getValue({ target }, `target.${delta.field}`) || 0);
    setValue(target, delta.field, current + amount);
    stampTarget(target);
  }
  return { item };
}

app.listen(PORT, () => {
  console.log(`${config.title} running at http://localhost:${PORT}`);
});
