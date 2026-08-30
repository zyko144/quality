import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Icon } from '@/components/Icon';
import { RolesPanel } from './RolesPanel';
import { supabase, errorMessage } from '@/lib/supabase';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { LIMITS } from '@/constants';
import { uploadSpaceImage } from '@/lib/upload';
import { useSession } from '@/store/session';
import type { UUID } from '@/types/db';

type Tab = 'general' | 'categories' | 'roles' | 'danger';

/**
 * Parametres d'un espace.
 *
 * Chaque action passe par la politique RLS correspondante : le formulaire ne
 * s'affiche que pour qui peut administrer, mais c'est la base qui refuse, pas
 * l'interface.
 */
export function SpaceSettings({
  open,
  spaceId,
  onClose,
}: {
  open: boolean;
  spaceId: UUID | null;
  onClose: () => void;
}) {
  const spaces = useChat((state) => state.spaces);
  const categories = useChat((state) => state.categories);
  const channels = useChat((state) => state.channels);
  const ranks = useChat((state) => state.ranks);
  const bootstrap = useChat((state) => state.bootstrap);
  const selectSpace = useUI((state) => state.selectSpace);

  const moi = useSession((state) => state.profile);
  const [tab, setTab] = useState<Tab>('general');
  const [icone, setIcone] = useState<string | null>(null);
  const [banniere, setBanniere] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState<'icon' | 'banner' | null>(null);

  const champIcone = useRef<HTMLInputElement>(null);
  const champBanniere = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const space = spaces.find((item) => item.id === spaceId) ?? null;
  const rank = spaceId ? (ranks[spaceId] ?? 0) : 0;
  const isOwner = rank >= 3;

  const spaceCategories = useMemo(
    () => categories.filter((item) => item.space_id === spaceId),
    [categories, spaceId],
  );

  useEffect(() => {
    if (!open || !space) return;
    setTab('general');
    setName(space.name);
    setDescription(space.description ?? '');
    setNewCategory('');
    setConfirmName('');
    setIcone(space?.icon_url ?? null);
    setBanniere(space?.banner_url ?? null);
    setEnvoi(null);
    setError(null);
  }, [open, space]);

  if (!space || !spaceId) return null;

  /*
   * L'image part tout de suite, sans attendre « Enregistrer ».
   *
   * Choisir un fichier EST la validation : personne ne s'attend a devoir
   * confirmer une seconde fois, et le nom et la description, eux, gardent leur
   * bouton parce qu'on les tape lettre par lettre.
   */
  const envoyerImage = async (fichier: File, genre: 'icon' | 'banner') => {
    if (!moi) return;

    setEnvoi(genre);
    setError(null);

    const resultat = await uploadSpaceImage(fichier, moi.id, genre);

    if ('error' in resultat) {
      setEnvoi(null);
      setError(resultat.error);
      return;
    }

    const colonne = genre === 'icon' ? 'icon_url' : 'banner_url';
    const { error: refus } = await supabase
      .from('spaces')
      .update({ [colonne]: resultat.url })
      .eq('id', spaceId);

    setEnvoi(null);

    if (refus) {
      setError(errorMessage(refus));
      return;
    }

    if (genre === 'icon') setIcone(resultat.url);
    else setBanniere(resultat.url);

    await bootstrap();
  };

  const dirty = name.trim() !== space.name || description.trim() !== (space.description ?? '');

  const save = async () => {
    setBusy(true);
    setError(null);

    const { error: failure } = await supabase
      .from('spaces')
      .update({
        name: name.trim() || space.name,
        description: description.trim() || null,
      })
      .eq('id', spaceId);

    setBusy(false);

    if (failure) {
      setError(errorMessage(failure));
      return;
    }
    await bootstrap();
  };

  const addCategory = async () => {
    const label = newCategory.trim();
    if (!label) return;

    setBusy(true);
    const { error: failure } = await supabase.from('categories').insert({
      space_id: spaceId,
      name: label,
      position: spaceCategories.length,
    });
    setBusy(false);

    if (failure) {
      setError(errorMessage(failure));
      return;
    }
    setNewCategory('');
    await bootstrap();
  };

  const removeCategory = async (categoryId: UUID) => {
    setBusy(true);
    const { error: failure } = await supabase.from('categories').delete().eq('id', categoryId);
    setBusy(false);

    if (failure) {
      setError(errorMessage(failure));
      return;
    }
    await bootstrap();
  };

  const destroy = async () => {
    setBusy(true);
    setError(null);

    const { error: failure } = await supabase.from('spaces').delete().eq('id', spaceId);
    setBusy(false);

    if (failure) {
      setError(errorMessage(failure));
      return;
    }

    onClose();
    selectSpace(null);
    await bootstrap();
  };

  return (
    <Modal
      open={open}
      title={`Parametres — ${space.name}`}
      onClose={onClose}
      width={620}
      footer={
        tab === 'general' ? (
          <>
            <div className="spacer" />
            <button type="button" className="btn" onClick={onClose}>
              Fermer
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!dirty || busy}
              onClick={() => void save()}
            >
              {busy ? <span className="spinner" /> : null}
              Enregistrer
            </button>
          </>
        ) : undefined
      }
    >
      <nav className="mod-tabs" role="tablist">
        {(
          [
            ['general', 'General', 'settings'],
            ['categories', 'Categories', 'hash'],
            ['roles', 'Roles', 'shield'],
            ['danger', 'Zone sensible', 'trash'],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={'mod-tab' + (tab === id ? ' is-active' : '')}
            onClick={() => setTab(id)}
          >
            <Icon name={icon} size={15} />
            {label}
          </button>
        ))}
      </nav>

      {error ? (
        <p className="mod-error" role="alert">
          <Icon name="x" size={14} />
          {error}
        </p>
      ) : null}

      {tab === 'general' ? (
        <>
          {/*
            L'icone et la banniere ouvrent l'onglet.
            Ce sont elles qu'on vient changer le plus souvent, et les chercher
            sous le nom et la description obligeait a faire defiler une page
            pour un geste de deux secondes.
          */}
          <div className="espace-images">
            <div className="espace-images__banniere">
              {banniere ? (
                <img src={banniere} alt="" />
              ) : (
                <span className="espace-images__vide" aria-hidden="true" />
              )}

              <button
                type="button"
                className="btn btn--sm espace-images__changer"
                onClick={() => champBanniere.current?.click()}
                disabled={envoi !== null}
              >
                {envoi === 'banner' ? (
                  <span className="spinner" />
                ) : (
                  <Icon name="image" size={14} />
                )}
                Banniere
              </button>
            </div>

            <div className="espace-images__icone">
              {icone ? (
                <img src={icone} alt="" />
              ) : (
                <span className="espace-images__initiales" aria-hidden="true">
                  {space.name.slice(0, 2).toUpperCase()}
                </span>
              )}

              <button
                type="button"
                className="espace-images__icone-btn"
                onClick={() => champIcone.current?.click()}
                disabled={envoi !== null}
                aria-label="Changer l'icone de l'espace"
              >
                {envoi === 'icon' ? <span className="spinner" /> : <Icon name="camera" size={16} />}
              </button>
            </div>
          </div>

          <p className="field__hint espace-images__note">
            L&rsquo;icone est la pastille du rail, a gauche. La banniere coiffe la
            liste des salons — c&rsquo;est elle qui donne son caractere a
            l&rsquo;espace une fois qu&rsquo;on est dedans.
          </p>

          <input
            ref={champIcone}
            type="file"
            accept="image/*"
            className="visually-hidden"
            onChange={(event) => {
              const fichier = event.target.files?.[0];
              if (fichier) void envoyerImage(fichier, 'icon');
              event.target.value = '';
            }}
          />
          <input
            ref={champBanniere}
            type="file"
            accept="image/*"
            className="visually-hidden"
            onChange={(event) => {
              const fichier = event.target.files?.[0];
              if (fichier) void envoyerImage(fichier, 'banner');
              event.target.value = '';
            }}
          />

          <div className="field">
            <label className="field__label" htmlFor="space-settings-name">
              Nom de l’espace
            </label>
            <input
              id="space-settings-name"
              className="input"
              value={name}
              maxLength={LIMITS.spaceNameLength}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="space-settings-description">
              Description
            </label>
            <textarea
              id="space-settings-description"
              className="input"
              rows={3}
              value={description}
              maxLength={280}
              placeholder="A quoi sert cet espace ?"
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="field">
            <span className="field__label">Code d’invitation</span>
            <div className="invite">
              <code className="invite__code">{space.invite_code}</code>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => useUI.getState().openModal({ kind: 'invite', spaceId })}
              >
                <Icon name="link" size={14} />
                Gerer
              </button>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'categories' ? (
        <>
          <p className="field__hint">
            Une categorie regroupe des salons dans la barre laterale. Supprimer une
            categorie ne supprime pas ses salons : ils remontent simplement en haut
            de la liste.
          </p>

          {spaceCategories.length === 0 ? (
            <div className="empty">
              <span className="empty__icon">
                <Icon name="hash" size={22} />
              </span>
              <p className="empty__title">Aucune categorie</p>
              <p className="empty__body">
                Les salons apparaissent tous au meme niveau. Creez-en une pour les
                regrouper.
              </p>
            </div>
          ) : (
            <ul className="mod-list">
              {spaceCategories.map((category) => {
                const count = channels.filter((c) => c.category_id === category.id).length;
                return (
                  <li className="mod-row" key={category.id}>
                    <div className="mod-row__head">
                      <Icon name="hash" size={15} />
                      <div className="mod-row__identity">
                        <span className="mod-row__name">{category.name}</span>
                        <span className="mod-row__handle">
                          {count === 0
                            ? 'Aucun salon'
                            : count === 1
                              ? '1 salon'
                              : `${count} salons`}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger"
                        onClick={() => void removeCategory(category.id)}
                        aria-label={`Supprimer la categorie ${category.name}`}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="field">
            <label className="field__label" htmlFor="space-new-category">
              Nouvelle categorie
            </label>
            <div className="mod-actions__row">
              <input
                id="space-new-category"
                className="input"
                style={{ flex: 1, minWidth: '200px' }}
                value={newCategory}
                maxLength={64}
                placeholder="Projets"
                onChange={(event) => setNewCategory(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void addCategory()}
              />
              <button
                type="button"
                className="btn btn--primary"
                disabled={!newCategory.trim() || busy}
                onClick={() => void addCategory()}
              >
                <Icon name="plus" size={15} />
                Ajouter
              </button>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'roles' && spaceId ? <RolesPanel spaceId={spaceId} /> : null}

      {tab === 'danger' ? (
        <div className="danger-zone">
          <h3 className="danger-zone__title">Supprimer cet espace</h3>
          <p className="danger-zone__body">
            Tous ses salons, messages, fils, sondages et pieces jointes seront
            effaces. Les membres en perdront l’acces immediatement.{' '}
            <strong>Cette action est definitive.</strong>
          </p>

          {isOwner ? (
            <>
              <div className="field">
                <label className="field__label" htmlFor="space-confirm">
                  Pour confirmer, tapez <strong>{space.name}</strong>
                </label>
                <input
                  id="space-confirm"
                  className="input"
                  value={confirmName}
                  placeholder={space.name}
                  onChange={(event) => setConfirmName(event.target.value)}
                  autoComplete="off"
                />
              </div>

              <button
                type="button"
                className="btn btn--danger"
                disabled={confirmName !== space.name || busy}
                onClick={() => void destroy()}
              >
                {busy ? <span className="spinner" /> : <Icon name="trash" size={15} />}
                Supprimer definitivement
              </button>
            </>
          ) : (
            <p className="field__hint">
              Seul le proprietaire de l’espace peut le supprimer.
            </p>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
