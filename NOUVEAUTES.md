# Nouveautes

Ce fichier est la source unique des notes de version.

Il sert deux fois : l'atelier de publication y prend le texte de la release
GitHub, et l'application y prend celui du message affiche au premier lancement
qui suit une mise a jour. Ecrire les notes a deux endroits garantissait qu'ils
finiraient par diverger.

Le format compte. Chaque version est un titre de niveau deux, `## x.y.z`, suivi
d'une liste a puces. Le premier titre rencontre est celui de la version en
cours ; l'outil de publication et l'application lisent tous deux la section
correspondant a leur numero de version.

## 0.9.0

### Badges

- **Vingt-sept badges a gagner**, ranges par famille et par palier : les heures en vocal, les messages ecrits, la taille des espaces fondes, l'anciennete du compte. Ils s'attribuent tout seuls des que la condition est remplie.
- **Dix-sept portent leur dessin.** Un badge qu'on possede rayonne ; un badge qu'on n'a pas encore reste en retrait, sans jamais disparaitre de sa serie.
- **Certains peuvent se fermer.** « Pionnier » n'a que cent places : une fois la centieme prise, plus personne ne pourra l'obtenir. Le nombre de places restantes est affiche.
- Les badges obtenus s'affichent a droite du nom, dans la fiche de profil.

### Echow AI

- **Un assistant qui repond dans l'application.** Il connait Echow et repond lui-meme au lieu de renvoyer au support.

### Profil

- **Fiche refaite**, en vertical : banniere, bio, liens, comptes lies, espaces en commun et activite en cours.
- Les comptes lies affichent le logo du service.

### Salons vocaux

- **On ne voit plus les autres separement.** Le salon se reconstruit tout seul quand la liaison se tait, et les raccourcis marchent depuis un jeu, en plein ecran.
- Un indicateur montre qui parle.

### Messages

- Mentions en pastilles, edition d'un message deja envoye, indicateur de saisie, images en plein ecran.
- **Les emojis ne sont plus ceux de Windows** : ceux d'Apple les remplacent, partout.

### Reglages

- **Reorganises**, et les reglages d'un espace passent en page complete.
- Les signalements aboutissent vraiment.

### Theme clair

- Les badges, leurs vignettes et la fiche de profil cessent d'etre illisibles hors du theme sombre.

## 0.8.0

### Maintenance

- **Fix cache WebView2.** Le cache du Service Worker est supprime au demarrage par le code natif (Rust), avant que le WebView ne charge. Tous les utilisateurs verront la page de maintenance sans intervention manuelle.

## 0.7.9

### Maintenance

- **Fix cache.** Suppression du Service Worker pour forcer la mise a jour de l'application de bureau sans delai.

## 0.7.8

### Maintenance

- **Mise en maintenance technique de l'application.** Les serveurs font l'objet d'une opération de maintenance globale. L'accès aux conversations, salons vocaux et inscriptions est temporairement suspendu pour tous les utilisateurs le temps de déployer les améliorations d'infrastructure.

## 0.7.7

### Corrige

- **On entrait dans un salon vocal sans y etre : personne ne vous voyait, et vous ne voyiez personne.** La cause est nommee mot pour mot dans les traces : « cannot add presence callbacks after subscribe() ». Le canal d'un salon peut deja exister — c'est celui qui sert a montrer qui discute dans un salon ou l'on n'est pas — et le demander une seconde fois rend CE canal-la plutot que d'en creer un neuf. Poser un ecouteur dessus leve une exception, qui echappait a la protection : celle-ci n'entourait que la creation, pas les ecouteurs poses juste apres. Toute la suite de la jonction etait emportee, et l'on se retrouvait « connecte » sans jamais publier sa presence ni recevoir celle des autres. Le sujet est desormais libere juste avant d'ouvrir, et l'installation entiere est protegee.

### Nouveau

- **Le tiroir de navigation suit le doigt.** Un glissement depuis le bord gauche ouvre les serveurs et les salons ; un glissement vers la gauche les referme. Le tiroir accompagne le doigt pendant le geste au lieu de surgir apres coup, ce qui permet de changer d'avis a mi-chemin.
- **Des fleches de retour la ou l'on revient.** Dans un salon sur telephone, dans les panneaux qui recouvrent la conversation, dans les reglages : « Echap » ne veut rien dire sur un telephone, et la croix y est moins claire qu'une fleche.

### Ameliore

- **Les messages sont plus denses sur telephone.** Avatar, interligne et barre d'actions resserres : on voit pres de moitie plus de messages sans que rien descende sous quinze pixels, qui est le plancher confortable a bout de bras.

## 0.7.6

### Corrige

- **Le salon vocal ne se reparait jamais tout seul, et c'est la cause d'une famille entiere de defauts.** Le canal qui porte la presence — qui est la, qui parle, qui partage — signale son etat : souscrit, en erreur, delai depasse, ferme. Seul le premier etait traite. Les trois autres ne declenchaient rien : le canal restait mort, la presence vide, et l'on se retrouvait seul dans un salon ou les autres etaient pourtant la, chacun de son cote. Rien ne le disait, et la seule issue etait de quitter et de revenir. C'est la meme cause pour « on ne se voit pas », « on ne s'entend pas », « mon profil ne s'affiche pas » et « je dois quitter et revenir ». Le canal se surveille desormais au fait le plus simple — s'y voir soi-meme — et se rebatit apres douze secondes de silence, sans couper le micro ni les connexions en cours.
- **On ne voyait pas toujours son propre partage.** La liste des partages etait construite a partir de la presence, y compris pour soi : voir SON PROPRE ecran attendait donc un aller-retour par le serveur, et tant que l'annonce n'etait pas revenue, notre entree disait « ne partage pas ». Quitter et revenir republiait tout, ce qui explique le contournement. Son propre partage se lit desormais chez soi, et s'ouvre deja regarde — il n'y a aucun decodage a epargner sur une capture qui est deja en memoire.

## 0.7.5

### Nouveau

- **Echow s'installe sur un telephone, et c'est la meme application.** Il existait un second projet, ecrit a la main, qui offrait six ecrans la ou l'application en compte vingt et un : ni amis, ni moderation, ni recherche, ni parametres, ni fils de discussion. Il a ete supprime. Deux copies d'une meme application divergent toujours, et c'est la plus pauvre qui recoit les corrections en dernier — ou jamais. L'application de bureau etait deja faite pour les petits ecrans et eprouvee sur un telephone : il ne manquait que de quoi la poser sur l'ecran d'accueil. Elle s'y installe desormais, se met a jour toute seule, et donne tout ce que donne le bureau.
- **L'encoche et la barre de geste sont respectees.** Le fond passe dessous, comme il se doit pour une application installee, mais le titre du salon ne glisse plus sous l'heure et le composeur reste atteignable au doigt.

## 0.7.4

### Nouveau

- **Les boutons de souris se posent comme des touches.** Le pouce d'une souris de joueur porte deux boutons dont aucun jeu ne se sert vraiment : c'est le meilleur endroit ou poser une touche de conversation, parce qu'on l'atteint sans lacher les commandes. Le clic molette aussi. Gauche et droit sont refuses, et a deux endroits plutot qu'un : les poser sur une action rendrait l'ordinateur inutilisable, et l'on ne pourrait meme plus cliquer le reglage pour le defaire.
- **Un bandeau signale les reglages non enregistres.** Les reglages continuent de s'appliquer sur-le-champ — c'est la seule facon de regler un micro en s'ecoutant — mais rien ne disait qu'on avait touche a quelque chose, et revenir en arriere demandait de s'en souvenir. « Tout annuler » remet tout comme a l'ouverture, et l'on ne referme plus sans avoir tranche.

### Corrige

- **Le partage d'un ami restait parfois invisible.** Le role d'un flux — camera ou ecran — voyage par un autre chemin que l'image, et rien n'ordonne les deux. Quand la reponse n'etait pas encore arrivee, un unique rattrapage etait tente une seconde plus tard : s'il tombait trop tot, le flux restait en attente POUR TOUJOURS, sans erreur ni trace. On cliquait « Regarder » et rien n'apparaissait. Cela explique aussi les deux contournements trouves a tatons — lancer son propre partage, ou quitter et revenir — qui refaisaient l'operation dans le bon ordre. Le classement se retente desormais a chaque changement, et se tranche par elimination quand quelqu'un montre sa camera et son ecran en meme temps.
- **Les raccourcis ne dependent plus d'un seul chemin.** Quand la surveillance par le systeme s'annoncait active, celle de la fenetre etait debranchee : une seule faille en aval, et il ne restait plus aucun raccourci — pas meme ceux qui marchaient depuis toujours. Les deux sont branches en permanence, et le double declenchement est ecarte autrement.

## 0.7.3

### Ameliore

- **Partager ne bloque plus la carte graphique, et le jeu garde ses images.** C'est ici que partaient les images perdues, et le coupable ne se devine pas. Pour lire une image capturee, il faut la recopier dans une zone que le processeur sait lire, puis demander l'acces a cette copie. Nous demandions l'acces a une copie tout juste ordonnee : la carte devait donc finir TOUT ce qu'elle avait en cours avant de rendre la main — soixante fois par seconde, et le jeu qui partage la meme carte s'arretait avec elle. On garde desormais deux zones et l'on lit celle remplie a l'image precedente, que la carte a terminee depuis longtemps. Mesure sur cette machine, en 1080p : l'attente passe de 1,125 ms a 0,013 ms par image, et le rapatriement complet de 2,0 ms a 0,9 ms. Le prix est une image de retard, soit une quinzaine de millisecondes que personne ne remarque.
- **Notre travail passe apres celui du jeu.** La carte arbitre entre ceux qui la sollicitent, et rien ne lui disait que recopier une image de partage est moins urgent que dessiner la scene qu'on joue. C'est dit.

## 0.7.2

### Ameliore

- **Partager coute nettement moins cher a celui qui partage.** Rapatrier une image depuis la carte graphique coute environ deux millisecondes en 1080p, auxquelles le moteur ajoute la conversion vers ce que l'encodeur sait lire. Capturer soixante images par seconde quand l'encodeur n'en sort que vingt-cinq revenait a payer ce prix trente-cinq fois par seconde pour des images que personne ne verrait jamais. La cadence de capture suit desormais ce que la machine tient reellement, et remonte des qu'elle respire. Rien ne change pour ceux qui regardent : les images qui partent gardent leur definition et leur debit, on cesse seulement de fabriquer celles qui seraient jetees.

### Nouveau

- **Choisir de quelle application vient le son en partageant un ecran.** Partager une fenetre prend deja le son de cette application seule. Un ecran n'a pas d'application derriere : on prenait donc tout, sauf nous — ce qui suffit tant qu'aucun routeur audio virtuel ne tourne. Voicemeeter et consorts rejouent notre voix depuis leur propre processus, que Windows capte a bon droit, et l'on s'entendait en double sans qu'aucun reglage n'y puisse rien. Un choix a cote de la bascule du son y repond.

## 0.7.1

### Nouveau

- **Les touches vocales repondent meme quand Echow n'est pas devant.** C'etait le defaut de fond du push-to-talk : une page web ne recoit plus rien du clavier des que la fenetre passe derriere, c'est-a-dire exactement au moment ou l'on veut parler en jouant. Le systeme les observe desormais lui-meme. La touche n'est pas confisquee pour autant — le jeu la recoit aussi — et les modificateurs en trop sont toleres, sans quoi une touche posee a cote de `Maj` ne repondrait jamais pendant qu'on court. Seule exception, imposee par Windows : un jeu lance en administrateur ne transmet ses frappes qu'a des programmes qui le sont aussi, et les reglages disent si la surveillance a bien pris.
- **Les applications reduites figurent enfin dans le selecteur de partage.** « Toutes mes applications ouvertes » comprend celles qu'on vient de ranger dans la barre des taches : Steam, un lanceur de jeu, l'explorateur de fichiers. Elles n'ont pas d'apercu — une fenetre reduite ne dessine rien — et les choisir les rouvre, sans voler le focus.
- **Un avertissement quand on enchaine les commandes trop vite.** Il explique ce qui se passe au lieu de laisser croire a une panne, une fois par demi-minute, et ne bloque rien.

### Corrige

- **L'apercu d'une fenetre montrait ce qui etait DEVANT elle.** La vignette recopiait l'ecran a l'endroit de la fenetre : deux applications en plein ecran donnaient donc exactement la meme image, et choisir Steam affichait le navigateur pose dessus — d'ou l'impression, tres juste, de partager l'ecran entier. Chaque fenetre se dessine desormais elle-meme, couverte ou non.
- **Une annonce de presence perdue n'etait jamais rejouee.** Une seule suffisait a disparaitre de la liste de son propre salon — et personne n'ouvre de connexion vers quelqu'un qu'il ne voit pas, donc plus personne ne vous entendait. Rien ne l'indiquait, et relancer l'application etait la seule issue. L'envoi perdu retourne dans la file, et l'on se re-annonce toutes les trois secondes.
- **L'echo, pour de bon.** Partager une fenetre capture maintenant le son de cette application seule. Exclure notre propre processus ne suffisait pas : un routeur audio virtuel — Voicemeeter, VB-Cable — rejoue notre son depuis un processus qui n'est pas le notre, que Windows capte alors a bon droit. La contrepartie est assumee : partager une fenetre ne diffuse plus la musique qui joue a cote.
- **Une meme pression ne compte plus deux fois.** Les bascules du vocal et les touches maintenues lisaient le clavier chacune de leur cote ; depuis que le systeme s'en mele, la bascule s'appliquait deux fois — donc pas du tout.

## 0.7.0

### Nouveau

- **Les touches vocales repondent meme quand Echow n'est pas devant**, et un avertissement previent quand on enchaine les commandes plus vite que le salon ne peut les annoncer.

### Corrige

- **Une annonce de presence perdue n'etait jamais rejouee** : on disparaissait de la liste de son propre salon, et plus personne ne vous entendait.
- **L'echo** : partager une fenetre capture desormais le son de cette application seule.

## 0.6.9

### Corrige

- **Lacher la touche pouvait laisser le micro coupe pour de bon.** La mecanique notait le relachement, puis l'application verifiait qu'on etait bien dans un salon — et abandonnait sinon. Or cette verification echoue pendant les fractions de seconde ou l'on rejoint. Le relachement etait alors enregistre sans etre applique : la touche comptait pour lachee, le micro restait ferme, et plus rien ne le rouvrait. Rendre un etat de micro hors d'un salon est sans consequence ; omettre de le rendre coute la parole.
- **Lacher la touche rend aussi l'audition.** Se retrouver sourd apres avoir lache n'a aucun sens, et c'est pourtant arrive : la sourdine coupe le micro, si bien qu'un etat « sourd » etait retenu comme un simple « micro coupe » et rendu comme tel.
- **La liste des salons suivait le serveur pour son propre etat.** La presence fait un aller-retour et se publie par fenetres : en enchainant les bascules plus vite qu'elles, on se voyait dans un etat perime — parfois plusieurs secondes, parfois jusqu'au changement suivant. On se croyait coupe en parlant, on recliquait, et le decalage empirait. Son propre etat vient desormais de chez soi, comme sur la scene vocale.

### Ameliore

- Les deux touches maintenues portent leur nom usuel : **push-to-talk** et **push-to-mute**. C'est celui qu'on emploie entre soi, et celui qu'on cherche dans une liste.

## 0.6.8

### Ameliore

- **Partager coute beaucoup moins cher a celui qui partage.** Deux gaspillages, et le premier etait de mon fait. Le plafond de cadence ajoute a la version precedente jetait les images APRES les avoir ramenees de la carte graphique : sur un ecran a cent quarante-quatre hertz, on payait cent quarante-quatre rapatriements par seconde — huit megaoctets chacun — pour en garder soixante. Le tri se fait desormais avant, et une image ecartee ne traverse plus rien.
- La texture d'attente est gardee d'une image a l'autre, au lieu d'en demander une au pilote soixante fois par seconde : cette allocation coutait plus cher que la copie elle-meme. Et quand la carte n'ajoute pas de remplissage entre les lignes — le cas des definitions usuelles — l'image est recopiee d'un seul tenant plutot qu'en mille quatre-vingts morceaux.
- La qualite ne change pas : c'est le meme nombre d'images, a la meme definition, pour une fraction du travail.

## 0.6.7

### Corrige

- **L'application devenait inutilisable en rejoignant un salon apres un partage.** Ecran noir, et rien qui dise pourquoi — au point qu'on croyait a un bannissement et qu'on reinstallait. La cause : la reconciliation des salons ecoutes est programmee huit cents millisecondes apres avoir quitte, donc en plein milieu d'une jonction si l'on rejoint aussitot. Elle ouvrait un canal sur le salon qu'on etait en train de rejoindre, et poser un ecouteur sur un canal deja souscrit leve une exception qui emportait toute l'interface. Le salon rejoint est desormais protege pendant la jonction, et plus aucune exception ne peut emporter l'application depuis cet endroit — au pire un message, jamais un ecran noir.
- **La qualite du partage s'effondrait sur les ecrans rapides.** La capture ne bornait pas sa cadence : elle suit le rafraichissement du moniteur, soit cent quarante-quatre images par seconde sur un ecran de joueur, quand le debit est calcule pour soixante. Chaque image recevait deux fois et demie moins de donnees. Ce n'est pas un partage plus fluide qu'on obtenait, mais un partage plus sale.

## 0.6.6

### Nouveau

- **Se taire en maintenant une touche.** L'inverse de « parler en maintenant » : le micro se ferme tant que la touche est enfoncee. Utile quand on parle la plupart du temps et qu'on veut se taire un instant — tousser, repondre a cote — sans chercher un bouton. A regler dans Parametres › Raccourcis ; aucune touche par defaut, car une touche imposee entrerait en conflit avec ce que font les jeux.
- **Un signe violet dit qui tient sa touche**, sur la scene vocale comme dans la liste des salons. Il fallait le distinguer des deux autres etats : le violet dit un micro ferme volontairement et pour quelques secondes, la ou l'orange dit un micro coupe qui peut durer une heure. On n'attend pas la meme chose de la personne.

### Corrige

- **L'etat des gens dans la liste des salons se lit de nouveau.** Les icones y etaient a douze pixels, ou l'on ne distinguait pas un casque d'un micro, et elles portaient la couleur du texte — elles disaient qu'il se passait quelque chose sans dire quoi. Elles passent a quinze et prennent la couleur de leur etat.

## 0.6.5

### Corrige

- **Le bandeau de mise a jour ne disparait plus pour de bon.** « Plus tard » l'effacait, et rien ne le rappelait ensuite : un clic, et l'on restait sur une ancienne version sans plus jamais rien voir en bas a droite. Il se replie desormais en une pastille, dans le meme coin — elle ne prend pas de place, ne demande rien, et un clic la redeploie. Elle passe a la couleur d'accent quand la version est installee et n'attend qu'un redemarrage, seul etat ou l'on perd quelque chose a ne rien faire.

## 0.6.4

### Corrige

- **Enchainer les bascules micro et sourdine coupait tout le monde.** Chaque bouton posait l'etat de la piste de son cote, a partir d'une copie prise avant sa propre ecriture : en cliquant vite, deux bascules se croisaient et la seconde remettait la piste dans la position que la premiere venait d'annuler. L'interface disait « micro ouvert », la piste etait coupee, et plus personne n'entendait personne. Un seul endroit touche desormais a la piste, et il lit l'etat apres l'avoir ecrit.
- **La liste laterale restait figee sur un ancien etat.** L'annonce de presence attend la reponse du serveur ; quand elle ne venait pas — socket a demi ferme, reseau qui pend — le verrou qui empeche deux envois simultanes restait leve pour toujours, et plus rien n'etait publie. L'envoi est desormais borne a trois secondes, et le suivant reprend.
- **Les couleurs du micro coupe et de la sourdine etaient inversees** entre la scene vocale et la liste laterale : la meme personne apparaissait en orange d'un cote et en rouge de l'autre. Orange pour le micro coupe, rouge pour la sourdine — etre sourd coupe tout, micro compris, et merite la couleur la plus forte.

### Ameliore

- **Le micro et le casque sont redessines et agrandis.** A dix-huit pixels, les traits du micro se rejoignaient en une tache et le casque se lisait comme un demi-cercle pose sur deux virgules. Les formes sont plus larges, plus espacees, et les deux boutons passent a vingt-deux pixels — ce sont ceux qu'on vise le plus souvent, et souvent vite.

## 0.6.3

### Corrige

- **« Des fois il ne m'entend pas. »** Voici pourquoi, et c'etait le defaut le plus couteux du vocal. La presence n'est pas un etat mais une suite d'instantanes, et l'un d'eux peut omettre quelqu'un qui n'est parti nulle part — un battement manque, une reconnexion. On detruisait alors toute la connexion, avec ses pistes. Le pire venait ensuite : un seul des deux cotes rebatit, celui dont l'identifiant est le plus petit. Quand c'est l'autre qui avait coupe, il attendait une offre que personne n'avait de raison d'envoyer — et la voix disparaissait **dans un seul sens, definitivement**, jusqu'a ce que quelqu'un quitte le salon.
- Une absence doit desormais se confirmer avant qu'une connexion tombe. Et lorsqu'un participant est la depuis six secondes sans qu'une connexion s'etablisse, on l'amorce soi-meme sans attendre l'offre d'en face.

## 0.6.2

### Corrige

- **Le volume d'un partage se regle de nouveau.** Le curseur restait bloque tant qu'aucune piste sonore n'etait arrivee — ce qui parait logique et ne l'est pas : le son d'un partage arrive apres l'image, et parfois bien apres. On avait donc un curseur mort, sans savoir s'il etait casse ou s'il attendait. Il regle le volume de LECTURE : le poser d'avance est aussi sense que de baisser le sien avant de lancer une video.

### Nouveau

- **Un clic droit sur un partage ouvre ses commandes** : le volume, couper le son, le plein ecran, et arreter de regarder. Elles vivaient dans trois endroits differents — sur l'image, dans la liste des participants, dans un coin — et les boutons de l'image sont petits, puis recouverts des qu'on passe en plein ecran. Le clic droit tombe la ou l'on regarde.

## 0.6.1

### Nouveau

- **Un bouton « Relancer maintenant »**, dans Parametres › Avance, quand une mise a jour est installee et attend un redemarrage. Le bandeau qui le proposait disparait des qu'on le ferme, et rien ne le rappelait ensuite : on restait sur l'ancienne version sans le savoir. Deux personnes se sont ainsi retrouvees a cinq versions d'ecart — et la moitie des defauts qu'elles constataient venait de la, puisqu'elles ne faisaient pas tourner le meme code.
- Les reglages disent aussi quelle version est proposee, et non plus seulement qu'il y en a une.

### Ameliore

- **Les recherches de mise a jour sont tracees** : trouvee, absente, ou impossible avec sa cause. « La mise a jour ne se propose plus » ne se distinguait pas de « elle se propose et personne ne clique ».
- **Les creux de qualite du partage sont traces.** Un unique releve pris cinq secondes apres le debut annoncait toujours « rien ne me limite » — et ne disait donc rien des chutes de dix secondes qui surviennent en cours de partage. Ce sont desormais les changements qui sont notes, avec ce qui les precede.

## 0.6.0

### Corrige

- **Choisir une fenetre partage enfin cette fenetre, et elle seule.** L'application demandait au moteur web l'ecran entier — toujours le premier — puis decoupait l'image. Ce qui recouvrait la fenetre partait donc avec elle. Windows sait capturer la source elle-meme : une fenetre rend son contenu meme recouverte.
- **Le deuxieme ecran se partage.** Il n'etait pas dans l'image qu'on decoupait, donc hors d'atteinte : l'application le disait, faute de pouvoir le montrer. Chaque ecran est desormais une source a part entiere.
- **Une fenetre reduite garde un contenu a montrer.** Elle disparaissait de la liste, n'ayant plus rien a decouper.

### Ameliore

- **Le partage ne repasse plus par une capture d'ecran.** Les images viennent du processeur graphique, sans recopie inutile, et sans le contour jaune que Windows ajoute par defaut a ce qu'il capture.

## 0.5.2

### Corrige

- **Le partage ne renvoie plus les voix d'Echow.** Le son capture etait celui d'une sortie, donc tout ce qu'elle jouait — y compris les autres participants. Celui qui partageait leur renvoyait leurs propres voix avec le retard du reseau, et personne ne pouvait le corriger de son cote. Windows sait capturer par application depuis sa version 20348 : on lui demande desormais tout le son du systeme **sauf le notre**. Le jeu, la musique, les videos passent ; les voix restent ou elles sont.
- Cette capture n'etant liee a aucune sortie, elle regle du meme coup le choix du peripherique : plus de bouclage ouvert sur une entree virtuelle ou rien ne joue. Sur un Windows plus ancien, l'ancien chemin sert de repli — le son passe, avec l'echo.

## 0.5.1

### Ameliore

- **« Partager l'audio systeme » est desormais un vrai interrupteur**, en bas de notre selecteur de partage, avec son icone et sa description. C'etait une case a cocher perdue en fin de ligne, presentee comme un detail — alors que c'est le reglage qu'on vient chercher, et le seul dont on se demande s'il est actif avant de lancer un partage.
- Le texte qui l'accompagnait affirmait que le son ne pouvait pas fonctionner sans la fenetre de Windows. C'etait vrai jusqu'a la version precedente ; ca ne l'est plus, et le laisser aurait fait douter d'un reglage qui marche.

## 0.5.0

### Corrige

- **Le son du partage ne passait pas, et la cause n'etait ni la capture ni le reseau.** Windows livrait bien le son — quatre cents paquets, cent quatre-vingt-treize mille trames, du signal mesure. Mais entre lui et l'application, le passage interne qui transportait ces paquets n'en livrait **qu'un seul sur quatre cents**. Au-dela d'un kilo-octet, ce passage ne transmet pas la donnee directement : il fait executer a l'interface un script qui va la rechercher, et cinquante allers-retours par seconde de ce genre ne tiennent pas. Rien n'echouait pour autant, ce qui explique la longueur de la recherche : la capture s'ouvrait, les paquets partaient, et le silence arrivait au bout.
- Le son passe desormais par une **connexion unique**, ouverte pour toute la duree du partage, sur laquelle les echantillons coulent sans etre annonces ni reassembles — le meme transport qu'une video en lecture continue, pour la meme raison. Elle n'ecoute que la machine elle-meme, n'accepte qu'une connexion, et exige un jeton tire au hasard a chaque partage.

## 0.4.9

### Ameliore

- **Le trajet du son d'un partage est mesure de bout en bout.** Trois maillons peuvent rompre entre Windows et les oreilles d'en face : le systeme peut ne rien donner, le canal interne peut ne rien livrer, le fil audio peut ne rien jouer. Chacun est desormais compte, et les trois tiennent sur une seule ligne — lus separement ils demandaient de recouper trois horodatages, lus ensemble ils designent le maillon rompu sans qu'on ait a reflechir.

## 0.4.8

### Corrige

- **Windows affichait encore « Quality » chez ceux qui l'avaient installe sous ce nom.** L'application s'est appelee Orbit, puis Quality, puis Echow, et l'installateur range chaque version sous son nom de produit : un dossier, un raccourci et une ligne dans « Applications installees » par nom. Renommer n'a donc pas renomme l'installation existante, il en a cree une seconde a cote — et le raccourci qu'on avait l'habitude de cliquer lancait toujours l'ancienne. L'installateur retire desormais les installations laissees par les anciens noms, sans toucher aux donnees : sessions, reglages et raccourcis clavier sont conserves.

### Ameliore

- **Les commandes de fenetre retrouvent leurs dessins**, mieux traces : trait, cadre et croix a bouts arrondis dans une cible de vingt-huit pixels. La couleur reste, mais ne s'allume que sous le curseur — vert, orange, rouge. En permanence, trois taches vives dans un coin sombre tirent l'oeil vers ce qu'on utilise le moins ; au survol, elles disent ce qu'on s'apprete a faire.

## 0.4.7

### Corrige

- **Le son du partage ne partait pas, et ce n'etait pas un defaut du code.** Windows capture le son de la sortie **par defaut**. Sur une machine equipee d'un routeur audio virtuel — Voicemeeter, VB-Cable, ceux qu'installent la plupart de ceux qui streament — cette sortie par defaut est une entree virtuelle sur laquelle rien ne joue : la capture s'ouvrait sans erreur et ne transportait que du silence. Rien ne le distinguait d'un partage muet, et la seule facon d'en sortir etait de changer le peripherique par defaut de Windows pour toute la machine.

### Nouveau

- **On choisit desormais la sortie a capturer**, dans le panneau de partage, sous l'interrupteur du son. Choisissez celle sur laquelle votre jeu joue reellement.
- **Le partage dit quand il capture du silence**, en nommant le peripherique concerne et ou le changer. Le probleme se voyait jusqu'ici de l'exterieur — les autres n'entendaient rien — et jamais de celui qui partage.

## 0.4.6

### Corrige

- **Le partage tombait a 540p et n'en revenait pas.** La taille du canevas de decoupe suivait celle de la capture — et le moteur reduit lui-meme sa capture quand la machine chauffe. La definition descendait donc avec elle, et rien ne la faisait remonter. Elle est desormais decidee par la fenetre partagee et par la qualite choisie, une fois, et ne bouge plus. Une definition stable vaut d'ailleurs mieux en soi : chaque changement force une image-cle qu'on voit passer.

### Ameliore

- **Plus de marge pour les jeux.** A soixante images en priorite fluidite, le plafond de debit serrait la qualite dans chaque image des que toute la scene bougeait — ce qui est la definition d'un jeu. Ce n'etait pas une definition plus basse mais une image plus sale, ce qui se decrit pareil et se corrige autrement.
- **Le partage dit maintenant pourquoi il se retient** : le moteur nomme lui-meme ce qui le limite — la machine, la liaison, ou rien. C'est le chiffre qui manquait a toutes les discussions precedentes sur la qualite.
- **Le niveau du son capture est mesure.** « La capture s'est ouverte » ne veut pas dire « il y a du son dedans » : Windows ouvre volontiers un bouclage sur le peripherique de sortie par defaut, et si le jeu joue sur un autre, la capture reussit et ne porte que du silence. Le nom du peripherique ecoute est desormais releve avec le niveau.

## 0.4.5

### Corrige

- **La definition du partage s'effondrait.** Une version precedente laissait le moteur reduire l'image en mode fluidite, pour repondre a des saccades dans les jeux rapides. C'etait une supposition, et elle etait fausse : les saccades venaient du canevas de decoupe, corrige depuis. L'autorisation, elle, etait restee — et un partage annonce en 1080p sortait a 540p au premier a-coup, sans le dire et sans jamais y revenir. La definition demandee est de nouveau tenue.
- **La pastille de parole s'eteignait pour de bon chez qui partageait son ecran avec le son.** L'analyseur d'une personne etait detache des qu'un second flux sonore arrivait d'elle — et le second, c'etait le partage. On ne voyait donc plus jamais parler celui qui partage, c'est-a-dire celui qu'on ecoute.

### Ameliore

- **Le chemin du son d'un partage est desormais trace**, des deux cotes : ce qui est envoye a chaque pair, et ce que la reception en fait. Une piste rangee du mauvais cote ne leve aucune erreur — on entend le mauvais son, ou rien — et la seule facon de le savoir etait de le demander a quelqu'un qui ne pouvait pas repondre.

## 0.4.4

### Ameliore

- **L'abonnement s'appelle « Echow + ».** Troisieme nom apres « Vague » et « Waves » — celui-ci dit ce qu'il est sans qu'on ait a l'expliquer.

## 0.4.3

### Corrige

- **La fenetre ne se deplacait plus.** La barre de titre du systeme est desactivee : deplacer la fenetre nous revient, et cela ne fonctionne que sur les elements qui portent la marque prevue. Seul l'en-tete d'un salon l'avait. Des qu'on ouvrait Amis, Waves, Suggestions ou Support, la fenetre devenait immobile — et cela s'est vu d'un coup, puisque ces pages ne s'ouvraient pas du tout avant la version precedente.
- **Le son du partage partait a la qualite d'un telephone.** La retouche appliquee au flux sonore s'arretait a la premiere piste, ce qui suffisait tant qu'il n'y avait que le micro. Depuis que le partage emporte le son de l'ordinateur, il y en a deux — et la seconde, celle qui porte le jeu ou la musique, restait en mono a trente-deux kilobits. Elle ne recevait pas non plus de plafond de debit, la ou la voix en avait un.

### Ameliore

- **Les commandes de fenetre sont trois pastilles de couleur** : vert pour reduire, orange pour agrandir, rouge pour fermer. Le trait, le carre et la croix disaient ce que la position dit deja. Les noms restent pour le clavier et les lecteurs d'ecran — une couleur ne se lit pas, et beaucoup ne distinguent pas le vert du rouge.
- **L'abonnement passe en maintenance**, barre en rouge dans la liste. « Bientot » annoncait une attente qui avance, ce qui n'etait plus vrai.

## 0.4.2

### Corrige

- **Le son d'un partage n'arrivait pas, alors qu'il partait bien.** Le micro d'une personne et le son de son partage voyagent dans deux flux distincts, et l'on distingue le second par la piste video qui l'accompagne. Mais les deux pistes n'arrivent pas ensemble, et rien n'impose que l'image precede : quand le son prenait les devants, son flux paraissait ne porter que de l'audio. Il etait alors pris pour une voix — il ecrasait le micro de la personne au passage — et n'atteignait jamais le curseur du partage, qui affichait « ce partage n'envoie pas de son » pendant que le son partait. Le classement se corrige desormais des que l'image ou l'annonce arrive.
- **Celui qui regarde sait pourquoi il n'entend rien.** L'infobulle affirmait « c'est un reglage de la personne qui partage » — ce qu'on ignorait. Elle distingue maintenant trois cas : le son part et tarde, il ne part pas, ou l'application d'en face ne sait pas encore le capturer. On cesse ainsi de chercher chez soi un defaut qui est ailleurs.

## 0.4.1

### Corrige

- **Le son du partage part enfin.** Il etait capture par le moteur web, qui ne l'accorde qu'apres une case a cocher vivant dans la fenetre de selection de Windows — celle-la meme qu'on supprime pour afficher la notre. Deux contournements avaient echoue, le second en tuant l'application a chaque partage. La capture se fait desormais cote natif, par le bouclage audio de Windows : le moteur n'a plus son mot a dire.
- **Un partage qu'on demandait a voir pouvait ne rien afficher.** Le role d'un flux — partage ou camera — voyage par le canal de signalisation, l'image par la connexion media. Quand l'annonce se perdait, la piste restait en attente pour toujours : le bouton passait a « Masquer » et rien n'apparaissait, sans que celui qui partageait puisse s'en douter. La presence dit deja qui partage ; elle sert desormais de repli, et cliquer « Regarder » tranche a lui seul.
- **Ouvrir Amis, Waves, Suggestions ou Support depuis un espace ne faisait rien.** Ces quatre pages liberent le salon actif en passant en vue privee — et un garde-fou voyait alors un espace ouvert sans salon choisi, et en rouvrait un aussitot. La page s'ouvrait et se refermait dans le meme rendu. Le defaut ne se voyait pas depuis la vue privee, ou aucun espace n'est actif : c'est-a-dire partout ou l'on pense a essayer.
- **Les images sautaient dans les jeux rapides.** Deux causes. Le partage d'une fenetre repassait par un canevas dont la cadence tournait a son propre rythme, sans rapport avec celui de la source : les deux horloges derivaient, et une image etait prise deux fois ou pas du tout. Ce meme canevas travaillait de plus a la taille de la fenetre a l'ecran, meme quand la capture arrivait deja reduite — on agrandissait une image reduite avant de l'encoder, et l'encodeur payait ce surcout en images perdues.
- **Un partage muet ne dit plus « deux chemins ont ete essayes ».** Il dit lequel a echoue et pourquoi : peripherique introuvable, bouclage refuse par Windows, format inconnu. Ces raisons existaient deja cote systeme ; elles etaient jetees en chemin.

### Nouveau

- **Un espace Support**, en rouge a droite d'« Ajouter un ami ». On y depose une demande, on suit l'echange, et on la clot soi-meme quand elle est reglee. Ce qu'on y ecrit n'est lu que par l'equipe : ni les proprietaires d'espaces, ni personne d'autre n'y ont acces.
- **Les suggestions sont devenues un salon.** La liste au-dessus, le champ en bas, comme partout ailleurs. La commande `/suggestion` repondait depuis n'importe quel salon : elle partait donc d'une conversation ou plus personne ne la reverrait, vers une page que son auteur decouvrait au moment de l'envoi — sans avoir vu ce qui avait deja ete propose. Elle ne repond plus qu'ici, ou elle n'est d'ailleurs plus necessaire.
- **Un compte peut etre suspendu.** Datee et motivee : la levee se fait toute seule, et le motif est lu par la personne concernee. La suspension empeche d'ecrire, jamais de lire ni de joindre le support — c'est la qu'on conteste une decision, et une decision peut etre une erreur.
- **L'application tient un journal de ses propres defauts** et le fait remonter, pour que « ca a coupe » devienne quelque chose qu'on puisse corriger. Il ne contient ni contenu de message, ni nom de fichier partage, ni adresse IP : des identifiants, des nombres et des noms d'etats. Ce qu'on n'y met pas ne peut pas fuir.

### Ameliore

- **Rejoindre un salon vocal est plus rapide.** Une attente d'un dixieme de seconde etait payee a chaque changement de salon, le temps que le systeme rende le micro precedent — pour un echec qui n'arrive presque jamais, et qui savait deja se rattraper seul. Les canaux restants se ferment desormais de front plutot qu'a la file.

## 0.4.0

### Corrige

- **Se demuter laissait sourd.** Deux chemins de sortie audio se relayaient sans se defaire : une fois le graphe ouvert pour amplifier quelqu'un, le volume de l'element restait a zero, et revenir dessus donnait un silence definitif qu'il fallait relancer l'application pour lever. C'est aussi ce qui faisait qu'on n'entendait plus certaines personnes.
- Se rendre sourd ne coupait pas les voix amplifiees : l'attribut `muted` d'un element audio n'a aucune prise sur le graphe. Sourdine et coupure sont desormais des gains a zero, une seule valeur d'ou tout decoule.
- Le casque de l'icone de sourdine paraissait perce : ses coussinets etaient des contours fermes, et tout le jeu d'icones est trace sans remplissage.
- Le logo etait pixelise dans la barre des taches. Chaque taille est desormais rendue depuis un maitre de 2048 pixels, et l'icone Windows en porte dix — le systeme prend celle dont il a besoin au lieu d'en reduire une autre.
- Le logo est centre sur la forme de la vague et non sur le cadre de l'image : la pointe de la bulle decalait tout vers le bas.

### Nouveau

- Les raccourcis vocaux se choisissent. Ils etaient fixes dans le code — or `Ctrl+Maj+M` est deja pris par plusieurs jeux, et qui parle en jouant n'avait aucun moyen de contourner le conflit.
- **Parler en maintenant une touche.** Relacher rend l'etat qui precedait l'appui, plutot que de couper : qui parlait deja micro ouvert continue de parler.
- Le volume d'un partage se regle sur l'image, a cote du plein ecran. Il n'existait que dans le menu contextuel de la personne, a trois gestes d'un son trop fort.
- Dans la liste des salons, un anneau colore autour de la photo dit qui est muet et qui est sourd — rouge et orange, comme sur la scene vocale.

## 0.3.9

### Nouveau

- Le logo revient a la vague en spirale d'origine, en blanc sur un disque noir, et rond partout — dans l'application, sur la barre des taches, dans le menu Demarrer et sur le site.

## 0.3.8

### Nouveau

- L'application s'appelle **Echow**. Les derniers textes qui portaient encore l'ancien nom sont repris.

### Corrige

- Les liens de telechargement du site pointaient vers un depot qui n'existe pas : le renommage les avait fait viser `zyko144/Echow`, quand le depot reste `zyko144/quality`. Tous les boutons rendaient une erreur 404.
- L'installateur est publie sous ses deux noms pendant la transition, pour que les liens deja partages continuent de repondre.

## 0.3.7

### Corrige

- **L'application tombait a chaque partage d'ecran.** Le detour ajoute en 0.3.5 pour recuperer le son demandait la sortie du systeme par des contraintes heritees de Chromium, sans identifiant de source. WebView2 traite cet appel comme un message malforme et tue le processus de rendu : page blanche, application a relancer. Le detour est retire.
- Un partage muet vaut infiniment mieux qu'une application qui tombe. Le son se fera donc autrement.

## 0.3.6

### Corrige

- La fenetre de selection de Windows est de nouveau supprimee, pour de bon. C'est moi qui l'avais fait revenir : le mecanisme cense rendre le son reaffirmait la preference a chaque ouverture du selecteur, et comme la case est cochee par defaut, le lanceur cessait de poser le drapeau. Le mecanisme entier est retire — il n'avait pas lieu d'exister.
- Le son du partage est desormais pris uniquement par le bouclage du systeme, sans aucune fenetre.

## 0.3.5

### Corrige

- Le son du partage est capture par un autre chemin, sans rendre la fenetre de selection de Windows. Ma correction precedente proposait de la faire revenir en echange du son : c'etait exactement ce qu'on avait entrepris de retirer, donc pas une solution.
- Chromium expose une voie anterieure a `getDisplayMedia`, toujours en place, qui rend la sortie de l'ordinateur sans rien afficher. C'est celle qu'emploient les applications Electron pour la meme raison. Elle est tentee des que la premiere n'a pas donne de son.
- La liste des suggestions ne s'installait pas : `max()` n'existe pas pour les booleens en PostgreSQL.

### Ameliore

- Le message affiche pendant un partage muet dit desormais que deux chemins ont ete essayes, et ce qu'il resterait a faire.

## 0.3.4

### Corrige

- Cocher « Partager le son de l'ordinateur » ne changeait rien, meme apres un redemarrage. La case etait deja cochee par defaut : la cocher n'ecrivait donc rien, et le lanceur — qui supposait l'inverse tant qu'aucun fichier ne le contredit — restait sur son choix. Les deux valeurs par defaut ne s'accordaient pas.
- L'application demande maintenant au lanceur ce qu'il a reellement decide, au lieu de le deviner. L'avertissement « relancez » apparait donc quand il le faut, et la preference est reaffirmee a chaque ouverture du selecteur.
- La liste des suggestions ne s'installait pas : `max()` n'existe pas pour les booleens en PostgreSQL.

## 0.3.3

### Nouveau

- Un espace **Suggestions**, sous Waves. On y propose par la commande `/suggestion` suivie de son idee, depuis n'importe quel salon — c'est la seule porte d'entree : ecrire une commande demande d'avoir voulu proposer, la ou un champ toujours ouvert recueille surtout des essais.
- On vote pour ou contre. Le vote est binaire et non un compte de « j'aime » : une idee peut deranger autant qu'elle plait, et une echelle a un seul sens ne dirait que la moitie de ce qu'on veut savoir. Recliquer sur son vote le retire.
- Les plus soutenues remontent. Une liste chronologique enterrerait une bonne idee sous une semaine de nouvelles.

## 0.3.2

### Corrige

- Le son du partage n'etait jamais capture, quelle que soit la source choisie. La cause n'etait pas Windows mais nous : le drapeau qui supprime la fenetre de selection du systeme — celui qui nous permet d'avoir notre propre selecteur — supprime aussi la case « partager aussi le son » qu'elle contient. Sans cette case, Chromium n'accorde jamais la piste audio.
- Le message affiche pendant un partage muet accusait Windows. Il dit desormais la vraie cause, et ce qu'il faut faire.

### Nouveau

- Le choix vous revient : cocher « Partager le son de l'ordinateur » et relancer rend la fenetre de Windows a la place de notre selecteur, en echange du son. Les deux ne peuvent pas coexister — la case est dans la fenetre qu'on supprime.

### Ameliore

- L'abonnement s'appelle Waves.

## 0.3.1

### Nouveau

- Un ecran de regles avant d'entrer, a lire jusqu'en bas. Sept points, ce sont les seules choses qu'on ne peut pas decouvrir en se servant de l'application. Le bouton n'apparait qu'une fois le texte parcouru — cela ne garantit pas la lecture, seulement qu'on a vu qu'il y avait quelque chose a lire.
- Une verification a la creation de compte et a la demande de nouveau mot de passe : une question de tete, pas une case a cocher. Pas a la connexion — qui connait deja son mot de passe a franchi une porte plus solide.

### Ameliore

- L'acceptation est consignee en base, avec une date posee par le serveur et un numero de version. Une date fournie par le navigateur ne vaudrait que ce que vaut la montre de qui la pose.

## 0.3.0

### Corrige

- Le son d'un partage n'atteignait pas ceux qui rejoignaient **apres** son debut : seule l'image leur etait envoyee. Celui qui etait deja la entendait le jeu, l'arrivant voyait une image muette — et rien ne distinguait cela d'un partage sans son. Cela se voit surtout dans un serveur, ou l'on entre et sort pendant qu'une partie se joue.
- Le workflow de publication ne se lisait plus depuis trois versions : une commande contenait un vrai retour a la ligne la ou il fallait un echappement. Aucun paquet n'etait construit, 0.2.7 a 0.2.9 n'ont jamais ete publiees.

### Nouveau

- Quand le systeme refuse le son du partage, l'application le dit a qui partage. Windows ne l'accorde que pour un ecran entier ou un onglet, jamais pour une fenetre seule : sans cette precision, l'echec etait muet et se confondait avec un jeu silencieux.

### Ameliore

- Ce message des nouveautes est range par nature et colore : vert pour ce qui est repare, bleu pour ce qui est nouveau, ambre pour ce qui change. On voit s'il y a des corrections avant de lire lesquelles.

## 0.2.9

- Le message « aucun relais n'est configure » ne s'affiche plus en vocal. Il partait dans le canal des erreurs, celui des pannes reelles, pour dire que rien ne s'etait mal passe. Le constat vit maintenant dans les reglages, a cote de l'interrupteur concerne.
- La page de connexion passe a une seule colonne centree. La colonne de presentation redisait ce que la page d'accueil vient d'expliquer — on y arrive en cliquant « Se connecter », donc apres l'avoir lue.
- Le logo tourne pendant la connexion, comme au demarrage : la meme marque et le meme mouvement, pour que ce soit visiblement la meme chose qui travaille.
- **Waves**, l'abonnement de Quality, s'annonce sous « Amis ». Rien n'est encaissable : le bouton est desactive et le dit. Ce que Waves ne fera jamais est ecrit noir sur blanc.
- Les reglages et les fiches de profil respirent : titres de rubrique lisibles, explications limitees a une soixantaine de caracteres par ligne, rubriques separees.

## 0.2.8

- Un champ de recherche dans les parametres. Onze sections et une centaine de reglages : le classement est defendable, mais il suppose de partager le raisonnement de qui l'a range. Personne ne cherche « Voix et video » — on cherche « le truc qui enleve le bruit du clavier ». Taper « clavier » y mene.
- Chaque resultat dit dans quelle section il se trouve : la fois suivante, on y va directement.

## 0.2.7

- Le son des partages d'ecran n'arrivait toujours pas : la piste audio etait rangee selon une annonce qui voyage par un autre canal qu'elle, et rien ne garantit laquelle arrive d'abord. Quand l'audio precedait l'annonce, il etait pris pour une voix et ecrasait le micro. La presence d'une piste video dans le meme flux tranche desormais, sans dependre de l'ordre.
- Le curseur du son de partage s'affiche des que quelqu'un partage, grise s'il n'y a pas de son — plutot qu'absent sans explication. Un partage sans son est une case a cocher du cote de qui partage, et rien ne le disait.
- Le message des nouveautes s'affiche enfin. Il n'apparaissait que si la mise a jour etait passee par le bouton « Installer » de la banniere : installer le setup a la main ne rangeait rien, et rien ne s'affichait jamais. Il compare desormais la version qui tourne a la derniere vue.
- Les notes sont ecrites une seule fois, dans `NOUVEAUTES.md`, et servent a la fois a la page de publication et au message dans l'application. Les tenir a deux endroits garantissait qu'ils finiraient par se contredire.

## 0.2.6

- Une vraie suppression du bruit : RNNoise retire le clavier, la chaise et le ventilateur **pendant** qu'on parle. Une porte, elle, ne sait que couper entre les phrases — elle ne pouvait rien contre un clavier au milieu d'un mot, puisqu'a cet instant c'est la voix qui porte le niveau.
- La case « Isolation de la voix » etait sans effet : le moteur l'annonce supportee, puis rapporte `voiceIsolation: false` sur la piste obtenue. La demande etait acceptee et ignoree.
- Un seul ecran de demarrage. Il en restait un troisieme, dans l'espace de travail, qui attendait le chargement des espaces derriere le premier.
- Le message des nouveautes s'affiche au premier lancement qui suit une mise a jour, quelle que soit la facon dont elle est arrivee — y compris en installant le setup a la main.

## 0.2.5

- Le son des partages d'ecran s'entend : il arrivait dans le meme casier que la voix, et le dernier des deux effacait l'autre.
- Il a son propre curseur, distinct de celui de la voix. Il demarre a 75 %, un jeu etant mixe bien plus fort qu'un micro.
- Le curseur de volume fonctionne enfin : le pourcentage n'etait jamais divise par cent, si bien qu'il ne faisait rien au-dessus de 1 %.
- Il suit une courbe perceptive : a mi-course, douze decibels de moins. Au-dela de cent pour cent, le son est reellement amplifie.

## 0.2.4

- Les reglages sont refaits : vrais titres de section, groupes en cartes, colonne elargie.

## 0.2.3

- Le vocal qui lachait « des fois » : chaque entree fermait puis rouvrait tous les canaux d'ecoute, au moment ou la signalisation du salon s'etablissait.
- La porte de bruit passe sur le fil audio, qui n'est jamais ralenti quand la fenetre passe en arriere-plan.
- Les liens des messages s'ouvrent dans le navigateur du systeme, au lieu de ne rien faire.
