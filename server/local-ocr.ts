import { spawn } from 'node:child_process';
import type { FieldEvidence, PrescriberCandidate, OCRObservation } from '../shared/model.js';
import type { ExtractedText, ImageExtractionProvider, InputDocument } from './pipeline.js';

export function parseTsv(tsv: string, document: InputDocument): ExtractedText[] {
  const lines = new Map<string, { words: string[]; confidence: number[]; x: number; y: number; right: number; bottom: number }>();
  for (const row of tsv.split(/\r?\n/).slice(1)) {
    const c = row.split('\t');
    if (c.length < 12 || c[0] !== '5' || !c.slice(11).join('\t').trim()) continue;
    const x = Number(c[6]), y = Number(c[7]), width = Number(c[8]), height = Number(c[9]), confidence = Number(c[10]);
    if (![x, y, width, height, confidence].every(Number.isFinite) || confidence < 0) continue;
    const key = c.slice(1, 5).join('.');
    const line = lines.get(key) ?? { words: [], confidence: [], x, y, right: x + width, bottom: y + height };
    line.words.push(c.slice(11).join('\t').trim()); line.confidence.push(confidence / 100);
    line.x = Math.min(line.x, x); line.y = Math.min(line.y, y);
    line.right = Math.max(line.right, x + width); line.bottom = Math.max(line.bottom, y + height);
    lines.set(key, line);
  }
  return [...lines.values()].map(line => {
    const text = line.words.join(' ');
    return { kind: document.kind, text, evidence: { documentId: document.id, method: 'ocr' as const, rawText: text,
      confidence: line.confidence.reduce((a, b) => a + b, 0) / line.confidence.length,
      bounds: { x: line.x, y: line.y, width: line.right - line.x, height: line.bottom - line.y } } };
  }).sort((a, b) => (a.evidence.bounds!.y - b.evidence.bounds!.y) || (a.evidence.bounds!.x - b.evidence.bounds!.x));
}

export class LocalOCRProvider implements ImageExtractionProvider {
  async extract(documents: InputDocument[]): Promise<ExtractedText[]> {
    const output: ExtractedText[] = [];
    for (const document of documents.filter(d => d.kind !== 'medications')) {
      const args = ['stdin', 'stdout'];
      if (process.env.OCR_TESSDATA_DIR) args.push('--tessdata-dir', process.env.OCR_TESSDATA_DIR);
      args.push('-l', 'swe+eng', '--psm', '11', '-c', 'tessedit_create_tsv=1');
      const tsv = await new Promise<string>((resolve, reject) => {
        const child = spawn('tesseract', args, { stdio: ['pipe', 'pipe', 'ignore'] });
        const chunks: Buffer[] = []; let size = 0;
        const timeout = setTimeout(() => child.kill(), 12_000);
        child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 2_000_000) child.kill(); else chunks.push(chunk); });
        child.on('error', reject);
        child.on('close', code => { clearTimeout(timeout); code === 0 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error('OCR failed')); });
        child.stdin.on('error', () => {});
        child.stdin.end(document.bytes);
      });
      output.push(...parseTsv(tsv, document));
    }
    return output;
  }
}

const normalized = (text: string) => text.toLocaleLowerCase('sv-SE').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
function valueAfter(blocks: ExtractedText[], label: string): ExtractedText | undefined {
  const anchor = blocks.find(b => normalized(b.text) === normalized(label));
  const box = anchor?.evidence.bounds;
  if (!box) return;
  const rightLabel = blocks.filter(b => b !== anchor && b.evidence.bounds && Math.abs(b.evidence.bounds.y - box.y) < 14 && b.evidence.bounds.x > box.x + box.width + 15)
    .sort((a, b) => a.evidence.bounds!.x - b.evidence.bounds!.x)[0];
  const rightLimit = rightLabel?.evidence.bounds?.x ?? Infinity;
  return blocks.filter(b => b !== anchor && b.evidence.bounds && b.evidence.confidence >= .80 &&
    b.evidence.bounds.x >= box.x - 8 && b.evidence.bounds.x < rightLimit - 8 &&
    b.evidence.bounds.y > box.y + box.height && b.evidence.bounds.y < box.y + box.height + 36)
    .sort((a, b) => (a.evidence.bounds!.y - b.evidence.bounds!.y) || (a.evidence.bounds!.x - b.evidence.bounds!.x))[0];
}
export function parsePrescriberCandidates(blocks: ExtractedText[]): PrescriberCandidate[] {
  const byDocument = new Map<string, ExtractedText[]>();
  for (const block of blocks.filter(b => b.kind === 'prescriber' && b.evidence.documentId)) {
    const id = block.evidence.documentId!;
    byDocument.set(id, [...(byDocument.get(id) ?? []), block]);
  }
  return [...byDocument].map(([documentId, rows]) => {
    const first = valueAfter(rows, 'Förnamn'), last = valueAfter(rows, 'Efternamn');
    const workplaceName = valueAfter(rows, 'Namn'), street = valueAfter(rows, 'Adress');
    const postCode = valueAfter(rows, 'Postnummer'), city = valueAfter(rows, 'Postort');
    const workplacePhone = valueAfter(rows, 'Telefon arbetsplats');
    const prescriberPhone = valueAfter(rows, 'Telefon förskrivare');
    const evidence: PrescriberCandidate['evidence'] = {};
    if (first) evidence.firstName = first.evidence;
    if (last) evidence.lastName = last.evidence;
    if (street && postCode && city) evidence.address = { ...street.evidence, confidence: Math.min(street.evidence.confidence, postCode.evidence.confidence, city.evidence.confidence) };
    if (prescriberPhone) evidence.phone = prescriberPhone.evidence;
    return { id: documentId, documentId, prescriber: {
      firstName: first?.text ?? '', lastName: last?.text ?? '',
      address: street && postCode && city ? `${street.text}, ${postCode.text} ${city.text}` : '',
      phone: prescriberPhone?.text ?? '',
    }, workplaceName: workplaceName?.text ?? '', workplacePhone: workplacePhone?.text ?? '', evidence };
  });
}
export function toObservations(blocks: ExtractedText[]): OCRObservation[] {
  return blocks.filter(b => b.kind === 'patient' && b.evidence.documentId).map(b => ({
    documentId: b.evidence.documentId!, text: b.text, confidence: b.evidence.confidence, bounds: b.evidence.bounds,
  }));
}
