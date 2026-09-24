import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Medication, ReviewModel } from '../shared/model.js';

export type Certificate = { id: string; medication: Medication; patient: ReviewModel['patient']; travel: ReviewModel['travel']; prescriber: Medication['prescriber']; pharmacy: ReviewModel['pharmacy']; templateVersion: string };
export interface CertificateGenerator { generate(review: ReviewModel): Certificate[] }
export interface CertificateTemplate { render(certificate: Certificate): Promise<Uint8Array> }
export interface CertificateDeliveryAdapter { deliver(certificate: Certificate, pdf: Uint8Array): unknown }
export class PdfDownloadAdapter implements CertificateDeliveryAdapter {
  deliver(certificate: Certificate, pdf: Uint8Array) { return { filename: `intyg-utkast-${certificate.id}.pdf`, bytes: pdf }; }
}
export class PrintAdapter implements CertificateDeliveryAdapter {
  deliver(_certificate: Certificate, pdf: Uint8Array) { return { bytes: pdf, action: 'open-browser-print-dialog' }; }
}
export class DemoCertificateGenerator implements CertificateGenerator {
  generate(review: ReviewModel): Certificate[] {
    return review.medications.filter(m => m.classification.status === 'required').map(m => ({
      id: m.id, medication: m, patient: review.patient, travel: review.travel,
      prescriber: m.prescriber, pharmacy: review.pharmacy, templateVersion: 'lv-2023-05-31-demo',
    }));
  }
}
export class DemoPdfTemplate implements CertificateTemplate {
  async render(c: Certificate): Promise<Uint8Array> {
    const source = readFileSync(path.resolve('reference/lv-schengenintyg.pdf'));
    const pdf = await PDFDocument.load(source);
    pdf.registerFontkit(fontkit);
    const textFont = await pdf.embedFont(readFileSync(path.resolve('reference/fonts/NotoSans-Regular.ttf')), { subset: true });
    const form = pdf.getForm();
    const fill = (name: string, value: string) => form.getTextField(name).setText(value);
    fill('Efternamn läkare 1', c.prescriber.lastName);
    fill('Förnamn läkare 2', c.prescriber.firstName);
    fill('Adress läkare 3', c.prescriber.address);
    fill('Telefonnummer läkare 4', c.prescriber.phone);
    fill('Efternamn förnamn kund 5', c.patient.name);
    fill('Passnationellt IDkortnummer alt personnummer 6', c.patient.passportNumber || c.patient.personalIdentityNumber);
    fill('Födelseort samt födelsedatum 7', c.patient.birthPlaceAndDate);
    fill('Kön kund 8', c.patient.sex);
    fill('Nationalitet kund 9', c.patient.nationality);
    fill('Telefonnummer kund 10', c.patient.phone);
    fill('Adress kund 11', c.patient.streetAddress);
    fill('Adress postadress kund 12', c.patient.postalAddress);
    fill('Resans längd antal dagar 13', c.travel.durationDays);
    fill('Datum fr.o.m. 14', c.travel.departureDate);
    fill('Datum t.o.m. 14', c.travel.returnDate);
    fill('Läkemedelsnamn 15', c.medication.productName);
    fill('Läkemedelsform 16', c.medication.form);
    fill('Verksam substans 17', c.medication.activeSubstance);
    fill('Styrka 18', c.medication.strength);
    fill('Dosering 19', c.medication.certificateDosageText);
    fill('Total mängd av verksam substans 20', c.medication.totalActiveSubstance);
    fill('Behandlingens varaktighet 21', c.medication.treatmentDays);
    fill('Anmärkningar 22', c.medication.notes);
    fill('Apotekets namn och telefonnummer 23', c.pharmacy.name);
    fill('Telefonnummer apotek 23', c.pharmacy.phone);
    fill('Adress apotek 24', c.pharmacy.address);
    fill('Ort apotek 24', c.pharmacy.city);
    // Utfärdandedatum, signature and physical stamp stay empty until the pharmacy issues the paper.
    for (const name of ['Återställ fält A', 'Återställ fält C', 'Skrivut']) form.removeField(form.getField(name));
    form.updateFieldAppearances(textFont);
    form.flatten();
    const page = pdf.getPage(0);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    page.drawRectangle({ x: 173, y: 808, width: 250, height: 24, color: rgb(1, 1, 1) });
    page.drawText('DEMO / UTKAST - EJ UTFÄRDAT', { x: 180, y: 815, font: bold, size: 11, color: rgb(0.75, 0.08, 0.12) });
    return pdf.save();
  }
}
