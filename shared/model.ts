export type Confidence = { productName: number; strength: number; form: number; activeSubstance: number; dosage: number; quantity: number };
export type Classification = { status: 'required' | 'not-required' | 'unknown'; reason: string; referenceVersion: string };
export type DocumentKind = 'patient' | 'medications' | 'prescriber';
export type DocumentInfo = { id: string; kind: DocumentKind; name: string; mimeType: string };
export type FieldEvidence = { documentId: string | null; method: 'mock-fixture' | 'ocr' | 'reference'; rawText: string; confidence: number; bounds?: { x: number; y: number; width: number; height: number } };
export type Prescriber = { lastName: string; firstName: string; address: string; phone: string };
export type PrescriberCandidate = { id: string; documentId: string; prescriber: Prescriber; workplaceName: string; workplacePhone: string; evidence: Partial<Record<keyof Prescriber, FieldEvidence>> };
export type OCRObservation = { documentId: string; text: string; confidence: number; bounds: FieldEvidence['bounds'] };
export type Medication = {
  id: string; originalText: string; productName: string; strength: string; form: string;
  activeSubstance: string; atcCode: string; dosageText: string; quantity: string;
  totalActiveSubstance: string; treatmentDays: string; notes: string;
  prescriber: Prescriber;
  prescriberCandidateId: string | null;
  confidence: Confidence; classification: Classification;
};
export function blankMedication(id: string): Medication {
  return { id, originalText: '', productName: '', strength: '', form: '', activeSubstance: '', atcCode: '',
    dosageText: '', quantity: '', totalActiveSubstance: '', treatmentDays: '', notes: '',
    prescriber: { lastName: '', firstName: '', address: '', phone: '' }, prescriberCandidateId: null,
    confidence: { productName: 0, strength: 0, form: 0, activeSubstance: 0, dosage: 0, quantity: 0 },
    classification: { status: 'unknown', reason: 'Manuellt tillagd rad. Klassning sker vid bekräftad granskning.', referenceVersion: 'demo-1' } };
}
export type ReviewModel = {
  referenceInfo: { source: 'demo' | 'vara'; version: string; generatedAt: string; status: 'demo' | 'current' | 'stale' };
  patient: { name: string; personalIdentityNumber: string; passportNumber: string; birthPlaceAndDate: string; sex: string; nationality: string; phone: string; streetAddress: string; postalAddress: string };
  travel: { destination: string; departureDate: string; returnDate: string; durationDays: string };
  pharmacy: { name: string; phone: string; address: string; city: string };
  medications: Medication[];
  prescriberCandidates: PrescriberCandidate[];
  ocrObservations: OCRObservation[];
  fieldEvidence: Record<string, FieldEvidence>;
};
export type CertificateCaseState = 'DRAFT' | 'REVIEWED' | 'GENERATED' | 'PRINTED' | 'AWAITING_SIGNATURE' | 'SIGNED_DOCUMENT_IMPORTED' | 'READY_FOR_SUBMISSION' | 'SUBMITTED';
export type SessionView = { id: string; expiresAt: string; source: string; state: CertificateCaseState; reviewed: boolean; documents: DocumentInfo[]; review: ReviewModel };
