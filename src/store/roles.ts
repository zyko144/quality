import { create } from 'zustand';
import type { UUID } from '@/types/db';

export interface PermissionItem {
  id: string;
  name: string;
  description: string;
  category: 'general' | 'membership' | 'text' | 'voice' | 'admin';
  danger?: boolean;
}

export const ALL_PERMISSIONS: PermissionItem[] = [
  // ── Administration (Danger) ──
  {
    id: 'administrator',
    name: 'Administrateur',
    description: 'Accorde toutes les permissions et contourne les restrictions de salon. Très dangereux.',
    category: 'admin',
    danger: true,
  },

  // ── Général ──
  {
    id: 'view_channels',
    name: 'Voir les salons',
    description: 'Permet aux membres de voir les salons par défaut.',
    category: 'general',
  },
  {
    id: 'manage_channels',
    name: 'Gérer les salons',
    description: 'Créer, modifier ou supprimer des salons et des catégories.',
    category: 'general',
  },
  {
    id: 'manage_roles',
    name: 'Gérer les rôles',
    description: 'Créer de nouveaux rôles et modifier/supprimer les rôles inférieurs.',
    category: 'general',
  },
  {
    id: 'manage_emojis',
    name: 'Gérer les émojis & stickers',
    description: 'Ajouter ou supprimer des émojis personnalisés.',
    category: 'general',
  },
  {
    id: 'view_audit_log',
    name: 'Voir le journal de modération',
    description: 'Consulter l’historique des actions de modération du serveur.',
    category: 'general',
  },
  {
    id: 'manage_server',
    name: 'Gérer le serveur',
    description: 'Modifier le nom, la photo de profil et la bannière du serveur.',
    category: 'general',
  },

  // ── Gestion des membres ──
  {
    id: 'create_invite',
    name: 'Créer des invitations',
    description: 'Permet d’inviter de nouvelles personnes sur le serveur.',
    category: 'membership',
  },
  {
    id: 'change_nickname',
    name: 'Changer de pseudo',
    description: 'Permet de modifier son propre surnom sur le serveur.',
    category: 'membership',
  },
  {
    id: 'manage_nicknames',
    name: 'Gérer les pseudos',
    description: 'Modifier le surnom des autres membres.',
    category: 'membership',
  },
  {
    id: 'kick_members',
    name: 'Expulser des membres',
    description: 'Retirer des membres du serveur.',
    category: 'membership',
  },
  {
    id: 'ban_members',
    name: 'Bannir des membres',
    description: 'Bannir définitivement des membres du serveur.',
    category: 'membership',
  },
  {
    id: 'timeout_members',
    name: 'Exclure temporairement',
    description: 'Empêcher temporairement un membre de parler ou réagir.',
    category: 'membership',
  },

  // ── Salons Textuels ──
  {
    id: 'send_messages',
    name: 'Envoyer des messages',
    description: 'Écrire dans les salons textuels.',
    category: 'text',
  },
  {
    id: 'send_thread_messages',
    name: 'Envoyer des messages dans les fils',
    description: 'Participer aux fils de discussion.',
    category: 'text',
  },
  {
    id: 'create_threads',
    name: 'Créer des fils de discussion',
    description: 'Ouvrir de nouveaux fils publics ou privés.',
    category: 'text',
  },
  {
    id: 'embed_links',
    name: 'Intégrer des liens',
    description: 'Affiche un aperçu riche pour les liens partagés.',
    category: 'text',
  },
  {
    id: 'attach_files',
    name: 'Joindre des fichiers',
    description: 'Envoyer des images, vidéos ou documents.',
    category: 'text',
  },
  {
    id: 'add_reactions',
    name: 'Ajouter des réactions',
    description: 'Réagir aux messages avec des émojis.',
    category: 'text',
  },
  {
    id: 'use_external_emojis',
    name: 'Utiliser des émojis externes',
    description: 'Employer des émojis d’autres serveurs.',
    category: 'text',
  },
  {
    id: 'mention_everyone',
    name: 'Mentionner @everyone & @here',
    description: 'Alerter tous les membres du salon en une seule mention.',
    category: 'text',
  },
  {
    id: 'manage_messages',
    name: 'Gérer les messages',
    description: 'Supprimer ou épingler les messages des autres membres.',
    category: 'text',
  },
  {
    id: 'read_message_history',
    name: 'Lire l’historique des messages',
    description: 'Voir les anciens messages envoyés avant de rejoindre.',
    category: 'text',
  },
  {
    id: 'send_polls',
    name: 'Créer des sondages',
    description: 'Lancer des sondages interactifs dans les salons.',
    category: 'text',
  },

  // ── Salons Vocaux ──
  {
    id: 'voice_connect',
    name: 'Se connecter',
    description: 'Rejoindre les salons vocaux pour écouter.',
    category: 'voice',
  },
  {
    id: 'voice_speak',
    name: 'Parler',
    description: 'Prendre la parole dans les salons vocaux.',
    category: 'voice',
  },
  {
    id: 'voice_video',
    name: 'Vidéo & Partage d’écran',
    description: 'Allumer sa caméra ou partager son écran dans les salons vocaux.',
    category: 'voice',
  },
  {
    id: 'voice_activity',
    name: 'Détection de la voix',
    description: 'Parler sans obligation d’utiliser le Push-to-Talk.',
    category: 'voice',
  },
  {
    id: 'voice_priority',
    name: 'Priorité de parole',
    description: 'Baisse le volume des autres quand vous parlez.',
    category: 'voice',
  },
  {
    id: 'voice_mute_members',
    name: 'Couper le micro de membres',
    description: 'Muter d’autres membres pour tout le monde.',
    category: 'voice',
  },
  {
    id: 'voice_deafen_members',
    name: 'Mettre en sourdine des membres',
    description: 'Couper l’écoute d’autres membres pour tout le monde.',
    category: 'voice',
  },
  {
    id: 'voice_move_members',
    name: 'Déplacer & Déconnecter des membres',
    description: 'Déplacer un membre vers un autre salon vocal ou le déconnecter.',
    category: 'voice',
  },
];

export interface CustomRole {
  id: string;
  spaceId: UUID;
  name: string;
  color: string;
  position: number;
  permissions: string[];
  hoist: boolean; // afficher séparément dans la liste des membres
}

interface RolesState {
  roles: Record<UUID, CustomRole[]>; // spaceId -> roles
  memberRoles: Record<string, string[]>; // `${spaceId}:${userId}` -> roleIds

  getSpaceRoles: (spaceId: UUID) => CustomRole[];
  getMemberRoleIds: (spaceId: UUID, userId: UUID) => string[];
  createRole: (spaceId: UUID, name?: string, color?: string) => CustomRole;
  updateRole: (spaceId: UUID, roleId: string, patch: Partial<CustomRole>) => void;
  deleteRole: (spaceId: UUID, roleId: string) => void;
  reorderRoles: (spaceId: UUID, roleIds: string[]) => void;
  toggleMemberRole: (spaceId: UUID, userId: UUID, roleId: string) => void;
  hasPermission: (spaceId: UUID, userId: UUID, permissionId: string, isOwner?: boolean) => boolean;
}

const STORAGE_KEY = 'quality:roles_v1';

function loadStorage(): {
  roles: Record<UUID, CustomRole[]>;
  memberRoles: Record<string, string[]>;
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { roles: {}, memberRoles: {} };
    return JSON.parse(raw);
  } catch {
    return { roles: {}, memberRoles: {} };
  }
}

function saveStorage(data: {
  roles: Record<UUID, CustomRole[]>;
  memberRoles: Record<string, string[]>;
}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export const useRoles = create<RolesState>((set, get) => {
  const initial = loadStorage();

  return {
    roles: initial.roles,
    memberRoles: initial.memberRoles,

    getSpaceRoles: (spaceId: UUID) => {
      const list = get().roles[spaceId];
      if (list && list.length > 0) return list;

      // Rôles par défaut si non configurés
      const defaultRoles: CustomRole[] = [
        {
          id: 'role-admin',
          spaceId,
          name: 'Administrateur',
          color: '#ef4444',
          position: 1,
          permissions: ['administrator'],
          hoist: true,
        },
        {
          id: 'role-mod',
          spaceId,
          name: 'Modérateur',
          color: '#3b82f6',
          position: 2,
          permissions: [
            'view_channels',
            'manage_messages',
            'kick_members',
            'timeout_members',
            'voice_mute_members',
            'voice_move_members',
          ],
          hoist: true,
        },
        {
          id: 'role-member',
          spaceId,
          name: 'Membre',
          color: '#94a3b8',
          position: 3,
          permissions: [
            'view_channels',
            'send_messages',
            'send_thread_messages',
            'embed_links',
            'attach_files',
            'add_reactions',
            'voice_connect',
            'voice_speak',
            'voice_video',
            'change_nickname',
          ],
          hoist: false,
        },
      ];
      return defaultRoles;
    },

    getMemberRoleIds: (spaceId: UUID, userId: UUID) => {
      const key = `${spaceId}:${userId}`;
      return get().memberRoles[key] ?? [];
    },

    createRole: (spaceId: UUID, name = 'Nouveau Rôle', color = '#38bdf8') => {
      const currentRoles = get().getSpaceRoles(spaceId);
      const newRole: CustomRole = {
        id: 'role_' + Math.random().toString(36).substring(2, 9),
        spaceId,
        name,
        color,
        position: currentRoles.length + 1,
        permissions: ['view_channels', 'send_messages', 'voice_connect', 'voice_speak'],
        hoist: true,
      };

      const updated = [newRole, ...currentRoles];
      set((state) => {
        const nextRoles = { ...state.roles, [spaceId]: updated };
        saveStorage({ roles: nextRoles, memberRoles: state.memberRoles });
        return { roles: nextRoles };
      });

      return newRole;
    },

    updateRole: (spaceId: UUID, roleId: string, patch: Partial<CustomRole>) => {
      const currentRoles = get().getSpaceRoles(spaceId);
      const updated = currentRoles.map((r) => (r.id === roleId ? { ...r, ...patch } : r));

      set((state) => {
        const nextRoles = { ...state.roles, [spaceId]: updated };
        saveStorage({ roles: nextRoles, memberRoles: state.memberRoles });
        return { roles: nextRoles };
      });
    },

    deleteRole: (spaceId: UUID, roleId: string) => {
      const currentRoles = get().getSpaceRoles(spaceId);
      const updated = currentRoles.filter((r) => r.id !== roleId);

      set((state) => {
        const nextRoles = { ...state.roles, [spaceId]: updated };
        saveStorage({ roles: nextRoles, memberRoles: state.memberRoles });
        return { roles: nextRoles };
      });
    },

    reorderRoles: (spaceId: UUID, roleIds: string[]) => {
      const currentRoles = get().getSpaceRoles(spaceId);
      const map = new Map(currentRoles.map((r) => [r.id, r]));
      const updated = roleIds.map((id, index) => {
        const r = map.get(id)!;
        return { ...r, position: index + 1 };
      });

      set((state) => {
        const nextRoles = { ...state.roles, [spaceId]: updated };
        saveStorage({ roles: nextRoles, memberRoles: state.memberRoles });
        return { roles: nextRoles };
      });
    },

    toggleMemberRole: (spaceId: UUID, userId: UUID, roleId: string) => {
      const key = `${spaceId}:${userId}`;
      const current = get().memberRoles[key] ?? [];
      const has = current.includes(roleId);
      const next = has ? current.filter((id) => id !== roleId) : [...current, roleId];

      set((state) => {
        const nextMemberRoles = { ...state.memberRoles, [key]: next };
        saveStorage({ roles: state.roles, memberRoles: nextMemberRoles });
        return { memberRoles: nextMemberRoles };
      });
    },

    hasPermission: (spaceId: UUID, userId: UUID, permissionId: string, isOwner = false) => {
      if (isOwner) return true;
      const roleIds = get().getMemberRoleIds(spaceId, userId);
      const roles = get().getSpaceRoles(spaceId).filter((r) => roleIds.includes(r.id));

      for (const role of roles) {
        if (role.permissions.includes('administrator')) return true;
        if (role.permissions.includes(permissionId)) return true;
      }
      return false;
    },
  };
});
