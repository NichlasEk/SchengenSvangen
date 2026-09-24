import test from 'node:test';
import assert from 'node:assert/strict';
import { createReview, classifier } from '../server/pipeline.js';
import type { InputDocument } from '../server/pipeline.js';
import { DemoCertificateGenerator, DemoPdfTemplate } from '../server/certificates.js';
import { draftReadiness } from '../shared/validation.js';
import { SessionStore } from '../server/sessions.js';
const documents: InputDocument[] = [
  { id: 'patient-1', kind: 'patient', name: 'patient.png', mimeType: 'image/png', bytes: Buffer.from('patient') },
  { id: 'med-1', kind: 'medications', name: 'mediciner.png', mimeType: 'image/png', bytes: Buffer.from('medications') },
  { id: 'doctor-1', kind: 'prescriber', name: 'recept.png', mimeType: 'image/png', bytes: Buffer.from('prescriber') },
];

test('flera syntetiska underlag går via extraktion, normalisering och klassning till två separata PDF-utkast', async () => {
  const review = await createReview(documents);
  assert.equal(review.medications.length, 4);
  assert.equal(review.medications.filter(m => m.classification.status === 'required').length, 2);
  assert.equal(review.medications.filter(m => m.classification.status === 'not-required').length, 2);
  assert.equal(review.medications[0].confidence.activeSubstance, 0);
  assert.equal(review.fieldEvidence[`medications.${review.medications[0].id}.productName`].method, 'mock-fixture');
  assert.equal(review.fieldEvidence[`medications.${review.medications[0].id}.productName`].documentId, null);
  review.patient.name = 'Testperson Testsson';
  review.patient.passportNumber = 'TEST-ID';
  review.pharmacy.name = 'Demoapotek';
  review.travel.destination = 'Fiktiv destination'; review.travel.departureDate = '2026-10-01';
  review.travel.returnDate = '2026-10-10'; review.travel.durationDays = '10';
  for (const m of review.medications.filter(m => m.classification.status === 'required')) {
    m.activeSubstance = 'Fiktiv substans'; m.totalActiveSubstance = '50 mg'; m.treatmentDays = '10';
    m.prescriber.firstName = 'Test'; m.prescriber.lastName = `Förskrivare ${m.productName}`;
  }
  assert.deepEqual(draftReadiness(review), []);
  const certificates = new DemoCertificateGenerator().generate(review);
  assert.equal(certificates.length, 2);
  assert.notEqual(certificates[0].id, certificates[1].id);
  assert.notEqual(certificates[0].prescriber.lastName, certificates[1].prescriber.lastName);
  const bytes = await Promise.all(certificates.map(c => new DemoPdfTemplate().render(c)));
  assert.ok(bytes.every(pdf => Buffer.from(pdf).subarray(0, 5).toString() === '%PDF-'));
  assert.ok(bytes.every(pdf => Buffer.from(pdf).length > 100_000));
});

test('okänt eller rättat preparat får aldrig en gissad klassning', async () => {
  const review = await createReview(documents);
  const edited = { ...review.medications[2], productName: 'Okänt preparat' };
  edited.classification = classifier.classify(edited);
  assert.equal(edited.classification.status, 'unknown');
  assert.equal(new DemoCertificateGenerator().generate({ ...review, medications: [edited] }).length, 0);
});

test('sessionen tas bort vid avslut och timeout', async () => {
  let now = 1000;
  const store = new SessionStore(200, () => now);
  const review = await createReview(documents);
  const first = store.create(documents, review);
  assert.ok(store.get(first.id));
  assert.equal(store.view(store.get(first.id)!).documents.length, 3);
  assert.equal('bytes' in store.view(store.get(first.id)!).documents[0], false);
  assert.equal(store.delete(first.id), true);
  assert.equal(store.get(first.id), undefined);
  const second = store.create(documents, review);
  now += 201;
  store.cleanup();
  assert.equal(store.get(second.id), undefined);
  assert.equal(store.size, 0);
});

test('framtida OCR-adapter kan ange bild och position per tolkat fält', async () => {
  const text = 'Okänt testmedel | 1 mg | tablett | dagligen | 10 st';
  const review = await createReview(documents, { extract: async () => [{
    text, kind: 'medications', evidence: { documentId: 'med-1', method: 'ocr', rawText: text,
      confidence: 0.93, bounds: { x: 10, y: 20, width: 300, height: 30 } },
  }] });
  const medication = review.medications[0];
  assert.equal(medication.confidence.productName, 0.93);
  assert.equal(review.fieldEvidence[`medications.${medication.id}.productName`].documentId, 'med-1');
  assert.equal(review.fieldEvidence[`medications.${medication.id}.productName`].bounds?.x, 10);
  assert.equal(medication.classification.status, 'unknown');
});
