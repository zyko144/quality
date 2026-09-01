import type { SVGProps } from 'react';

/**
 * Jeu d'icones dessine a la main, en SVG inline.
 *
 * Aucune bibliotheque d'icones n'est utilisee : elles pesent des centaines de
 * kilo-octets pour une trentaine de symboles reellement affiches. Ici tout est
 * traite par le compilateur, donc seul ce qui est importe finit dans le
 * paquet livre.
 */

export type IconName = keyof typeof PATHS;

const PATHS = {
  hash: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
  volume: 'M11 5 6 9H2v6h4l5 4V5Z M15.5 8.5a5 5 0 0 1 0 7 M19 5a9 9 0 0 1 0 14',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  x: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
  pin: 'M12 17v5 M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1Z',
  at: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.14',
  'user-plus':
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M19 8v6 M22 11h-6',
  'user-x':
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M17 8l5 5 M22 8l-5 5',
  'user-check':
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M16 11l2 2 4-4',
  shield:
    'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  'shield-off':
    'M2 2l20 20 M20 12V5l-8-3-5.5 2.06 M4.5 6.2 4 12c0 6 8 10 8 10a17 17 0 0 0 4.5-3.4',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z M22 7l-10 6L2 7',
  key: 'M15 2a7 7 0 1 0-5.6 11.2L3 19.6V22h2.4l1.2-1.2v-2h2v-2h2l1.6-1.6A7 7 0 0 0 15 2Z M16.5 7.5h.01',
  keyboard:
    'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M9 13h6',
  globe:
    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M2 12h20 M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20Z',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2 M14 4v4M8 10v4M14 16v4',
  play: 'M6 4l14 8-14 8Z',
  square: 'M5 5h14v14H5Z',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  thread:
    'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z M8 9h8 M8 13h5',
  reply: 'M9 17 4 12l5-5 M20 18v-2a4 4 0 0 0-4-4H4',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  smile:
    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M8 14s1.5 2 4 2 4-2 4-2 M9 9h.01M15 9h.01',
  send: 'M22 2 11 13 M22 2l-7 20-4-9-9-4Z',
  edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z',
  trash: 'M3 6h18 M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6 M10 11v6M14 11v6',
  /*
   * Micro : une capsule large, un arceau bas, un pied.
   *
   * La capsule faisait six pixels de large sur vingt-quatre, et l'arceau la
   * serrait de pres : a dix-huit pixels — la taille du bouton de la barre
   * vocale — les trois traits se rejoignaient en une tache. Elle est desormais
   * plus large et l'arceau descend plus bas, ce qui laisse du blanc entre les
   * formes. Le pied est raccourci d'autant, sans quoi l'ensemble depasserait.
   */
  mic: 'M12 3a3.4 3.4 0 0 0-3.4 3.4v5.2a3.4 3.4 0 0 0 6.8 0V6.4A3.4 3.4 0 0 0 12 3Z M18.4 11.6v.6a6.4 6.4 0 0 1-12.8 0v-.6 M12 18.6V21 M8.6 21h6.8',
  /*
   * Le meme, barre.
   *
   * La barre traverse en diagonale et les formes s'interrompent la ou elle
   * passe : un trait pose PAR-DESSUS un micro entier se lit comme une rayure
   * sur l'icone, pas comme un etat.
   */
  'mic-off':
    'M3 3l18 18 M8.6 8.9v2.9a3.4 3.4 0 0 0 5.6 2.6 M15.4 11V6.4A3.4 3.4 0 0 0 9.2 4.5 M18.4 11.6v.6a6.4 6.4 0 0 1-1 3.4 M5.6 11.6v.6a6.4 6.4 0 0 0 10.2 5.2 M12 18.6V21 M8.6 21h6.8',
  /*
   * Casque : un arceau, et deux coussinets pleins.
   *
   * Les coussinets etaient des rectangles arrondis fermes. Tout le jeu est
   * trace sans remplissage, si bien qu'un contour ferme se lit comme un
   * anneau — le casque paraissait perce de deux trous. Deux traits verticaux
   * epais n'ont pas d'interieur, et tiennent a seize pixels.
   */
  /*
   * Casque : un arceau, et deux coussinets pleins.
   *
   * Les coussinets sont des traits epais plutot que des contours fermes : tout
   * le jeu est trace sans remplissage, si bien qu'un contour ferme se lit comme
   * un anneau — le casque paraissait perce de deux trous.
   *
   * Ils descendent maintenant plus bas et l'arceau est plus haut : a
   * dix-huit pixels, l'ancien tracé donnait un demi-cercle pose sur deux
   * virgules, ou l'on ne reconnaissait le casque qu'en le sachant.
   */
  headphones: 'M3.4 18v-6a8.6 8.6 0 0 1 17.2 0v6 M4.4 14.6v5.4 M19.6 14.6v5.4',
  /* Le meme, barre. L'arceau s'arrete la ou la barre le coupe : le prolonger
     donnerait deux traits qui se croisent sans raison lisible. */
  'headphones-off':
    'M3 3l18 18 M3.4 18v-6a8.6 8.6 0 0 1 12.9-7.4 M20.6 18v-6a8.5 8.5 0 0 0-.6-3.1 M4.4 14.6v5.4 M19.6 14.6v5.4',
  /*
   * Micro tenu : la capsule, et une fleche vers le bas.
   *
   * Il fallait la distinguer du micro barre — qui dit « coupe », un etat qui
   * dure — alors que celle-ci dit « on appuie », un etat qui se relache dans la
   * seconde. La fleche vers le bas porte cette idee sans un mot : c'est le
   * dessin qu'on met sur une touche qu'on maintient.
   *
   * L'arceau de la capsule est retire : a quatorze pixels, la capsule, l'arceau
   * et la fleche donnaient une tache. On garde ce qui identifie — la capsule —
   * et ce qui distingue — la fleche.
   */
  'mic-tenu':
    'M12 3a3.2 3.2 0 0 0-3.2 3.2v4.4a3.2 3.2 0 0 0 6.4 0V6.2A3.2 3.2 0 0 0 12 3Z M12 15.4V21 M9.4 18.4 12 21l2.6-2.6',
  screen: 'M2 4h20v12H2Z M8 20h8 M12 16v4',
  // Combine classique : le microtelephone incline. Trace dans le meme style
  // que `phone-off`, dont il est le pendant, pour que les deux etats du bouton
  // d'appel ne changent pas d'epaisseur en basculant.
  phone: 'M15.5 21A16 16 0 0 1 3 8.5 3 3 0 0 1 6 5h1.5a1 1 0 0 1 1 .85l.6 3a1 1 0 0 1-.4 1L7.5 11a13 13 0 0 0 5.5 5.5l1.15-1.2a1 1 0 0 1 1-.4l3 .6a1 1 0 0 1 .85 1V18a3 3 0 0 1-3.5 3Z',
  'phone-off': 'M2 2l20 20 M10.7 5.3A16 16 0 0 1 12 5a2 2 0 0 1 2 2v1.5 M5.4 9.6A16 16 0 0 0 5 12c0 4.4 5.2 8 9 8 .8 0 1.6-.1 2.4-.4',
  video: 'M22 8l-6 4 6 4V8Z M2 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2Z',
  // Appareil photo, distinct du camescope `video` : celui-ci sert a changer
  // une image (photo de profil, banniere), l'autre a filmer.
  camera:
    'M3 7h3l2-2h8l2 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  image: 'M3 4h18v16H3Z M3 16l5-5 4 4 3-3 6 6 M9 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.7 21a2 2 0 0 1-3.4 0',
  // Chemise a onglet : sert aux categories, qui rangent des salons comme une
  // chemise range des feuilles.
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  'bell-off': 'M2 2l20 20 M8.7 3.7A6 6 0 0 1 18 8c0 2.3.3 4.1.8 5.4 M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h13 M13.7 21a2 2 0 0 1-3.4 0',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  expand:
    'M9 3H5a2 2 0 0 0-2 2v4 M15 3h4a2 2 0 0 1 2 2v4 M9 21H5a2 2 0 0 1-2-2v-4 M15 21h4a2 2 0 0 0 2-2v-4',
  monitor: 'M3 4h18v12H3Z M8 20h8 M12 16v4',
  sparkles: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z',
  'arrow-down': 'M12 5v14 M19 12l-7 7-7-7',
  'arrow-left': 'M19 12H5 M12 19l-7-7 7-7',
  'chevron-up': 'M18 15l-6-6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-left': 'M15 18l-6-6 6-6',
  'chevron-right': 'M9 18l6-6-6-6',
  compass: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M16.2 7.8l-2.9 6.4-6.4 2.9 2.9-6.4Z',
  'log-out': 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  copy: 'M9 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2Z M5 15H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7 M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  paperclip: 'M21.4 11.05 12.25 20.2a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.65 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.49-8.48',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2 M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z',
  'check-circle': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M8 12l3 3 5-6',
  circle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z',
  filter: 'M22 3H2l8 9.46V19l4 2v-8.54Z',
  refresh: 'M21 2v6h-6 M3 12a9 9 0 0 1 15-6.7L21 8 M3 22v-6h6 M21 12a9 9 0 0 1-15 6.7L3 16',
  loader: 'M12 2v4M12 18v4M4.9 4.9l2.9 2.9M16.2 16.2l2.9 2.9M2 12h4M18 12h4M4.9 19.1l2.9-2.9M16.2 7.8l2.9-2.9',
  // Un avertissement, distinct de la croix d'erreur : le triangle se lit de
  // loin comme « attention », la croix comme « rate ».
  'alert-triangle':
    'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z M12 9v4 M12 17h.01',
} as const;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  /**
   * Texte alternatif. Sans lui l'icone est marquee decorative et ignoree par
   * les lecteurs d'ecran, ce qui est le bon defaut quand un libelle
   * l'accompagne deja.
   */
  label?: string;
}

export function Icon({ name, size = 18, label, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
      {...rest}
    >
      {PATHS[name].split(' M').map((segment, index) => (
        <path key={index} d={index === 0 ? segment : `M${segment}`} />
      ))}
    </svg>
  );
}
