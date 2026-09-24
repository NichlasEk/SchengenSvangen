import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Medication, ReviewModel, SessionView } from '../shared/model';
import { draftReadiness } from '../shared/validation';
import './style.css';

type Field = keyof Pick<Medication, 'originalText' | 'productName' | 'strength' | 'form' | 'activeSubstance' | 'atcCode' | 'dosageText' | 'quantity' | 'totalActiveSubstance' | 'treatmentDays' | 'notes'>;
const fields: [Field, string, keyof Medication['confidence'] | null][] = [
  ['originalText', 'Ursprunglig rad', null],
  ['productName', 'Preparat', 'productName'], ['strength', 'Styrka', 'strength'],
  ['form', 'Form', null], ['activeSubstance', 'Aktiv substans', 'activeSubstance'],
  ['atcCode', 'ATC-kod (internt)', null], ['dosageText', 'Dosering', 'dosage'], ['quantity', 'Mängd (internt)', null],
  ['totalActiveSubstance', 'Total mängd verksam substans', null], ['treatmentDays', 'Behandling under resa (dagar)', null], ['notes', 'Anmärkningar', null],
];
const emptyMessage = 'Börja med att klistra in en skärmdump eller välja en bild.';
function App() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [review, setReview] = useState<ReviewModel | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(emptyMessage);
  const fileInput = useRef<HTMLInputElement>(null);

  async function submitImage(file: File) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setMessage('Välj en PNG-, JPEG- eller WebP-bild.'); return; }
    if (file.size > 8 * 1024 * 1024) { setMessage('Bilden är för stor (max 8 MB).'); return; }
    setBusy(true); setMessage('Analyserar demo-bilden…');
    try {
      const body = new FormData(); body.append('image', file);
      const response = await fetch('/intyg/api/sessions', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Analysen misslyckades.');
      if (session) await fetch(`/intyg/api/sessions/${session.id}`, { method: 'DELETE' });
      setSession(data); setReview(data.review); setDirty(false);
      setMessage('Demo-extraktion klar. Raderna kommer från en syntetisk fixture, inte från bildens innehåll. Kontrollera allt.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Tekniskt fel.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const image = Array.from(event.clipboardData?.items ?? []).find(item => item.type.startsWith('image/'));
      const file = image?.getAsFile();
      if (file) { event.preventDefault(); void submitImage(file); }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });
  function changeMedication(id: string, field: Field, value: string) {
    setReview(previous => previous && ({ ...previous, medications: previous.medications.map(m => m.id === id ? { ...m, [field]: value } : m) }));
    setDirty(true);
  }
  function changeCommon(section: 'patient' | 'travel' | 'prescriber' | 'pharmacy', key: string, value: string) {
    setReview(previous => previous && ({ ...previous, [section]: { ...previous[section], [key]: value } }));
    setDirty(true);
  }
  async function confirmReview() {
    if (!session || !review) return;
    setBusy(true);
    try {
      const response = await fetch(`/intyg/api/sessions/${session.id}/review`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(review) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Granskning kunde inte sparas.');
      setSession(data); setReview(data.review); setDirty(false);
      setMessage('Granskning bekräftad. Klassningen har räknats om från demo-registret. PDF-utkast kan nu hämtas.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Tekniskt fel.'); }
    finally { setBusy(false); }
  }
  async function finish() {
    if (session) await fetch(`/intyg/api/sessions/${session.id}`, { method: 'DELETE' });
    setSession(null); setReview(null); setDirty(false); setMessage('Sessionen är raderad. Klistra in eller välj en ny bild.');
    if (fileInput.current) fileInput.current.value = '';
  }
  const required = review?.medications.filter(m => m.classification.status === 'required') ?? [];
  const unknown = review?.medications.filter(m => m.classification.status === 'unknown').length ?? 0;
  const readinessIssues = review ? draftReadiness(review) : [];
  const group = (section: 'prescriber' | 'patient' | 'travel' | 'pharmacy', label: string, entries: [string, string][]) => <div className="field-group"><h3>{label}</h3><div className="form-grid">{entries.map(([key, caption]) => <label key={key}>{caption}<input type={key.endsWith('Date') ? 'date' : 'text'} value={(review?.[section] as Record<string, string> | undefined)?.[key] ?? ''} onChange={e => changeCommon(section, key, e.target.value)} autoComplete="off"/></label>)}</div></div>;
  return <div className="app">
    <header><div className="brand"><span className="brand-icon">✦</span><div><strong>APOTHICTECH</strong><small>INTYG / ARBETSSTATION</small></div></div><span className="demo-pill">DEMO · LOKAL DRIFT</span></header>
    <main>
      <div className="eyebrow">SCHENGENINTYG / ARBETSFLÖDE 01</div>
      <h1>Från läkemedelslista<br/><em>till granskat intygsutkast.</em></h1>
      <p className="lede">Ett arbetsverktyg för farmaceutens kontroll. Den här versionen använder fiktiva läkemedel och skapar endast tydligt märkta PDF-utkast.</p>
      <section className="intake">
        <div className="intake-copy"><span className="step">01 / UNDERLAG</span><h2>Klistra in läkemedelslista</h2><p>Tryck <kbd>Ctrl</kbd> + <kbd>V</kbd> med en bild i urklipp, eller välj en fil. PNG, JPEG och WebP upp till 8 MB.</p></div>
        <div className="intake-actions"><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void submitImage(file); }}/><button className="primary" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? 'Bearbetar…' : 'Välj bild'}</button><span>eller klistra in var som helst på sidan</span></div>
      </section>
      <p role="status" className="notice">{message}</p>
      {session && review && <>
        <div className="summary"><div><b>{review.medications.length}</b><span>läkemedelsrader</span></div><div><b>{required.length}</b><span>markerade för intyg</span></div><div><b>{unknown}</b><span>okända klassningar</span></div><div><b>{new Date(session.expiresAt).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}</b><span>sessionen upphör</span></div></div>
        <div className="review-grid">
          <section className="panel image-panel"><div className="panel-head"><span className="step">02 / KÄLLA</span><h2>Originalbild</h2></div><img src={`/intyg/api/sessions/${session.id}/image`} alt="Uppladdad läkemedelslista för manuell jämförelse"/><p>Jämför varje fält mot bilden. Mock-adaptern läser ännu inga pixlar.</p></section>
          <section className="panel details-panel"><div className="panel-head"><span className="step">03 / GEMENSAMMA UPPGIFTER</span><h2>Uppgifter till officiell blankett</h2></div>
            {group('prescriber', 'A. Förskrivare', [['lastName','Efternamn'],['firstName','Förnamn'],['address','Adress'],['phone','Telefon']])}
            {group('patient', 'B. Patient', [['name','Efternamn och förnamn'],['passportNumber','Pass-/nationellt ID-kortnummer'],['personalIdentityNumber','Personnummer (resa inom Norden)'],['birthPlaceAndDate','Födelseort och födelsedatum'],['sex','Kön'],['nationality','Nationalitet'],['phone','Telefon'],['streetAddress','Gatuadress'],['postalAddress','Postnummer och ort']])}
            {group('travel', 'Resa', [['destination','Resmål (internt)'],['departureDate','Giltig från'],['returnDate','Giltig till'],['durationDays','Resans längd (dagar)']])}
            {group('pharmacy', 'D. Apotek', [['name','Apotekets namn'],['phone','Telefon'],['address','Fullständig postadress'],['city','Ort']])}
          </section>
        </div>
        <section className="medications"><div className="section-head"><div><span className="step">04 / MANUELL GRANSKNING</span><h2>Identifierade preparat</h2></div><p>Osäkra fält markeras. Korrigera data och bekräfta granskningen för ny klassning.</p></div>
          {review.medications.map((m, index) => <article className="med-card" key={m.id}>
            <div className="med-heading"><span className="med-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{m.productName || 'Namnlöst preparat'}</h3><small>Extraherad rad: {m.originalText}</small></div><span className={`class-badge ${m.classification.status}`}>{m.classification.status === 'required' ? 'Intyg enligt demo-regel' : m.classification.status === 'not-required' ? 'Inget intyg enligt demo-regel' : 'Osäker klassning'}</span></div>
            <div className="med-fields">{fields.map(([key, label, confidence]) => <label key={key}>{label}{confidence && <span className={m.confidence[confidence] < 0.8 ? 'confidence low' : 'confidence'}>{Math.round(m.confidence[confidence] * 100)} % säkerhet</span>}<input value={m[key]} onChange={e => changeMedication(m.id, key, e.target.value)} placeholder="Ej känt — fyll i manuellt" autoComplete="off"/></label>)}</div>
            <p className="reason"><b>Regelmotorns motivering:</b> {m.classification.reason} <small>({m.classification.referenceVersion})</small></p>
          </article>)}
        </section>
        <section className="output panel"><div><span className="step">05 / UTKAST</span><h2>Separata PDF:er</h2><p>En PDF per preparat som demo-regeln markerar. PDF:erna fyller Läkemedelsverkets officiella blankett men är märkta som demo-utkast. Signatur och stämpel lämnas tomma.</p>{readinessIssues.map((issue, i) => <p className="warning" key={i}>{issue}</p>)}</div>
          <div className="output-actions"><button className="primary" disabled={busy} onClick={() => void confirmReview()}>{session.reviewed && !dirty ? 'Granska igen' : 'Bekräfta granskning'}</button>{session.reviewed && !dirty && readinessIssues.length === 0 && required.map(m => <div className="pdf-row" key={m.id}><span>{m.productName}</span><a href={`/intyg/api/sessions/${session.id}/certificates/${m.id}.pdf`} download>Ladda ner PDF</a><button onClick={() => { window.open(`/intyg/api/sessions/${session.id}/certificates/${m.id}.pdf?delivery=print`, '_blank'); }}>Skriv ut</button></div>)}<button className="quiet" onClick={() => void finish()}>Avsluta och radera session</button></div>
        </section>
      </>}
      <footer>DEMO / Inga riktiga patientuppgifter. Bilder och granskningsdata ligger tillfälligt i serverns minne.</footer>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
