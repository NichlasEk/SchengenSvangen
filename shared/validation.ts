import type { ReviewModel } from './model.js';

export function draftReadiness(review: ReviewModel): string[] {
  const issues: string[] = [];
  const { patient, travel, prescriber, pharmacy } = review;
  if (!patient.name.trim() || !(patient.passportNumber.trim() || patient.personalIdentityNumber.trim())) issues.push('Patientens namn och identitet saknas.');
  if (!prescriber.lastName.trim() || !prescriber.firstName.trim()) issues.push('Förskrivarens namn saknas.');
  if (!pharmacy.name.trim()) issues.push('Apotekets namn saknas.');
  const start = Date.parse(travel.departureDate), end = Date.parse(travel.returnDate);
  const days = (end - start) / 86_400_000 + 1;
  if (!Number.isInteger(days) || days < 1 || days > 30) issues.push('Giltighetstid måste vara 1–30 dagar.');
  const duration = Number(travel.durationDays);
  if (!Number.isInteger(duration) || duration < 1 || duration > 30) issues.push('Resans längd måste vara 1–30 dagar.');
  if (review.medications.some(m => m.classification.status === 'unknown')) issues.push('Okänd klassning måste utredas.');
  for (const m of review.medications.filter(m => m.classification.status === 'required')) {
    if (![m.productName, m.form, m.activeSubstance, m.strength, m.dosageText, m.totalActiveSubstance].every(x => x.trim())) issues.push('Uppgifter om intygskrävande preparat saknas.');
    const treatmentDays = Number(m.treatmentDays);
    if (!Number.isInteger(treatmentDays) || treatmentDays < 1 || treatmentDays > 30) issues.push('Behandlingens längd måste vara 1–30 dagar.');
  }
  return issues;
}
