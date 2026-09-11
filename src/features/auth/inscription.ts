/**
 * Ce que Supabase a fait d'une inscription, et ce qu'il faut en dire.
 *
 * Le defaut
 * ---------
 * « La creation de compte ne fait rien. » Trois issues tres differentes
 * donnaient le meme ecran — un message vague, « si la confirmation par e-mail
 * est active sur le projet… », puis le retour a la connexion :
 *
 *  - la session est ouverte, et il n'y a rien a dire : on entre ;
 *  - un e-mail de confirmation est parti, et c'est lui qu'il faut aller
 *    ouvrir — le message ne le disait qu'au conditionnel, sans l'adresse ;
 *  - l'adresse est DEJA inscrite. Supabase repond alors comme a un succes,
 *    sans rien envoyer, pour ne pas reveler quelles adresses existent. On
 *    attendait un e-mail qui ne viendrait jamais.
 *
 * Ce dernier cas se reconnait pourtant : l'utilisateur rendu n'a aucune
 * identite. C'est la seule trace qu'en laisse la reponse.
 *
 * Sans dependance, pour s'eprouver sans reseau ni session.
 */

export type IssueInscription = 'connecte' | 'confirmation' | 'deja-inscrit';

/** Le strict necessaire de la reponse de `signUp`. */
export interface ReponseInscription {
  session: unknown;
  user: { identities?: unknown[] | null } | null;
}

export function issueInscription(reponse: ReponseInscription): IssueInscription {
  if (reponse.session) return 'connecte';

  if (reponse.user && Array.isArray(reponse.user.identities) && reponse.user.identities.length === 0) {
    return 'deja-inscrit';
  }

  return 'confirmation';
}

/**
 * La phrase a afficher, ou `null` quand il n'y a rien a dire.
 *
 * L'adresse y figure : « un e-mail a ete envoye » sans dire ou laisse
 * chercher dans la mauvaise boite, et c'est le premier doute qu'on a devant
 * un e-mail qui tarde — me suis-je trompe en la tapant ?
 */
export function messageInscription(issue: IssueInscription, adresse: string): string | null {
  if (issue === 'connecte') return null;

  if (issue === 'deja-inscrit') {
    return (
      `Un compte existe deja avec ${adresse}. Connectez-vous, ou choisissez ` +
      '« Mot de passe oublie » si vous ne vous en souvenez plus.'
    );
  }

  return (
    `Un e-mail de confirmation vient d’etre envoye a ${adresse}. Ouvrez le lien ` +
    'qu’il contient, puis connectez-vous ici. Pensez a regarder vos indesirables.'
  );
}
