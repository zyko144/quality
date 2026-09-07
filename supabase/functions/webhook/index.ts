import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Le point d'entree des webhooks.
 *
 * Un programme — serveur de jeu, integrateur continu, script de sauvegarde —
 * envoie une requete a une adresse secrete, et son message parait dans un
 * salon. C'est tout ce que cette fonction fait, et c'est deliberement tout ce
 * qu'elle sait faire : elle n'ouvre aucune lecture, ne rend aucune donnee, et
 * ne peut ecrire que dans le salon attache au jeton.
 *
 * Pourquoi le format de Discord
 * -----------------------------
 * La forme acceptee est celle des webhooks Discord — `content`, `username`,
 * `avatar_url`, `embeds`. Ce n'est pas de l'imitation : c'est ce qui rend la
 * chose UTILISABLE le jour ou on la branche.
 *
 * Tout ce qui parle deja a un salon quelconque parle ce format : les modules
 * Garry's Mod, les actions GitHub, Grafana, UptimeRobot, les scripts trouves
 * sur un forum. Inventer une forme a nous aurait oblige a reecrire chacun
 * d'eux — c'est-a-dire, en pratique, a ne jamais brancher que ce qu'on a
 * ecrit soi-meme.
 *
 * Coller l'adresse d'Echow a la place de celle de Discord suffit donc, et rien
 * d'autre ne change.
 *
 * Ce qui n'est PAS ici
 * --------------------
 * La verification du jeton, la limite de debit et les bornes du contenu vivent
 * en base, dans `poster_par_webhook`. Cette fonction s'execute avec la cle de
 * service : elle peut tout, et une regle posee ici ne tiendrait que tant qu'on
 * pense a l'ecrire. En base, elle tient meme si l'on se trompe ici.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Un champ d'encart, tel que Discord le decrit. */
interface Champ {
  name?: unknown;
  value?: unknown;
}

interface Encart {
  title?: unknown;
  description?: unknown;
  url?: unknown;
  fields?: unknown;
}

/**
 * Aplatit un encart en texte.
 *
 * Echow n'a pas d'encarts : un message est du texte, avec la mise en forme que
 * l'application sait deja rendre. Les jeter serait perdre l'essentiel de ce
 * qu'envoient la plupart des integrations — un deploiement decrit son etat
 * dans un encart, pas dans `content`.
 *
 * On les rend donc en markdown, que l'application affiche deja : le titre en
 * gras, la description dessous, les champs en liste. Le resultat se lit, ce
 * qui est tout ce qu'on demande.
 */
function encartEnTexte(encart: Encart): string {
  const morceaux: string[] = [];

  const titre = typeof encart.title === 'string' ? encart.title.trim() : '';
  const lien = typeof encart.url === 'string' ? encart.url.trim() : '';

  if (titre) morceaux.push(lien ? `**[${titre}](${lien})**` : `**${titre}**`);
  else if (lien) morceaux.push(lien);

  if (typeof encart.description === 'string' && encart.description.trim()) {
    morceaux.push(encart.description.trim());
  }

  if (Array.isArray(encart.fields)) {
    for (const brut of encart.fields.slice(0, 25)) {
      const champ = brut as Champ;
      const nom = typeof champ.name === 'string' ? champ.name.trim() : '';
      const valeur = typeof champ.value === 'string' ? champ.value.trim() : '';

      if (nom && valeur) morceaux.push(`• **${nom}** — ${valeur}`);
      else if (valeur) morceaux.push(`• ${valeur}`);
    }
  }

  return morceaux.join('\n');
}

/** Le texte final : `content`, puis les encarts, dans l'ordre recu. */
function texteDuCorps(corps: Record<string, unknown>): string {
  const morceaux: string[] = [];

  if (typeof corps.content === 'string' && corps.content.trim()) {
    morceaux.push(corps.content.trim());
  }

  if (Array.isArray(corps.embeds)) {
    // Dix au plus, comme Discord : au-dela, c'est un journal qu'on deverse
    // dans une conversation, et personne ne le lira.
    for (const encart of corps.embeds.slice(0, 10)) {
      const texte = encartEnTexte(encart as Encart);
      if (texte) morceaux.push(texte);
    }
  }

  return morceaux.join('\n\n');
}

/**
 * Le jeton, pris dans le chemin.
 *
 * `/webhook/<jeton>`, comme Discord — une adresse qu'on colle telle quelle. Le
 * passer en parametre de requete serait plus simple a lire ici et plus facile
 * a laisser trainer ailleurs : les parametres se retrouvent dans les journaux
 * des serveurs mandataires, l'historique des navigateurs et les en-tetes
 * `Referer`. Un chemin n'y echappe pas toujours, mais bien plus souvent.
 */
function jetonDeLAdresse(url: URL): string | null {
  const morceaux = url.pathname.split('/').filter(Boolean);
  const dernier = morceaux[morceaux.length - 1] ?? '';

  return /^[a-f0-9]{32,96}$/i.test(dernier) ? dernier : null;
}

Deno.serve(async (requete) => {
  if (requete.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (requete.method !== 'POST') {
    return new Response('Methode non autorisee', { status: 405, headers: CORS });
  }

  const jeton = jetonDeLAdresse(new URL(requete.url));
  if (!jeton) {
    return new Response('Adresse incomplete', { status: 404, headers: CORS });
  }

  let corps: Record<string, unknown>;
  try {
    corps = (await requete.json()) as Record<string, unknown>;
  } catch {
    /*
     * Un corps illisible se dit tout de suite.
     *
     * C'est l'erreur la plus courante au branchement — un `Content-Type`
     * oublie, une chaine collee sans guillemets — et la seule qui se corrige
     * en dix secondes si on la nomme.
     */
    return new Response('Corps JSON illisible', { status: 400, headers: CORS });
  }

  const texte = texteDuCorps(corps);
  if (!texte) {
    return new Response('Rien a publier : ni content ni embeds', { status: 400, headers: CORS });
  }

  const client = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const { data, error } = await client.rpc('poster_par_webhook', {
    p_jeton: jeton,
    p_contenu: texte,
    p_nom: typeof corps.username === 'string' ? corps.username : null,
    p_avatar: typeof corps.avatar_url === 'string' ? corps.avatar_url : null,
  });

  if (error) {
    return new Response('Publication impossible', { status: 500, headers: CORS });
  }

  const resultat = (data as { message_id: string | null; refuse: string | null }[] | null)?.[0];

  if (resultat?.refuse) {
    /*
     * Les refus portent le code qui leur convient.
     *
     * `404` pour un jeton inconnu, `429` pour un debit depasse : ce sont ceux
     * qu'attendent les bibliotheques clientes, qui savent alors reessayer plus
     * tard plutot que d'abandonner — ou l'inverse.
     */
    const statut = resultat.refuse === 'trop de messages' ? 429 : 404;
    return new Response(resultat.refuse, { status: statut, headers: CORS });
  }

  // `204`, comme Discord : rien a rendre, et les integrations existantes
  // s'attendent a ne rien lire.
  return new Response(null, { status: 204, headers: CORS });
});
