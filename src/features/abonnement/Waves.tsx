import { Icon, type IconName } from '@/components/Icon';
import { QualityLogo } from '@/components/QualityLogo';

/**
 * Waves — l'abonnement de Echow.
 *
 * Le nom vient du logo, une vague en spirale — au pluriel, parce qu'il y en
 * aura d'autres. Il dit aussi ce que l'abonnement est : ce qui pousse
 * l'application en avant, pas un peage pose devant ce qui existe deja.
 *
 * Cette page annonce, elle ne vend pas. Rien n'est encaissable aujourd'hui :
 * il n'y a ni paiement, ni compte marchand, ni conditions de vente. Un bouton
 * « S'abonner » qui ne mene nulle part serait pire qu'une annonce honnete —
 * on y clique, et l'on apprend qu'on a ete promene.
 *
 * Ce qui est promis ici engage. Chaque ligne doit rester tenable le jour ou le
 * paiement existera : mieux vaut une liste courte que des promesses qu'il
 * faudra retirer.
 */

interface Avantage {
  icone: IconName;
  titre: string;
  detail: string;
}

const AVANTAGES: Avantage[] = [
  {
    icone: 'sparkles',
    titre: 'Les nouveautes avant tout le monde',
    detail:
      'Les fonctionnalites en cours d’essai vous sont ouvertes des qu’elles tiennent debout. Vous verrez donc aussi ce qui ne marche pas encore — c’est le principe, et c’est ce qui rend vos retours utiles.',
  },
  {
    icone: 'shield',
    titre: 'Un badge sur votre profil',
    detail:
      'Il dit que vous soutenez le projet. Il ne donne aucun droit sur les autres : ni priorite, ni pouvoir de moderation, ni acces a quoi que ce soit de prive.',
  },
  {
    icone: 'screen',
    titre: 'Un partage d’ecran plus genereux',
    detail:
      'Un plafond de debit releve pour les jeux rapides, ou toute l’image change d’une trame a l’autre. Le partage reste direct : c’est votre liaison qui travaille, pas nos serveurs.',
  },
  {
    icone: 'image',
    titre: 'Des fichiers plus lourds',
    detail:
      'De quoi envoyer une video de partie sans passer par un service tiers. La limite exacte sera annoncee avec le prix, pas avant.',
  },
  {
    icone: 'smile',
    titre: 'Une photo de profil animee',
    detail:
      'Et une banniere animee. C’est cosmetique, et c’est assume : personne ne devrait avoir a payer pour se faire entendre.',
  },
  {
    icone: 'volume',
    titre: 'La qualite Musique par defaut',
    detail:
      'Le son a 128 kb/s en stereo, sans avoir a le rechoisir a chaque fois. Disponible pour tout le monde des aujourd’hui dans les reglages : l’abonnement n’en fait que le defaut.',
  },
];

export function Waves() {
  return (
    <div className="waves">
      <section className="waves__entete">
        <span className="waves__logo" aria-hidden="true">
          <QualityLogo size={64} />
        </span>

        <p className="waves__annonce">Prochainement</p>
        <h1 className="waves__titre">Waves</h1>

        <p className="waves__accroche">
          Cinq euros par mois pour soutenir Echow et essayer ce qui arrive
          avant les autres.
        </p>

        {/*
          Un bouton desactive plutot qu'un bouton qui ment.
          Il n'y a pas de paiement aujourd'hui : rien ne serait encaisse, et
          l'on ne l'apprendrait qu'apres avoir clique.
        */}
        <button type="button" className="btn btn--primary waves__bouton" disabled>
          Bientot disponible
        </button>

        <p className="waves__note">
          Aucun paiement n&rsquo;est ouvert pour l&rsquo;instant, et rien de ce
          que vous utilisez aujourd&rsquo;hui ne deviendra payant.
        </p>
      </section>

      <ul className="waves__liste">
        {AVANTAGES.map((avantage) => (
          <li className="waves__carte" key={avantage.titre}>
            <span className="waves__icone" aria-hidden="true">
              <Icon name={avantage.icone} size={18} />
            </span>
            <h2 className="waves__carte-titre">{avantage.titre}</h2>
            <p className="waves__carte-detail">{avantage.detail}</p>
          </li>
        ))}
      </ul>

      <section className="waves__promesse">
        <h2 className="waves__promesse-titre">Ce que Waves ne fera jamais</h2>
        <ul>
          <li>
            Rendre payant ce qui est gratuit aujourd&rsquo;hui. Les salons, la
            voix, le partage d&rsquo;ecran et la recherche restent entiers pour
            tout le monde.
          </li>
          <li>
            Donner un avantage sur les autres. Un badge n&rsquo;est pas un
            grade, et ne fera jamais passer un message devant un autre.
          </li>
          <li>
            Servir de la publicite, ni revendre quoi que ce soit de ce qui
            transite ici.
          </li>
        </ul>
      </section>
    </div>
  );
}
