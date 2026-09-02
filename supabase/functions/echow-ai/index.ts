import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CONNAISSANCE, CONSIGNE } from './connaissance.ts';

/**
 * Echow AI — la fonction qui parle a Gemini.
 *
 * Pourquoi une fonction serveur, et pas un appel depuis l'application
 * ---------------------------------------------------------------------
 * Une cle d'API posee dans le code de l'application est lisible par quiconque
 * l'installe. Il suffit d'ouvrir le fichier livre pour la trouver, et elle est
 * ensuite facturee au proprietaire du compte jusqu'a ce qu'il s'en apercoive.
 * Ce n'est pas un risque theorique : c'est la premiere chose que cherchent les
 * robots qui parcourent les paquets publies.
 *
 * La cle vit donc ici, dans les secrets du projet, et ne quitte jamais le
 * serveur. L'application n'envoie qu'une question et son jeton de session.
 *
 * Trois verrous, et chacun sert
 * -----------------------------
 * 1. **Il faut etre connecte.** Sans cela, l'adresse de la fonction est un
 *    acces gratuit a Gemini pour toute la planete, sur votre facture.
 * 2. **Une limite par personne et par jour.** Un compte seul ne peut pas
 *    vider le budget, volontairement ou par une boucle mal ecrite.
 * 3. **Une reponse bornee.** Le cout d'un appel est plafonne par construction,
 *    et non par confiance dans le modele.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Le modele, reglable sans redeployer.
 *
 * Les noms de modeles changent plus vite que le code qui les appelle : en
 * figer un obligerait a republier la fonction a chaque nouvelle version. La
 * variable permet de suivre, et de revenir en arriere si une version se revele
 * moins bonne.
 */
/**
 * Le modele, lu dans les secrets.
 *
 * Le defaut sert quand `GEMINI_MODEL` n'est pas pose. Le changer ici ne suffit
 * donc pas si un secret existe deja : c'est lui qui gagne, et c'est voulu — un
 * changement de modele ne doit pas demander un deploiement.
 *
 * La valeur suit celle qui tourne reellement en production : un defaut qui
 * annonce autre chose que ce qui est pose ne se voit jamais — il n'est lu que
 * le jour ou le secret disparait, c'est-a-dire le jour ou l'on a le moins envie
 * d'une surprise.
 *
 * Un nom errone ne se confond pas avec une panne : l'appel rend alors 404, et
 * la fonction repond « le modele n'est pas reconnu » plutot qu'« indisponible ».
 */
const MODELE = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.6-flash';

/**
 * Ce qu'une personne peut demander par jour.
 *
 * Cinquante : de quoi se servir de l'assistant sans jamais y penser. Le palier
 * gratuit de Gemini Flash accorde mille cinq cents requetes par jour ; a
 * cinquante chacun, trente personnes actives tiennent dedans.
 */
const PAR_JOUR = Number(Deno.env.get('IA_LIMITE_JOUR') ?? '50');

/**
 * Ce que TOUT LE MONDE peut demander par jour, ensemble.
 *
 * La limite par personne protege contre un compte qui s'emballe ; elle ne
 * protege pas contre trente comptes qui se servent normalement le meme jour, ni
 * contre des comptes crees pour l'occasion. Cinquante fois trente font
 * exactement le palier gratuit : sans ce second plafond, une journee active le
 * depasse et les appels suivants sont factures sans que personne l'ait decide.
 *
 * Mille quatre cents laisse cent requetes de marge sous le palier — de quoi
 * absorber un comptage decale sans basculer en payant.
 */
const PAR_JOUR_TOTAL = Number(Deno.env.get('IA_LIMITE_GLOBALE') ?? '1400');

/**
 * Longueur maximale d'une reponse, en jetons.
 *
 * C'est ce qui borne le cout : un modele bavard peut produire plusieurs
 * milliers de jetons pour une question simple. Huit cents suffisent largement
 * a expliquer un reglage, et forcent des reponses courtes — ce qu'on veut de
 * toute facon.
 */
/*
 * Ce qui a ete essaye, et retire
 * ------------------------------
 * `thinkingConfig: { thinkingBudget: 0 }` dans `generationConfig`, pour couper
 * la deliberation prealable des modeles Flash et gagner sur le delai avant le
 * premier mot.
 *
 * L'API a repondu `400 INVALID_ARGUMENT` et l'assistant a cesse de repondre.
 * J'avais suppose qu'un modele ne connaissant pas ce champ l'ignorerait : Gemini
 * rejette la requete ENTIERE sur un champ inconnu. Une supposition sur le
 * comportement d'un service tiers ne vaut rien tant qu'elle n'a pas ete
 * essayee contre lui.
 *
 * A ne pas remettre sans avoir verifie que le modele configure l'accepte — et
 * le seul moyen de le verifier est de l'appeler.
 */

/**
 * La longueur maximale d'une reponse.
 *
 * Large, et c'est voulu.
 *
 * Il avait ete ramene a trois cent cinquante pour accelerer les reponses. Elles
 * se sont mises a s'arreter au milieu d'une phrase : sur ces modeles, les
 * jetons de REFLEXION comptent dans ce plafond. La deliberation le consommait,
 * et il ne restait plus assez pour finir de repondre.
 *
 * Le plafond ne doit donc pas servir a raccourcir. C'est une securite contre un
 * emballement, rien d'autre — et depuis la diffusion au fil de l'eau, la
 * longueur ne coute plus d'attente : les mots paraissent des le premier.
 *
 * La brievete se demande dans la consigne, ou elle porte sur ce qui est ECRIT
 * plutot que sur ce qui est pense. C'est le seul endroit ou elle ne risque pas
 * de couper une phrase en deux.
 */
const REPONSE_MAX = 2000;

/** Longueur maximale d'une question. Au-dela, c'est un texte colle. */
const QUESTION_MAX = 2000;

/** Nombre d'echanges precedents renvoyes au modele. */
const MEMOIRE = 8;

interface Tour {
  role: 'user' | 'model';
  texte: string;
}

Deno.serve(async (requete) => {
  if (requete.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const repondre = (corps: unknown, statut = 200) =>
    new Response(JSON.stringify(corps), {
      status: statut,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  try {
    const cle = Deno.env.get('GEMINI_API_KEY');
    if (!cle) console.error('[echow-ai] GEMINI_API_KEY absente des secrets');
    if (!cle) {
      // Distinct d'une panne : l'assistant n'est pas configure, et le dire
      // evite de chercher un defaut la ou il n'y a qu'un secret manquant.
      return repondre(
        { erreur: 'non-configure', message: 'L’assistant n’est pas encore configure.' },
        503,
      );
    }

    /* ------------------------------------------------------------------ */
    /* 1. Qui demande                                                      */
    /* ------------------------------------------------------------------ */

    const jeton = requete.headers.get('Authorization')?.replace('Bearer ', '');
    if (!jeton) return repondre({ erreur: 'non-connecte' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: auth, error: erreurAuth } = await supabase.auth.getUser(jeton);
    const moi = auth?.user?.id;

    if (erreurAuth || !moi) return repondre({ erreur: 'non-connecte' }, 401);

    /* ------------------------------------------------------------------ */
    /* 2. Combien il en reste                                              */
    /* ------------------------------------------------------------------ */

    /*
     * Le compte est tenu cote base, pas en memoire.
     *
     * Une fonction de bord n'a pas de memoire d'un appel a l'autre : elle peut
     * s'executer sur une machine differente a chaque fois. Compter en memoire
     * reviendrait a ne pas compter du tout.
     */
    const aujourdhui = new Date().toISOString().slice(0, 10);

    const [{ data: usage }, { data: total }] = await Promise.all([
      supabase
        .from('ia_usage')
        .select('appels')
        .eq('profil_id', moi)
        .eq('jour', aujourdhui)
        .maybeSingle(),
      supabase.rpc('ia_total_du_jour'),
    ]);

    const deja = usage?.appels ?? 0;

    /*
     * Le plafond commun passe en premier.
     *
     * Quand il est atteint, le message doit dire que cela ne vient pas de la
     * personne : « vous avez atteint votre limite » alors qu'on n'a pose que
     * deux questions ferait chercher une erreur la ou il n'y en a pas.
     */
    if (typeof total === 'number' && total >= PAR_JOUR_TOTAL) {
      return repondre(
        {
          erreur: 'quota-global',
          message:
            'L’assistant a atteint sa limite pour aujourd’hui, tous comptes confondus. Il repartira demain.',
          restant: 0,
        },
        429,
      );
    }

    if (deja >= PAR_JOUR) {
      return repondre(
        {
          erreur: 'quota',
          message: `Vous avez atteint la limite de ${PAR_JOUR} questions pour aujourd’hui. Elle se remet a zero demain.`,
          restant: 0,
        },
        429,
      );
    }

    /* ------------------------------------------------------------------ */
    /* 3. La question                                                      */
    /* ------------------------------------------------------------------ */

    const corps = (await requete.json()) as { question?: string; historique?: Tour[] };
    const question = (corps.question ?? '').trim();

    if (!question) return repondre({ erreur: 'question-vide' }, 400);
    if (question.length > QUESTION_MAX) {
      return repondre(
        {
          erreur: 'question-trop-longue',
          message: 'Votre question est trop longue. Resumez-la en quelques phrases.',
        },
        400,
      );
    }

    /*
     * L'historique vient du client, et n'est donc pas de confiance.
     *
     * On le borne en nombre et en longueur : sans cela, on paierait un
     * contexte que quelqu'un aurait fabrique, et la facture suivrait.
     */
    const historique = (corps.historique ?? [])
      .slice(-MEMOIRE)
      .filter((tour) => tour && typeof tour.texte === 'string')
      .map((tour) => ({
        role: tour.role === 'model' ? 'model' : 'user',
        parts: [{ text: tour.texte.slice(0, QUESTION_MAX) }],
      }));

    /* ------------------------------------------------------------------ */
    /* 4. L'appel                                                          */
    /* ------------------------------------------------------------------ */

    const reponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELE}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cle },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: `${CONSIGNE}\n\n${CONNAISSANCE}` }] },
          contents: [...historique, { role: 'user', parts: [{ text: question }] }],
          generationConfig: {
            maxOutputTokens: REPONSE_MAX,
            temperature: 0.6,
          },
        }),
      },
    );

    if (!reponse.ok) {
      const detail = await reponse.text();

      /*
       * Un modele inconnu se distingue d'une panne.
       *
       * Les noms de modeles changent, et se tromper d'un caractere rend une
       * erreur qui ressemble a une panne generale. La distinguer evite de
       * chercher ailleurs.
       */
      const inconnu = reponse.status === 404 || detail.includes('not found');

      /*
       * Une surcharge n'est pas une panne.
       *
       * `429` veut dire « trop de demandes en ce moment » : cela se resout en
       * attendant, et souvent en quelques secondes. « L'assistant est
       * momentanement indisponible » laisse croire a une panne, donc a quelque
       * chose a signaler ou a reparer — alors qu'il n'y a qu'a reessayer.
       *
       * Le quota epuise porte le meme code. On les separe sur le texte : Google
       * dit « credits are depleted » pour l'un, et parle de debit pour l'autre.
       */
      const surcharge =
        reponse.status === 429 && !detail.toLowerCase().includes('depleted');

      /*
       * La raison part aussi dans les journaux du serveur.
       *
       * Elle etait renvoyee dans la reponse, et seulement la. Quand l'assistant
       * a cesse de repondre, les journaux de la fonction ne montraient que des
       * demarrages et des arrets : elle echouait sans rien ecrire, et la seule
       * trace vivait dans une reponse que personne ne gardait.
       *
       * Une fonction qui rate en silence n'est pas reparable. Celle-ci dit
       * desormais qui l'a refusee et pourquoi.
       */
      console.error('[echow-ai] Gemini a refuse', {
        statut: reponse.status,
        modele: MODELE,
        detail: detail.slice(0, 400),
      });

      return repondre(
        {
          erreur: inconnu ? 'modele-inconnu' : surcharge ? 'surcharge' : 'service',
          message: inconnu
            ? `Le modele « ${MODELE} » n’est pas reconnu par l’API. Changez GEMINI_MODEL.`
            : surcharge
              ? 'Les serveurs sont surcharges en ce moment. Reessayez dans quelques secondes.'
              : 'L’assistant est momentanement indisponible.',
          detail: detail.slice(0, 400),
        },
        inconnu ? 400 : 502,
      );
    }

    /* ------------------------------------------------------------------ */
    /* 5. On relaie au fil de l'eau                                        */
    /* ------------------------------------------------------------------ */

    /*
     * Le texte part par morceaux, des le premier mot.
     *
     * Attendre la reponse entiere avant de l'envoyer laissait la personne
     * devant un ecran vide pendant toute l'ecriture — plusieurs secondes, et
     * d'autant plus longtemps que la reponse etait bonne. La longueur devenait
     * une punition.
     *
     * Tout ce qui peut echouer a deja ete verifie AVANT d'arriver ici : la
     * session, le quota, la cle, et le refus de Gemini. C'est la condition pour
     * pouvoir diffuser — une fois le flux ouvert, on ne peut plus revenir en
     * arriere et repondre une erreur, le client a deja commence a afficher.
     *
     * Chaque morceau part en une ligne de JSON, terminee par un saut de ligne.
     * Le client peut ainsi lire ligne par ligne sans assembler lui-meme les
     * paquets, qui arrivent decoupes n'importe ou.
     */
    let ecrit = '';
    let jetons = 0;

    const flux = new ReadableStream({
      async start(controle) {
        const sortie = new TextEncoder();
        const lecteur = reponse.body!.getReader();
        const decodeur = new TextDecoder();
        let reste = '';

        const envoyer = (objet: unknown) =>
          controle.enqueue(sortie.encode(JSON.stringify(objet) + String.fromCharCode(10)));

        try {
          for (;;) {
            const { done, value } = await lecteur.read();
            if (done) break;

            reste += decodeur.decode(value, { stream: true });

            // Les evenements arrivent en lignes `data: {...}`. Le dernier
            // fragment est souvent incomplet : on le garde pour le tour suivant.
            const lignes = reste.split(String.fromCharCode(10));
            reste = lignes.pop() ?? '';

            for (const ligne of lignes) {
              if (!ligne.startsWith('data:')) continue;

              const charge = ligne.slice(5).trim();
              if (!charge || charge === '[DONE]') continue;

              try {
                const bout = JSON.parse(charge);
                const morceau: string =
                  bout?.candidates?.[0]?.content?.parts
                    ?.map((p: { text?: string }) => p.text ?? '')
                    .join('') ?? '';

                if (bout?.usageMetadata?.totalTokenCount) {
                  jetons = bout.usageMetadata.totalTokenCount;
                }

                if (morceau) {
                  ecrit += morceau;
                  envoyer({ morceau });
                }

                /*
                 * Une reponse coupee se signale.
                 *
                 * `MAX_TOKENS` veut dire que le modele s'est arrete parce qu'il
                 * n'avait plus de place, pas parce qu'il avait fini. Sans cette
                 * mention, une phrase interrompue au milieu passe pour une
                 * reponse complete, et l'on cherche le sens de ce qui manque.
                 */
                if (bout?.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
                  console.error('[echow-ai] Reponse coupee par le plafond', {
                    plafond: REPONSE_MAX,
                    ecrits: ecrit.length,
                  });
                  envoyer({ morceau: String.fromCharCode(10) + '(reponse coupee)' });
                }
              } catch {
                // Un evenement illisible ne doit pas interrompre les suivants :
                // le flux continue, et il en manquera au pire quelques mots.
              }
            }
          }

          /*
           * Rien du tout : l'assistant n'a pas su repondre.
           *
           * Le meme cas qu'avant la diffusion, mais il ne peut plus etre une
           * erreur — le flux est ouvert. Il devient donc le texte lui-meme.
           */
          if (!ecrit.trim()) {
            envoyer({
              morceau:
                'Je n’ai pas su repondre a celle-ci. Le support humain pourra vous aider.' +
                String.fromCharCode(10) +
                '[[SUPPORT]]',
            });
          }

          // Le compteur monte apres coup, comme avant : une reponse qui n'est
          // jamais arrivee ne doit pas etre payee.
          await supabase.rpc('ia_compter', { p_jetons: jetons });

          envoyer({ fin: true, restant: Math.max(0, PAR_JOUR - deja - 1), jetons, modele: MODELE });
        } catch (cause) {
          console.error('[echow-ai] Flux interrompu', String(cause).slice(0, 300));
          envoyer({ fin: true, interrompu: true });
        } finally {
          controle.close();
        }
      },
    });

    return new Response(flux, {
      status: 200,
      headers: {
        ...CORS,
        // `x-ndjson` : une ligne de JSON par morceau. Pas `text/event-stream`,
        // dont le format n'apporterait rien ici et qu'il faudrait re-analyser.
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (cause) {
    console.error('[echow-ai] Echec inattendu', String(cause).slice(0, 400));

    return repondre(
      { erreur: 'inattendu', message: 'L’assistant a rencontre un probleme.', detail: String(cause).slice(0, 300) },
      500,
    );
  }
});
