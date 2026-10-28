const test = require('node:test');
const assert = require('node:assert/strict');
const { inferExpectedPriority, getPriorityAssessment } = require('./priority-matrix');

test('priority matrix classifies clear P1-P4 examples', () => {
  const examples = [
    ['التماس كهربائي في غرفة الكهرباء', 'P1'],
    ['انقطاع جزئي للكهرباء في الدور الثاني', 'P2'],
    ['تسرب إنشائي في أحد الفصول', 'P3'],
    ['تنظيف أجهزة التكييف', 'P4']
  ];
  for (const [description, priority] of examples) {
    assert.equal(inferExpectedPriority({ description })?.priority, priority, description);
  }
});

test('priority matrix does not infer a class from vague descriptions', () => {
  assert.equal(inferExpectedPriority({ description: 'طلب صيانة عاجل' }), null);
  assert.equal(inferExpectedPriority({ description: '' }), null);
});

test('assessment reports over-prioritization by default but ignores under-prioritization', () => {
  const assessment = getPriorityAssessment({
    priority: 'حرج',
    description: 'تنظيف أجهزة التكييف'
  });
  assert.equal(assessment.expectedPriority, 'P4');
  assert.equal(assessment.alertDirection, 'over');
  assert.equal(assessment.alertLabel, 'أولوية أعلى من الموصى بها');
  assert.equal(assessment.resolutionHours, 48);
  assert.match(assessment.reason, /صيانة خدمية بسيطة/);
  assert.equal(getPriorityAssessment({ priority: 'منخفض', description: 'تنظيف أجهزة التكييف' }), null);
  assert.equal(getPriorityAssessment({ priority: 'حرج', description: 'طلب صيانة عاجل' }), null);

  const underPriorityTicket = { priority: 'متوسط', description: 'التماس كهربائي في غرفة الكهرباء' };
  assert.equal(getPriorityAssessment(underPriorityTicket), null);
  const underPriorityAlert = getPriorityAssessment(underPriorityTicket, { priorityUnderAlertEnabled: true });
  assert.equal(underPriorityAlert.expectedPriority, 'P1');
  assert.equal(underPriorityAlert.alertDirection, 'under');
  assert.equal(underPriorityAlert.alertLabel, 'أولوية أقل من الموصى بها');
});
