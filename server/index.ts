import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { createReview, classifier } from './pipeline.js';
import { SessionStore } from './sessions.js';
import { DemoCertificateGenerator, DemoPdfTemplate } from './certificates.js';
import { draftReadiness } from '../shared/validation.js';
import type { Medication, ReviewModel } from '../shared/model.js';

const app = express();
const ttlMs = Number(process.env.SESSION_TTL_MINUTES ?? 15) * 60_000;
const sessions = new SessionStore(Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 15 * 60_000);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const allowedMime = new Set(['image/png', 'image/jpeg', 'image/webp']);
function matchesImageSignature(bytes: Buffer, mime: string): boolean {
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg') return bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/webp') return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  return false;
}
app.disable('x-powered-by');
app.use((_, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff'); next(); });
app.use(express.json({ limit: '1mb' }));

function validateReview(value: unknown, original: ReviewModel): ReviewModel | undefined {
  if (!value || typeof value !== 'object') return;
  const r = value as ReviewModel;
  if (!r.patient || !r.travel || !r.prescriber || !r.pharmacy || !Array.isArray(r.medications) || r.medications.length !== original.medications.length) return;
  const plain = (v: unknown) => typeof v === 'string' && v.length <= 500;
  if (![...Object.values(r.prescriber), ...Object.values(r.patient), ...Object.values(r.travel), ...Object.values(r.pharmacy)].every(plain)) return;
  const ids = new Set(original.medications.map(m => m.id));
  if (!r.medications.every(m => m && ids.has(m.id) &&
    [m.originalText, m.productName, m.strength, m.form, m.activeSubstance, m.atcCode, m.dosageText, m.quantity, m.totalActiveSubstance, m.treatmentDays, m.notes].every(plain))) return;
  if (new Set(r.medications.map(m => m.id)).size !== ids.size) return;
  return {
    prescriber: r.prescriber, patient: r.patient, travel: r.travel, pharmacy: r.pharmacy,
    medications: r.medications.map((m: Medication) => {
      const saved = original.medications.find(x => x.id === m.id)!;
      return { ...saved, originalText: m.originalText, productName: m.productName, strength: m.strength,
        form: m.form, activeSubstance: m.activeSubstance, atcCode: m.atcCode, dosageText: m.dosageText,
        quantity: m.quantity, totalActiveSubstance: m.totalActiveSubstance, treatmentDays: m.treatmentDays,
        notes: m.notes, classification: classifier.classify(m) };
    }),
  };
}

app.post('/intyg/api/sessions', upload.single('image'), async (req, res) => {
  if (!req.file || !allowedMime.has(req.file.mimetype) || !matchesImageSignature(req.file.buffer, req.file.mimetype)) { res.status(400).json({ error: 'Välj en giltig PNG-, JPEG- eller WebP-bild.' }); return; }
  try {
    const review = await createReview(req.file.buffer, req.file.mimetype);
    res.status(201).json(sessions.create(req.file.buffer, req.file.mimetype, review));
  } catch { res.status(500).json({ error: 'Bilden kunde inte behandlas.' }); }
});
app.get('/intyg/api/sessions/:id', (req, res) => {
  const s = sessions.get(req.params.id); if (!s) { res.sendStatus(404); return; }
  res.json(sessions.view(s));
});
app.get('/intyg/api/sessions/:id/image', (req, res) => {
  const s = sessions.get(req.params.id); if (!s) { res.sendStatus(404); return; }
  res.type(s.mimeType).send(s.image);
});
app.put('/intyg/api/sessions/:id/review', (req, res) => {
  const s = sessions.get(req.params.id); if (!s) { res.sendStatus(404); return; }
  const review = validateReview(req.body, s.review);
  if (!review) { res.status(400).json({ error: 'Ogiltiga granskningsuppgifter.' }); return; }
  res.json(sessions.update(s.id, review));
});
app.get('/intyg/api/sessions/:id/certificates/:medicationId.pdf', async (req, res) => {
  const s = sessions.get(req.params.id); if (!s) { res.sendStatus(404); return; }
  if (!s.reviewed) { res.status(409).json({ error: 'Granskning krävs före PDF.' }); return; }
  const issues = draftReadiness(s.review);
  if (issues.length) { res.status(409).json({ error: issues.join(' ') }); return; }
  const cert = new DemoCertificateGenerator().generate(s.review).find(c => c.id === req.params.medicationId);
  if (!cert) { res.sendStatus(404); return; }
  try {
    const pdf = await new DemoPdfTemplate().render(cert);
    sessions.markGenerated(s.id);
    res.set('Content-Type', 'application/pdf');
    const disposition = req.query.delivery === 'print' ? 'inline' : 'attachment';
    res.set('Content-Disposition', `${disposition}; filename="intyg-utkast-${cert.id}.pdf"`);
    res.send(Buffer.from(pdf));
  } catch { res.status(500).json({ error: 'PDF kunde inte skapas.' }); }
});
app.delete('/intyg/api/sessions/:id', (req, res) => { sessions.delete(req.params.id); res.sendStatus(204); });
app.use('/intyg', express.static(path.resolve('dist'), { index: 'index.html' }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError) { res.status(413).json({ error: 'Bilden är för stor (max 8 MB).' }); return; }
  res.status(500).json({ error: 'Tekniskt fel.' });
});
setInterval(() => sessions.cleanup(), 60_000).unref();
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
app.listen(port, host, () => console.info(`API lyssnar på ${host}:${port}`));
