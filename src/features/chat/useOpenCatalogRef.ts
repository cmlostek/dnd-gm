import { useNavigate } from 'react-router-dom';
import { useNotes } from '../notes/notesStore';
import { useNpcStore } from '../npcs/npcStore';
import type { CatalogKind } from './catalog';

/**
 * Canonical "open this catalog entry" routing.
 *
 * Notes and NPCs are selected through their stores (those pages render the
 * active record rather than reading the URL); everything else deep-links via a
 * hash the destination page already understands.
 *
 * Shared by the chat chips and the command palette so a note opened from
 * either lands in the same place.
 */
export function useOpenCatalogRef(): (kind: CatalogKind, identifier: string) => void {
  const navigate = useNavigate();
  const setActiveNote = useNotes((s) => s.setActiveNote);
  const setActiveNpc = useNpcStore((s) => s.setActive);

  return (kind, identifier) => {
    switch (kind) {
      case 'note':
        setActiveNote(identifier);
        navigate('/notes');
        break;
      case 'npc':
        setActiveNpc(identifier);
        navigate('/npcs');
        break;
      case 'item':
        navigate(`/items#custom-${identifier}`);
        break;
      case 'srd-item':
        navigate(`/items#${identifier}`);
        break;
      case 'spell':
        navigate(`/spells#custom-${identifier}`);
        break;
      case 'srd-spell':
        navigate(`/spells#${identifier}`);
        break;
      case 'rule':
        navigate(`/rules#${identifier}`);
        break;
    }
  };
}
