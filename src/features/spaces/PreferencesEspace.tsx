import { useSpacePrefs } from '@/store/spacePrefs';
import { SwitchRow } from '@/features/settings/VoiceSettings';
import { Icon } from '@/components/Icon';
import type { UUID } from '@/types/db';

/**
 * Ce que ce serveur fait chez soi.
 *
 * Distinct des reglages du serveur : ceux-ci n'engagent que la personne qui les
 * pose et ne demandent aucun droit. Les melanger aurait laisse croire qu'on
 * coupe les notifications de tout le monde en coupant les siennes.
 *
 * Ils vivent sur la machine — voir `spacePrefs`.
 */

/** Teintes proposees pour la pastille. Assez espacees pour rester distinctes. */
const TEINTES = [
  { valeur: null, nom: 'Par defaut' },
  { valeur: '#f87171', nom: 'Rouge' },
  { valeur: '#fb923c', nom: 'Orange' },
  { valeur: '#facc15', nom: 'Jaune' },
  { valeur: '#4ade80', nom: 'Vert' },
  { valeur: '#38bdf8', nom: 'Bleu' },
  { valeur: '#a78bfa', nom: 'Violet' },
  { valeur: '#f472b6', nom: 'Rose' },
];

export function PreferencesEspace({ spaceId }: { spaceId: UUID }) {
  const prefs = useSpacePrefs((state) => state.parEspace[spaceId]);
  const pour = useSpacePrefs((state) => state.pour);
  const regler = useSpacePrefs((state) => state.regler);
  const reinitialiser = useSpacePrefs((state) => state.reinitialiser);

  // `prefs` n'est lu que pour redeclencher le rendu ; la valeur complete vient
  // de `pour`, qui comble les defauts.
  void prefs;
  const p = pour(spaceId);

  return (
    <div className="mod-section">
      <section className="settings__group">
        <h2 className="settings__group-title">Notifications</h2>

        <SwitchRow
          label="Mettre ce serveur en sourdine"
          hint="Plus aucune notification ni son, quoi qu'il s'y passe. Le compteur de non-lus reste visible."
          checked={p.muet}
          onChange={(valeur) => regler(spaceId, 'muet', valeur)}
        />

        <SwitchRow
          label="Ignorer @everyone et @here"
          hint="Les mentions qui vous nomment passent toujours. Celles qui s'adressent a tout le monde, non."
          checked={p.ignorerGlobales}
          onChange={(valeur) => regler(spaceId, 'ignorerGlobales', valeur)}
        />

        <div className="field">
          <span className="field__label">Ce qui compte comme non-lu</span>
          <div className="mod-choice" role="group">
            {(
              [
                ['tout', 'Tous les messages'],
                ['mentions', 'Seulement les mentions'],
                ['rien', 'Rien'],
              ] as const
            ).map(([valeur, label]) => (
              <button
                key={valeur}
                type="button"
                className={'chip' + (p.notifications === valeur ? ' is-active' : '')}
                aria-pressed={p.notifications === valeur}
                onClick={() => regler(spaceId, 'notifications', valeur)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <SwitchRow
          label="Signal sonore quand quelqu'un entre en vocal"
          hint="Utile sur un serveur ou l'on se retrouve ; penible sur un serveur de deux cents personnes."
          checked={p.sonVocal}
          onChange={(valeur) => regler(spaceId, 'sonVocal', valeur)}
        />
      </section>

      <section className="settings__group">
        <h2 className="settings__group-title">Affichage</h2>

        <SwitchRow
          label="Montrer qui est en vocal sous chaque salon"
          hint="Les photos et les noms apparaissent sous le salon. A couper si la liste devient trop longue."
          checked={p.apercuVocal}
          onChange={(valeur) => regler(spaceId, 'apercuVocal', valeur)}
        />

        <SwitchRow
          label="Masquer les categories vides"
          hint="Un titre de categorie sans salon dessous n'apprend rien."
          checked={p.masquerCategoriesVides}
          onChange={(valeur) => regler(spaceId, 'masquerCategoriesVides', valeur)}
        />

        <SwitchRow
          label="Masquer les salons ou je ne peux pas ecrire"
          hint="Ne garde que ce a quoi vous pouvez repondre."
          checked={p.masquerSalonsMuets}
          onChange={(valeur) => regler(spaceId, 'masquerSalonsMuets', valeur)}
        />

        <div className="field">
          <span className="field__label">Teinte de ce serveur</span>
          <span className="field__hint">
            Colore sa pastille dans la colonne de gauche. Sur dix serveurs, la
            couleur se retrouve plus vite qu&rsquo;un nom.
          </span>

          <div className="roles__couleurs" role="group" aria-label="Teinte du serveur">
            {TEINTES.map((teinte) => (
              <button
                key={teinte.nom}
                type="button"
                className={
                  'roles__couleur' + (p.couleur === teinte.valeur ? ' is-active' : '')
                }
                style={teinte.valeur ? { background: teinte.valeur } : undefined}
                title={teinte.nom}
                aria-label={teinte.nom}
                aria-pressed={p.couleur === teinte.valeur}
                onClick={() => regler(spaceId, 'couleur', teinte.valeur)}
              >
                {teinte.valeur ? null : <Icon name="x" size={12} />}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings__group">
        <button type="button" className="btn btn--sm" onClick={() => reinitialiser(spaceId)}>
          <Icon name="refresh" size={14} />
          Remettre les valeurs par defaut
        </button>
        <p className="settings__hint">
          Ces reglages ne valent que sur cet appareil et ne sont visibles de
          personne d&rsquo;autre.
        </p>
      </section>
    </div>
  );
}
