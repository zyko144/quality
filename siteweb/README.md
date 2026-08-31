# Echow — site vitrine

Site statique : du HTML, une feuille de style, un fichier de script. Aucune
dependance, aucun outil de construction, rien a compiler. On ouvre
`index.html` dans un navigateur et c'est deja le site final.

## Pages

| Fichier | Role |
| --- | --- |
| `index.html` | Accueil : ce qu'est Echow, et le bouton de telechargement. |
| `telecharger.html` | Windows disponible ; macOS et Linux annonces. |
| `player.html` | Maquette de l'interface. Ce n'est pas l'application, et la page le dit. |
| `aide.html` | Centre d'aide : une quarantaine de reponses rangees par sujet, une recherche, un formulaire de contact. |
| `cgu.html` | Conditions generales d'utilisation. |
| `confidentialite.html` | Politique de confidentialite (RGPD). |
| `mentions-legales.html` | Mentions legales. |
| `securite.html` | Mesures de securite et signalement de faille. |

## Avant toute mise en ligne publique

Les trois documents juridiques sont des **modeles de depart, rediges sans
conseil juridique**. Chacun porte un encart le disant.

Les mentions legales reposent sur l'article 6, III, 2 de la LCEN : une personne
physique qui edite un site **a titre non professionnel** peut ne pas publier son
identite ni son adresse, des lors qu'elle les a communiquees a son hebergeur.
D'ou l'absence de nom, de siege, de forme juridique, de SIRET et de TVA — ce
n'est pas un oubli, et la page l'explique. **Cela suppose que l'identite ait
effectivement ete communiquee a Vercel** ; si ce n'est pas fait, le regime ne
s'applique pas.

Quatre champs restent entre crochets, parce qu'eux seuls dependent d'une
decision ou d'un renseignement que le site ne peut pas deviner :

- `[Region d'hebergement de la base de donnees]` — dans le tableau de bord Supabase
- `[Duree d'inactivite retenue, par exemple 3 ans]` — au choix de l'editeur
- `[Delegue a la protection des donnees, le cas echeant]` — aucun designe a ce jour
- `[Mediateur de la consommation, le cas echeant]` — aucun designe a ce jour

Un point signale dans `confidentialite.html` et non tranche : la LCEN autorise
l'editeur non professionnel a taire son identite, mais le RGPD demande que le
responsable du traitement soit identifiable. Les deux regimes ne se recouvrent
pas exactement.

Pour retrouver les crochets restants :

```bash
grep -rn '\[' *.html
```

Faites relire l'ensemble par un professionnel avant de publier. Un modele
couvre les sujets attendus ; il ne remplace pas un avis sur votre situation.

## Le formulaire du centre d'aide

Le bouton ouvre le logiciel de messagerie du visiteur avec un message deja
redige — categorie, description, version de l'application et systeme. Rien ne
part sans son geste : il n'y a pas de serveur derriere, et le site n'en reclame
pas.

L'adresse tient en une ligne, en tete de `assets/site.js` :

```js
var ADRESSE_CONTACT = 'contactEchow@gmail.com';
```

La vider desactive le formulaire, qui l'annonce alors franchement plutot que de
faire semblant d'envoyer.

Un tableau de bord pour suivre les demandes suppose une base et une
authentification : il se construit cote application, pas ici.

## Deploiement

Depuis ce dossier :

```bash
npx vercel --prod
```

Vercel sert le dossier tel quel — pas de commande de construction, pas de
dossier de sortie a designer. `vercel.json` ne fait que deux choses : retirer
l'extension `.html` des adresses, et poser les en-tetes de securite habituels,
dont une politique de contenu qui interdit toute ressource externe. Le site
n'en charge aucune, ce qui rend cette regle gratuite.

## Le lien de telechargement

Il pointe vers la derniere version publiee sur GitHub :

```
https://github.com/zyko144/Echow/releases/latest/download/Echow-setup.exe
```

Cette adresse ne change jamais : `latest` suit les publications. Rien a
modifier ici a chaque version.

