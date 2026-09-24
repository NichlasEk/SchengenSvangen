import type { FieldEvidence, Medication } from '../shared/model.js';
import type { ExtractedText, MedicationParser, ParsedMedication } from './pipeline.js';

const strengthPattern = /\b(\d+(?:[,.]\d+)?\s*(?:mg|µg|mcg|g|ml))\b/i;
const formPattern = /\b(tablett(?:er)?|kapsel|kapslar|oral lösning|droppar|plåster|spray|injektion|suppositorium)\b/i;
const quantityPattern = /^\s*(\d+(?:[,.]\d+)?\s*(?:st|tabletter|kapslar|ml|förpackningar))\s*$/i;
const headingPattern = /^(?:fiktiv|läkemedelslista|preparat|läkemedel|substans|styrka|dosering|mängd|antal|expedierat|ordinerat)\b/i;
const bounds = (block: ExtractedText) => block.evidence.bounds;
const centerY = (block: ExtractedText) => (bounds(block)?.y ?? 0) + (bounds(block)?.height ?? 0) / 2;
const posX = (block: ExtractedText) => bounds(block)?.x ?? 0;
const safe = (block: ExtractedText | undefined, minimum = .70) => block && block.evidence.confidence >= minimum ? block : undefined;
const field = (result: ParsedMedication, key: keyof Medication, value: string, source: ExtractedText | undefined) => {
  if (!value || !source) return;
  (result.values as Record<string, unknown>)[key] = value;
  result.evidence[key] = source.evidence;
};
function parseIndexedRow(anchor: ExtractedText, row: ExtractedText[], detail: ExtractedText[]): ParsedMedication | undefined {
  const other = row.filter(b => b !== anchor).sort((a, b) => posX(a) - posX(b));
  const strengthBlock = safe(other.find(b => strengthPattern.test(b.text)));
  const product = safe(other.find(b => posX(b) > posX(anchor) + 20 &&
    (!strengthBlock || posX(b) < posX(strengthBlock)) &&
    !headingPattern.test(b.text) && /\p{L}/u.test(b.text) && !quantityPattern.test(b.text)), .75);
  if (!product || !strengthBlock) return;
  const result: ParsedMedication = { values: {}, evidence: {} };
  const source = row.sort((a, b) => posX(a) - posX(b)).map(b => b.text).join(' | ');
  field(result, 'originalText', source, product);
  field(result, 'productName', product.text.trim(), product);
  field(result, 'strength', strengthPattern.exec(strengthBlock.text)?.[1] ?? '', strengthBlock);
  field(result, 'form', formPattern.exec(strengthBlock.text)?.[1] ?? '', strengthBlock);
  const quantity = safe(other.find(b => quantityPattern.test(b.text)));
  field(result, 'quantity', quantityPattern.exec(quantity?.text ?? '')?.[1] ?? '', quantity);
  for (const block of detail) {
    const substance = /^\s*(?:verksam substans|substans)\s*:\s*(.+)$/i.exec(block.text);
    const dosage = /^\s*dosering\s*:\s*(.+)$/i.exec(block.text);
    if (substance) field(result, 'activeSubstance', substance[1].trim(), safe(block, .80));
    if (dosage) field(result, 'dosageText', dosage[1].trim(), safe(block, .80));
  }
  return result;
}
function parseInline(block: ExtractedText): ParsedMedication | undefined {
  if (block.evidence.confidence < .80 || headingPattern.test(block.text)) return;
  const match = /^(.{3,80}?)\s+(\d+(?:[,.]\d+)?\s*(?:mg|µg|mcg|g|ml))\b(?:\s+(.+))?$/i.exec(block.text);
  if (!match || !/\p{L}/u.test(match[1])) return;
  const result: ParsedMedication = { values: {}, evidence: {} };
  field(result, 'originalText', block.text, block);
  field(result, 'productName', match[1].trim(), block);
  field(result, 'strength', match[2].trim(), block);
  const form = formPattern.exec(match[3] ?? '')?.[1];
  if (form) field(result, 'form', form, block);
  return result;
}
export class OCRMedicationParser implements MedicationParser {
  parse(blocks: ExtractedText[]): ParsedMedication[] {
    const byDocument = new Map<string, ExtractedText[]>();
    for (const block of blocks.filter(b => b.kind === 'medications' && b.evidence.documentId && bounds(b))) {
      const id = block.evidence.documentId!;
      byDocument.set(id, [...(byDocument.get(id) ?? []), block]);
    }
    const result: ParsedMedication[] = [];
    for (const rows of byDocument.values()) {
      const indexes = rows.filter(b => /^\d{1,2}$/.test(b.text.trim()) && b.evidence.confidence >= .70)
        .sort((a, b) => centerY(a) - centerY(b));
      const used = new Set<ExtractedText>();
      for (const [i, anchor] of indexes.entries()) {
        const nearby = rows.filter(b => Math.abs(centerY(b) - centerY(anchor)) <= 20);
        const nextY = indexes[i + 1] ? centerY(indexes[i + 1]) : centerY(anchor) + 95;
        const detail = rows.filter(b => centerY(b) > centerY(anchor) + 20 && centerY(b) < Math.min(nextY - 15, centerY(anchor) + 72));
        const parsed = parseIndexedRow(anchor, nearby, detail);
        if (parsed) { result.push(parsed); for (const b of nearby) used.add(b); for (const b of detail) used.add(b); }
      }
      for (const block of rows) {
        if (used.has(block)) continue;
        const parsed = parseInline(block);
        if (parsed) result.push(parsed);
      }
    }
    return result.slice(0, 30);
  }
}
