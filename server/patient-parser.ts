import type { FieldEvidence, ReviewModel } from '../shared/model.js';
import type { ExtractedText, PatientParser } from './pipeline.js';

export type ParsedPatient = { values: Partial<ReviewModel['patient']>; evidence: Record<string, FieldEvidence> };
type PatientKey = keyof ReviewModel['patient'];
const fieldLabels: Partial<Record<PatientKey, RegExp>> = {
  name: /^(?:patientens? namn|kundens? namn|namn)\s*:\s*(.+)$/i,
  personalIdentityNumber: /^(?:personnummer|personnr|pnr)\s*:\s*(.+)$/i,
  birthPlaceAndDate: /^(?:födelseort och datum|födelseort och födelsedatum)\s*:\s*(.+)$/i,
  sex: /^(?:kön)\s*:\s*(.+)$/i,
  nationality: /^(?:nationalitet|medborgarskap)\s*:\s*(.+)$/i,
  phone: /^(?:telefon|mobil)\s*:\s*(.+)$/i,
  streetAddress: /^(?:adress|gatuadress)\s*:\s*(.+)$/i,
  postalAddress: /^(?:postadress|postnummer och ort)\s*:\s*(.+)$/i,
};
const clean = (value: string) => value.trim().replace(/\s+/g, ' ');
function accepted(key: PatientKey, value: string): boolean {
  if (key === 'name') return /^[\p{L}][\p{L}'-]+(?:\s+[\p{L}][\p{L}'-]+)+$/u.test(value) && value.length <= 100;
  if (key === 'personalIdentityNumber') return /^(?:\d{8}[-+]?\d{4}|\d{6}[-+]\d{4})$/.test(value);
  if (key === 'phone') return /^[+\d][\d\s-]{5,20}$/.test(value);
  return value.length >= 2 && value.length <= 150;
}
export class LabelPatientParser implements PatientParser {
  parse(blocks: ExtractedText[]): ParsedPatient {
    const values: ParsedPatient['values'] = {};
    const evidence: Record<string, FieldEvidence> = {};
    for (const block of blocks.filter(b => b.kind === 'patient' && b.evidence.confidence >= .85)) {
      for (const [key, expression] of Object.entries(fieldLabels) as [PatientKey, RegExp][]) {
        if (values[key]) continue;
        const match = expression.exec(block.text);
        if (!match) continue;
        const value = clean(match[1]);
        if (!accepted(key, value)) continue;
        values[key] = value;
        evidence[`patient.${key}`] = block.evidence;
      }
    }
    // A passport/ID number must be entered by the pharmacist, even if OCR sees one.
    return { values, evidence };
  }
}
