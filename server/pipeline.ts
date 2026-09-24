import { randomUUID } from 'node:crypto';
import type { Classification, Confidence, DocumentInfo, FieldEvidence, Medication, ReviewModel } from '../shared/model.js';
import { LocalOCRProvider, parsePrescriberCandidates, toObservations } from './local-ocr.js';
import { OCRMedicationParser } from './medication-parser.js';
import { LabelPatientParser } from './patient-parser.js';
import { loadDrugReference, ReferenceClassificationService } from './drug-reference.js';

export type InputDocument = DocumentInfo & { bytes: Buffer };
export type ExtractedText = { text: string; kind: DocumentInfo['kind']; evidence: FieldEvidence };
export type ParsedMedication = { values: Partial<Medication>; evidence: Partial<Record<keyof Medication, FieldEvidence>> };
export interface ImageExtractionProvider { extract(documents: InputDocument[]): Promise<ExtractedText[]> }
export interface MedicationParser { parse(blocks: ExtractedText[]): ParsedMedication[] }
export interface PatientParser { parse(blocks: ExtractedText[]): { values: Partial<ReviewModel['patient']>; evidence: Record<string, FieldEvidence> } }
export interface PrescriberParser { parse(blocks: ExtractedText[]): Partial<Medication['prescriber']> }
export interface Normalizer { normalize(rows: ParsedMedication[]): { medications: Medication[]; evidence: Record<string, FieldEvidence> } }
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
        strength: values.strength ?? '', form: values.form ?? '', activeSubstance: values.activeSubstance ?? '', atcCode: values.atcCode ?? '',
        dosageText: values.dosageText ?? '', certificateDosageText: (values.dosageText?.length ?? 0) <= 88 ? values.dosageText ?? '' : '', quantity: values.quantity ?? '',
        totalActiveSubstance: '', treatmentDays: '', notes: '',
        prescriber: { lastName: '', firstName: '', address: '', phone: '' },
        prescriberCandidateId: null,
        prescriberSourceIds: {},
        manualClassification: null,
        confidence, classification: { status: 'unknown', reason: 'Ej klassificerad', referenceVersion: 'demo-1' },
      } satisfies Medication;
    });
    return { medications, evidence: fieldEvidence };
  }
}
export const classifier = new ReferenceClassificationService(loadDrugReference());
export async function createReview(documents: InputDocument[], extractor: ImageExtractionProvider = new LocalOCRProvider(), medicationParser: MedicationParser = new OCRMedicationParser()): Promise<ReviewModel> {
  const blocks = await extractor.extract(documents);
  const { medications, evidence } = new MedicationNormalizer().normalize(medicationParser.parse(blocks));
  const patient = new LabelPatientParser().parse(blocks);
  for (const medication of medications) {
    const product = classifier.match(medication);
    if (product?.activeSubstance && !medication.activeSubstance) {
      medication.activeSubstance = product.activeSubstance;
      medication.confidence.activeSubstance = 1;
      evidence[`medications.${medication.id}.activeSubstance`] = { documentId: null, method: 'reference', rawText: product.nplId, confidence: 1 };
    }
    if (product?.atcCode && !medication.atcCode) {
      medication.atcCode = product.atcCode;
      evidence[`medications.${medication.id}.atcCode`] = { documentId: null, method: 'reference', rawText: product.nplId, confidence: 1 };
    }
  }
  return {
    referenceInfo: classifier.info(),
    patient: { name: '', personalIdentityNumber: '', passportNumber: '', birthPlaceAndDate: '', sex: '', nationality: '', phone: '', streetAddress: '', postalAddress: '', ...patient.values },
    travel: { destination: '', departureDate: '', returnDate: '', durationDays: '' },
    pharmacy: { name: '', phone: '', address: '', city: '' },
    medications: medications.map(m => ({ ...m, classification: classifier.classify(m) })),
    prescriberCandidates: parsePrescriberCandidates(blocks),
    ocrObservations: toObservations(blocks),
    fieldEvidence: { ...evidence, ...patient.evidence },
  };
}
