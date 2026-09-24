import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const base = process.env.INTYG_API_BASE ?? 'http://127.0.0.1:3001/intyg/api/sessions';
const form = new FormData();
for (const [kind, file] of [['patient', 'kund-demo.png'], ['medications', 'lakemedelslista-demo.png'], ['prescriber', 'forskrivare-demo.png']]) {
  form.append('images', new Blob([readFileSync(`tests/fixtures/${file}`)], { type: 'image/png' }), file);
  form.append('kinds', kind);
}
let id;
try {
  const created = await fetch(base, { method: 'POST', body: form });
  if (!created.ok) throw Error(`create ${created.status}`);
  const session = await created.json(); id = session.id;
  const review = session.review;
  if (review.medications.length !== 4 || review.medications.filter(m => m.classification.status === 'required').length !== 2 || review.patient.passportNumber !== '') throw Error('analysis mismatch');
  review.patient.passportNumber = 'TEST-PASS'; review.pharmacy.name = 'Testapotek';
  review.travel.departureDate = '2026-10-01'; review.travel.returnDate = '2026-10-10'; review.travel.durationDays = '10';
  for (const medication of review.medications.filter(m => m.classification.status === 'required')) {
    medication.prescriber = { ...review.prescriberCandidates[0].prescriber };
    medication.prescriberCandidateId = review.prescriberCandidates[0].id;
    medication.dosageText = '1 tablett dagligen'; medication.certificateDosageText = medication.dosageText; medication.totalActiveSubstance = '50 mg'; medication.treatmentDays = '10';
  }
  const unknown = { ...review.medications[0], id: randomUUID(), originalText: '', productName: 'Concerta', strength: '18 mg', form: 'depottablett', activeSubstance: 'Metylfenidat', atcCode: '', manualClassification: null,
    classification: { status: 'required', reason: 'förfalskad', referenceVersion: 'x' } };
  review.medications.push(unknown);
  const save = async data => {
    const response = await fetch(`${base}/${id}/review`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!response.ok) throw Error(`review ${response.status}: ${await response.text()}`);
    return (await response.json()).review;
  };
  const withUnknown = await save(review);
  if (withUnknown.medications.at(-1).classification.status !== 'unknown') throw Error('forged classification accepted');
  const blocked = await fetch(`${base}/${id}/certificates/${withUnknown.medications[2].id}.pdf`);
  if (blocked.status !== 409) throw Error(`unknown did not block PDF ${blocked.status}`);
  const manual = withUnknown.medications.at(-1);
  manual.manualClassification = {
    status: 'required', sourceUrl: 'https://fass.se/health/product/20021101000311/pl',
    rationale: 'Exakt produktvariant kontrollerad mot FASS: narkotikaklass II.', reviewer: 'TEST',
    verifiedIdentity: JSON.stringify([manual.productName, manual.strength, manual.form, manual.activeSubstance].map(x => x.trim().toLocaleLowerCase('sv-SE').replace(/\s+/g, ' '))),
  };
  manual.prescriber = { ...review.prescriberCandidates[0].prescriber };
  manual.dosageText = '1 tablett dagligen'; manual.certificateDosageText = manual.dosageText;
  manual.totalActiveSubstance = '180 mg'; manual.treatmentDays = '10';
  const manuallyReviewed = await save(withUnknown);
  if (manuallyReviewed.medications.at(-1).classification.referenceVersion !== 'manual-review') throw Error('manual review not applied');
  const manualPdf = await fetch(`${base}/${id}/certificates/${manual.id}.pdf`);
  if (!manualPdf.ok || new TextDecoder().decode((await manualPdf.arrayBuffer()).slice(0, 5)) !== '%PDF-') throw Error(`manual pdf ${manualPdf.status}`);
  withUnknown.medications.pop();
  const clean = await save(withUnknown);
  let pdfs = 0;
  for (const medication of clean.medications.filter(m => m.classification.status === 'required')) {
    const response = await fetch(`${base}/${id}/certificates/${medication.id}.pdf`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!response.ok || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw Error(`pdf ${response.status}`);
    pdfs++;
  }
  console.log(JSON.stringify({ ocrRows: 4, unknownBlocked: true, manualReviewPdf: true, pdfs }));
} finally {
  if (id) {
    const response = await fetch(`${base}/${id}`, { method: 'DELETE' });
    console.log(`delete ${response.status}`);
  }
}
