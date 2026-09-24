export type Confidence = { productName: number; strength: number; form: number; activeSubstance: number; dosage: number; quantity: number };
export type Classification = { status: 'required' | 'not-required' | 'unknown'; reason: string; referenceVersion: string };
export type DocumentKind = 'patient' | 'medications' | 'prescriber';
export type DocumentInfo = { id: string; kind: DocumentKind; name: string; mimeType: string };
export type FieldEvidence = { documentId: string | null; method: 'mock-fixture' | 'ocr'; rawText: string; confidence: number; bounds?: { x: number; y: number; width: number; height: number } };
export type Prescriber = { lastName: string; firstName: string; address: string; phone: string };
export type Medication = {
  id: string; originalText: string; productName: string; strength: string; form: string;
  activeSubstance: string; atcCode: string; dosageText: string; quantity: string;
  totalActiveSubstance: string; treatmentDays: string; notes: string;
  prescriber: Prescriber;
  confidence: Confidence; classification: Classification;
};
export type ReviewModel = {
  patient: { name: string; personalIdentityNumber: string; passportNumber: string; birthPlaceAndDate: string; sex: string; nationality: string; phone: string; streetAddress: string; postalAddress: string };
  travel: { destination: string; departureDate: string; returnDate: string; durationDays: string };
  pharmacy: { name: string; phone: string; address: string; city: string };
  medications: Medication[];
  fieldEvidence: Record<string, FieldEvidence>;
};
export type CertificateCaseState = 'DRAFT' | 'REVIEWED' | 'GENERATED' | 'PRINTED' | 'AWAITING_SIGNATURE' | 'SIGNED_DOCUMENT_IMPORTED' | 'READY_FOR_SUBMISSION' | 'SUBMITTED';
export type SessionView = { id: string; expiresAt: string; source: string; state: CertificateCaseState; reviewed: boolean; documents: DocumentInfo[]; review: ReviewModel };
