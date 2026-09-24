import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { blankMedication } from '../shared/model';
import type { DocumentKind, Medication, ReviewModel, SessionView } from '../shared/model';
import { draftReadiness } from '../shared/validation';
import './style.css';

type Field = keyof Pick<Medication, 'originalText' | 'productName' | 'strength' | 'form' | 'activeSubstance' | 'atcCode' | 'dosageText' | 'quantity' | 'totalActiveSubstance' | 'treatmentDays' | 'notes'>;
type PendingDocument = { id: string; kind: DocumentKind; file: File };
const kindLabels: Record<DocumentKind, string> = { patient: 'Kund / patient', medications: 'Läkemedel', prescriber: 'Förskrivare / recept' };
const fields: [Field, string, keyof Medication['confidence'] | null][] = [
  ['originalText', 'Ursprunglig rad', null], ['productName', 'Preparat', 'productName'],
  ['strength', 'Styrka', 'strength'], ['form', 'Form', 'form'],
  ['activeSubstance', 'Aktiv substans', 'activeSubstance'], ['atcCode', 'ATC-kod (internt)', null],
  ['dosageText', 'Dosering', 'dosage'], ['quantity', 'Mängd (internt)', 'quantity'],
  ['totalActiveSubstance', 'Total mängd verksam substans', null],
  ['treatmentDays', 'Behandling under resa (dagar)', null], ['notes', 'Anmärkningar', null],
];
const prescriberFields: [keyof Medication['prescriber'], string][] = [
  ['lastName', 'Efternamn'], ['firstName', 'Förnamn'], ['address', 'Adress'], ['phone', 'Telefon'],
];
function App() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [review, setReview] = useState<ReviewModel | null>(null);
  const [pending, setPending] = useState<PendingDocument[]>([]);
  const [kind, setKind] = useState<DocumentKind>('medications');
  const [selectedDocument, setSelectedDocument] = useState<string | null>(null);
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Välj bildtyp, lägg till underlag och analysera när du är klar.');
  const fileInput = useRef<HTMLInputElement>(null);

  function addFiles(files: File[], documentKind: DocumentKind) {
    const accepted = files.filter(file => ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) && file.size <= 8 * 1024 * 1024);
    if (accepted.length !== files.length) setMessage('Endast PNG, JPEG och WebP upp till 8 MB per bild kan läggas till.');
    setPending(previous => {
      const available = Math.max(0, 6 - previous.length);
      if (accepted.length > available) setMessage('Högst sex bilder per ärende.');
      return [...previous, ...accepted.slice(0, available).map(file => ({ id: crypto.randomUUID(), kind: documentKind, file }))];
    });
  }
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      if (session) return;
      const image = Array.from(event.clipboardData?.items ?? []).find(item => item.type.startsWith('image/'));
      const file = image?.getAsFile();
      if (file) { event.preventDefault(); addFiles([file], kind); }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [kind, session]);
  async function analyze() {
    if (!pending.some(d => d.kind === 'medications')) { setMessage('Lägg till minst en läkemedelsbild.'); return; }
    if (pending.reduce((sum, d) => sum + d.file.size, 0) > 24 * 1024 * 1024) { setMessage('Bilderna får vara högst 24 MB tillsammans.'); return; }
    setBusy(true); setMessage('Läser underlagen lokalt…');
    try {
      const body = new FormData();
      for (const document of pending) { body.append('images', document.file); body.append('kinds', document.kind); }
      const response = await fetch('/intyg/api/sessions', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Analysen misslyckades.');
      setSession(data); setReview(data.review); setSelectedDocument(data.documents[0]?.id ?? null);
      setPending([]); setEdited(new Set()); setDirty(false);
      setMessage(data.review.medications.length ? 'Bildläsningen är klar. Kontrollera alla föreslagna fält och klassningar mot underlagen.' : 'Inga säkra läkemedelsrader hittades. Lägg till dem manuellt och kontrollera mot bilden.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Tekniskt fel.'); }
    finally { setBusy(false); }
  }
  function markEdited(path: string) { setEdited(previous => new Set(previous).add(path)); setDirty(true); }
  function changeMedication(id: string, field: Field, value: string) {
    setReview(previous => {
      if (!previous) return previous;
      const fieldEvidence = { ...previous.fieldEvidence };
      const medications = previous.medications.map(m => {
        if (m.id !== id) return m;
        const updated = { ...m, [field]: value };
        if (field === 'productName' || field === 'strength' || field === 'form') {
          const substancePath = `medications.${id}.activeSubstance`, atcPath = `medications.${id}.atcCode`;
          if (fieldEvidence[substancePath]?.method === 'reference' && !edited.has(substancePath)) { updated.activeSubstance = ''; updated.confidence = { ...updated.confidence, activeSubstance: 0 }; delete fieldEvidence[substancePath]; }
          if (fieldEvidence[atcPath]?.method === 'reference' && !edited.has(atcPath)) { updated.atcCode = ''; delete fieldEvidence[atcPath]; }
        }
        return updated;
      });
      return { ...previous, medications, fieldEvidence };
    });
    markEdited(`medications.${id}.${field}`);
  }
  function addMedication() {
    setReview(previous => previous && previous.medications.length < 30 ? { ...previous, medications: [...previous.medications, blankMedication(crypto.randomUUID())] } : previous);
    setDirty(true);
  }
  function removeMedication(id: string) {
    setReview(previous => previous && ({ ...previous, medications: previous.medications.filter(m => m.id !== id) }));
    setDirty(true);
  }
  function changePrescriber(id: string, key: keyof Medication['prescriber'], value: string) {
    setReview(previous => previous && ({ ...previous, medications: previous.medications.map(m => m.id === id ? { ...m, prescriber: { ...m.prescriber, [key]: value }, prescriberSourceIds: { ...m.prescriberSourceIds, [key]: undefined } } : m) }));
    markEdited(`medications.${id}.prescriber.${key}`);
  }
  function copyPrescriber(id: string) {
    setReview(previous => {
      if (!previous) return previous;
      const source = previous.medications.find(m => m.id === id);
      return source ? { ...previous, medications: previous.medications.map(m => ({ ...m, prescriber: { ...source.prescriber }, prescriberCandidateId: source.prescriberCandidateId, prescriberSourceIds: { ...source.prescriberSourceIds } })) } : previous;
    });
    setEdited(previous => {
      const next = new Set(previous);
      const source = review?.medications.find(m => m.id === id);
      for (const medication of review?.medications ?? []) for (const [key] of prescriberFields) {
        const path = `medications.${medication.id}.prescriber.${key}`;
        if (source?.prescriberSourceIds?.[key]) next.delete(path);
        else next.add(path);
      }
      return next;
    });
    setDirty(true);
  }
  function usePrescriberCandidate(medicationId: string, candidateId: string, fillEmpty = false) {
    setReview(previous => {
      if (!previous) return previous;
      const candidate = previous.prescriberCandidates.find(c => c.id === candidateId);
      return candidate ? { ...previous, medications: previous.medications.map(m => {
        if (m.id !== medicationId) return m;
        const prescriber = { ...m.prescriber }, prescriberSourceIds = fillEmpty ? { ...m.prescriberSourceIds } : {} as Medication['prescriberSourceIds'];
        for (const [key] of prescriberFields) {
          if (!fillEmpty || !prescriber[key]) {
            prescriber[key] = candidate.prescriber[key];
            if (candidate.prescriber[key]) prescriberSourceIds[key] = candidate.id;
            else delete prescriberSourceIds[key];
          }
        }
        return { ...m, prescriber, prescriberSourceIds, prescriberCandidateId: candidate.id };
      }) } : previous;
    });
    setEdited(previous => { const next = new Set(previous); for (const [key] of prescriberFields) if (!fillEmpty) next.delete(`medications.${medicationId}.prescriber.${key}`); return next; });
    setDirty(true);
  }
  function changeCommon(section: 'patient' | 'travel' | 'pharmacy', key: string, value: string) {
    setReview(previous => previous && ({ ...previous, [section]: { ...previous[section], [key]: value } }));
    markEdited(`${section}.${key}`);
  }
  async function confirmReview() {
    if (!session || !review) return;
    setBusy(true);
    try {
      const response = await fetch(`/intyg/api/sessions/${session.id}/review`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(review) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Granskning kunde inte sparas.');
      setSession(data); setReview(data.review); setDirty(false);
      setMessage(`Granskning bekräftad. Klassningen har räknats om från ${data.review.referenceInfo.source === 'demo' ? 'demoregistret' : 'den importerade VARA-referensen'}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Tekniskt fel.'); }
    finally { setBusy(false); }
  }
  async function finish() {
    if (session) await fetch(`/intyg/api/sessions/${session.id}`, { method: 'DELETE' });
    setSession(null); setReview(null); setSelectedDocument(null); setEdited(new Set()); setDirty(false);
    setMessage('Sessionen är raderad. Lägg till nya bilder för nästa ärende.');
  }
  const required = review?.medications.filter(m => m.classification.status === 'required') ?? [];
  const unknown = review?.medications.filter(m => m.classification.status === 'unknown').length ?? 0;
  const readinessIssues = review ? draftReadiness(review) : [];
  const shownDocument = session?.documents.find(d => d.id === selectedDocument);
  const group = (section: 'patient' | 'travel' | 'pharmacy', label: string, entries: [string, string][]) => <div className="field-group"><h3>{label}</h3><div className="form-grid">{entries.map(([key, caption]) => { const source = review?.fieldEvidence[`${section}.${key}`]; return <label key={key}>{caption}{source && <span className={source.confidence < .9 ? 'confidence low' : 'confidence'}>{Math.round(source.confidence * 100)} %</span>}<input type={key.endsWith('Date') ? 'date' : 'text'} value={(review?.[section] as Record<string, string> | undefined)?.[key] ?? ''} onChange={e => changeCommon(section, key, e.target.value)} onFocus={() => { if (source?.documentId) setSelectedDocument(source.documentId); }} autoComplete="off"/><small className="field-source">{edited.has(`${section}.${key}`) ? 'Korrigerat manuellt' : source ? 'OCR-förslag – kontrollera mot bild' : 'Fylls i manuellt'}</small></label>; })}</div></div>;
  return <div className="app">
    <header><div className="brand"><span className="brand-icon">✦</span><div><strong>APOTHICTECH</strong><small>INTYG / ARBETSSTATION</small></div></div><span className="demo-pill">DEMO · LOKAL DRIFT</span></header>
    <main>
      <div className="eyebrow">SCHENGENINTYG / ARBETSFLÖDE 01</div>
      <h1>Flera underlag.<br/><em>Ett granskat intyg per preparat.</em></h1>
      <p className="lede">Samla kund-, läkemedels- och förskrivarunderlag i samma ärende. Bilderna läses lokalt. Klassningen bygger på en separat, versionerad produktreferens.</p>
      {!session && <section className="intake multi-intake"><div><span className="step">01 / UNDERLAG</span><h2>Lägg till skärmdumpar</h2><p>Välj vilken information bilden innehåller. Du kan klistra in med <kbd>Ctrl</kbd> + <kbd>V</kbd> eller välja flera bilder. En bild får innehålla fler än en typ av uppgifter; välj dess huvudsakliga innehåll.</p><div className="kind-picker">{(Object.keys(kindLabels) as DocumentKind[]).map(option => <button key={option} className={kind === option ? 'selected' : ''} onClick={() => setKind(option)}>{kindLabels[option]}</button>)}</div></div><div className="intake-actions"><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={e => { addFiles(Array.from(e.target.files ?? []), kind); e.target.value = ''; }}/><button className="primary" onClick={() => fileInput.current?.click()}>Välj bild(er)</button><span>eller klistra in till vald kategori</span></div><div className="pending-list">{pending.map(d => <div key={d.id}><span>{kindLabels[d.kind]} · {d.file.name}</span><button onClick={() => setPending(previous => previous.filter(x => x.id !== d.id))}>Ta bort</button></div>)}{pending.length > 0 && <button className="primary" disabled={busy || !pending.some(d => d.kind === 'medications')} onClick={() => void analyze()}>{busy ? 'Bearbetar…' : `Analysera ${pending.length} bild${pending.length === 1 ? '' : 'er'}`}</button>}</div></section>}
      <p role="status" className="notice">{message}</p>
      {session && review && <>
        <div className="summary"><div><b>{session.documents.length}</b><span>underlagsbilder</span></div><div><b>{review.medications.length}</b><span>läkemedelsrader</span></div><div><b>{required.length}</b><span>markerade för intyg</span></div><div><b>{unknown}</b><span>okända klassningar</span></div></div><p className="reference-status">Referens: {review.referenceInfo.source === 'demo' ? 'Testregister (fiktiva poster + avgränsad pilotpost)' : 'VARA-import'} · version {review.referenceInfo.version}{review.referenceInfo.status === 'stale' && ' · För gammal för automatisk klassning'}</p>
        <div className="review-grid">
          <section className="panel image-panel"><div className="panel-head"><span className="step">02 / KÄLLOR</span><h2>Originalbilder</h2></div><div className="document-tabs">{session.documents.map(d => <button key={d.id} className={selectedDocument === d.id ? 'selected' : ''} onClick={() => setSelectedDocument(d.id)}>{kindLabels[d.kind]}<small>{d.name}</small></button>)}</div>{shownDocument && <img src={`/intyg/api/sessions/${session.id}/images/${shownDocument.id}`} alt={`${kindLabels[shownDocument.kind]}: ${shownDocument.name}`}/>}<p>Jämför varje OCR-förslag med originalbilden. Passnummer anges manuellt.</p>{shownDocument && <details className="ocr-notes"><summary>Visa lästa textrader ({review.ocrObservations.filter(o => o.documentId === shownDocument.id).length})</summary>{review.ocrObservations.filter(o => o.documentId === shownDocument.id).map((o, i) => <div key={i}>{o.text} <small>{Math.round(o.confidence * 100)} %</small></div>)}</details>}</section>
          <section className="panel details-panel"><div className="panel-head"><span className="step">03 / GEMENSAMMA UPPGIFTER</span><h2>Patient, resa och apotek</h2></div>
            {group('patient', 'B. Patient', [['name','Efternamn och förnamn'],['passportNumber','Pass-/nationellt ID-kortnummer'],['personalIdentityNumber','Personnummer (resa inom Norden)'],['birthPlaceAndDate','Födelseort och födelsedatum'],['sex','Kön'],['nationality','Nationalitet'],['phone','Telefon'],['streetAddress','Gatuadress'],['postalAddress','Postnummer och ort']])}
            {!review.patient.name && session.documents.some(d => d.kind === 'patient') && <p className="warning">Kundbilden gav inget fullständigt namn. Ett kort klipp med bara efternamn eller födelsedatum räcker inte för att fylla intyget; kontrollera och ange hela namnet.</p>}
            {group('travel', 'Resa – fylls i manuellt', [['destination','Resmål (internt)'],['departureDate','Avresedatum / giltig från'],['returnDate','Hemkomstdatum / giltig till'],['durationDays','Resans längd (dagar)']])}
            {group('pharmacy', 'D. Apotek', [['name','Apotekets namn'],['phone','Telefon'],['address','Fullständig postadress'],['city','Ort']])}
          </section>
        </div>
        <section className="medications"><div className="section-head"><div><span className="step">04 / MANUELL GRANSKNING</span><h2>Identifierade preparat</h2></div><p>Osäkra eller saknade fält fylls i här. Förskrivare anges per preparat.</p></div>{review.medications.length === 0 && <p className="warning">Inga läkemedelsrader kunde tolkas. Lägg till en rad manuellt och jämför med bilden.</p>}
          {review.medications.map((m, index) => <article className="med-card" key={m.id}>
            <div className="med-heading"><span className="med-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{m.productName || 'Namnlöst preparat'}</h3><small>{m.originalText ? `Föreslagen rad: ${m.originalText}` : 'Manuellt tillagd rad'}</small></div><span className={`class-badge ${m.classification.status}`}>{dirty ? 'Klassning väntar på granskning' : m.classification.status === 'required' ? m.classification.sourceUrls?.length ? 'Intyg enligt pilotpost' : 'Intyg enligt demo-regel' : m.classification.status === 'not-required' ? 'Inget intyg enligt demo-regel' : 'Osäker klassning'}</span><button className="remove-med" onClick={() => removeMedication(m.id)}>Ta bort</button></div>
            <div className="med-fields">{fields.map(([key, label, confidence]) => { const path = `medications.${m.id}.${key}`, source = review.fieldEvidence[path], sourceDocument = session.documents.find(d => d.id === source?.documentId); return <label key={key}>{label}{confidence && <span className={m.confidence[confidence] < 0.8 ? 'confidence low' : 'confidence'}>{source?.method === 'mock-fixture' ? 'Ej bildläst' : source?.method === 'reference' ? 'Register' : source ? `${Math.round(m.confidence[confidence] * 100)} %` : 'Osäkert'}</span>}<input value={m[key]} onChange={e => changeMedication(m.id, key, e.target.value)} onFocus={() => { if (sourceDocument) setSelectedDocument(sourceDocument.id); }} placeholder="Ej känt — fyll i manuellt" autoComplete="off"/><small className="field-source">{edited.has(path) ? 'Korrigerat · ' : ''}{source?.method === 'mock-fixture' ? 'Mockfixture, ingen bildkälla' : source?.method === 'reference' ? `Produktreferens: ${source.rawText}` : sourceDocument ? `Källa: ${sourceDocument.name}` : 'Fylls i manuellt'}</small></label>; })}</div>
            <div className="prescriber-block"><div className="prescriber-heading"><h4>A. Förskrivare för detta preparat</h4><button onClick={() => copyPrescriber(m.id)}>Använd samma förskrivare på alla</button></div>{review.prescriberCandidates.length > 0 && <div className="candidate-list">{review.prescriberCandidates.map(c => <div key={c.id}><span>Bildförslag: {[c.prescriber.firstName, c.prescriber.lastName].filter(Boolean).join(' ') || 'Inget namn i bilden'}{c.workplaceName && ` · ${c.workplaceName}`}<small>Arbetsplatsens telefon: {c.workplacePhone || 'ej läst'} · Direkttelefon: {c.prescriber.phone && c.prescriber.phone !== c.workplacePhone ? c.prescriber.phone : 'ej läst'}</small></span><div className="candidate-actions"><button onClick={() => { usePrescriberCandidate(m.id, c.id); setSelectedDocument(c.documentId); }}>Använd</button><button onClick={() => { usePrescriberCandidate(m.id, c.id, true); setSelectedDocument(c.documentId); }}>Fyll tomma fält</button></div></div>)}</div>}<div className="form-grid">{prescriberFields.map(([key, label]) => { const candidate = review.prescriberCandidates.find(c => c.id === m.prescriberSourceIds?.[key]), source = candidate?.evidence[key], workplaceNumber = key === 'phone' && candidate && candidate.workplacePhone === m.prescriber.phone; return <label key={key}>{label}{source && <span className={source.confidence < .9 ? 'confidence low' : 'confidence'}>{Math.round(source.confidence * 100)} %</span>}<input value={m.prescriber[key]} onChange={e => changePrescriber(m.id, key, e.target.value)} onFocus={() => { if (source?.documentId) setSelectedDocument(source.documentId); }} placeholder="Ange manuellt" autoComplete="off"/><small className="field-source">{edited.has(`medications.${m.id}.prescriber.${key}`) ? 'Korrigerat manuellt' : source ? workplaceNumber ? 'Arbetsplatsens telefon från bild – kontrollera' : 'OCR-förslag från bild – kontrollera' : m.prescriber[key] ? 'Kontrollera mot bild' : 'Fylls i manuellt'}</small></label>; })}</div></div>
            <p className="reason"><b>Regelmotorns motivering:</b> {m.classification.reason} <small>({m.classification.referenceVersion})</small>{m.classification.sourceUrls?.map((url, i) => <a key={url} href={url} target="_blank" rel="noreferrer">{i === 0 ? 'FASS-produkt' : 'LV-föreskrift'}</a>)}</p>
          </article>)}<button className="add-med" onClick={addMedication} disabled={review.medications.length >= 30}>+ Lägg till läkemedel manuellt</button>
        </section>
        <section className="output panel"><div><span className="step">05 / UTKAST</span><h2>Separata PDF:er</h2><p>En PDF per preparat som demo-regeln markerar. Den officiella blanketten fylls som demo-utkast; signatur och stämpel lämnas tomma.</p>{readinessIssues.map((issue, i) => <p className="warning" key={i}>{issue}</p>)}</div>
          <div className="output-actions"><button className="primary" disabled={busy} onClick={() => void confirmReview()}>{session.reviewed && !dirty ? 'Granska igen' : 'Bekräfta granskning'}</button>{session.reviewed && !dirty && readinessIssues.length === 0 && required.map(m => <div className="pdf-row" key={m.id}><span>{m.productName}</span><a href={`/intyg/api/sessions/${session.id}/certificates/${m.id}.pdf`} download>Ladda ner PDF</a><button onClick={() => { window.open(`/intyg/api/sessions/${session.id}/certificates/${m.id}.pdf?delivery=print`, '_blank'); }}>Skriv ut</button></div>)}<button className="quiet" onClick={() => void finish()}>Avsluta och radera session</button></div>
        </section>
      </>}
      <footer>DEMO / Använd endast avidentifierade testbilder. Bilder och granskningsdata ligger tillfälligt i serverns minne.</footer>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
