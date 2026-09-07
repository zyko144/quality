import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Icon } from '@/components/Icon';
import { useChat } from '@/store/chat';
import { journal } from '@/lib/journal';
import type { UUID } from '@/types/db';

/**
 * Les webhooks d'un espace.
 *
 * Un webhook est une adresse secrete qui ne sait faire qu'une chose : ecrire
 * dans un salon. Un serveur de jeu, un integrateur continu, un script de
 * sauvegarde — des programmes qui ont quelque chose a dire et pas de compte.
 *
 * Ce que cette page doit permettre, et pourquoi chaque chose y est
 * -----------------------------------------------------------------
 * En creer un ne suffit pas. Une page qui ne ferait que cela serait
 * inutilisable des le lendemain :
 *
 *  - **copier l'adresse**, parce que c'est la seule chose qu'on vient y
 *    chercher, et qu'un jeton se recopie mal a la main ;
 *  - **voir ce qu'il fait** — combien d'appels, combien de refus, quand pour
 *    la derniere fois. « Est-ce que mon webhook marche ? » est la premiere
 *    question apres l'avoir branche, et sans ces trois nombres la seule
 *    reponse serait de regarder si un message est arrive, ce qui ne distingue
 *    pas « il n'a rien envoye » de « il a envoye et ca a ete refuse » ;
 *  - **regenerer le jeton**, parce qu'un secret finit dans un depot public ou
 *    une capture d'ecran, et que la seule autre issue serait de supprimer le
 *    webhook — donc de reconfigurer tout ce qui pointe dessus ;
 *  - **l'eteindre sans le supprimer**, pour arreter une boucle folle a trois
 *    heures du matin sans rien perdre ;
 *  - **le supprimer**, evidemment.
 */

interface Webhook {
  id: UUID;
  channel_id: UUID;
  nom: string;
  jeton: string;
  actif: boolean;
  appels: number;
  refus: number;
  dernier_le: string | null;
  created_at: string;
}

/** L'adresse a coller dans l'outil externe. */
function adresseDe(jeton: string): string {
  const base = import.meta.env.VITE_SUPABASE_URL ?? '';
  return `${base}/functions/v1/webhook/${jeton}`;
}

function quand(date: string | null): string {
  if (!date) return 'jamais';

  const ecart = Date.now() - Date.parse(date);
  if (ecart < 60_000) return "a l'instant";
  if (ecart < 3_600_000) return `il y a ${Math.round(ecart / 60_000)} min`;
  if (ecart < 86_400_000) return `il y a ${Math.round(ecart / 3_600_000)} h`;

  return new Date(date).toLocaleDateString('fr-FR');
}

export function Webhooks({ spaceId }: { spaceId: UUID }) {
  const channels = useChat((etat) => etat.channels);
  const salons = channels.filter((salon) => salon.space_id === spaceId && salon.kind === 'text');

  const [liste, setListe] = useState<Webhook[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [nom, setNom] = useState('');
  const [salon, setSalon] = useState<UUID | ''>('');
  const [copie, setCopie] = useState<UUID | null>(null);
  const [occupe, setOccupe] = useState(false);

  const charger = async () => {
    const { data, error } = await supabase
      .from('webhooks')
      .select('*')
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false });

    if (error) {
      /*
       * La table peut ne pas exister : la migration n'est pas forcement
       * appliquee. On le dit plutot que d'afficher une liste vide, qui ferait
       * croire qu'il n'y a rien alors qu'on n'a pas pu regarder.
       */
      setErreur('Les webhooks ne sont pas disponibles sur cette base.');
      setListe([]);
      return;
    }

    setErreur(null);
    setListe((data ?? []) as Webhook[]);
  };

  useEffect(() => {
    void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  useEffect(() => {
    if (salon === '' && salons[0]) setSalon(salons[0].id);
  }, [salons, salon]);

  const creer = async () => {
    if (!nom.trim() || !salon || occupe) return;
    setOccupe(true);

    const moi = (await supabase.auth.getUser()).data.user?.id;
    const { error } = await supabase.from('webhooks').insert({
      space_id: spaceId,
      channel_id: salon,
      nom: nom.trim(),
      cree_par: moi,
    });

    setOccupe(false);

    if (error) {
      setErreur(`Creation impossible : ${error.message}`);
      return;
    }

    journal.info('interface', 'Webhook cree', { salon });
    setNom('');
    void charger();
  };

  const copier = async (crochet: Webhook) => {
    try {
      await navigator.clipboard.writeText(adresseDe(crochet.jeton));
      setCopie(crochet.id);
      window.setTimeout(() => setCopie((actuel) => (actuel === crochet.id ? null : actuel)), 2000);
    } catch {
      setErreur("La copie n'a pas ete autorisee par le systeme.");
    }
  };

  const roter = async (crochet: Webhook) => {
    /*
     * On demande confirmation, parce que c'est irreversible pour ce qui est
     * deja branche : tout outil qui utilise l'ancienne adresse s'arrete a
     * l'instant meme, sans erreur visible de son cote.
     */
    const sur = window.confirm(
      `Regenerer l'adresse de « ${crochet.nom} » ? Tout ce qui utilise l'ancienne cessera d'ecrire.`,
    );
    if (!sur) return;

    const { error } = await supabase.rpc('roter_jeton_webhook', { p_webhook: crochet.id });
    if (error) setErreur(`Regeneration impossible : ${error.message}`);
    void charger();
  };

  const basculer = async (crochet: Webhook) => {
    const { error } = await supabase
      .from('webhooks')
      .update({ actif: !crochet.actif })
      .eq('id', crochet.id);

    if (error) setErreur(`Changement impossible : ${error.message}`);
    void charger();
  };

  const supprimer = async (crochet: Webhook) => {
    const sur = window.confirm(
      `Supprimer « ${crochet.nom} » ? Ses messages restent dans le salon ; seule l'adresse disparait.`,
    );
    if (!sur) return;

    const { error } = await supabase.from('webhooks').delete().eq('id', crochet.id);
    if (error) setErreur(`Suppression impossible : ${error.message}`);
    void charger();
  };

  return (
    <section className="settings__section">
      <header className="settings__section-tete">
        <h3>Webhooks</h3>
        <p className="settings__hint">
          Une adresse secrete qu&rsquo;un programme peut appeler pour ecrire dans un
          salon — un serveur de jeu, un deploiement, une sauvegarde. Elle ne lit
          rien et n&rsquo;ecrit que dans le salon choisi.
        </p>
        <p className="settings__hint">
          Le format est celui des webhooks Discord : ce qui parle deja a Discord
          parle a Echow, en changeant seulement l&rsquo;adresse.
        </p>
      </header>

      {erreur ? <p className="settings__erreur">{erreur}</p> : null}

      <div className="webhook__creation">
        <input
          className="input"
          value={nom}
          maxLength={48}
          placeholder="Nom — « Serveur Gmod », « Deploiements »…"
          onChange={(evenement) => setNom(evenement.target.value)}
        />

        <select
          className="input"
          value={salon}
          onChange={(evenement) => setSalon(evenement.target.value as UUID)}
        >
          {salons.map((entree) => (
            <option key={entree.id} value={entree.id}>
              #{entree.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="btn btn--primary"
          disabled={!nom.trim() || !salon || occupe}
          onClick={() => void creer()}
        >
          <Icon name="plus" size={14} />
          Creer
        </button>
      </div>

      {liste === null ? (
        <p className="settings__hint">Chargement…</p>
      ) : liste.length === 0 ? (
        <p className="settings__hint">Aucun webhook pour l&rsquo;instant.</p>
      ) : (
        <ul className="webhook__liste">
          {liste.map((crochet) => {
            const salonDuCrochet = channels.find((entree) => entree.id === crochet.channel_id);

            return (
              <li key={crochet.id} className={'webhook' + (crochet.actif ? '' : ' is-eteint')}>
                <div className="webhook__tete">
                  <strong className="webhook__nom truncate">{crochet.nom}</strong>
                  <span className="webhook__salon">#{salonDuCrochet?.name ?? 'salon supprime'}</span>
                  {crochet.actif ? null : <span className="webhook__eteint">Eteint</span>}
                </div>

                {/*
                  Ce qu'il a fait, en trois nombres.

                  « Est-ce que ca marche ? » ne se repond pas en regardant le
                  salon : un salon vide ne distingue pas « rien envoye » de
                  « envoye et refuse ». Les refus comptent donc a part.
                */}
                <p className="webhook__mesures">
                  {crochet.appels} message{crochet.appels > 1 ? 's' : ''}
                  {crochet.refus > 0 ? ` · ${crochet.refus} refuse${crochet.refus > 1 ? 's' : ''}` : ''}
                  {' · dernier '}
                  {quand(crochet.dernier_le)}
                </p>

                <div className="webhook__actions">
                  <button type="button" className="btn btn--sm" onClick={() => void copier(crochet)}>
                    <Icon name={copie === crochet.id ? 'check' : 'copy'} size={13} />
                    {copie === crochet.id ? 'Copiee' : "Copier l'adresse"}
                  </button>

                  <button type="button" className="btn btn--sm" onClick={() => void basculer(crochet)}>
                    <Icon name={crochet.actif ? 'mic-off' : 'check-circle'} size={13} />
                    {crochet.actif ? 'Eteindre' : 'Rallumer'}
                  </button>

                  <button type="button" className="btn btn--sm" onClick={() => void roter(crochet)}>
                    <Icon name="refresh" size={13} />
                    Regenerer
                  </button>

                  <button
                    type="button"
                    className="btn btn--sm btn--danger"
                    onClick={() => void supprimer(crochet)}
                  >
                    <Icon name="trash" size={13} />
                    Supprimer
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
