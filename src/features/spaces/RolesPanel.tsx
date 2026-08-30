import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import {
  ALL_PERMISSIONS,
  PERMISSION_CATEGORIES,
  useRoles,
  type CustomRole,
} from '@/store/roles';
import type { UUID } from '@/types/db';

/**
 * Roles et permissions d'un espace.
 *
 * A gauche la liste des roles, a droite ce que le role choisi autorise. Les
 * permissions sont rangees par domaine plutot que listees d'un bloc : a
 * trente-six cases, une liste continue devient une page qu'on ne relit jamais.
 *
 * « Administrateur » est en tete, seul dans son groupe et en rouge. Elle accorde
 * tout le reste et rend les autres cases sans objet — l'interface les grise
 * alors, plutot que de laisser croire qu'on peut retirer quelque chose a
 * quelqu'un qui a deja tout.
 */

const COULEURS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#38bdf8',
  '#6366f1',
  '#a855f7',
  '#ec4899',
  '#94a3b8',
];

export function RolesPanel({ spaceId }: { spaceId: UUID }) {
  const loadSpace = useRoles((state) => state.loadSpace);
  const roles = useRoles((state) => state.roles[spaceId]);
  const createRole = useRoles((state) => state.createRole);
  const updateRole = useRoles((state) => state.updateRole);
  const deleteRole = useRoles((state) => state.deleteRole);

  const [choisi, setChoisi] = useState<string | null>(null);

  useEffect(() => {
    void loadSpace(spaceId);
  }, [spaceId, loadSpace]);

  const liste = roles ?? [];
  const role: CustomRole | undefined = liste.find((entree) => entree.id === choisi) ?? liste[0];

  const estAdmin = role?.permissions.includes('administrator') ?? false;

  const basculer = (permission: string) => {
    if (!role) return;
    const porte = role.permissions.includes(permission);
    void updateRole(spaceId, role.id, {
      permissions: porte
        ? role.permissions.filter((id) => id !== permission)
        : [...role.permissions, permission],
    });
  };

  return (
    <div className="roles">
      <aside className="roles__liste">
        <button
          type="button"
          className="btn btn--sm btn--primary roles__ajouter"
          onClick={() => void createRole(spaceId).then((cree) => cree && setChoisi(cree.id))}
        >
          <Icon name="plus" size={14} />
          Nouveau role
        </button>

        {liste.length === 0 ? (
          <p className="roles__vide">
            Aucun role pour l&rsquo;instant. Un role regroupe des permissions et
            donne sa couleur au nom de ceux qui le portent.
          </p>
        ) : (
          <ul className="roles__items">
            {liste.map((entree) => (
              <li key={entree.id}>
                <button
                  type="button"
                  className={'roles__item' + (entree.id === role?.id ? ' is-active' : '')}
                  onClick={() => setChoisi(entree.id)}
                >
                  <span
                    className="roles__pastille"
                    style={{ background: entree.color }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{entree.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {role ? (
        <div className="roles__detail">
          <div className="roles__entete">
            <input
              className="input roles__nom"
              value={role.name}
              maxLength={40}
              onChange={(event) => void updateRole(spaceId, role.id, { name: event.target.value })}
              aria-label="Nom du role"
            />

            <button
              type="button"
              className="btn btn--sm btn--danger"
              onClick={() => {
                void deleteRole(spaceId, role.id);
                setChoisi(null);
              }}
            >
              <Icon name="trash" size={14} />
              Supprimer
            </button>
          </div>

          <div className="roles__couleurs" role="group" aria-label="Couleur du role">
            {COULEURS.map((couleur) => (
              <button
                key={couleur}
                type="button"
                className={'roles__couleur' + (role.color === couleur ? ' is-active' : '')}
                style={{ background: couleur }}
                onClick={() => void updateRole(spaceId, role.id, { color: couleur })}
                aria-label={`Couleur ${couleur}`}
                aria-pressed={role.color === couleur}
              />
            ))}
          </div>

          <label className="switchrow roles__hoist">
            <span className="switchrow__body">
              <span className="switchrow__label">Afficher a part dans la liste des membres</span>
              <span className="switchrow__hint">
                Les porteurs apparaissent dans leur propre groupe, au-dessus des
                autres.
              </span>
            </span>
            <input
              type="checkbox"
              className="visually-hidden"
              checked={role.hoist}
              onChange={(event) => void updateRole(spaceId, role.id, { hoist: event.target.checked })}
            />
            <span
              className={'switchrow__track' + (role.hoist ? ' is-on' : '')}
              aria-hidden="true"
            >
              <span className="switchrow__thumb" />
            </span>
          </label>

          {PERMISSION_CATEGORIES.map((categorie) => {
            const permissions = ALL_PERMISSIONS.filter((p) => p.category === categorie.id);
            if (permissions.length === 0) return null;

            return (
              <section className="roles__groupe" key={categorie.id}>
                <h4 className="roles__groupe-titre">{categorie.label}</h4>

                <ul className="roles__permissions">
                  {permissions.map((permission) => {
                    /*
                     * Les autres cases n'ont plus d'objet sous « Administrateur ».
                     * Les laisser actives laisserait croire qu'on peut retirer
                     * quelque chose a quelqu'un qui a deja tout.
                     */
                    const neutralisee = estAdmin && permission.id !== 'administrator';
                    const cochee = neutralisee || role.permissions.includes(permission.id);

                    return (
                      <li key={permission.id}>
                        <label
                          className={
                            'roles__permission' +
                            (permission.danger ? ' is-danger' : '') +
                            (neutralisee ? ' is-neutralisee' : '')
                          }
                        >
                          <input
                            type="checkbox"
                            checked={cochee}
                            disabled={neutralisee}
                            onChange={() => basculer(permission.id)}
                          />
                          <span className="roles__permission-corps">
                            <span className="roles__permission-nom">{permission.name}</span>
                            <span className="roles__permission-note">
                              {neutralisee
                                ? 'Accordee par « Administrateur ».'
                                : permission.description}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
