import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotDrugReference, ReferenceClassificationService, validateSnapshot } from '../server/drug-reference.js';
import { blankMedication } from '../shared/model.js';
import { applyManualClassification, manualClassificationIssues, medicationIdentity } from '../shared/manual-classification.js';
import { readFileSync } from 'node:fs';

const snapshot = validateSnapshot({ schemaVersion: 1, source: 'vara', sourceVersion: 'test-2026-09-24',
  generatedAt: '2026-09-24T10:00:00Z', products: [
    { nplId: 'TEST-1', productName: 'Testpreparat', strength: '5 mg', form: 'tablett', activeSubstance: 'Testsubstans', atcCode: 'N02AB03', narcoticClass: 'II' },
    { nplId: 'TEST-2', productName: 'Testpreparat', strength: '10 mg', form: 'tablett', activeSubstance: 'Testsubstans', atcCode: 'N02AB03', narcoticClass: 'II' },
    { nplId: 'TEST-3', productName: 'Vanligt testmedel', strength: '20 mg', form: 'kapsel', activeSubstance: 'Testsubstans B', atcCode: 'A01AA01', narcoticClass: 'none' },
  ] });

test('exakt produktvariant klassas från versionerad referens', () => {
  const service = new ReferenceClassificationService(new SnapshotDrugReference(snapshot, () => Date.parse('2026-09-24T12:00:00Z')));
  const med = blankMedication('id'); med.productName = 'Testpreparat'; med.strength = '5 mg'; med.form = 'tablett';
  assert.equal(service.classify(med).status, 'required');
  assert.equal(service.match(med)?.atcCode, 'N02AB03');
  med.strength = '2 mg';
  assert.equal(service.classify(med).status, 'unknown');
  med.productName = 'Vanligt testmedel'; med.strength = '20 mg'; med.form = 'kapsel';
  assert.equal(service.classify(med).status, 'not-required');
});

test('för gammal referens ger alltid okänd klassning', () => {
  const service = new ReferenceClassificationService(new SnapshotDrugReference(snapshot, () => Date.parse('2026-09-27T12:00:00Z')));
  const med = blankMedication('id'); med.productName = 'Testpreparat'; med.strength = '5 mg'; med.form = 'tablett';
  assert.equal(service.info().status, 'stale');
  assert.equal(service.classify(med).status, 'unknown');
});

test('tvetydiga produktposter ger ingen automatisk klassning', () => {
  const duplicate = { ...snapshot, products: [...snapshot.products, { ...snapshot.products[0], nplId: 'OTHER' }] };
  const service = new ReferenceClassificationService(new SnapshotDrugReference(duplicate, () => Date.parse('2026-09-24T12:00:00Z')));
  const med = blankMedication('id'); med.productName = 'Testpreparat'; med.strength = '5 mg'; med.form = 'tablett';
  assert.equal(service.classify(med).status, 'unknown');
});

test('källkontrollerad pilotpost för Concerta gäller bara aktuell produktvariant och begränsad tid', () => {
  const pilot = validateSnapshot(JSON.parse(readFileSync('reference/demo-products.json', 'utf8')));
  const med = blankMedication('id'); med.productName = 'Concerta'; med.strength = '36 mg'; med.form = 'depottablett';
  const current = new ReferenceClassificationService(new SnapshotDrugReference(pilot, () => Date.parse('2026-09-24T12:00:00Z')));
  assert.equal(current.classify(med).status, 'required');
  assert.equal(current.match(med)?.activeSubstance, 'Metylfenidat');
  assert.equal(current.match(med)?.atcCode, 'N06BA04');
  assert.equal(current.classify(med).sourceUrls?.length, 2);
  med.strength = '18 mg';
  assert.equal(current.classify(med).status, 'unknown');
  med.strength = '36 mg';
  const expired = new ReferenceClassificationService(new SnapshotDrugReference(pilot, () => Date.parse('2026-10-25T12:00:00Z')));
  assert.equal(expired.classify(med).status, 'unknown');
});

test('farmaceut kan dokumentera en manuell klassning utan att ändra referensmotorns svar', () => {
  const service = new ReferenceClassificationService(new SnapshotDrugReference(snapshot, () => Date.parse('2026-09-24T12:00:00Z')));
  const medication = blankMedication('manual');
  medication.productName = 'Okänt testpreparat'; medication.strength = '18 mg'; medication.form = 'depokapsel'; medication.activeSubstance = 'Testsubstans';
  const deterministic = service.classify(medication);
  assert.equal(deterministic.status, 'unknown');
  medication.manualClassification = {
    status: 'required', sourceUrl: 'https://www.lakemedelsverket.se/sv/sok-lakemedelsfakta/lakemedel/TEST',
    rationale: 'Kontrollerat preparat i officiell produktkälla.', reviewer: 'FT', verifiedIdentity: medicationIdentity(medication),
  };
  assert.deepEqual(manualClassificationIssues(medication), []);
  const reviewed = applyManualClassification(medication, deterministic);
  assert.equal(reviewed.status, 'required');
  assert.equal(reviewed.referenceVersion, 'manual-review');
  assert.equal(service.classify(medication).status, 'unknown');
  medication.manualClassification.status = 'not-required';
  assert.equal(applyManualClassification(medication, deterministic).status, 'not-required');
  medication.strength = '27 mg';
  assert.equal(applyManualClassification(medication, deterministic).status, 'unknown');
  assert.match(manualClassificationIssues(medication).join(' '), /Bekräfta/);
  medication.manualClassification.verifiedIdentity = medicationIdentity(medication);
  medication.manualClassification.sourceUrl = 'https://fass.se.evil.example/product/TEST';
  assert.equal(applyManualClassification(medication, deterministic).status, 'unknown');
  assert.match(manualClassificationIssues(medication).join(' '), /FASS/);
});

test('entydig referensklassning går före ett manuellt beslut', () => {
  const service = new ReferenceClassificationService(new SnapshotDrugReference(snapshot, () => Date.parse('2026-09-24T12:00:00Z')));
  const medication = blankMedication('known'); medication.productName = 'Vanligt testmedel'; medication.strength = '20 mg'; medication.form = 'kapsel'; medication.activeSubstance = 'Testsubstans B';
  medication.manualClassification = {
    status: 'required', sourceUrl: 'https://fass.se/health/product/TEST', rationale: 'Manuellt försök att skriva över en entydig referens.',
    reviewer: 'FT', verifiedIdentity: medicationIdentity(medication),
  };
  assert.equal(applyManualClassification(medication, service.classify(medication)).status, 'not-required');
});
