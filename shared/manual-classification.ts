import type { Classification, Medication } from './model.js';

const normalized = (value: string) => value.trim().toLocaleLowerCase('sv-SE').replace(/\s+/g, ' ');

export function medicationIdentity(medication: Medication): string {
  return JSON.stringify([medication.productName, medication.strength, medication.form, medication.activeSubstance].map(normalized));
}

function approvedSource(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['fass.se', 'www.fass.se', 'lakemedelsverket.se', 'www.lakemedelsverket.se'].includes(url.hostname) && url.pathname !== '/';
  } catch { return false; }
}

export function manualClassificationIssues(medication: Medication): string[] {
  const decision = medication.manualClassification;
  if (!decision) return ['Välj ett manuellt klassningsbeslut.'];
  const issues: string[] = [];
  if (!['required', 'not-required'].includes(decision.status)) issues.push('Välj om preparatet kräver intyg.');
  if (!medication.productName.trim() || !medication.activeSubstance.trim() || !medication.form.trim() ||
    !/\d/.test(medication.strength) || !/[a-zµμ]/i.test(medication.strength)) {
    issues.push('Ange exakt preparat, styrka med enhet, form och aktiv substans.');
  }
  if (!approvedSource(decision.sourceUrl)) issues.push('Ange en produkt- eller klassningslänk från FASS eller Läkemedelsverket.');
  if (decision.rationale.trim().length < 15) issues.push('Motivera klassningen med minst 15 tecken.');
  if (decision.reviewer.trim().length < 2) issues.push('Ange farmaceutens signum eller namn.');
  if (decision.verifiedIdentity !== medicationIdentity(medication)) issues.push('Bekräfta att exakt expedierat preparat, styrka, form och substans har kontrollerats.');
  return issues;
}

export function applyManualClassification(medication: Medication, deterministic: Classification): Classification {
  const decision = medication.manualClassification;
  if (deterministic.status !== 'unknown' || !decision || manualClassificationIssues(medication).length) return deterministic;
  return {
    status: decision.status as 'required' | 'not-required',
    reason: `Manuell farmaceutisk bedömning (${decision.reviewer.trim()}): ${decision.rationale.trim()}`,
    referenceVersion: 'manual-review',
    sourceUrls: [decision.sourceUrl],
  };
}
