import test from 'node:test';
import assert from 'node:assert/strict';
import { createReview, classifier } from '../server/pipeline.js';
import { DemoCertificateGenerator, DemoPdfTemplate } from '../server/certificates.js';
import { draftReadiness } from '../shared/validation.js';
import { SessionStore } from '../server/sessions.js';

test('syntetisk bild går via extraktion, normalisering och klassning till två separata PDF-utkast', async () => {
  const review = await createReview(Buffer.from('fake-image'), 'image/png');
  assert.equal(review.medications.length, 4);
  assert.equal(review.medications.filter(m => m.classification.status === 'required').length, 2);
  assert.equal(review.medications.filter(m => m.classification.status === 'not-required').length, 2);
  assert.equal(review.medications[0].confidence.activeSubstance, 0);
  review.patient.name = 'Testperson Testsson';
  review.patient.passportNumber = 'TEST-ID';
  review.prescriber.firstName = 'Test'; review.prescriber.lastName = 'Förskrivare';
  review.pharmacy.name = 'Demoapotek';
  review.travel.destination = 'Fiktiv destination'; review.travel.departureDate = '2026-10-01';
  review.travel.returnDate = '2026-10-10'; review.travel.durationDays = '10';
  for (const m of review.medications.filter(m => m.classification.status === 'required')) {
    m.activeSubstance = 'Fiktiv substans'; m.totalActiveSubstance = '50 mg'; m.treatmentDays = '10';
  }
  assert.deepEqual(draftReadiness(review), []);
  const certificates = new DemoCertificateGenerator().generate(review);
  assert.equal(certificates.length, 2);
  assert.notEqual(certificates[0].id, certificates[1].id);
  const bytes = await Promise.all(certificates.map(c => new DemoPdfTemplate().render(c)));
  assert.ok(bytes.every(pdf => Buffer.from(pdf).subarray(0, 5).toString() === '%PDF-'));
  assert.ok(bytes.every(pdf => Buffer.from(pdf).length > 100_000));
});

test('okänt eller rättat preparat får aldrig en gissad klassning', async () => {
  const review = await createReview(Buffer.from('fake-image'), 'image/png');
  const edited = { ...review.medications[2], productName: 'Okänt preparat' };
  edited.classification = classifier.classify(edited);
  assert.equal(edited.classification.status, 'unknown');
  assert.equal(new DemoCertificateGenerator().generate({ ...review, medications: [edited] }).length, 0);
});

test('sessionen tas bort vid avslut och timeout', async () => {
  let now = 1000;
  const store = new SessionStore(200, () => now);
  const review = await createReview(Buffer.from('fake-image'), 'image/png');
  const first = store.create(Buffer.from('image'), 'image/png', review);
  assert.ok(store.get(first.id));
  assert.equal(store.delete(first.id), true);
  assert.equal(store.get(first.id), undefined);
  const second = store.create(Buffer.from('image'), 'image/png', review);
  now += 201;
  store.cleanup();
  assert.equal(store.get(second.id), undefined);
  assert.equal(store.size, 0);
});
