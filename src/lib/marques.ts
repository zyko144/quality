/**
 * La couleur d'un site, devinee depuis son adresse.
 *
 * Une carte d'apercu portait le gris le plus sombre de la palette, une initiale
 * et un chemin. Trois liens dans une conversation donnaient trois rectangles
 * noirs identiques, et il fallait LIRE chacun pour savoir lequel menait a une
 * video. Or on ne lit pas une conversation en diagonale, on la parcourt.
 *
 * Le rouge de YouTube ne veut dire que YouTube. C'est reconnu avant d'etre lu,
 * et cela ne coute rien : la couleur se deduit du nom de domaine, qu'on a deja.
 *
 * Aucune requete
 * --------------
 * Pas de favicon, pas de metadonnees. Aller chercher l'icone du site
 * annoncerait a ce site que quelqu'un vient de recevoir son lien — avant meme
 * qu'il clique, et pour chaque personne du salon. Une couleur deduite du
 * domaine dit presque autant, et ne dit rien a personne.
 */

export interface Marque {
  nom: string;
  teinte: string;
}

/**
 * Les sites reconnus, par domaine.
 *
 * La liste est volontairement courte. Une couleur de plus est une couleur de
 * plus a distinguer, et l'oeil n'en separe pas trente : au-dela, on retombe sur
 * la teinte de l'application, ce qui reste correct et honnete.
 */
const PAR_DOMAINE: Record<string, Marque> = {
  'youtube.com': { nom: 'YouTube', teinte: '#ff0033' },
  'youtu.be': { nom: 'YouTube', teinte: '#ff0033' },
  'twitch.tv': { nom: 'Twitch', teinte: '#9146ff' },
  'spotify.com': { nom: 'Spotify', teinte: '#1db954' },
  'github.com': { nom: 'GitHub', teinte: '#8b949e' },
  'x.com': { nom: 'X', teinte: '#d9dde3' },
  'twitter.com': { nom: 'X', teinte: '#d9dde3' },
  'instagram.com': { nom: 'Instagram', teinte: '#e1306c' },
  'tiktok.com': { nom: 'TikTok', teinte: '#25f4ee' },
  'reddit.com': { nom: 'Reddit', teinte: '#ff4500' },
  'soundcloud.com': { nom: 'SoundCloud', teinte: '#ff5500' },
  'steampowered.com': { nom: 'Steam', teinte: '#66c0f4' },
  'steamcommunity.com': { nom: 'Steam', teinte: '#66c0f4' },
  'discord.com': { nom: 'Discord', teinte: '#5865f2' },
  'discord.gg': { nom: 'Discord', teinte: '#5865f2' },
  'wikipedia.org': { nom: 'Wikipedia', teinte: '#c8ccd1' },
  'roblox.com': { nom: 'Roblox', teinte: '#00a2ff' },
};

/**
 * La marque derriere un hote, ou `null` si on ne la connait pas.
 *
 * Le `www.` est retire et les sous-domaines sont acceptes : `open.spotify.com`
 * et `spotify.com` designent le meme site, et exiger la forme exacte ferait
 * echouer la reconnaissance sur la moitie des adresses reellement partagees.
 */
export function marqueDe(hote: string): Marque | null {
  const propre = hote.toLowerCase().replace(/^www\./, '');

  for (const [domaine, marque] of Object.entries(PAR_DOMAINE)) {
    if (propre === domaine || propre.endsWith(`.${domaine}`)) return marque;
  }

  return null;
}

/**
 * La couleur a poser sur la carte : celle du site, ou celle de l'application.
 *
 * Une valeur CSS, pas une couleur figee, pour le cas inconnu : la teinte de
 * l'application suit le theme et ce que la personne a choisi. Une couleur en
 * dur y ferait une tache qui ne bouge pas avec le reste.
 */
export function teinteDe(hote: string): string {
  return marqueDe(hote)?.teinte ?? 'var(--accent)';
}
