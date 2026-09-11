import { test, expect } from '@playwright/test';
import { issueInscription, messageInscription } from '../src/features/auth/inscription';

/**
 * L'issue d'une inscription, telle que Supabase la rend.
 *
 * Fichier du projet « public » : aucune session, aucun compte cree — les cas
 * se posent sur la forme des reponses.
 *
 * Ce que ce fichier protege : « la creation de compte ne fait rien ». Trois
 * issues tres differentes donnaient le meme ecran, dont une — l'adresse deja
 * inscrite — ou Supabase repond comme a un succes sans rien envoyer.
 */

test.describe('Issue d une inscription', () => {
  test('une session ouverte fait entrer, sans rien a dire', () => {
    const issue = issueInscription({ session: { access_token: 'x' }, user: { identities: [{}] } });

    expect(issue).toBe('connecte');
    expect(messageInscription(issue, 'a@exemple.fr')).toBeNull();
  });

  test('sans session, c est une confirmation a aller ouvrir', () => {
    const issue = issueInscription({ session: null, user: { identities: [{}] } });

    expect(issue).toBe('confirmation');
    // L'adresse est dans la phrase : c'est le premier doute devant un e-mail
    // qui tarde.
    expect(messageInscription(issue, 'a@exemple.fr')).toContain('a@exemple.fr');
    expect(messageInscription(issue, 'a@exemple.fr')).toContain('indesirables');
  });

  test('une adresse deja inscrite se reconnait a l absence d identite', () => {
    // Supabase repond comme a un succes, sans rien envoyer : sans ce cas, on
    // attendait un e-mail qui ne viendrait jamais.
    const issue = issueInscription({ session: null, user: { identities: [] } });

    expect(issue).toBe('deja-inscrit');
    expect(messageInscription(issue, 'a@exemple.fr')).toContain('Mot de passe oublie');
  });

  test('une reponse sans utilisateur reste une confirmation', () => {
    // Faute de mieux : c'est l'issue qui invite a verifier sa boite, et non
    // celle qui affirmerait un compte existant qu'on ne peut pas prouver.
    expect(issueInscription({ session: null, user: null })).toBe('confirmation');
  });
});
