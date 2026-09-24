import { randomUUID } from 'node:crypto';
import type { Classification, Medication, ReviewModel } from '../shared/model.js';

export interface ImageExtractionProvider { extract(image: Buffer, mimeType: string): Promise<string[]> }
export interface MedicationParser { parse(lines: string[]): Partial<Medication>[] }
export interface Normalizer { normalize(rows: Partial<Medication>[]): Medication[] }
export interface DrugReferenceSource { version: string; lookup(productName: string): 'required' | 'not-required' | undefined }
export interface DrugClassificationService { classify(medication: Medication): Classification }

// Demo adapter deliberately ignores image pixels. It proves the workflow without pretending to perform OCR.
export class MockImageExtractionProvider implements ImageExtractionProvider {
  async extract(): Promise<string[]> {
    return [
      'Demomedicin A | 10 mg | tablett | 1 tablett dagligen | 30 st',
      'Demomedicin B | 20 mg | kapsel | 1 kapsel dagligen | 30 st',
      'Demo Kontroll C | 5 mg | tablett | 1 tablett kvällstid | 30 st',
      'Demo Kontroll D | 2 mg | tablett | 1 tablett vid behov | 10 st',
    ];
  }
}
export class PipeMedicationParser implements MedicationParser {
  parse(lines: string[]): Partial<Medication>[] {
    return lines.map(line => {
      const [productName = '', strength = '', form = '', dosageText = '', quantity = ''] = line.split('|').map(x => x.trim());
      return { originalText: line, productName, strength, form, dosageText, quantity };
    });
  }
}
export class MedicationNormalizer implements Normalizer {
  normalize(rows: Partial<Medication>[]): Medication[] {
    return rows.map(row => ({
      id: randomUUID(), originalText: row.originalText ?? '', productName: row.productName ?? '',
      strength: row.strength ?? '', form: row.form ?? '', activeSubstance: '', atcCode: '',
      dosageText: row.dosageText ?? '', quantity: row.quantity ?? '', totalActiveSubstance: '', treatmentDays: '', notes: '',
      confidence: { productName: 0, strength: 0, activeSubstance: 0, dosage: 0 },
      classification: { status: 'unknown', reason: 'Ej klassificerad', referenceVersion: 'demo-1' },
    }));
  }
}
export class DemoDrugReference implements DrugReferenceSource {
  version = 'demo-1';
  private readonly data = new Map<string, 'required' | 'not-required'>([
    ['demo kontroll c', 'required'], ['demo kontroll d', 'required'],
    ['demomedicin a', 'not-required'], ['demomedicin b', 'not-required'],
  ]);
  lookup(name: string) { return this.data.get(name.trim().toLocaleLowerCase('sv-SE')); }
}
export class ReferenceClassificationService implements DrugClassificationService {
  constructor(private readonly source: DrugReferenceSource) {}
  classify(medication: Medication): Classification {
    const result = this.source.lookup(medication.productName);
    return {
      status: result ?? 'unknown', referenceVersion: this.source.version,
      reason: result === 'required' ? 'Fiktivt preparat markerat intygskrävande i demo-registret.'
        : result === 'not-required' ? 'Fiktivt preparat markerat ej intygskrävande i demo-registret.'
        : 'Ingen exakt träff i demo-registret. Kontrollera mot godkänd källa.',
    };
  }
}
export const classifier = new ReferenceClassificationService(new DemoDrugReference());
export async function createReview(image: Buffer, mimeType: string, extractor: ImageExtractionProvider = new MockImageExtractionProvider()): Promise<ReviewModel> {
  const lines = await extractor.extract(image, mimeType);
  const medications = new MedicationNormalizer().normalize(new PipeMedicationParser().parse(lines));
  return {
    prescriber: { lastName: '', firstName: '', address: '', phone: '' },
    patient: { name: '', personalIdentityNumber: '', passportNumber: '', birthPlaceAndDate: '', sex: '', nationality: '', phone: '', streetAddress: '', postalAddress: '' },
    travel: { destination: '', departureDate: '', returnDate: '', durationDays: '' },
    pharmacy: { name: '', phone: '', address: '', city: '' },
    medications: medications.map(m => ({ ...m, classification: classifier.classify(m) })),
  };
}
