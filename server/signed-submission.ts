// Future workflow, intentionally separate from generated PDF delivery.
import type { CertificateCaseState } from '../shared/model.js';
export type { CertificateCaseState };

export type SignedCertificateImport = {
  caseId: string;
  // This must be a new scan/photo of the physically signed and stamped document.
  document: Uint8Array;
  mimeType: 'application/pdf' | 'image/png' | 'image/jpeg';
  signatureAndStampConfirmedBy: string;
};

export interface SignedCertificateSubmissionService {
  submit(signedDocument: SignedCertificateImport): Promise<{ receiptId: string }>;
}

export class LakemedelsverketSignedSubmissionStub implements SignedCertificateSubmissionService {
  // TODO: Implement after official upload service/API workflow has been inspected and documented.
  async submit(_signedDocument: SignedCertificateImport): Promise<{ receiptId: string }> {
    throw new Error('Inskick av signerat och stämplat intyg är inte implementerat');
  }
}
