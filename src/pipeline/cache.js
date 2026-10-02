/**
 * Read cache: an unchanged crop must return the text it produced before, not
 * nothing. Returning nothing is what made the live read flip from a correct
 * number to "no number" on the next poll.
 */
export class ReadCache {
  constructor() {
    this.map = new Map();
  }

  get(id, hash) {
    const hit = this.map.get(id);
    return hit && hit.hash === hash ? hit : null;
  }

  set(id, hash, text) {
    this.map.set(id, { hash, text });
  }

  clear() {
    this.map.clear();
  }
}
