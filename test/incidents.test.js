const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DAY_MS,
  createIncident,
  addPhotos,
  completeNote,
  confirmRecovery,
  deriveIncident,
  sortIncidents
} = require('../incidents');

const T0 = Date.parse('2026-09-24T08:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function makeDb() {
  return {
    sites: [
      { id: 'site-a', cave: '北麓三号洞', zone: '滴水帘区', pointCode: 'D-07', protectedStatus: '常规观察', history: [] },
      { id: 'site-b', cave: '北麓三号洞', zone: '石笋厅', pointCode: 'S-02', protectedStatus: '暂停开放', history: [] }
    ],
    incidents: []
  };
}

test('登记：记录发现时刻、样点、现场人员和照片，常规样点升级重点保护', () => {
  const db = makeDb();
  const { item, reused } = createIncident(db, {
    siteId: 'site-a',
    foundAt: '2026-09-24T07:30:00.000Z',
    responder: '沈宁',
    description: '游客越过栏杆触碰钟乳石',
    photos: 'p1.jpg, p2.jpg'
  }, T0);

  assert.equal(reused, false);
  assert.equal(item.foundAt, '2026-09-24T07:30:00.000Z');
  assert.equal(item.firstResponder, '沈宁');
  assert.equal(item.reportCount, 1);
  assert.deepEqual(item.photos.map((p) => p.url), ['p1.jpg', 'p2.jpg']);
  assert.equal(item.priorSiteStatus, '常规观察');
  assert.equal(db.sites[0].protectedStatus, '重点保护');

  const d = deriveIncident(item, T0);
  assert.equal(d.phase, '处置中');
  assert.equal(d.evidenceState, '齐全');
  assert.equal(d.noteReady, false);
});

test('再次上报：同一样点未闭环时沿用原记录、累加次数，发现时刻不变', () => {
  const db = makeDb();
  const first = createIncident(db, { siteId: 'site-a', responder: '沈宁', photos: 'p1.jpg' }, T0).item;
  const again = createIncident(db, {
    siteId: 'site-a',
    responder: '李岚',
    description: '换班后复查，痕迹仍在',
    photos: 'p1.jpg p2.jpg'
  }, T0 + 2 * HOUR);

  assert.equal(again.reused, true);
  assert.equal(again.item.id, first.id);
  assert.equal(db.incidents.length, 1);
  assert.equal(first.reportCount, 2);
  assert.equal(first.foundAt, new Date(T0).toISOString());
  assert.deepEqual(first.responders.map((r) => r.who), ['沈宁', '李岚']);
  assert.deepEqual(first.photos.map((p) => p.url), ['p1.jpg', 'p2.jpg'], '重复照片不累加');
  assert.equal(first.description, '换班后复查，痕迹仍在');

  const other = createIncident(db, { siteId: 'site-b', responder: '王珂' }, T0 + 3 * HOUR);
  assert.equal(other.reused, false, '不同样点应新建记录');
  assert.equal(db.incidents.length, 2);
});

test('待补证：照片缺失超过一天进入待补证，补回照片后脱离', () => {
  const db = makeDb();
  const { item } = createIncident(db, { siteId: 'site-a', responder: '沈宁' }, T0);

  assert.equal(deriveIncident(item, T0 + 12 * HOUR).evidenceState, '待补充');
  const overdue = deriveIncident(item, T0 + DAY_MS + HOUR);
  assert.equal(overdue.evidenceState, '待补证');
  assert.equal(overdue.phase, '待补证');
  assert.equal(overdue.overdueMs, HOUR);
  assert.equal(db.sites[0].protectedStatus, '重点保护', '待补证期间样点保持重点保护');

  addPhotos(db, item, { photos: 'late.jpg', who: '沈宁' }, T0 + DAY_MS + 2 * HOUR);
  const after = deriveIncident(item, T0 + DAY_MS + 2 * HOUR);
  assert.equal(after.evidenceState, '齐全');
  assert.equal(after.phase, '处置中');
});

test('闭环：负责人补完说明不能自确认，须另一位巡测员确认', () => {
  const db = makeDb();
  const { item } = createIncident(db, { siteId: 'site-a', responder: '沈宁', photos: 'p1.jpg' }, T0);

  const early = confirmRecovery(db, item, { confirmer: '李岚' }, T0 + HOUR);
  assert.match(early.error, /现场说明/, '说明未补不能确认');

  completeNote(db, item, { leader: '王珂', note: '已清理触碰痕迹，环境监测恢复正常' }, T0 + 2 * HOUR);
  assert.equal(deriveIncident(item, T0 + 2 * HOUR).phase, '待确认');

  const selfConfirm = confirmRecovery(db, item, { confirmer: '王珂' }, T0 + 3 * HOUR);
  assert.match(selfConfirm.error, /另一位巡测员/);
  assert.equal(item.confirmedAt, null);

  const ok = confirmRecovery(db, item, { confirmer: '李岚', confirmNote: '现场复核无异常' }, T0 + 4 * HOUR);
  assert.equal(ok.error, undefined);
  assert.equal(deriveIncident(item, T0 + 4 * HOUR).phase, '已闭环');
  assert.equal(db.sites[0].protectedStatus, '常规观察', '常规样点确认后恢复原来状态');
});

test('闭环：原本暂停开放的样点确认后仍不开放', () => {
  const db = makeDb();
  const { item } = createIncident(db, { siteId: 'site-b', responder: '沈宁', photos: 'p1.jpg' }, T0);
  assert.equal(item.priorSiteStatus, '暂停开放');
  assert.equal(db.sites[1].protectedStatus, '暂停开放', '暂停开放不降级也不改动');

  completeNote(db, item, { leader: '王珂', note: '已处置' }, T0 + HOUR);
  confirmRecovery(db, item, { confirmer: '李岚' }, T0 + 2 * HOUR);
  assert.equal(db.sites[1].protectedStatus, '暂停开放', '确认后仍不开放');
});

test('闭环：照片不齐不能确认；闭环后禁止再上报、补照片、改说明', () => {
  const db = makeDb();
  const { item } = createIncident(db, { siteId: 'site-a', responder: '沈宁' }, T0);
  completeNote(db, item, { leader: '王珂', note: '说明已补' }, T0 + HOUR);

  const noPhotos = confirmRecovery(db, item, { confirmer: '李岚' }, T0 + 2 * HOUR);
  assert.match(noPhotos.error, /照片不齐/);

  addPhotos(db, item, { photos: 'p1.jpg', who: '沈宁' }, T0 + 3 * HOUR);
  confirmRecovery(db, item, { confirmer: '李岚' }, T0 + 4 * HOUR);
  assert.ok(item.confirmedAt);

  const after = createIncident(db, { siteId: 'site-a', responder: '沈宁' }, T0 + 5 * HOUR);
  assert.equal(after.reused, false, '闭环后同一样点应开新记录');
  assert.notEqual(after.item.id, item.id);
  assert.match(addPhotos(db, item, { photos: 'x.jpg' }, T0 + 5 * HOUR).error, /已闭环/);
  assert.match(completeNote(db, item, { leader: '王珂', note: '改' }, T0 + 5 * HOUR).error, /已闭环/);
  assert.match(confirmRecovery(db, item, { confirmer: '李岚' }, T0 + 5 * HOUR).error, /已闭环/);
});

test('排序：逾期最久的待补证在最前，其后临期补证、待说明、待确认，已闭环垫底', () => {
  const db = makeDb();
  const now = T0 + 10 * DAY_MS;

  const overdueLong = createIncident(db, { siteId: 'site-a', responder: '甲' }, T0).item; // 逾期最久
  const closed = createIncident(db, { siteId: 'site-b', responder: '乙', photos: 'p.jpg' }, T0 + DAY_MS).item;
  completeNote(db, closed, { leader: '王珂', note: '已处置' }, T0 + DAY_MS + HOUR);
  confirmRecovery(db, closed, { confirmer: '李岚' }, T0 + DAY_MS + 2 * HOUR);

  const db2 = makeDb();
  db2.sites.push({ id: 'site-c', protectedStatus: '常规观察', history: [] }, { id: 'site-d', protectedStatus: '常规观察', history: [] });
  const awaiting = createIncident(db2, { siteId: 'site-c', responder: '丙', photos: 'p.jpg' }, now - 3 * HOUR).item;
  completeNote(db2, awaiting, { leader: '王珂', note: '说明' }, now - HOUR);
  const fresh = createIncident(db2, { siteId: 'site-d', responder: '丁' }, now - 2 * HOUR).item; // 待补充未逾期

  const sorted = sortIncidents([closed, fresh, awaiting, overdueLong], now);
  assert.deepEqual(
    sorted.map((item) => item.id),
    [overdueLong.id, fresh.id, awaiting.id, closed.id]
  );
  const phases = sorted.map((item) => deriveIncident(item, now).phase);
  assert.deepEqual(phases, ['待补证', '处置中', '待确认', '已闭环']);
});
