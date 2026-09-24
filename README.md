# Apothictech Intyg

Första körbara **demo-MVP** för farmaceutisk granskning av läkemedelslistor och separata PDF-utkast. Repositoriet var tomt vid start. Stacken är React/TypeScript, Express/TypeScript, `pdf-lib` och en minnesbaserad sessionsbutik. Tjänsten kan köras lokalt utan molnnycklar.

**Använd endast syntetiska eller avidentifierade uppgifter i denna version.** Alla tre bildtyper läses lokalt med Tesseract. Läkemedelsrader skapas bara när produkt och styrka går att läsa; annars får användaren lägga till rader manuellt. Regelmotorn använder fyra fiktiva produktposter och en tidsbegränsad, källkontrollerad pilotpost för Concerta depottablett 36 mg. PDF:erna fyller [Läkemedelsverkets officiella blankett](https://www.lakemedelsverket.se/sv/blanketter/schengenintyg/) men är tydligt märkta `DEMO / UTKAST` och är **inte utfärdade eller giltiga Schengenintyg**. Ett produktionsflöde kräver behörig, löpande uppdaterad läkemedelsreferens, validering mot fler skärmbildslayouter och säkerhetsgranskning.

## Lokal start

```sh
npm ci
sudo apt install tesseract-ocr tesseract-ocr-swe tesseract-ocr-eng # Debian/Ubuntu
npm run dev
```

Öppna `http://127.0.0.1:5173/intyg/`. Välj bildtyp och lägg till `tests/fixtures/kund-demo.png` som kundbild, `tests/fixtures/lakemedelslista-demo.png` som läkemedelsbild och `tests/fixtures/forskrivare-demo.png` som förskrivarbild. Ctrl+V lägger en bild i vald kategori. Kundbilden föreslår namn och andra tydligt märkta fält; passnummer lämnas tomt. Läkemedelsbilden ger fyra rader med källspårning, varav två träffar det fiktiva registret. Förskrivarbilden ger ett förslag som farmaceuten själv kopplar till rätt preparat. Fyll i resterande **fiktiva** uppgifter (bland annat resa, apotek, dosering och total mängd), granska, bekräfta och hämta två PDF-utkast. Avsluta sessionen med knappen. `OCR_TESSDATA_DIR` kan peka på en egen katalog med språkfiler.

För formulärlayouten ”Artikel för expedition”, prova `tests/fixtures/expeditionsartikel-demo.png` som läkemedelsbild. Benämning, styrka, form, substansbeskrivning och doseringsanvisning läses som separata fält. Förpackningsstorlek blandas inte ihop med expedierad mängd. Concerta 36 mg från det avidentifierade exempelklippet matchar en separat pilotpost och får källänkar i granskningsvyn; andra verkliga preparat förblir `unknown` tills referensdata finns.

Resmål, avresedatum, hemkomstdatum och resans längd anges manuellt en gång per ärende. Systemet kontrollerar att dagantalet stämmer med datumen och ligger inom 30 dagar; det fyller inte i dagantalet automatiskt.

```sh
npm test
npm run build
```

Alternativt: `docker compose up --build` och öppna `http://127.0.0.1:3001/intyg/`. Compose binder enbart till loopback. För exponering på annan värd krävs HTTPS och åtkomstskydd i reverse proxy.

## Serverdrift

Servern `192.168.32.186` kör samma repo under `/home/nichlas/SchengenSvangen` via `deploy/apothic-intyg.service`. Caddy tar emot `https://apothictech.se/intyg/`, kräver separat Basic Auth och proxyar `/intyg/*` till loopback-port 3001. Caddys accesslog är avstängd för `/intyg*`, eftersom URL:er innehåller tillfälliga sessions-ID. Inga hemligheter finns i Git-repot; lösenordet ligger separat på servern. Denna åtkomstkontroll är ett demo-skydd, inte en färdig klinisk behörighetsmodell.

## Struktur och gränser

| Katalog | Ansvar |
| --- | --- |
| `shared/model.ts` | Strukturerad `ReviewModel`, läkemedel och klassning |
| `server/pipeline.ts` | Flera typade bilder → `ImageExtractionProvider` → parser → normalizer → `DrugClassificationService` med utbytbar referenskälla och fältvis källspårning |
| `server/local-ocr.ts` | Lokal Tesseract-adapter, positioner och förskrivarparser |
| `server/patient-parser.ts` | Försiktig parser för märkta kundfält; passnummer lämnas tomt |
| `server/medication-parser.ts` | Läkemedelsrader från OCR; oläsbara bilder ger inga fiktiva träffar |
| `server/drug-reference.ts` | Versionerad produktreferens med entydig variantmatchning och 48 timmars färskhetskontroll för VARA-import |
| `server/sessions.ts` | RAM-sessioner, TTL och radering |
| `server/certificates.ts` | `CertificateGenerator`, officiell PDF-mall och PDF/print-adaptrar |
| `server/signed-submission.ts` | Separat framtida tjänst för återinläst signerat/stämplat dokument; stub utan uppladdning |
| `server/index.ts` | API, validering och statisk produktionsklient |
| `src/` | Inklistring, uppladdning och farmaceutens granskningsvy |

Sessionens data och bilder finns enbart i serverns RAM. Högst sex bilder per ärende, 8 MB per bild och 24 MB totalt. `SESSION_TTL_MINUTES` är 15 som standard. Sessionen tas bort vid explicit avslut eller timeout; en städning körs varje minut. Processomstart raderar alla sessioner. Servern loggar endast en teknisk startpost. Ingen patientanalys eller permanent bildkatalog finns. Webbläsarens egen nedladdning av PDF är däremot användarstyrd och påverkas inte av serverns TTL.

## Fysiskt och framtida inskickningsflöde

`DRAFT → REVIEWED → GENERATED → PRINTED → AWAITING_SIGNATURE → SIGNED_DOCUMENT_IMPORTED → READY_FOR_SUBMISSION → SUBMITTED`

MVP:n implementerar bara granskning, PDF-generering och att öppna PDF för utskrift. Den kan inte bekräfta att papperet verkligen skrivits ut, signerats eller stämplats. En framtida `SignedCertificateSubmissionService` ska ta emot **en ny skanning eller bild av det fysiskt signerade och stämplade intyget**, aldrig den nygenererade PDF:en som direkt leverans. Officiellt API/arbetsflöde måste granskas och dokumenteras före implementation. Fält 25 (stämpel) och 26 (underskrift/utfärdandedatum) lämnas tomma i utkastet.

Läkemedelsverket beskriver att [apotek utfärdar intyget och skickar kopia](https://www.lakemedelsverket.se/sv/handel-med-lakemedel/apotek/apotekskunder/schengenintyg), att originalet ges till resenären och att ett intyg behövs per narkotikaklassat preparat. Denna demo implementerar inte dessa formella steg.

## Antaganden och nästa byte av adapter

- Läkemedelsextraktionen använder lokal OCR. Den syntetiska läkemedelslistan ger fyra verkligt bildlästa rader, och en syntetisk expeditionsartikel ger en rad med bildläst substans och dosering. En orelaterad bild ger noll. Korta, okända eller oläsbara layouter kan kräva manuell rad. Förpackningsstorlek används inte som expedierad mängd.
- Kund- och förskrivarbilder körs genom lokal OCR i RAM. Förskrivarens för- och efternamn, arbetsplatsadress och eventuellt direkttelefon föreslås från fältetiketter och positioner när säkerheten är tillräcklig. Arbetsplatsens telefon blir **inte** förskrivarens telefon. Förslag hör till källbilden och måste kopplas till läkemedel av användaren. Fel eller ofullständiga klipp kan ge tomma fält.
- Kompletta, tydligt märkta kundfält ger förslag till namn, fullständigt personnummer och övriga igenkända uppgifter. Det korta exempelklippet visar bara del av födelsedatum och efternamn; det fyller inga identitetsfält. Passnummer OCR-fylls aldrig.
- Förskrivare hör till varje läkemedel. Granskaren kan kopiera samma förskrivare till alla när det stämmer.
- Regelmotorn kräver en entydig träff på namn, styrka och form i en versionerad produktreferens. Okända eller tvetydiga produkter får `unknown`. Produktreferensen kan även fylla substans och ATC utan att ändra OCR-texten. Det förvalda registret är fiktivt; se [referensdataplan](docs/REFERENCE_DATA.md).
- Granskaren kan ändra alla tolkade fält; servern räknar om klassningen från kontrollerad källa när granskningen bekräftas. Ändring i klienten spärrar PDF tills ny bekräftelse.
- `reference/lv-schengenintyg.pdf` är den officiella PDF som hämtades från Läkemedelsverkets blankettlänk den 24 september 2026. SHA-256: `884f7c62a75763dc370845bba3ac0a566c0b16aee9db9019e613a893f04190e5`. Kontrollera alltid blankettlänken/versionen före produktionsbruk. PDF:ens formulärfält fylls och plattas till; blankettens skriptknappar tas bort.
