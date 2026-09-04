/**
 * Formes exactes des lignes Postgres.
 *
 * Les noms restent en `snake_case`, identiques a ceux des colonnes. Traduire en
 * `camelCase` imposerait une couche de conversion a chaque lecture et a chaque
 * ecriture, pour un benefice cosmetique : la moindre faute de frappe dans le
 * mapping produirait un `undefined` silencieux au lieu d'une erreur de
 * compilation. On garde donc la forme de la base de bout en bout.
 */

export type UUID = string;
/** Horodatage ISO 8601 renvoye par Postgres pour un `timestamptz`. */
export type ISODate = string;

export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline';
export type SpaceRole = 'owner' | 'admin' | 'moderator' | 'member';
/** `dm` : conversation a deux. `group` : conversation a plusieurs. */
export type ChannelKind = 'text' | 'voice' | 'dm' | 'group';

/** Lien externe affiche sur une carte de profil. */
export interface ProfileLink {
  label: string;
  url: string;
}

export interface Profile {
  id: UUID;
  username: string;
  display_name: string;
  accent: string;
  avatar_url: string | null;
  banner_url: string | null;
  /**
   * Cadrage de la banniere, `{ x, y, zoom }`, ou `null` pour centre et sans
   * grossissement. Type large a dessein : la colonne est du `jsonb` libre, et
   * `lireCadrage` est seul a savoir en tirer quelque chose d'affichable.
   */
  banner_frame: unknown;
  bio: string | null;
  pronouns: string | null;
  links: ProfileLink[];
  /** Teinte choisie, appliquee a la carte de profil. `null` = teinte derivee. */
  theme_hue: number | null;
  status: PresenceStatus;
  /**
   * Dernier signe de vie, ou `null` si le compte n'a jamais battu.
   *
   * C'est ce qui rend `status` fiable : un etat declare peut rester « en
   * ligne » indefiniment apres une veille ou un plantage, une date ne le peut
   * pas. Voir `lib/presence.ts`.
   */
  derniere_presence: string | null;
  custom_status: string | null;
  /** Faux tant que le pseudo a ete deduit de l'adresse plutot que choisi. */
  username_chosen: boolean;
  /**
   * Quand les regles ont ete acceptees, et pour quelle version.
   *
   * `null` signifie « jamais » ; une version inferieure a celle de
   * l'application signifie « pour un texte qui n'est plus celui-ci ». Les deux
   * ramenent a l'ecran d'acceptation.
   */
  terms_accepted_at: ISODate | null;
  terms_version: number | null;

  /**
   * Echeance de la suspension du compte, si le compte est suspendu.
   *
   * Datee, jamais definitive : la levee se fait toute seule. Un drapeau
   * booleen aurait demande qu'on pense a le retirer, ce que personne ne fait,
   * et les suspensions « temporaires » seraient devenues perpetuelles.
   *
   * Nulle, ou passee, veut dire « rien a signaler » : c'est la base qui
   * tranche, cette valeur ne sert qu'a l'expliquer a l'interessé.
   */
  suspendu_jusqu_a?: ISODate | null;

  /** Pourquoi. Une sanction dont on ignore la cause ne corrige rien. */
  suspendu_motif?: string | null;

  created_at: ISODate;
}

/** Ce qu'on affiche d'une fiche de profil, calcule a la demande. */
export interface ProfileStats {
  joined_at: ISODate;
  /** Espaces partages avec la personne consultee. Vide sur sa propre fiche. */
  mutual_spaces: { id: UUID; name: string; icon_url: string | null }[];
  /** Connaissances communes. Vide sur sa propre fiche. */
  mutual_friends: { id: UUID; username: string; display_name: string; avatar_url: string | null }[];
  roles: SpaceRole[];
}

export interface Space {
  id: UUID;
  name: string;
  slug: string;
  description: string | null;
  icon_url: string | null;
  banner_url?: string | null;
  accent: string;
  owner_id: UUID;
  invite_code: string;
  created_at: ISODate;
}

export interface SpaceMember {
  space_id: UUID;
  user_id: UUID;
  role: SpaceRole;
  nickname: string | null;
  joined_at: ISODate;
}

export interface Category {
  id: UUID;
  space_id: UUID;
  name: string;
  position: number;
}

export interface Channel {
  id: UUID;
  /** Nul pour une conversation privee, qui n'appartient a aucun espace. */
  space_id: UUID | null;
  category_id: UUID | null;
  kind: ChannelKind;
  name: string;
  topic: string | null;
  position: number;
  created_at: ISODate;
  /**
   * Photo et banniere d'un groupe.
   *
   * Nulles ailleurs : un salon d'espace herite de l'icone de son espace, et une
   * conversation a deux porte le visage de l'autre. Seul un groupe n'avait
   * rien — trois groupes avec les memes personnes ne se distinguaient que par
   * leur nom, dans une liste ou tout le reste se reconnait a une image.
   */
  icon_url?: string | null;
  banner_url?: string | null;
  /** Intervalle minimal entre deux messages d une meme personne, en secondes. */
  slowmode_seconds: number;
  /** Salon verrouille : seule l equipe de moderation peut encore ecrire. */
  locked: boolean;
}

export interface Thread {
  id: UUID;
  channel_id: UUID;
  space_id: UUID | null;
  root_message_id: UUID;
  title: string;
  created_by: UUID;
  created_at: ISODate;
  last_activity_at: ISODate;
  resolved: boolean;
  resolved_by: UUID | null;
  resolved_at: ISODate | null;
}

export interface MessageRow {
  id: UUID;
  channel_id: UUID;
  thread_id: UUID | null;
  author_id: UUID;
  content: string;
  created_at: ISODate;
  edited_at: ISODate | null;
  reply_to_id: UUID | null;
  pinned: boolean;
}

export interface Attachment {
  id: UUID;
  message_id: UUID;
  storage_path: string;
  filename: string;
  content_type: string;
  size: number;
  width: number | null;
  height: number | null;
}

export interface ReactionRow {
  message_id: UUID;
  user_id: UUID;
  emoji: string;
  created_at: ISODate;
}

export interface ReadState {
  channel_id: UUID;
  last_read_at: ISODate;
  unread_count: number;
  mention_count: number;
}

/** Reactions d'un message, regroupees par emoji pour l'affichage. */
export interface ReactionGroup {
  emoji: string;
  count: number;
  reacted_by: UUID[];
}

/**
 * Message tel que manipule par l'interface : la ligne brute enrichie de ce qui
 * l'accompagne toujours a l'ecran.
 */
export interface Message extends MessageRow {
  reactions: ReactionGroup[];
  attachments: Attachment[];
  /** Renseigne quand un fil a ete ouvert depuis ce message. */
  thread: Thread | null;
  /** Renseigne quand un sondage est attache a ce message. */
  poll: Poll | null;
  /**
   * Vrai tant que le serveur n'a pas confirme l'envoi. Le message est affiche
   * immediatement et se materialise une fois accuse.
   */
  pending?: boolean;
  /** Renseigne si l'envoi a echoue, pour proposer un renvoi. */
  failed?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Retours des fonctions RPC                                                   */
/* -------------------------------------------------------------------------- */

export interface BootstrapPayload {
  profile: Profile | null;
  spaces: Space[];
  channels: Channel[];
  categories: Category[];
  members: SpaceMember[];
  profiles: Profile[];
  open_threads: Thread[];
  read_states: ReadState[];
  dm_participants: DmParticipant[];
  /** Rang de l utilisateur par espace, indexe par identifiant d espace. */
  ranks: Record<UUID, number>;
  /** Exclusions de parole en cours qui le concernent. */
  timeouts: SpaceTimeout[];
  bookmarks: Bookmark[];
}

/** Participation a une conversation privee. */
export interface DmParticipant {
  channel_id: UUID;
  user_id: UUID;
  joined_at: ISODate;
  /** Masquee de la liste, mais l'historique reste intact. */
  hidden: boolean;
}

export interface SearchRow {
  id: UUID;
  channel_id: UUID;
  channel_name: string;
  space_id: UUID | null;
  thread_id: UUID | null;
  author_id: UUID;
  content: string;
  created_at: ISODate;
  pinned: boolean;
  rank: number;
  total_count: number;
}

/* -------------------------------------------------------------------------- */
/* Etats ephemeres, transportes par les canaux temps reel et non par la base    */
/* -------------------------------------------------------------------------- */

export interface TypingSignal {
  user_id: UUID;
  channel_id: UUID;
  thread_id: UUID | null;
  at: number;
}

export interface VoiceParticipant {
  user_id: UUID;
  channel_id: UUID;
  muted: boolean;
  deafened: boolean;
  sharing: boolean;
  video: boolean;

  /**
   * Vrai tant que la personne tient sa touche « se taire ».
   *
   * Distinct de `muted`, qui l'accompagne : les deux disent que le micro est
   * ferme, celui-ci dit en plus que c'est volontaire et momentane. Un micro
   * coupe se defait d'un clic et peut durer une heure ; une touche tenue se
   * relache dans la seconde, et l'on n'attend pas la meme chose de la personne.
   */
  pousse_pour_couper?: boolean;

  /**
   * Vrai quand le partage emporte le son de l'ordinateur.
   *
   * Absent — et non pas faux — chez qui n'a pas encore la version qui sait le
   * capturer. Les trois cas se distinguent donc : `true` le son part, `false`
   * il ne part pas et l'emetteur le sait, `undefined` son application ne sait
   * pas encore repondre a la question.
   */
  son_partage?: boolean;

  joined_at: number;
}

/** Signalisation WebRTC echangee entre deux pairs d'un salon vocal. */
export type VoiceSignal =
  | { kind: 'offer'; from: UUID; to: UUID; sdp: string }
  | { kind: 'answer'; from: UUID; to: UUID; sdp: string }
  | { kind: 'ice'; from: UUID; to: UUID; candidate: RTCIceCandidateInit };

/* -------------------------------------------------------------------------- */
/* Moderation                                                                  */
/* -------------------------------------------------------------------------- */

/** Rang hierarchique. `member` vaut 0, `owner` vaut 3. */
export const RANK = { member: 0, moderator: 1, admin: 2, owner: 3 } as const;

export const ROLE_LABEL: Record<SpaceRole, string> = {
  owner: 'Proprietaire',
  admin: 'Administrateur',
  moderator: 'Moderateur',
  member: 'Membre',
};

export interface SpaceBan {
  space_id: UUID;
  user_id: UUID;
  reason: string | null;
  banned_by: UUID | null;
  created_at: ISODate;
  /** `null` vaut bannissement definitif. */
  expires_at: ISODate | null;
}

export interface SpaceTimeout {
  space_id: UUID;
  user_id: UUID;
  reason: string | null;
  issued_by: UUID | null;
  created_at: ISODate;
  expires_at: ISODate;
}

export type ModerationAction =
  | 'role_change'
  | 'kick'
  | 'ban'
  | 'unban'
  | 'timeout'
  | 'timeout_cleared'
  | 'channel_moderation'
  | 'message_delete';

export interface ModerationEntry {
  id: UUID;
  space_id: UUID;
  actor_id: UUID | null;
  target_id: UUID | null;
  action: ModerationAction;
  reason: string | null;
  details: Record<string, unknown>;
  created_at: ISODate;
}

export interface MessageReport {
  id: UUID;
  message_id: UUID;
  space_id: UUID;
  reporter_id: UUID;
  reason: string;
  status: 'open' | 'resolved' | 'dismissed';
  handled_by: UUID | null;
  handled_at: ISODate | null;
  created_at: ISODate;
}

/* -------------------------------------------------------------------------- */
/* Sondages                                                                    */
/* -------------------------------------------------------------------------- */

export interface Poll {
  id: UUID;
  message_id: UUID;
  question: string;
  multi_choice: boolean;
  hide_results: boolean;
  closes_at: ISODate | null;
  closed: boolean;
  created_by: UUID;
  created_at: ISODate;
}

export interface PollResult {
  option_id: UUID;
  label: string;
  /** Prefixe cote SQL : `position` est un mot-cle refuse en parametre de sortie. */
  option_position: number;
  votes: number;
  voted: boolean;
}

/* -------------------------------------------------------------------------- */
/* Messages sauvegardes et historique                                          */
/* -------------------------------------------------------------------------- */

export interface Bookmark {
  user_id: UUID;
  message_id: UUID;
  note: string | null;
  created_at: ISODate;
}

export interface MessageEdit {
  id: UUID;
  message_id: UUID;
  previous: string;
  edited_at: ISODate;
}

/* -------------------------------------------------------------------------- */
/* Relations d'amitie                                                          */
/* -------------------------------------------------------------------------- */

export type FriendshipStatus = 'pending' | 'accepted' | 'blocked';

export interface Friendship {
  id: UUID;
  requester_id: UUID;
  addressee_id: UUID;
  status: FriendshipStatus;
  created_at: ISODate;
  responded_at: ISODate | null;
}

/** Une relation vue depuis soi : seule compte l'autre personne. */
export interface FriendLink {
  id: UUID;
  user_id: UUID;
  since?: ISODate | null;
  created_at?: ISODate;
}

/** Charge renvoyee par `friends_overview`. */
export interface FriendsOverview {
  friends: FriendLink[];
  incoming: FriendLink[];
  outgoing: FriendLink[];
  blocked: FriendLink[];
  profiles: Profile[];
}
