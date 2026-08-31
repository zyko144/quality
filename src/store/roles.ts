import { create } from 'zustand';
import { supabase, errorMessage } from '@/lib/supabase';
import type { UUID } from '@/types/db';

/**
 * Roles d'espace : couleurs, rangs, permissions.
 *
 * Le premier jet gardait tout dans le stockage du navigateur. Un role n'a
 * pourtant de sens que partage : celui qui l'attribue et celui qui le porte ne
 * sont pas sur la meme machine, et une permission qui ne vaut que chez soi n'en
 * est pas une. Tout passe donc par la base, avec les memes politiques que le
 * reste.
 *
 * Le rang historique de `space_members` — proprietaire, administrateur,
 * moderateur, membre — n'est pas remplace : il porte encore la securite en
 * base. Ces roles-ci s'ajoutent par-dessus pour decrire finement qui fait quoi.
 */

export interface PermissionItem {
  id: string;
  name: string;
  description: string;
  category: 'admin' | 'general' | 'membership' | 'text' | 'voice';
  /** Rouge dans l'interface : ce que l'on n'accorde pas a la legere. */
  danger?: boolean;
}

export const PERMISSION_CATEGORIES: { id: PermissionItem['category']; label: string }[] = [
  { id: 'admin', label: 'Administration' },
  { id: 'general', label: 'General' },
  { id: 'membership', label: 'Membres' },
  { id: 'text', label: 'Salons textuels' },
  { id: 'voice', label: 'Salons vocaux' },
];

export const ALL_PERMISSIONS: PermissionItem[] = [
  {
    id: 'administrator',
    name: 'Administrateur',
    description:
      'Accorde toutes les permissions et contourne toute restriction de salon. A ne donner qu’a quelqu’un en qui vous avez une confiance entiere.',
    category: 'admin',
    danger: true,
  },

  { id: 'view_channels', name: 'Voir les salons', description: 'Acces aux salons publics de l’espace.', category: 'general' },
  { id: 'manage_channels', name: 'Gerer les salons', description: 'Creer, renommer, deplacer et supprimer salons et categories.', category: 'general' },
  { id: 'manage_roles', name: 'Gerer les roles', description: 'Creer des roles et modifier ceux places en dessous du sien.', category: 'general' },
  { id: 'manage_space', name: 'Gerer l’espace', description: 'Nom, icone, banniere et reglages generaux.', category: 'general' },
  { id: 'manage_emojis', name: 'Gerer les emojis', description: 'Ajouter ou retirer des emojis personnalises.', category: 'general' },
  { id: 'view_audit_log', name: 'Voir le journal', description: 'Consulter l’historique des actions de moderation.', category: 'general' },
  { id: 'manage_webhooks', name: 'Gerer les integrations', description: 'Connecter des services exterieurs a l’espace.', category: 'general' },

  { id: 'create_invite', name: 'Creer une invitation', description: 'Inviter de nouvelles personnes dans l’espace.', category: 'membership' },
  { id: 'change_nickname', name: 'Changer son surnom', description: 'Modifier le nom qu’on affiche dans cet espace.', category: 'membership' },
  { id: 'manage_nicknames', name: 'Gerer les surnoms', description: 'Modifier le surnom des autres membres.', category: 'membership' },
  { id: 'kick_members', name: 'Expulser des membres', description: 'Retirer quelqu’un de l’espace. Il peut revenir sur invitation.', category: 'membership', danger: true },
  { id: 'ban_members', name: 'Bannir des membres', description: 'Retirer quelqu’un et l’empecher de revenir.', category: 'membership', danger: true },
  { id: 'timeout_members', name: 'Rendre muet temporairement', description: 'Empecher quelqu’un d’ecrire et de parler pour une duree.', category: 'membership' },

  { id: 'send_messages', name: 'Envoyer des messages', description: 'Ecrire dans les salons textuels.', category: 'text' },
  { id: 'send_thread_messages', name: 'Ecrire dans les fils', description: 'Repondre dans un fil de discussion.', category: 'text' },
  { id: 'create_threads', name: 'Ouvrir des fils', description: 'Demarrer un fil depuis un message.', category: 'text' },
  { id: 'embed_links', name: 'Deplier les liens', description: 'Les adresses partagees affichent leur apercu.', category: 'text' },
  { id: 'attach_files', name: 'Joindre des fichiers', description: 'Envoyer images et documents.', category: 'text' },
  { id: 'add_reactions', name: 'Ajouter des reactions', description: 'Reagir aux messages avec un emoji.', category: 'text' },
  { id: 'use_external_emojis', name: 'Emojis d’ailleurs', description: 'Utiliser les emojis d’autres espaces.', category: 'text' },
  { id: 'mention_everyone', name: 'Mentionner tout le monde', description: 'Utiliser @everyone et @here.', category: 'text', danger: true },
  { id: 'manage_messages', name: 'Gerer les messages', description: 'Supprimer et epingler les messages des autres.', category: 'text', danger: true },
  { id: 'read_history', name: 'Lire l’historique', description: 'Voir les messages ecrits avant son arrivee.', category: 'text' },
  { id: 'send_polls', name: 'Creer des sondages', description: 'Poser une question a choix multiples.', category: 'text' },
  { id: 'send_voice_messages', name: 'Messages vocaux', description: 'Envoyer un enregistrement audio.', category: 'text' },

  { id: 'voice_connect', name: 'Se connecter', description: 'Rejoindre les salons vocaux.', category: 'voice' },
  { id: 'voice_speak', name: 'Parler', description: 'Transmettre sa voix.', category: 'voice' },
  { id: 'voice_video', name: 'Camera', description: 'Activer sa camera.', category: 'voice' },
  { id: 'voice_share', name: 'Partager son ecran', description: 'Diffuser un ecran ou une fenetre.', category: 'voice' },
  { id: 'voice_priority', name: 'Voix prioritaire', description: 'Baisser le volume des autres quand on parle.', category: 'voice' },
  { id: 'voice_mute_members', name: 'Couper le micro des autres', description: 'Rendre muet dans le salon vocal.', category: 'voice', danger: true },
  { id: 'voice_deafen_members', name: 'Rendre sourd', description: 'Couper le son pour quelqu’un d’autre.', category: 'voice', danger: true },
  { id: 'voice_move_members', name: 'Deplacer les membres', description: 'Changer quelqu’un de salon vocal, ou l’en deconnecter.', category: 'voice', danger: true },
  { id: 'voice_activity', name: 'Detection de la voix', description: 'Parler sans maintenir une touche.', category: 'voice' },
  { id: 'voice_soundboard', name: 'Sons', description: 'Jouer des sons dans le salon vocal.', category: 'voice' },
];

export interface CustomRole {
  id: string;
  spaceId: UUID;
  name: string;
  color: string;
  position: number;
  permissions: string[];
  /** Afficher les porteurs a part dans la liste des membres. */
  hoist: boolean;
}

interface LigneRole {
  id: string;
  space_id: UUID;
  name: string;
  color: string;
  position: number;
  permissions: string[];
  hoist: boolean;
}

interface RolesState {
  roles: Record<UUID, CustomRole[]>;
  /** `${spaceId}:${userId}` vers les identifiants de roles portes. */
  memberRoles: Record<string, string[]>;
  loading: Record<UUID, boolean>;
  error: string | null;

  /** Charge roles et attributions d'un espace. Sans effet si deja charge. */
  loadSpace: (spaceId: UUID, forcer?: boolean) => Promise<void>;
  getSpaceRoles: (spaceId: UUID) => CustomRole[];
  getMemberRoleIds: (spaceId: UUID, userId: UUID) => string[];
  /** Role le mieux place parmi ceux portes : c'est lui qui donne la couleur. */
  topRole: (spaceId: UUID, userId: UUID) => CustomRole | undefined;

  createRole: (spaceId: UUID, name?: string, color?: string) => Promise<CustomRole | null>;
  updateRole: (spaceId: UUID, roleId: string, patch: Partial<CustomRole>) => Promise<void>;
  deleteRole: (spaceId: UUID, roleId: string) => Promise<void>;
  toggleMemberRole: (spaceId: UUID, userId: UUID, roleId: string) => Promise<void>;

  /** Permission effective. Le proprietaire passe avant tout. */
  hasPermission: (
    spaceId: UUID,
    userId: UUID,
    permissionId: string,
    isOwner?: boolean,
  ) => boolean;
}

function versRole(ligne: LigneRole): CustomRole {
  return {
    id: ligne.id,
    spaceId: ligne.space_id,
    name: ligne.name,
    color: ligne.color,
    position: ligne.position,
    permissions: ligne.permissions ?? [],
    hoist: ligne.hoist,
  };
}

export const useRoles = create<RolesState>((set, get) => ({
  roles: {},
  memberRoles: {},
  loading: {},
  error: null,

  loadSpace: async (spaceId, forcer = false) => {
    // Sans `forcer`, on ne recharge pas : la liste ne bouge presque jamais, et
    // la relire a chaque ouverture de fiche ferait un aller-retour pour rien.
    if (get().loading[spaceId]) return;
    if (!forcer && get().roles[spaceId]) return;

    set((state) => ({ loading: { ...state.loading, [spaceId]: true } }));

    const [roles, attributions] = await Promise.all([
      supabase.from('roles').select('*').eq('space_id', spaceId).order('position', { ascending: false }),
      supabase.from('member_roles').select('user_id, role_id').eq('space_id', spaceId),
    ]);

    if (roles.error) {
      set((state) => ({
        loading: { ...state.loading, [spaceId]: false },
        error: errorMessage(roles.error),
      }));
      return;
    }

    const parMembre: Record<string, string[]> = {};
    for (const ligne of attributions.data ?? []) {
      const cle = `${spaceId}:${ligne.user_id}`;
      (parMembre[cle] ??= []).push(ligne.role_id);
    }

    set((state) => ({
      roles: { ...state.roles, [spaceId]: (roles.data ?? []).map(versRole) },
      memberRoles: { ...state.memberRoles, ...parMembre },
      loading: { ...state.loading, [spaceId]: false },
    }));
  },

  getSpaceRoles: (spaceId) => get().roles[spaceId] ?? [],

  getMemberRoleIds: (spaceId, userId) => get().memberRoles[`${spaceId}:${userId}`] ?? [],

  topRole: (spaceId, userId) => {
    const portes = new Set(get().getMemberRoleIds(spaceId, userId));
    return get()
      .getSpaceRoles(spaceId)
      .filter((role) => portes.has(role.id))
      .sort((a, b) => b.position - a.position)[0];
  },

  createRole: async (spaceId, name = 'Nouveau role', color = '#38bdf8') => {
    const existants = get().getSpaceRoles(spaceId);
    const position = existants.reduce((haut, role) => Math.max(haut, role.position), 0) + 1;

    /*
     * Le nom est rendu unique avant l'envoi.
     *
     * Deux roles ne peuvent pas porter le meme nom dans un espace — la base y
     * veille, et elle a raison : un role sert a etre designe. Mais le bouton
     * proposait toujours « Nouveau role », si bien qu'il ne marchait qu'une
     * fois : au second clic, la base renvoyait « duplicate key value violates
     * unique constraint », affiche tel quel. On avait un bouton qui echouait
     * en jargon, et rien qui explique quoi faire.
     */
    const pris = new Set(existants.map((role) => role.name.toLowerCase()));
    let nomLibre = name;
    for (let suffixe = 2; pris.has(nomLibre.toLowerCase()); suffixe += 1) {
      nomLibre = `${name} ${suffixe}`;
    }

    const { data, error } = await supabase
      .from('roles')
      .insert({
        space_id: spaceId,
        name: nomLibre,
        color,
        position,
        // Le minimum pour qu'un nouveau role ne soit pas une coquille vide :
        // voir, ecrire, rejoindre le vocal et y parler.
        permissions: ['view_channels', 'send_messages', 'voice_connect', 'voice_speak'],
      })
      .select()
      .single();

    if (error || !data) {
      // Le doublon reste possible si quelqu'un d'autre a cree le meme nom
      // entre-temps. Le dire en francais vaut mieux que de recopier Postgres.
      set({
        error: error?.message.includes('roles_space_id_name_key')
          ? 'Un role porte deja ce nom dans cet espace.'
          : errorMessage(error),
      });
      return null;
    }

    const role = versRole(data as LigneRole);
    set((state) => ({
      roles: { ...state.roles, [spaceId]: [role, ...(state.roles[spaceId] ?? [])] },
    }));

    return role;
  },

  updateRole: async (spaceId, roleId, patch) => {
    const avant = get().getSpaceRoles(spaceId);

    // Applique tout de suite : cocher une permission doit repondre au clic, et
    // non a l'aller-retour reseau.
    set((state) => ({
      roles: {
        ...state.roles,
        [spaceId]: avant.map((role) => (role.id === roleId ? { ...role, ...patch } : role)),
      },
    }));

    const { error } = await supabase
      .from('roles')
      .update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.position !== undefined ? { position: patch.position } : {}),
        ...(patch.permissions !== undefined ? { permissions: patch.permissions } : {}),
        ...(patch.hoist !== undefined ? { hoist: patch.hoist } : {}),
      })
      .eq('id', roleId);

    if (error) {
      set((state) => ({ roles: { ...state.roles, [spaceId]: avant }, error: errorMessage(error) }));
    }
  },

  deleteRole: async (spaceId, roleId) => {
    const avant = get().getSpaceRoles(spaceId);

    set((state) => ({
      roles: { ...state.roles, [spaceId]: avant.filter((role) => role.id !== roleId) },
    }));

    const { error } = await supabase.from('roles').delete().eq('id', roleId);
    if (error) {
      set((state) => ({ roles: { ...state.roles, [spaceId]: avant }, error: errorMessage(error) }));
    }
  },

  toggleMemberRole: async (spaceId, userId, roleId) => {
    const cle = `${spaceId}:${userId}`;
    const avant = get().memberRoles[cle] ?? [];
    const porte = avant.includes(roleId);
    const apres = porte ? avant.filter((id) => id !== roleId) : [...avant, roleId];

    set((state) => ({ memberRoles: { ...state.memberRoles, [cle]: apres } }));

    const { error } = porte
      ? await supabase
          .from('member_roles')
          .delete()
          .eq('space_id', spaceId)
          .eq('user_id', userId)
          .eq('role_id', roleId)
      : await supabase
          .from('member_roles')
          .insert({ space_id: spaceId, user_id: userId, role_id: roleId });

    if (error) {
      set((state) => ({
        memberRoles: { ...state.memberRoles, [cle]: avant },
        error: errorMessage(error),
      }));
    }
  },

  hasPermission: (spaceId, userId, permissionId, isOwner = false) => {
    /*
     * Le proprietaire passe avant tout.
     *
     * Sans cette regle, il pourrait se retirer lui-meme l'acces a son propre
     * espace en decochant une case, et n'aurait plus aucun moyen d'y revenir.
     * La meme regle existe cote base, dans `has_space_permission`.
     */
    if (isOwner) return true;

    const portes = new Set(get().getMemberRoleIds(spaceId, userId));

    return get()
      .getSpaceRoles(spaceId)
      .some(
        (role) =>
          portes.has(role.id) &&
          (role.permissions.includes('administrator') ||
            role.permissions.includes(permissionId)),
      );
  },
}));
