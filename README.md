# Apothictech Intyg

Första körbara **demo-MVP** för farmaceutisk granskning av läkemedelslistor och separata PDF-utkast. Repositoriet var tomt vid start. Stacken är React/TypeScript, Express/TypeScript, `pdf-lib` och en minnesbaserad sessionsbutik. Tjänsten kan köras lokalt utan molnnycklar.

**Använd endast syntetiska eller avidentifierade uppgifter i denna version.** Kund- och förskrivarbilder läses lokalt med Tesseract. Läkemedelsbilden använder fortfarande en mock som returnerar fyra fasta, fiktiva rader oavsett bildens innehåll. Regelmotorn har bara fyra fiktiva namn. PDF:erna fyller [Läkemedelsverkets officiella blankett](https://www.lakemedelsverket.se/sv/blanketter/schengenintyg/) men är tydligt märkta `DEMO / UTKAST` och är **inte utfärdade eller giltiga Schengenintyg**. Ett produktionsflöde kräver verifierad läkemedelsreferens, riktig läkemedelsextraktion, formell fältvalidering och säkerhetsgranskning.

## Lokal start

```sh
npm ci
sudo apt install tesseract-ocr tesseract-ocr-swe tesseract-ocr-eng # Debian/Ubuntu
npm run dev
```

Öppna `http://127.0.0.1:5173/intyg/`. Välj bildtyp och lägg till `tests/fixtures/kund-demo.png` som kundbild, `tests/fixtures/lakemedelslista-demo.png` som läkemedelsbild och `tests/fixtures/forskrivare-demo.png` som förskrivarbild. Ctrl+V lägger en bild i vald kategori. Kundbildens OCR-text visas som observationer; ofullständig identitet fylls inte i. Förskrivarbild med separata fält kan ge ett förslag som farmaceuten själv kopplar till rätt preparat. Fyll i **fiktiva** patient-, rese- och resterande förskrivaruppgifter, granska, bekräfta och hämta två PDF-utkast. Avsluta sessionen med knappen. `OCR_TESSDATA_DIR` kan peka på en egen katalog med språkfiler.

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
| `server/local-ocr.ts` | Lokal Tesseract-adapter och positionsbaserad tolkning av förskrivarfält; kundtext visas som observationer |
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

- Läkemedelsextraktionen är uttryckligen en fixture, inte OCR. Den ger fyra rader en gång även om flera läkemedelsbilder laddas upp och tillskriver inga fält någon bild. Byt dess `ImageExtractionProvider` utan att ändra review/PDF-lagren.
- Kund- och förskrivarbilder körs genom lokal OCR i RAM. Förskrivarens för- och efternamn, arbetsplatsadress och eventuellt direkttelefon föreslås från fältetiketter och positioner när säkerheten är tillräcklig. Arbetsplatsens telefon blir **inte** förskrivarens telefon. Förslag hör till källbilden och måste kopplas till läkemedel av användaren. Fel eller ofullständiga klipp kan ge tomma fält.
- Kundbildens lästa textrader visas med OCR-säkerhet och position men fyller ännu inte identitetsfält. Det korta exempelklippet visar bara del av födelsedatum och efternamn; ett fullständigt personnummer eller namn får inte konstrueras ur det. Passnummer anges manuellt. När ett komplett avidentifierat kundklipp finns kan en separat patientparser föreslå fler fält.
- Förskrivare hör till varje läkemedel. Granskaren kan kopiera samma förskrivare till alla när det stämmer.
- Regelmotorn gör exakta namnuppslag i en fiktiv versionerad referenskälla. Okända namn får `unknown`; den gissar inte utifrån OCR-förtroende eller ATC-kod.
- Förtroendesiffror för mock-raderna är demonstrativa. Substans och ATC lämnas tomma med låg säkerhet.
- Granskaren kan ändra alla tolkade fält; servern räknar om klassningen från kontrollerad källa när granskningen bekräftas. Ändring i klienten spärrar PDF tills ny bekräftelse.
- `reference/lv-schengenintyg.pdf` är den officiella PDF som hämtades från Läkemedelsverkets blankettlänk den 24 september 2026. SHA-256: `884f7c62a75763dc370845bba3ac0a566c0b16aee9db9019e613a893f04190e5`. Kontrollera alltid blankettlänken/versionen före produktionsbruk. PDF:ens formulärfält fylls och plattas till; blankettens skriptknappar tas bort.
