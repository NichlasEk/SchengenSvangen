import type { ReviewModel } from './model.js';
import { manualClassificationIssues } from './manual-classification.js';

// MaxLength values from reference/lv-schengenintyg.pdf. Keep in sync with the
// bundled form; never silently truncate medical or identity information.
export const PDF_FIELD_MAX: Record<string, number> = {
  'Efternamn läkare 1': 32, 'Förnamn läkare 2': 32, 'Adress läkare 3': 88, 'Telefonnummer läkare 4': 15,
  'Efternamn förnamn kund 5': 32, 'Passnationellt IDkortnummer alt personnummer 6': 25,
  'Födelseort samt födelsedatum 7': 32, 'Kön kund 8': 32, 'Nationalitet kund 9': 32,
  'Telefonnummer kund 10': 15, 'Adress kund 11': 32, 'Adress postadress kund 12': 32,
  'Resans längd antal dagar 13': 32, 'Datum fr.o.m. 14': 11, 'Datum t.o.m. 14': 11,
  'Läkemedelsnamn 15': 32, 'Läkemedelsform 16': 32, 'Verksam substans 17': 32,
  'Styrka 18': 32, 'Dosering 19': 88, 'Total mängd av verksam substans 20': 88,
  'Behandlingens varaktighet 21': 88, 'Anmärkningar 22': 88,
  'Apotekets namn och telefonnummer 23': 88, 'Telefonnummer apotek 23': 15,
  'Adress apotek 24': 88, 'Ort apotek 24': 25,
};

export function draftReadiness(review: ReviewModel): string[] {
  const issues: string[] = [];
  const { patient, travel, pharmacy } = review;
  if (!patient.name.trim() || !(patient.passportNumber.trim() || patient.personalIdentityNumber.trim())) issues.push('Patientens namn och identitet saknas.');
  if (!pharmacy.name.trim()) issues.push('Apotekets namn saknas.');
  const start = Date.parse(travel.departureDate), end = Date.parse(travel.returnDate);
  const days = (end - start) / 86_400_000 + 1;
  if (!Number.isInteger(days) || days < 1 || days > 30) issues.push('Giltighetstid måste vara 1–30 dagar.');
  const duration = Number(travel.durationDays);
  if (!Number.isInteger(duration) || duration < 1 || duration > 30) issues.push('Resans längd måste vara 1–30 dagar.');
  else if (Number.isInteger(days) && days >= 1 && days <= 30 && duration !== days) issues.push('Resans längd måste stämma med avrese- och hemkomstdatum.');
  for (const m of review.medications.filter(m => m.classification.status === 'unknown')) {
    const manualIssues = manualClassificationIssues(m);
    issues.push(manualIssues.length
      ? `Osäker klassning för ${m.productName || 'preparat'}: ${manualIssues.join(' ')}`
      : `Bekräfta granskningen för att tillämpa det manuella beslutet för ${m.productName || 'preparat'}.`);
  }
  const required = review.medications.filter(m => m.classification.status === 'required');
  const checkLength = (name: string, value: string | undefined) => {
    const max = PDF_FIELD_MAX[name];
    if (max && (value?.length ?? 0) > max) issues.push(`${name}: ${value!.length} tecken, blanketten rymmer högst ${max}. Förkorta efter kontroll.`);
  };
  if (required.length) {
    for (const [name, value] of [
      ['Efternamn förnamn kund 5', patient.name], ['Passnationellt IDkortnummer alt personnummer 6', patient.passportNumber || patient.personalIdentityNumber],
      ['Födelseort samt födelsedatum 7', patient.birthPlaceAndDate], ['Kön kund 8', patient.sex], ['Nationalitet kund 9', patient.nationality],
      ['Telefonnummer kund 10', patient.phone], ['Adress kund 11', patient.streetAddress], ['Adress postadress kund 12', patient.postalAddress],
      ['Resans längd antal dagar 13', travel.durationDays], ['Datum fr.o.m. 14', travel.departureDate], ['Datum t.o.m. 14', travel.returnDate],
      ['Apotekets namn och telefonnummer 23', pharmacy.name], ['Telefonnummer apotek 23', pharmacy.phone],
      ['Adress apotek 24', pharmacy.address], ['Ort apotek 24', pharmacy.city],
    ] as [string, string][]) checkLength(name, value);
  }
  for (const m of required) {
    if (!m.prescriber.lastName.trim() || !m.prescriber.firstName.trim()) issues.push(`Förskrivare saknas för ${m.productName || 'preparat'}.`);
    if (![m.productName, m.form, m.activeSubstance, m.strength, m.dosageText, m.totalActiveSubstance].every(x => x.trim())) issues.push('Uppgifter om intygskrävande preparat saknas.');
    if (m.totalActiveSubstance.trim() && !/[a-zµμ]/i.test(m.totalActiveSubstance)) issues.push('Total mängd verksam substans måste anges med enhet, till exempel mg.');
    if (!m.certificateDosageText?.trim()) issues.push('Skriv en granskad kort dosering för intyget. Den fullständiga doseringsanvisningen bevaras separat.');
    for (const [name, value] of [
      ['Efternamn läkare 1', m.prescriber.lastName], ['Förnamn läkare 2', m.prescriber.firstName],
      ['Adress läkare 3', m.prescriber.address], ['Telefonnummer läkare 4', m.prescriber.phone],
      ['Läkemedelsnamn 15', m.productName], ['Läkemedelsform 16', m.form], ['Verksam substans 17', m.activeSubstance],
      ['Styrka 18', m.strength], ['Dosering 19', m.certificateDosageText],
      ['Total mängd av verksam substans 20', m.totalActiveSubstance], ['Behandlingens varaktighet 21', m.treatmentDays],
      ['Anmärkningar 22', m.notes],
    ] as [string, string][]) checkLength(name, value);
    const treatmentDays = Number(m.treatmentDays);
    if (!Number.isInteger(treatmentDays) || treatmentDays < 1 || treatmentDays > 30) issues.push('Behandlingens längd måste vara 1–30 dagar.');
  }
  return issues;
}
