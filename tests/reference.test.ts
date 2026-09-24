import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotDrugReference, ReferenceClassificationService, validateSnapshot } from '../server/drug-reference.js';
import { blankMedication } from '../shared/model.js';

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
