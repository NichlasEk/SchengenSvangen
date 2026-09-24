import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Classification, Medication } from '../shared/model.js';

export type ReferenceProduct = {
  nplId: string; productName: string; strength: string; form: string;
  activeSubstance: string; atcCode: string; narcoticClass: 'none' | 'I' | 'II' | 'III' | 'IV' | 'V';
  pilotEvidence?: { checkedAt: string; fassUrl: string; lvUrl: string };
};
export type ReferenceSnapshot = {
  schemaVersion: 1; source: 'demo' | 'vara'; sourceVersion: string;
  generatedAt: string; products: ReferenceProduct[];
};
export type ReferenceInfo = { source: ReferenceSnapshot['source']; version: string; generatedAt: string; status: 'demo' | 'current' | 'stale' };
const normalize = (value: string) => value.trim().toLocaleLowerCase('sv-SE').replace(/\s+/g, ' ');
const classes = new Set(['none', 'I', 'II', 'III', 'IV', 'V']);
export function validateSnapshot(value: unknown): ReferenceSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid drug reference');
  const v = value as ReferenceSnapshot;
  if (v.schemaVersion !== 1 || !['demo', 'vara'].includes(v.source) || typeof v.sourceVersion !== 'string' ||
    !Number.isFinite(Date.parse(v.generatedAt)) || !Array.isArray(v.products) || v.products.length > 100_000 ||
    !v.products.every(p => p && [p.nplId, p.productName, p.strength, p.form, p.activeSubstance, p.atcCode].every(x => typeof x === 'string' && x.length <= 200) && classes.has(p.narcoticClass) &&
      (!p.pilotEvidence || (Number.isFinite(Date.parse(p.pilotEvidence.checkedAt)) && /^https:\/\/(?:www\.)?fass\.se\//.test(p.pilotEvidence.fassUrl) && /^https:\/\/www\.lakemedelsverket\.se\//.test(p.pilotEvidence.lvUrl))))) {
    throw new Error('Invalid drug reference');
  }
  return v;
}
export interface DrugReferenceSource {
  info(): ReferenceInfo;
  lookup(medication: Pick<Medication, 'productName' | 'strength' | 'form'>): ReferenceProduct | undefined;
}
export class SnapshotDrugReference implements DrugReferenceSource {
  private readonly byName = new Map<string, ReferenceProduct[]>();
  constructor(private readonly snapshot: ReferenceSnapshot, private readonly now = () => Date.now()) {
    validateSnapshot(snapshot);
    for (const product of snapshot.products) {
      const name = normalize(product.productName);
      this.byName.set(name, [...(this.byName.get(name) ?? []), product]);
    }
  }
  info(): ReferenceInfo {
    const age = this.now() - Date.parse(this.snapshot.generatedAt);
    return { source: this.snapshot.source, version: this.snapshot.sourceVersion, generatedAt: this.snapshot.generatedAt,
      status: this.snapshot.source === 'demo' ? 'demo' : age >= 0 && age <= 48 * 60 * 60_000 ? 'current' : 'stale' };
  }
  lookup(medication: Pick<Medication, 'productName' | 'strength' | 'form'>): ReferenceProduct | undefined {
    if (this.info().status === 'stale' || !medication.productName.trim() || !medication.strength.trim()) return;
    const candidates = (this.byName.get(normalize(medication.productName)) ?? []).filter(p => normalize(p.strength) === normalize(medication.strength));
    const withForm = medication.form.trim() ? candidates.filter(p => normalize(p.form) === normalize(medication.form)) : candidates;
    const current = withForm.filter(p => !p.pilotEvidence || (this.now() - Date.parse(p.pilotEvidence.checkedAt) >= 0 && this.now() - Date.parse(p.pilotEvidence.checkedAt) <= 30 * 86_400_000));
    return current.length === 1 ? current[0] : undefined;
  }
}
export function loadDrugReference(): SnapshotDrugReference {
  const file = process.env.DRUG_REFERENCE_FILE ?? path.resolve('reference/demo-products.json');
  return new SnapshotDrugReference(validateSnapshot(JSON.parse(readFileSync(file, 'utf8'))));
}
export class ReferenceClassificationService {
  constructor(private readonly source: DrugReferenceSource) {}
  info() { return this.source.info(); }
  match(medication: Medication) { return this.source.lookup(medication); }
  classify(medication: Medication): Classification {
    const info = this.source.info(), product = this.source.lookup(medication);
    const prefix = info.source === 'demo' ? 'Fiktivt demoregister' : 'VARA-referens';
    return {
      status: product ? product.narcoticClass === 'none' ? 'not-required' : 'required' : 'unknown',
      referenceVersion: `${info.source}:${info.version}`,
      reason: !product ? info.status === 'stale' ? 'Referensdata är äldre än 48 timmar. Uppdatera innan klassning.'
        : 'Ingen entydig produktträff med namn, styrka och form. Kontrollera mot godkänd källa.'
        : product.pilotEvidence ? `Källkontrollerad pilotpost: narkotikaklass ${product.narcoticClass} för exakt produktvariant. Kontrollera aktuella källor före utfärdande.`
        : product.narcoticClass === 'none' ? `${prefix}: produkten har ingen narkotikaklass i denna referens.`
          : `${prefix}: narkotikaklass ${product.narcoticClass} för exakt produktvariant (${product.nplId}).`,
      sourceUrls: product?.pilotEvidence ? [product.pilotEvidence.fassUrl, product.pilotEvidence.lvUrl] : undefined,
    };
  }
}
