import { randomUUID } from 'node:crypto';
import type { Classification, Confidence, DocumentInfo, FieldEvidence, Medication, ReviewModel } from '../shared/model.js';

export type InputDocument = DocumentInfo & { bytes: Buffer };
export type ExtractedText = { text: string; kind: DocumentInfo['kind']; evidence: FieldEvidence };
export type ParsedMedication = { values: Partial<Medication>; evidence: Partial<Record<keyof Medication, FieldEvidence>> };
export interface ImageExtractionProvider { extract(documents: InputDocument[]): Promise<ExtractedText[]> }
export interface MedicationParser { parse(blocks: ExtractedText[]): ParsedMedication[] }
export interface PatientParser { parse(blocks: ExtractedText[]): Partial<ReviewModel['patient']> }
export interface PrescriberParser { parse(blocks: ExtractedText[]): Partial<Medication['prescriber']> }
export interface Normalizer { normalize(rows: ParsedMedication[]): { medications: Medication[]; evidence: Record<string, FieldEvidence> } }
export interface DrugReferenceSource { version: string; lookup(productName: string): 'required' | 'not-required' | undefined }
export interface DrugClassificationService { classify(medication: Medication): Classification }

const demoLines = [
  'Demomedicin A | 10 mg | tablett | 1 tablett dagligen | 30 st',
  'Demomedicin B | 20 mg | kapsel | 1 kapsel dagligen | 30 st',
  'Demo Kontroll C | 5 mg | tablett | 1 tablett kvällstid | 30 st',
  'Demo Kontroll D | 2 mg | tablett | 1 tablett vid behov | 10 st',
];
// Ignores pixels and emits one fixture regardless of image count. No field is attributed to an image.
export class MockImageExtractionProvider implements ImageExtractionProvider {
  async extract(documents: InputDocument[]): Promise<ExtractedText[]> {
    if (!documents.some(d => d.kind === 'medications')) return [];
    return demoLines.map(text => ({ text, kind: 'medications', evidence: {
      documentId: null, method: 'mock-fixture', rawText: text, confidence: 0,
    } }));
  }
}
export class PipeMedicationParser implements MedicationParser {
  parse(blocks: ExtractedText[]): ParsedMedication[] {
    return blocks.filter(b => b.kind === 'medications').map(block => {
      const [productName = '', strength = '', form = '', dosageText = '', quantity = ''] = block.text.split('|').map(x => x.trim());
      const values = { originalText: block.text, productName, strength, form, dosageText, quantity };
      const evidence: ParsedMedication['evidence'] = {};
      for (const key of Object.keys(values) as (keyof typeof values)[]) evidence[key] = block.evidence;
      return { values, evidence };
    });
  }
}
export class MedicationNormalizer implements Normalizer {
  normalize(rows: ParsedMedication[]) {
    const fieldEvidence: Record<string, FieldEvidence> = {};
    const medications = rows.map(({ values, evidence }) => {
      const id = randomUUID();
      for (const [field, source] of Object.entries(evidence)) if (source) fieldEvidence[`medications.${id}.${field}`] = source;
      const confidence: Confidence = {
        productName: evidence.productName?.confidence ?? 0,
        strength: evidence.strength?.confidence ?? 0,
        form: evidence.form?.confidence ?? 0,
        activeSubstance: evidence.activeSubstance?.confidence ?? 0,
        dosage: evidence.dosageText?.confidence ?? 0,
        quantity: evidence.quantity?.confidence ?? 0,
      };
      return {
        id, originalText: values.originalText ?? '', productName: values.productName ?? '',
        strength: values.strength ?? '', form: values.form ?? '', activeSubstance: '', atcCode: '',
        dosageText: values.dosageText ?? '', quantity: values.quantity ?? '',
        totalActiveSubstance: '', treatmentDays: '', notes: '',
        prescriber: { lastName: '', firstName: '', address: '', phone: '' },
        confidence, classification: { status: 'unknown', reason: 'Ej klassificerad', referenceVersion: 'demo-1' },
      } satisfies Medication;
    });
    return { medications, evidence: fieldEvidence };
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
export async function createReview(documents: InputDocument[], extractor: ImageExtractionProvider = new MockImageExtractionProvider()): Promise<ReviewModel> {
  const blocks = await extractor.extract(documents);
  const { medications, evidence } = new MedicationNormalizer().normalize(new PipeMedicationParser().parse(blocks));
  return {
    patient: { name: '', personalIdentityNumber: '', passportNumber: '', birthPlaceAndDate: '', sex: '', nationality: '', phone: '', streetAddress: '', postalAddress: '' },
    travel: { destination: '', departureDate: '', returnDate: '', durationDays: '' },
    pharmacy: { name: '', phone: '', address: '', city: '' },
    medications: medications.map(m => ({ ...m, classification: classifier.classify(m) })),
    fieldEvidence: evidence,
  };
}
