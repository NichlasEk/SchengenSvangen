# Produktreferens för intygsgranskning

## Val av källa

FASS visar produkt, substans, ATC och narkotikaklass på sina produktsidor. [FASS API](https://api.fass.se/documentation/index.html) kräver dock konto och [användarhandledningen](https://api.fass.se/userguide.pdf) anger särskild åtkomst. Bygg därför ingen bakgrundsskrapning av webbplatsen eller lokal FASS-kopia utan rätt till data och avtal.

[E‑hälsomyndighetens VARA-export](https://samarbetsyta.ehalsomyndigheten.se/handboken/latest/utveckla-mot-e-haelsomyndighetens-tjaenster/information-stoed-och-krav-per-delsystem/vara-nationellt-produkt-och-artikelregister/vara-exportfil/tillgang-till-vara-exportfil) är en bättre produktkälla för apoteksflödet. Dess [schema](https://samarbetsyta.ehalsomyndigheten.se/handboken/latest/utveckla-mot-e-haelsomyndighetens-tjaenster/information-stoed-och-krav-per-delsystem/vara-nationellt-produkt-och-artikelregister/vara-dokumentation-av-xml-schema/dokumentation-av-xml-schema-version-8-0) innehåller bland annat produktidentitet, ATC och `narkotika_klass`. Exporten kräver ansökan, avtal och inloggning; den får inte kopieras fritt till tredje part. De narkotikaklassade substanserna regleras i [LVFS 2011:10 med ändringar](https://www.lakemedelsverket.se/sv/lagar-och-regler/foreskrifter/2011-10-konsoliderad). ATC är en gruppering, inte ett tillräckligt klassningsbevis.

## Implementerat gränssnitt

`DRUG_REFERENCE_FILE` kan peka på en **lokal, behörigt framtagen och kontrollerad** normaliserad JSON-snapshot. Utan den används `reference/demo-products.json` med endast fyra fiktiva poster. Filen lagras utanför Git om den innehåller licensierade produktdata. Ingen patientinformation skickas till referenskällan.

Exempelformat (fiktiva data):

```json
{
  "schemaVersion": 1,
  "source": "vara",
  "sourceVersion": "export-YYYY-MM-DD",
  "generatedAt": "2026-09-24T00:30:00Z",
  "products": [
    {
      "nplId": "TEST-001",
      "productName": "Fiktivt preparat",
      "strength": "5 mg",
      "form": "tablett",
      "activeSubstance": "Fiktiv substans",
      "atcCode": "",
      "narcoticClass": "II"
    }
  ]
}
```

Tillåtna klassvärden är `none`, `I`, `II`, `III`, `IV`, `V`. Importsteget från verklig VARA-XML och lexikon måste byggas och granskas mot en faktiskt åtkommen export innan denna fil tas i bruk. Det får inte gissa kodmappning. Motorn kräver en enda post med exakt normaliserat produktnamn, styrka och form. Dubbletter, saknade uppgifter och snapshot äldre än 48 timmar ger `unknown`, aldrig ett automatiskt nej. Utgå från VARA:s uppdateringsfrekvens och kontrollera även att myndighetens föreskrifter är aktuella.

För att prova arkitekturen nu: kör de medföljande syntetiska bilderna och demoregistret. Vill du prova produktspecifik klassning med behörig data senare, lägg en normaliserad snapshot på servern och sätt `DRUG_REFERENCE_FILE` i tjänstens miljö. Starta om tjänsten; den läser in och validerar snapshot vid start. Detta är ett adaptergränssnitt, inte en färdig produktionsintegration.
