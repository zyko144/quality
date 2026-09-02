import { useEffect, useRef } from 'react';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { journal } from '@/lib/journal';
import { arriveeDuDepart, oublierArrivee } from '@/lib/lienDArrivee';

/**
 * Ce qui se passe quand on ouvre l'application par un lien.
 *
 * Un composant sans rendu, monte une fois. Il repare un defaut entier : les
 * trois sortes de liens que l'application produit — une invitation, un salon,
 * un message — n'etaient recues par personne. Le routeur ne connaissait que
 * trois adresses fixes, et tout le reste retombait silencieusement sur la
 * presentation.
 *
 * Ce qui rendait le defaut couteux, c'est qu'il etait invisible des deux cotes :
 * celui qui envoyait voyait un lien normal, copie par un bouton prevu pour
 * cela ; celui qui cliquait arrivait sur l'application sans comprendre pourquoi
 * elle ne l'avait pas emmene.
 *
 * La lecture de l'adresse vit dans `lienDArrivee.ts`, avec ses cas : elle porte
 * sur des chaines venues du dehors, et chacune doit pouvoir rendre « je ne sais
 * pas » plutot que d'emmener quelque part au hasard.
 */
export function Arrivee() {
  const ready = useChat((state) => state.ready);

  /*
   * Une seule fois, meme si l'application se remonte.
   *
   * L'adresse est effacee dans la foulee, mais entre sa lecture et son
   * effacement il y a un aller-retour vers la base : sans ce verrou, un second
   * rendu pourrait rejouer l'arrivee et demander deux fois a rejoindre le meme
   * espace.
   */
  const traitee = useRef(false);

  useEffect(() => {
    // On attend que les espaces et les salons soient charges : sans eux, ouvrir
    // un salon ne mene nulle part et l'on aurait consomme le lien pour rien.
    if (!ready || traitee.current) return;

    // L'adresse du lancement, retenue avant la redirection vers `/app` : c'est
    // elle qui porte le lien, et elle a deja disparu de la barre d'adresse.
    const arrivee = arriveeDuDepart();
    if (!arrivee) return;

    traitee.current = true;

    void (async () => {
      const chat = useChat.getState();

      if (arrivee.genre === 'invitation') {
        journal.info('interface', 'Arrivee par invitation', { code: arrivee.code });

        const espace = await chat.joinSpace(arrivee.code);
        oublierArrivee();

        if (!espace) {
          // `joinSpace` a deja pose le message d'erreur ; on n'en ajoute pas un
          // second qui dirait la meme chose autrement.
          journal.alerte('interface', 'Invitation refusee', { code: arrivee.code });
          return;
        }

        /*
         * On ouvre l'espace rejoint, et son premier salon.
         *
         * Rejoindre sans y aller laisserait la personne devant l'espace
         * precedent, en se demandant si le lien a fonctionne — ce qui est
         * exactement le doute qu'on essaie de lever.
         */
        const ui = useUI.getState();
        ui.selectSpace(espace.id);

        const premier = useChat
          .getState()
          .channels.filter((salon) => salon.space_id === espace.id && salon.kind === 'text')
          .sort((a, b) => a.position - b.position)[0];

        if (premier) ui.selectChannel(premier.id);
        return;
      }

      // Un salon ou un message : les deux mènent au meme endroit, le second
      // designant en plus la ligne a mettre en avant.
      const salonId =
        arrivee.genre === 'salon'
          ? arrivee.id
          : (chat.messages['direct']?.find((m) => m.id === arrivee.id)?.channel_id ?? null);

      const salon = useChat.getState().channels.find((entree) => entree.id === salonId);
      oublierArrivee();

      if (!salon) {
        journal.alerte('interface', 'Lien vers un salon introuvable', {
          genre: arrivee.genre,
          cible: arrivee.id,
        });
        useChat.setState({
          error:
            'Ce lien mene a un salon que vous ne pouvez pas ouvrir : il a ete supprime, ou vous n’en etes pas membre.',
        });
        return;
      }

      const ui = useUI.getState();
      if (salon.space_id) ui.selectSpace(salon.space_id);
      ui.selectChannel(salon.id);
    })();
  }, [ready]);

  return null;
}
