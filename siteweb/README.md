# Qualityz — site vitrine

Site statique : du HTML, une feuille de style, un fichier de script. Aucune
dependance, aucun outil de construction, rien a compiler. On ouvre
`index.html` dans un navigateur et c'est deja le site final.

## Pages

| Fichier | Role |
| --- | --- |
| `index.html` | Accueil : ce qu'est Quality, et le bouton de telechargement. |
| `telecharger.html` | Windows disponible ; macOS et Linux annonces. |
| `player.html` | Maquette de l'interface. Ce n'est pas l'application, et la page le dit. |
| `cgu.html` | Conditions generales d'utilisation. |
| `confidentialite.html` | Politique de confidentialite (RGPD). |
| `mentions-legales.html` | Mentions legales. |
| `securite.html` | Mesures de securite et signalement de faille. |

## Avant toute mise en ligne publique

Les trois documents juridiques sont des **modeles de depart, rediges sans
conseil juridique**. Chacun porte un encart le disant, et laisse entre crochets
ce que seul l'editeur peut renseigner :

- `[Nom de l'editeur]`, `[Forme juridique, ou personne physique]`, `[Adresse]`,
  `[Numero de telephone]`, `[Email de contact]`
- `[Numero SIRET le cas echeant]`, `[Numero de TVA, le cas echeant]`
- `[Hebergeur]`, `[Region d'hebergement de la base de donnees]`
- `[Mediateur de la consommation, le cas echeant]`
- `[Date d'entree en vigueur]`, `[Date de derniere mise a jour]`

Pour les retrouver tous :

```bash
grep -rn '\[' *.html
```

Faites relire l'ensemble par un professionnel avant de publier. Un modele
couvre les sujets attendus ; il ne remplace pas un avis sur votre situation.

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
https://github.com/zyko144/quality/releases/latest/download/Quality-setup.exe
```

Cette adresse ne change jamais : `latest` suit les publications. Rien a
modifier ici a chaque version.
