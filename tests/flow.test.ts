import test from 'node:test';
import assert from 'node:assert/strict';
import { createReview, classifier } from '../server/pipeline.js';
import type { InputDocument } from '../server/pipeline.js';
import { DemoCertificateGenerator, DemoPdfTemplate } from '../server/certificates.js';
import { draftReadiness } from '../shared/validation.js';
import { SessionStore } from '../server/sessions.js';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { LocalOCRProvider, parsePrescriberCandidates, parseTsv, toObservations } from '../server/local-ocr.js';
const noOcr = { extract: async () => [] };
const documents: InputDocument[] = [
  { id: 'patient-1', kind: 'patient', name: 'patient.png', mimeType: 'image/png', bytes: Buffer.from('patient') },
  { id: 'med-1', kind: 'medications', name: 'mediciner.png', mimeType: 'image/png', bytes: Buffer.from('medications') },
  { id: 'doctor-1', kind: 'prescriber', name: 'recept.png', mimeType: 'image/png', bytes: Buffer.from('prescriber') },
];

test('flera syntetiska underlag går via extraktion, normalisering och klassning till två separata PDF-utkast', async () => {
  const review = await createReview(documents, undefined, noOcr);
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
  const review = await createReview(documents, undefined, noOcr);
  const edited = { ...review.medications[2], productName: 'Okänt preparat' };
  edited.classification = classifier.classify(edited);
  assert.equal(edited.classification.status, 'unknown');
  assert.equal(new DemoCertificateGenerator().generate({ ...review, medications: [edited] }).length, 0);
});

test('sessionen tas bort vid avslut och timeout', async () => {
  let now = 1000;
  const store = new SessionStore(200, () => now);
  const review = await createReview(documents, undefined, noOcr);
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
  }] }, noOcr);
  const medication = review.medications[0];
  assert.equal(medication.confidence.productName, 0.93);
  assert.equal(review.fieldEvidence[`medications.${medication.id}.productName`].documentId, 'med-1');
  assert.equal(review.fieldEvidence[`medications.${medication.id}.productName`].bounds?.x, 10);
  assert.equal(medication.classification.status, 'unknown');
});

const ocrArgs = process.env.OCR_TESSDATA_DIR ? ['--tessdata-dir', process.env.OCR_TESSDATA_DIR] : [];
const availableLanguages = spawnSync('tesseract', [...ocrArgs, '--list-langs'], { encoding: 'utf8' }).stdout;
test('lokal OCR läser syntetiskt kundklipp men fyller inte ofullständig identitet', { skip: !availableLanguages?.includes('swe') || !availableLanguages?.includes('eng') }, async () => {
  const patient = { ...documents[0], bytes: readFileSync('tests/fixtures/kund-demo.png') };
  const review = await createReview([patient, documents[1]], undefined, new LocalOCRProvider());
  assert.ok(review.ocrObservations.length > 0);
  assert.equal(review.patient.personalIdentityNumber, '');
  assert.equal(review.patient.passportNumber, '');
});

test('lokal OCR läser fiktivt förskrivarformulär som valbart förslag', { skip: !availableLanguages?.includes('swe') || !availableLanguages?.includes('eng') }, async () => {
  const prescriber = { ...documents[2], bytes: readFileSync('tests/fixtures/forskrivare-demo.png') };
  const review = await createReview([documents[1], prescriber], undefined, new LocalOCRProvider());
  const candidate = review.prescriberCandidates[0];
  assert.equal(candidate.prescriber.firstName, 'Klara');
  assert.equal(candidate.prescriber.lastName, 'Testsson');
  assert.equal(candidate.prescriber.address, 'Testvägen 1, 12345 Teststad');
  assert.equal(candidate.workplacePhone, '0101234567');
  assert.equal(candidate.prescriber.phone, '');
  assert.ok(review.medications.every(m => m.prescriberCandidateId === null && m.prescriber.firstName === ''));
});

test('förskrivarvärden kopplas till sin bild utan att arbetsplatstelefon blir förskrivartelefon', () => {
  const doc = documents[2];
  const lines = [
    ['Förnamn', 20, 100], ['Test', 25, 120], ['Efternamn', 210, 100], ['Läkare', 220, 120],
    ['Namn', 800, 100], ['Testmottagningen', 810, 120], ['Adress', 1100, 100], ['Testvägen 1', 1110, 120],
    ['Postnummer', 800, 150], ['12345', 810, 170], ['Postort', 950, 150], ['Teststad', 960, 170],
    ['Telefon arbetsplats', 800, 200], ['0101234567', 810, 220], ['Telefon förskrivare', 1000, 200],
  ];
  const tsv = ['level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
    ...lines.map(([value, x, y], i) => `5\t1\t${i + 1}\t1\t1\t1\t${x}\t${y}\t80\t12\t95\t${value}`)].join('\n');
  const candidate = parsePrescriberCandidates(parseTsv(tsv, doc))[0];
  assert.equal(candidate.prescriber.firstName, 'Test');
  assert.equal(candidate.prescriber.lastName, 'Läkare');
  assert.equal(candidate.prescriber.address, 'Testvägen 1, 12345 Teststad');
  assert.equal(candidate.workplacePhone, '0101234567');
  assert.equal(candidate.prescriber.phone, '');
  assert.equal(candidate.evidence.firstName?.documentId, doc.id);
  assert.equal(toObservations(parseTsv(tsv, doc)).length, 0);
});
