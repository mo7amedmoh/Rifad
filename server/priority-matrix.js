const PRIORITIES = {
  P1: { label: 'حرج جدًا', resolutionHours: 2 },
  P2: { label: 'حرج', resolutionHours: 4 },
  P3: { label: 'متوسط عاجل', resolutionHours: 24 },
  P4: { label: 'روتيني', resolutionHours: 48 }
};

const RULES = [
  {
    priority: 'P1',
    reason: 'خطر مباشر على السلامة أو توقف كامل لخدمة أساسية',
    pattern: /التماس\s*(?:كهربائي)?|شرر كهربائي|تسرب.{0,10}غاز|انقطاع\s*(?:كلي|كامل)\s*(?:للكهرباء|الكهرباء|للمياه|المياه|للماء|الماء)|انقطاع كامل للتكييف|انحباس.{0,24}المصعد|احتجاز.{0,24}المصعد|المصعد.{0,24}(?:انحباس|احتجاز)|توقف كامل.{0,35}(?:الكهرباء|المياه|الماء|التكييف)/u
  },
  {
    priority: 'P2',
    reason: 'توقف جزئي لنظام رئيسي أو خلل في أنظمة مكافحة الحريق والطوارئ',
    pattern: /انقطاع جزئي.{0,35}(?:الكهرباء|كهرباء|المياه|الماء)|(?:الكهرباء|كهرباء|المياه|الماء).{0,35}انقطاع جزئي|مضخات.{0,18}الحريق|مضخة الحريق|انظمة الحريق|إنذار الحريق|انذار الحريق|نظام مكافحة الحريق|تعبئة الطفايات|الطفايات|طفايات الحريق|إنارة الطوارئ|انارة الطوارئ|مخارج الطوارئ/u
  },
  {
    priority: 'P3',
    reason: 'عطل يؤثر على البيئة التعليمية دون دلالة على توقف كامل أو خطر مباشر',
    pattern: /أعطال التكييف|اعطال التكييف|عطل.{0,24}التكييف|خلل.{0,24}التكييف|فيضان المياه|فيضان مياه|تسرب.{0,24}انشائي|تسرب مياه|تسريب مياه|تسربات مياه|توريد مياه|طلب مياه/u
  },
  {
    priority: 'P4',
    reason: 'صيانة خدمية بسيطة أو اعتيادية لا تشير إلى خطر مباشر',
    pattern: /نظافة.{0,24}التكييف|تنظيف.{0,24}التكييف|مفاتيح التشغيل|مفاتيح الإضاءة|مفاتيح الانارة|السباكة العادية|سباكة بسيطة|كوالين|مقابض|اقفال|دهانات|إصلاح الزجاج|اصلاح الزجاج|الأرضيات|الارضيات|النظافة العامة|أدوات النظافة/u
  }
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ar')
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[إأآ]/g, 'ا')
    .replace(/ى/g, 'ي');
}

function inferExpectedPriority(ticket) {
  const text = normalizeText([ticket.layer2, ticket.layer3, ticket.description].filter(Boolean).join(' '));
  if (!text) return null;
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return { priority: rule.priority, ...PRIORITIES[rule.priority], reason: rule.reason };
    }
  }
  return null;
}

function getPriorityGroup(value) {
  const normalized = normalizeText(value).trim();
  const code = normalized.match(/\bp([1-4])\b/i);
  if (code) return `P${code[1]}`;
  if (/حرج جدا|طارئ|critical 1|critical very/.test(normalized)) return 'P1';
  if (/^حرج$|عاجل|عالي|critical|high|priority 2/.test(normalized)) return 'P2';
  if (/متوسط|اعتيادي عاجل|medium|moderate|priority 3/.test(normalized)) return 'P3';
  if (/روتيني|تفاعلي|منخفض|routine|low|priority 4/.test(normalized)) return 'P4';
  return null;
}

function getPriorityDirection(currentPriority, expectedPriority) {
  const current = getPriorityGroup(currentPriority);
  if (!current || !expectedPriority || current === expectedPriority) return null;
  const currentRank = Number(current[1]);
  const expectedRank = Number(expectedPriority[1]);
  return currentRank < expectedRank ? 'over' : 'under';
}

function getPriorityAssessment(ticket, { priorityOverAlertEnabled = true, priorityUnderAlertEnabled = false } = {}) {
  const expected = inferExpectedPriority(ticket);
  const direction = expected && getPriorityDirection(ticket.priority, expected.priority);
  if (!direction || (direction === 'over' && !priorityOverAlertEnabled) || (direction === 'under' && !priorityUnderAlertEnabled)) return null;
  return {
    expectedPriority: expected.priority,
    expectedLabel: expected.label,
    resolutionHours: expected.resolutionHours,
    currentPriority: ticket.priority,
    alertDirection: direction,
    alertLabel: direction === 'over' ? 'أولوية أعلى من الموصى بها' : 'أولوية أقل من الموصى بها',
    reason: expected.reason
  };
}

module.exports = { PRIORITIES, inferExpectedPriority, getPriorityGroup, getPriorityDirection, getPriorityAssessment };
