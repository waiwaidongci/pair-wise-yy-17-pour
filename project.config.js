module.exports = {
  port: 3912,
  title: '钟乳石洞穴微环境巡测',
  lede: '围绕洞穴、分区、样点和巡测路线记录微环境数据；游客触碰、越线登记为干扰处置记录，补证、现场说明与环境恢复双人确认，换班后照单接手。',
  tones: {
    '常规观察': 'ok',
    '正常': 'ok',
    '已复查': 'ok',
    '已恢复': 'ok',
    '重点保护': 'warn',
    '处置中': 'warn',
    '待确认': 'warn',
    '异常待复查': 'bad',
    '暂停开放': 'bad',
    '待补证': 'bad'
  },
  collections: {
    sites: { label: '样点档案' },
    surveys: { label: '巡测记录' },
    incidents: { label: '干扰处置' }
  },
  stats: [
    { label: '样点', collection: 'sites' },
    { label: '重点保护', collection: 'sites', filter: { field: 'protectedStatus', value: '重点保护' } },
    { label: '暂停开放', collection: 'sites', filter: { field: 'protectedStatus', value: '暂停开放' } },
    { label: '巡测记录', collection: 'surveys' },
    { label: '待补证干扰', collection: 'incidents', filter: { field: 'status', value: '待补证' } },
    { label: '待确认恢复', collection: 'incidents', filter: { field: 'status', value: '待确认' } }
  ],
  views: [
    {
      id: 'dashboard',
      label: '处置看板',
      type: 'dashboard',
      focusTitle: '干扰处置队列（按补证逾期 / 等待确认时间排列）',
      focus: { collection: 'incidents', field: 'status', values: ['待补证', '待确认', '处置中'], limit: 12 }
    },
    {
      id: 'incidents',
      label: '干扰处置',
      collection: 'incidents',
      formTitle: '登记游客干扰',
      listTitle: '处置记录队列',
      submitLabel: '登记干扰',
      searchPlaceholder: '搜索样点、现场人员、情况说明',
      searchFields: ['staff', 'note', 'handler', 'confirmer'],
      statusField: 'status',
      statusOptions: ['处置中', '待补证', '待确认', '已恢复'],
      titleFields: ['discoveredAt'],
      relation: { collection: 'sites', localKey: 'siteId', labelFields: ['cave', 'zone', 'pointCode'] },
      summaryFields: ['note'],
      cardType: 'incident',
      detailFields: [
        { label: '上报次数', name: 'reportCount' },
        { label: '现场人员', name: 'staff' },
        { label: '照片', name: 'photoUrl', type: 'photo' },
        { label: '补证期限', name: 'evidenceDueAt', type: 'datetime' },
        { label: '负责人', name: 'handler' },
        { label: '确认人', name: 'confirmer' }
      ],
      defaults: {},
      fields: [
        { label: '样点', name: 'siteId', type: 'relation', collection: 'sites', labelFields: ['cave', 'zone', 'pointCode'], required: true, wide: true },
        { label: '发现时刻', name: 'discoveredAt', type: 'datetime-local', required: true },
        { label: '现场人员', name: 'staff', required: true, placeholder: '当时在场的巡测员 / 值班员' },
        { label: '现场照片链接', name: 'photoUrl', placeholder: '照片缺失将进入待补证' },
        { label: '现场情况（触碰 / 越线）', name: 'note', type: 'textarea', wide: true, required: true }
      ]
    },
    {
      id: 'sites',
      label: '样点档案',
      collection: 'sites',
      formTitle: '新增样点',
      listTitle: '样点列表',
      submitLabel: '保存样点',
      searchPlaceholder: '搜索洞穴、分区、样点、路线',
      searchFields: ['cave', 'zone', 'pointCode', 'route'],
      statusField: 'protectedStatus',
      statusOptions: ['常规观察', '重点保护', '暂停开放'],
      titleFields: ['pointCode', 'zone'],
      summaryFields: ['note'],
      detailFields: [
        { label: '洞穴', name: 'cave' },
        { label: '巡测路线', name: 'route' },
        { label: '敏感等级', name: 'sensitivity' }
      ],
      fields: [
        { label: '洞穴', name: 'cave', required: true },
        { label: '分区', name: 'zone', required: true },
        { label: '样点编号', name: 'pointCode', required: true },
        { label: '巡测路线', name: 'route', required: true },
        { label: '敏感等级', name: 'sensitivity', type: 'select', options: ['低', '中', '高'] },
        { label: '保护状态', name: 'protectedStatus', type: 'select', options: ['常规观察', '重点保护', '暂停开放'] },
        { label: '基准温度', name: 'baselineTemp', type: 'number', required: true },
        { label: '基准湿度', name: 'baselineHumidity', type: 'number', required: true },
        { label: '基准CO2', name: 'baselineCo2', type: 'number', required: true },
        { label: '备注', name: 'note', type: 'textarea', wide: true }
      ]
    },
    {
      id: 'surveys',
      label: '巡测记录',
      collection: 'surveys',
      formTitle: '登记巡测',
      listTitle: '巡测历史',
      submitLabel: '保存巡测',
      searchPlaceholder: '搜索人员、干扰痕迹、照片',
      searchFields: ['surveyor', 'disturbance', 'photoUrl'],
      statusField: 'status',
      statusOptions: ['正常', '异常待复查', '已复查'],
      titleFields: ['surveyor', 'date'],
      relation: { collection: 'sites', localKey: 'siteId', labelFields: ['cave', 'zone', 'pointCode'] },
      summaryFields: ['disturbance', 'reviewNote'],
      detailFields: [
        { label: '温度', name: 'temperature' },
        { label: '湿度', name: 'humidity' },
        { label: 'CO2', name: 'co2' }
      ],
      defaults: { status: '正常', reviewNote: '' },
      fields: [
        { label: '样点', name: 'siteId', type: 'relation', collection: 'sites', labelFields: ['cave', 'zone', 'pointCode'], required: true, wide: true },
        { label: '巡测人员', name: 'surveyor', required: true },
        { label: '日期', name: 'date', type: 'date', required: true },
        { label: '温度', name: 'temperature', type: 'number', required: true },
        { label: '湿度', name: 'humidity', type: 'number', required: true },
        { label: 'CO2', name: 'co2', type: 'number', required: true },
        { label: '滴水频率', name: 'dripRate', type: 'number', required: true },
        { label: '照片链接', name: 'photoUrl' },
        { label: '游客干扰痕迹', name: 'disturbance', type: 'textarea', wide: true }
      ]
    }
  ],
  actions: [
    { id: 'site-normal', label: '常规观察', collection: 'sites', patches: [{ field: 'protectedStatus', value: '常规观察' }] },
    { id: 'site-focus', label: '重点保护', collection: 'sites', patches: [{ field: 'protectedStatus', value: '重点保护' }] },
    { id: 'site-close', label: '暂停开放', collection: 'sites', danger: true, patches: [{ field: 'protectedStatus', value: '暂停开放' }] },
    {
      id: 'survey-alert',
      label: '标记异常',
      collection: 'surveys',
      relation: { collection: 'sites', localKey: 'siteId' },
      patches: [
        { field: 'status', value: '异常待复查' },
        { target: 'related', field: 'protectedStatus', value: '重点保护' }
      ]
    },
    { id: 'survey-review', label: '完成复查', collection: 'surveys', patches: [{ field: 'status', value: '已复查' }, { field: 'reviewNote', value: '异常已复核' }] },
    {
      // 补证：照片缺失 / 超期后补照片，记录回到处置队列
      id: 'incident-photo',
      label: '补充照片',
      collection: 'incidents',
      showInStatuses: ['待补证'],
      inputs: [
        { name: 'photoUrl', label: '照片链接', required: true, placeholder: '补证照片链接' },
        { name: 'photoSuppliedBy', label: '补证人', required: true, placeholder: '补证巡测员' }
      ],
      guards: [
        { left: 'item.status', op: 'eq', right: '待补证', message: '只有待补证记录需要补充照片' },
        { left: 'item.photoUrl', op: 'present', message: '照片已齐，无需补证' }
      ],
      patches: [
        { field: 'photoSuppliedAt', valueNow: true },
        { field: 'status', resolve: 'incident:nextStage' }
      ]
    },
    {
      // 值班负责人补现场说明：只能推进到"待确认"，不能自行结束
      id: 'incident-handle',
      label: '负责人补充现场说明',
      collection: 'incidents',
      showInStatuses: ['处置中'],
      inputs: [
        { name: 'handler', label: '值班负责人', required: true, placeholder: '填写本人姓名' },
        { name: 'handleNote', label: '现场说明', type: 'textarea', required: true, placeholder: '触碰 / 越线经过、处置措施、环境现状' }
      ],
      guards: [
        { left: 'item.status', op: 'eq', right: '处置中', message: '照片补齐并处于处置中，才能补充现场说明' },
        { left: 'item.photoUrl', op: 'missing', message: '照片未齐，请先补证' }
      ],
      patches: [
        { field: 'handledAt', valueNow: true },
        { field: 'status', value: '待确认' }
      ],
      note: '现场说明已补，等待另一位巡测员确认环境恢复'
    },
    {
      // 环境恢复双人确认：确认人必须不是负责人；结案后样点恢复原状态（原暂停开放的仍不开）
      id: 'incident-confirm',
      label: '确认环境恢复',
      collection: 'incidents',
      relation: { collection: 'sites', localKey: 'siteId' },
      showInStatuses: ['待确认'],
      inputs: [
        { name: 'confirmer', label: '确认巡测员', required: true, placeholder: '须与值班负责人不同' }
      ],
      guards: [
        { left: 'item.status', op: 'eq', right: '待确认', message: '只有待确认记录可以做恢复确认' },
        { left: 'item.handler', op: 'missing', message: '负责人尚未补充现场说明' },
        { left: 'inputs.confirmer', op: 'missing', message: '请填写确认巡测员' },
        { left: 'inputs.confirmer', op: 'neq', rightPath: 'item.handler', message: '确认人必须是另一位巡测员，不能由负责人自行结束' }
      ],
      patches: [
        { field: 'confirmedAt', valueNow: true },
        { field: 'status', value: '已恢复' },
        { target: 'related', field: 'protectedStatus', valuePath: 'item.priorStatus' }
      ],
      note: '双人确认完成，样点恢复干扰前状态（原暂停开放的仍暂停开放）'
    }
  ]
};
