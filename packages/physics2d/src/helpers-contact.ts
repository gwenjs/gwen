// Tree-shakable contact helpers entry.
export {
  selectContactsForEntityId,
  dedupeContactsByPair,
  toResolvedContacts,
  selectResolvedContactsForEntityId,
  getEntityCollisionContacts,
} from './helpers/contact';
export type { ResolvedCollisionContact } from './types';
