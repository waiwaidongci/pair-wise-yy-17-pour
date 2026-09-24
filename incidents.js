// 游客干扰处置记录 —— 纯领域逻辑（不依赖 express / 文件系统，便于测试）
//
// 处置流转：
//   登记(处置中) ──照片缺失且超过24h──▶ 待补证（样点维持重点保护）
//   照片齐 + 值班负责人补完现场说明 ──▶ 待确认
//   另一位巡测员确认环境恢复 ──▶ 已闭环
//   （同一样点未闭环前再次上报：沿用原记录，仅累加次数，截止时间不重算）

const DAY_MS = 24 * 60 * 60 * 1000;

const PHASE = {
  OPEN: '处置中',
  EVIDENCE_DUE: '待补证',
  AWAIT_CONFIRM: '待确认',
  CLOSED: '已闭环'
};

function nowIso(now) {
  return new Date(now).toISOString();
}

function stamp(action, note, at) {
  return { at: nowIso(at), action, note: note || '' };
}

// 接受字符串（逗号/空格/换行分隔）或数组，去空白、去重
function parsePhotoList(input) {
  if (Array.isArray(input)) {
    return input.map((value) => String(value).trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input.split(/[,，\s]+/).map((value) => value.trim()).filter(Boolean);
  }
  return [];
}

function dedupePhotos(existing, incoming) {
  const known = new Set(existing.map((photo) => photo.url));
  return incoming.filter((url) => !known.has(url));
}

function parseFoundAt(input, now) {
  if (!input) return nowIso(now);
  const time = new Date(input);
  return Number.isNaN(time.getTime()) ? nowIso(now) : time.toISOString();
}

// 干扰期间，常规样点升级重点保护；暂停开放的不降级
function enforceFocusProtection(site, at, note) {
  if (site && site.protectedStatus !== '暂停开放' && site.protectedStatus !== '重点保护') {
    site.protectedStatus = '重点保护';
    site.updatedAt = nowIso(at);
    site.history = site.history || [];
    site.history.unshift(stamp('重点保护', note || '游客干扰处置期间升级保护', at));
    return true;
  }
  return false;
}

function findOpenIncident(db, siteId) {
  return (db.incidents || []).find((item) => item.siteId === siteId && !item.confirmedAt);
}

// 登记发现；同一样点存在未闭环记录时，沿用原记录并累加次数
function createIncident(db, body, now) {
  const site = db.sites?.find((entry) => entry.id === body.siteId);
  if (!site) return { error: '样点不存在，请先在样点档案中建档' };

  const responder = String(body.responder || '').trim();
  if (!responder) return { error: '现场人员不能为空' };

  const existing = findOpenIncident(db, body.siteId);
  if (existing) return reportAgain(db, existing, body, now);

  const atIso = nowIso(now);
  const photos = dedupePhotos([], parsePhotoList(body.photos)).map((url) => ({
    url,
    addedAt: atIso,
    addedBy: responder
  }));
  const description = String(body.description || '').trim();
  const item = {
    id: `incident-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    siteId: body.siteId,
    foundAt: parseFoundAt(body.foundAt, now),
    firstResponder: responder,
    responders: [{ who: responder, at: atIso, note: description }],
    reportCount: 1,
    lastReportedAt: atIso,
    description,
    photos,
    requiredPhotos: 1,
    dispositionNote: '',
    noteLeader: null,
    notedAt: null,
    confirmer: null,
    confirmedAt: null,
    confirmNote: '',
    priorSiteStatus: site.protectedStatus || '常规观察',
    createdAt: atIso,
    updatedAt: atIso,
    history: [stamp('登记干扰', `发现时刻已登记 · 现场人员：${responder} · 第1次上报`, now)]
  };
  db.incidents = db.incidents || [];
  db.incidents.push(item);
  enforceFocusProtection(site, now, '游客干扰登记，处置期间升级重点保护');
  return { item, reused: false };
}

// 再次上报：沿用原记录、累加次数；发现时刻/补证截止时间保持原值
function reportAgain(db, item, body, now) {
  if (item.confirmedAt) return { error: '该记录已闭环，不能再上报' };
  const responder = String(body.responder || '').trim();
  if (!responder) return { error: '现场人员不能为空' };

  const atIso = nowIso(now);
  item.reportCount += 1;
  item.lastReportedAt = atIso;
  item.responders = item.responders || [];
  item.responders.push({ who: responder, at: atIso, note: String(body.description || '').trim() });
  if (body.description && String(body.description).trim()) item.description = String(body.description).trim();

  const fresh = dedupePhotos(item.photos || [], parsePhotoList(body.photos));
  for (const url of fresh) {
    item.photos.push({ url, addedAt: atIso, addedBy: responder });
  }
  item.updatedAt = atIso;
  item.history = item.history || [];
  item.history.unshift(stamp('再次上报', `第${item.reportCount}次上报 · 现场人员：${responder}${fresh.length ? ` · 新增照片${fresh.length}张` : ''}`, now));

  const site = db.sites?.find((entry) => entry.id === item.siteId);
  enforceFocusProtection(site, now, '同一样点干扰未处理完，继续重点保护');
  return { item, reused: true, addedPhotos: fresh.length };
}

// 补充照片（待补证记录补回即脱离待补证）
function addPhotos(db, item, body, now) {
  if (item.confirmedAt) return { error: '该记录已闭环，不能再补充照片' };
  const incoming = dedupePhotos(item.photos || [], parsePhotoList(body.photos));
  if (!incoming.length) return { error: '请填写至少一张新照片链接' };
  const who = String(body.who || '').trim() || '值班人员';
  const atIso = nowIso(now);
  for (const url of incoming) {
    item.photos.push({ url, addedAt: atIso, addedBy: who });
  }
  item.updatedAt = atIso;
  item.history = item.history || [];
  const wasOverdue = deriveIncident(item, Date.parse(atIso) - 1).evidenceState === '待补证';
  item.history.unshift(stamp('补充照片', `${who} 补充${incoming.length}张${wasOverdue ? ' · 补证完成，脱离待补证' : ''}`, now));
  return { item, added: incoming.length };
}

// 值班负责人补完现场说明（补完也不能自行结束）
function completeNote(db, item, body, now) {
  if (item.confirmedAt) return { error: '该记录已闭环，不能修改现场说明' };
  const leader = String(body.leader || '').trim();
  const note = String(body.note || '').trim();
  if (!leader) return { error: '请填写值班负责人姓名' };
  if (!note) return { error: '现场说明不能为空' };
  const atIso = nowIso(now);
  item.dispositionNote = note;
  item.noteLeader = leader;
  item.notedAt = atIso;
  item.updatedAt = atIso;
  item.history = item.history || [];
  item.history.unshift(stamp('补完现场说明', `值班负责人：${leader} · 须由另一位巡测员确认后闭环`, now));
  return { item };
}

// 另一位巡测员确认环境恢复；负责人不能自确认
function confirmRecovery(db, item, body, now) {
  if (item.confirmedAt) return { error: '该记录已闭环' };
  const derived = deriveIncident(item, Date.parse(nowIso(now)));
  if (!derived.photosComplete) return { error: '照片不齐，不能确认闭环' };
  if (!derived.noteReady) return { error: '值班负责人尚未补完现场说明，不能确认' };
  const confirmer = String(body.confirmer || '').trim();
  if (!confirmer) return { error: '请填写确认的巡测员' };
  if (confirmer === item.noteLeader) {
    return { error: '值班负责人不能自行结束，须由另一位巡测员确认环境恢复' };
  }
  const atIso = nowIso(now);
  item.confirmer = confirmer;
  item.confirmedAt = atIso;
  item.confirmNote = String(body.confirmNote || '').trim();
  item.updatedAt = atIso;
  item.history = item.history || [];
  item.history.unshift(stamp('确认环境恢复', `确认巡测员：${confirmer}`, now));

  // 恢复样点：原本暂停开放的确认后仍不开；其他样点恢复原来状态
  const site = db.sites?.find((entry) => entry.id === item.siteId);
  if (site) {
    if (item.priorSiteStatus === '暂停开放') {
      site.protectedStatus = '暂停开放';
      site.history = site.history || [];
      site.history.unshift(stamp('维持暂停开放', '干扰处置已闭环；该样点原本暂停开放，确认后仍不开放', now));
    } else {
      site.protectedStatus = item.priorSiteStatus || '常规观察';
      site.history = site.history || [];
      site.history.unshift(stamp(`恢复${site.protectedStatus}`, `干扰处置已闭环（${confirmer} 确认），恢复原来状态`, now));
    }
    site.updatedAt = atIso;
  }
  return { item };
}

// 派生现场状态（读取时计算，不落库）
function deriveIncident(item, nowMs) {
  const required = item.requiredPhotos || 1;
  const photoCount = (item.photos || []).length;
  const photosComplete = photoCount >= required;
  const foundMs = Date.parse(item.foundAt || item.createdAt) || nowMs;
  const deadlineMs = foundMs + DAY_MS;
  const overdueMs = nowMs > deadlineMs ? nowMs - deadlineMs : 0;

  let evidenceState;
  if (photosComplete) evidenceState = '齐全';
  else if (nowMs > deadlineMs) evidenceState = PHASE.EVIDENCE_DUE;
  else evidenceState = '待补充';

  const noteReady = !!(item.dispositionNote && item.dispositionNote.trim() && item.noteLeader);
  const closed = !!item.confirmedAt;

  let phase;
  if (closed) phase = PHASE.CLOSED;
  else if (evidenceState === PHASE.EVIDENCE_DUE) phase = PHASE.EVIDENCE_DUE;
  else if (photosComplete && noteReady) phase = PHASE.AWAIT_CONFIRM;
  else phase = PHASE.OPEN;

  const lastPhotoAt = photoCount ? item.photos[photoCount - 1].addedAt : null;
  const responderNames = [...new Set((item.responders || []).map((entry) => entry.who).filter(Boolean))];
  const latestDescription = [...(item.responders || [])].reverse().map((entry) => entry.note).find(Boolean) || item.description || '';

  let confirmState;
  if (closed) confirmState = '已确认';
  else if (photosComplete && noteReady) confirmState = PHASE.AWAIT_CONFIRM;
  else confirmState = '未就绪';

  return {
    ...item,
    phase,
    evidenceState,
    confirmState,
    photosComplete,
    noteReady,
    closed,
    deadline: new Date(deadlineMs).toISOString(),
    overdueMs,
    canConfirm: !closed && photosComplete && noteReady,
    lastPhotoAt,
    responderNames: responderNames.join('、'),
    latestDescription,
    photoText: (item.photos || []).map((photo) => photo.url).join(' '),
    evidenceProgress: `照片 ${photoCount}/${required} · ${evidenceState}`,
    noteProgress: noteReady ? `现场说明已补（负责人 ${item.noteLeader}）` : '现场说明未补',
    confirmProgress: closed
      ? `${item.confirmer} 已确认环境恢复`
      : photosComplete && noteReady
        ? '待另一位巡测员确认（负责人不可自确认）'
        : `确认未就绪（缺：${[
            photosComplete ? null : '照片',
            noteReady ? null : '现场说明'
          ].filter(Boolean).join('、') || '—'}）`
  };
}

// 列表排序：逾期最久的最先；其后是临期补证、等负责人说明、等确认；已闭环垫底
function sortIncidents(items, nowMs) {
  const rank = (entry) => {
    const d = deriveIncident(entry, nowMs);
    if (d.closed) return [9, Date.parse(d.confirmedAt)];
    if (d.evidenceState === PHASE.EVIDENCE_DUE) return [0, -d.overdueMs];
    if (!d.photosComplete) return [1, Date.parse(d.deadline)];
    if (!d.noteReady) return [2, Date.parse(d.lastPhotoAt || d.updatedAt)];
    return [3, Date.parse(d.notedAt || d.updatedAt)];
  };
  return [...items].sort((a, b) => {
    const [ra, ka] = rank(a);
    const [rb, kb] = rank(b);
    return ra - rb || ka - kb;
  });
}

module.exports = {
  DAY_MS,
  PHASE,
  parsePhotoList,
  parseFoundAt,
  createIncident,
  reportAgain,
  addPhotos,
  completeNote,
  confirmRecovery,
  deriveIncident,
  sortIncidents
};
