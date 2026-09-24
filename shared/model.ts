export type Confidence = { productName: number; strength: number; activeSubstance: number; dosage: number };
export type Classification = { status: 'required' | 'not-required' | 'unknown'; reason: string; referenceVersion: string };
export type Medication = {
  id: string; originalText: string; productName: string; strength: string; form: string;
  activeSubstance: string; atcCode: string; dosageText: string; quantity: string;
  totalActiveSubstance: string; treatmentDays: string; notes: string;
  confidence: Confidence; classification: Classification;
};
export type ReviewModel = {
  prescriber: { lastName: string; firstName: string; address: string; phone: string };
  patient: { name: string; personalIdentityNumber: string; passportNumber: string; birthPlaceAndDate: string; sex: string; nationality: string; phone: string; streetAddress: string; postalAddress: string };
  travel: { destination: string; departureDate: string; returnDate: string; durationDays: string };
  pharmacy: { name: string; phone: string; address: string; city: string };
  medications: Medication[];
};
export type CertificateCaseState = 'DRAFT' | 'REVIEWED' | 'GENERATED' | 'PRINTED' | 'AWAITING_SIGNATURE' | 'SIGNED_DOCUMENT_IMPORTED' | 'READY_FOR_SUBMISSION' | 'SUBMITTED';
export type SessionView = { id: string; expiresAt: string; source: string; state: CertificateCaseState; reviewed: boolean; review: ReviewModel };
