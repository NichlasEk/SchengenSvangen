import { randomUUID } from 'node:crypto';
import type { ReviewModel, SessionView } from '../shared/model.js';
import type { InputDocument } from './pipeline.js';

type Session = Omit<SessionView, 'documents'> & { documents: InputDocument[]; expires: number };
export class SessionStore {
  private sessions = new Map<string, Session>();
  constructor(private ttlMs = 15 * 60_000, private now = () => Date.now()) {}
  create(documents: InputDocument[], review: ReviewModel): SessionView {
    const id = randomUUID(), expires = this.now() + this.ttlMs;
    const session: Session = { id, expires, expiresAt: new Date(expires).toISOString(), source: 'local-ocr+mock-medications', state: 'DRAFT', reviewed: false, review, documents };
    this.sessions.set(id, session);
    return this.view(session);
  }
  get(id: string): Session | undefined {
    const session = this.sessions.get(id);
    if (session && session.expires <= this.now()) { this.sessions.delete(id); return undefined; }
    return session;
  }
  view(session: Session): SessionView {
    return { id: session.id, expiresAt: session.expiresAt, source: session.source, state: session.state, reviewed: session.reviewed, documents: session.documents.map(({ id, kind, name, mimeType }) => ({ id, kind, name, mimeType })), review: session.review };
  }
  update(id: string, review: ReviewModel): SessionView | undefined {
    const session = this.get(id);
    if (!session) return;
    session.review = review;
    session.reviewed = true;
    session.state = 'REVIEWED';
    return this.view(session);
  }
  markGenerated(id: string) { const session = this.get(id); if (session?.reviewed) session.state = 'GENERATED'; }
  delete(id: string) { return this.sessions.delete(id); }
  cleanup() { for (const id of this.sessions.keys()) this.get(id); }
  get size() { this.cleanup(); return this.sessions.size; }
}
