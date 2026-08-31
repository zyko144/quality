# Securite de Quality

Ce document dit ce que l'application protege aujourd'hui, ce qu'elle ne protege
pas, et ce que couterait chacune des deux demandes en suspens : masquer les
adresses IP dans le vocal, et chiffrer les messages de bout en bout.

Il s'adresse a la personne qui exploite le service, pas a ses utilisateurs. La
page publique correspondante est `siteweb/securite.html`, et les deux doivent
rester d'accord : si l'un des choix ci-dessous change, cette page change aussi.

---

## 1. Ce qui tient deja

L'essentiel de la securite d'une application Supabase se joue dans les
politiques RLS, parce que le client parle directement a Postgres avec la cle
publique. Sur ce point le schema est serieux :

- **Chaque table a RLS activee**, refus par defaut, ouverture explicite.
- **Les fonctions d'autorisation sont `SECURITY DEFINER` avec
  `set search_path = ''`** et derivent toujours l'identite de `auth.uid()`,
  jamais d'un argument. C'est la bonne facon : un argument se falsifie, pas un
  jeton.
- **Les gestes sensibles passent par des fonctions**, pas par des ecritures
  directes : `join_space`, `set_member_role`, `kick_member`, `ban_member`,
  `moderate_delete_message`. Chacune verifie le rang de l'appelant, et
  `assert_outranks` interdit de viser quelqu'un d'egal ou de superieur, ou
  soi-meme.
- **Le rendu des messages n'utilise nulle part `dangerouslySetInnerHTML`.**
  Les liens sont extraits par une expression reguliere qui n'accepte que
  `http` et `https` : un `javascript:` ne peut pas devenir cliquable. Tous les
  liens sortants portent deja `rel="noopener noreferrer"`.
- **Les liens de profil sont valides cote serveur**, par une contrainte
  `CHECK` qui impose `^https?://`, cinq liens au plus, 200 caracteres au plus.
  La validation cliente n'est qu'un confort : la vraie barriere est en base.
- **Les limites de taille existent** : messages a 4000 caracteres, bio a 280,
  avatars a 2 Mo, pieces jointes a 25 Mo.
- **Les limites de debit existent** : 30 messages par minute, 60 reactions,
  5 espaces par heure, 20 signalements par heure, plus le mode lent par salon.
- **Les capacites Tauri sont minimales** : ni `shell`, ni `fs`, ni `http`.
  Rien qui permette a une page d'executer quoi que ce soit sur la machine.
- **Aucun secret n'est commite.** `.env.example` porte une cle d'exemple et
  rappelle de ne jamais y mettre la cle `service_role`.
- **Le mode `?preview=` est derriere `import.meta.env.DEV`**, remplace par
  `false` a la compilation : il n'existe pas dans le binaire publie.

C'est un socle sain. Les corrections ci-dessous portent sur des defauts precis,
pas sur une reprise generale.

---

## 2. Ce qui a ete corrige

Migration : `supabase/migrations/20260831120001_durcissement_appartenances.sql`.
**Elle n'est pas appliquee** — c'est a vous de la pousser, apres relecture.

### La faille principale : une ligne d'appartenance deplacable

`members_update`, dans `20260826120002_security.sql`, autorisait :

```sql
using      (can_manage_space(space_id) or user_id = auth.uid())
with check (can_manage_space(space_id) or user_id = auth.uid())
```

L'intention — « chacun change son propre surnom » — est legitime. Le probleme
est qu'**une politique RLS choisit des lignes, pas des colonnes**. Autoriser
quelqu'un a modifier sa ligne l'autorise a en modifier toutes les colonnes.

Deux consequences, exploitables depuis le client avec la seule cle publique :

1. **Auto-promotion.** `update space_members set role = 'owner' where user_id
   = auth.uid()`. La contrainte de table accepte `owner`, la politique accepte
   la ligne. Toute la hierarchie de `set_member_role` est contournee.

2. **Prise de controle d'un espace tiers.** Plus grave :

   ```sql
   update space_members
      set space_id = '<espace vise>'
    where space_id = '<mon espace>' and user_id = auth.uid();
   ```

   Le `WITH CHECK` ne regarde que `user_id`, qui n'a pas bouge : il passe.
   Or chacun recoit une ligne `role = 'owner'` sur l'espace cree a son
   inscription. **Il suffit donc de connaitre l'identifiant d'un espace pour en
   devenir proprietaire** — lire tout son historique, en exclure le vrai
   proprietaire, supprimer ses salons. Ni le code d'invitation ni la liste des
   bannis ne s'y opposent : `join_space` est purement court-circuite.

Cela ne se corrige pas dans la politique : une politique RLS ne compare pas
l'ancienne ligne a la nouvelle. `USING` juge l'ancienne, `WITH CHECK` la
nouvelle, jamais les deux ensemble. La correction est un declencheur
`BEFORE UPDATE` qui rend `space_id` et `user_id` immuables, et qui rejoue sur
`role` les invariants de `set_member_role`. Le chemin legitime continue de
passer ; l'auto-promotion et le deplacement echouent.

### Les quatre points mineurs

| Point | Ce qui n'allait pas | Correction |
| --- | --- | --- |
| `avatars_update_own` | `USING` sans `WITH CHECK` : on pouvait renommer son objet vers le dossier de quelqu'un d'autre, et le compartiment est public en lecture | `WITH CHECK` ajoute |
| `avatar_url`, `banner_url` | Colonnes `text` libres : ni schema, ni longueur. Un `data:` de plusieurs Mo y tenait, retelecharge par chaque visiteur | Contrainte `https://` et 512 caracteres, posee `NOT VALID` pour ne pas echouer sur l'existant |
| Codes d'invitation | Valables indefiniment, sauf rotation manuelle | Colonne `invite_expires_at` (NULL = sans terme, comportement inchange) verifiee dans `join_space` |
| `has_space_permission` | Repondait sur n'importe quel espace, y compris ceux dont l'appelant n'est pas membre | Repond `false` hors de ses espaces |

Sur la contrainte `NOT VALID` : elle s'applique aux ecritures futures sans
rejouer l'existant, ce qui evite qu'une migration echoue sur une ligne heritee.
Quand vous aurez verifie les donnees en place :

```sql
alter table public.profiles validate constraint profiles_images_forme;
```

---

## 3. Les adresses IP dans le vocal

### L'etat actuel

Le vocal est en pair-a-pair complet. Chaque participant etablit une liaison
directe avec chacun des autres, ce qui suppose que les machines connaissent
leurs adresses reseau : **dans un salon vocal, votre adresse IP est visible des
autres participants.** C'est le prix du pair-a-pair, et c'est ce que la page
publique annonce.

S'y ajoute un point moins visible. Par defaut, `useVoice.ts` retombe sur les
serveurs STUN publics de Google :

```
stun:stun.l.google.com:19302
stun:stun1.l.google.com:19302
```

Un serveur STUN ne transporte ni son ni image — il sert seulement a decouvrir
son adresse publique — **mais il voit l'adresse IP de chaque personne qui
rejoint un salon.** Aujourd'hui, Google recoit donc cette information.

### Le premier gain, sans contrepartie

Poser votre propre STUN supprime cette fuite vers un tiers. Cela ne cache rien
aux autres participants, mais cela cesse de renseigner Google. C'est peu cher
et sans effet de bord :

```bash
VITE_ICE_SERVERS='[{"urls":"stun:turn.exemple.fr:3478"}]'
```

### Le second gain : forcer le relais

Pour que les participants ne voient plus l'adresse des autres, il faut que tout
le media passe par un relais TURN, et que le client **ne rassemble que des
candidats de relais** :

```ts
new RTCPeerConnection({ iceServers: ICE_SERVERS, iceTransportPolicy: 'relay' })
```

Cette ligne est dans `src/features/voice/useVoice.ts`. **Elle n'a pas ete
ajoutee**, et c'est deliberé : sans serveur TURN joignable, `relay` ne laisse
aucun candidat utilisable et le vocal cesse de fonctionner pour tout le monde.
C'est un interrupteur a n'actionner qu'une fois le relais en place et teste.

#### Ce qu'il faut poser

`coturn` est l'implementation de reference. L'essentiel de sa configuration :

```conf
listening-port=3478
tls-listening-port=5349
realm=exemple.fr
# Secret partage : le client ne recoit que des identifiants temporaires,
# derives de ce secret. Ne jamais distribuer un mot de passe permanent.
use-auth-secret
static-auth-secret=<secret long et aleatoire>
# Sans cela, le relais peut etre utilise pour atteindre votre reseau interne.
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
no-multicast-peers
```

Cote application, `VITE_ICE_SERVERS` accepte deux formes, lues par
`readIceServers()` :

- **un JSON**, seule forme capable de porter des identifiants — c'est celle
  qu'il faut pour TURN ;
- une liste d'adresses separees par des virgules, qui ne peut pas transporter
  `username` ni `credential`, donc inutilisable ici.

```bash
VITE_ICE_SERVERS='[
  {"urls":"stun:turn.exemple.fr:3478"},
  {"urls":["turn:turn.exemple.fr:3478","turns:turn.exemple.fr:5349"],
   "username":"<horodatage>","credential":"<derive du secret>"}
]'
```

Attention : `VITE_ICE_SERVERS` est lue a la compilation et **finit dans le
binaire**. Un identifiant permanent qui y figure est un identifiant publie. Il
faut donc des identifiants temporaires, distribues a la demande — ce qui
suppose un point d'acces qui les signe, par exemple une fonction Edge Supabase.
Ce point n'existe pas aujourd'hui : c'est le vrai travail a prevoir, davantage
que l'installation de coturn.

#### Ce que cela coute

Le relais porte **tout** le media, et le vocal est en maille complete : chaque
paire de participants ouvre son propre flux. Le trafic croit donc en N×(N−1).

| Situation | Flux | Debit sur le relais |
| --- | --- | --- |
| 3 personnes, voix seule (~40 kb/s) | 6 | ~0,24 Mb/s |
| 5 personnes, voix seule | 20 | ~0,8 Mb/s |
| 5 personnes, dont un partage 1080p60 (~4 Mb/s) | 20 + 4 | ~17 Mb/s |

Un seul partage d'ecran en haute definition coute donc davantage que des heures
de conversation. Sur un serveur factures a la bande passante, c'est le poste
dominant, et il faut le dimensionner sur les partages, pas sur la voix.

#### Ce qu'on y gagne, ce qu'on y perd

**Gagne** : les participants ne voient plus l'adresse des autres. C'est la
seule facon d'y arriver sans changer d'architecture.

**Perd** : un peu de latence (un saut de plus), une facture de bande passante,
un point de panne unique — si le relais tombe, plus aucun appel n'aboutit — et
l'exploitation d'un service supplementaire.

**Ne change pas** : le chiffrement. Le relais achemine du DTLS-SRTP qu'il ne
peut pas dechiffrer. Il voit qui parle a qui, quand et combien — des
metadonnees, pas du contenu.

Une voie intermediaire existe : garder le pair-a-pair par defaut et n'offrir le
relais qu'en option, par salon ou par personne. Cela laisse le choix a chacun
entre la latence et la discretion, au prix d'un reglage de plus a comprendre.

---

## 4. Le chiffrement des messages, honnetement

### Ce qui est vrai aujourd'hui

Les messages ecrits sont chiffres **en transit** et cloisonnes par RLS, mais
stockes en clair : le service peut les lire. Le son et l'image des appels, eux,
sont chiffres entre participants et ne sont jamais stockes.

### Pourquoi un demi-chiffrement serait pire que rien

Chiffrer les messages avec une cle qui transite par le meme serveur que les
messages ne protege de rien : qui detient les deux detient le contenu. Cela
ajouterait surtout une assurance fausse, et une page publique qui la repeterait
deviendrait mensongere. L'etat actuel a au moins le merite d'etre annonce.

### Ce que couterait un vrai chiffrement de bout en bout

**A construire :**

- une paire de cles par personne, et une par appareil ;
- une distribution des cles publiques que le serveur ne puisse pas remplacer
  sans etre vu — donc une verification entre personnes, du type « numeros de
  securite » ;
- une cle par salon, distribuee a chaque membre, **et renouvelee a chaque
  entree ou sortie**, sans quoi un membre exclu continue de lire ;
- une synchronisation entre appareils, et une sauvegarde de secours : sans
  elle, perdre son telephone c'est perdre tout son historique ;
- une reecriture du chemin des pieces jointes, aujourd'hui deposees en clair.

**Ce qu'on perdrait, concretement dans ce depot :**

- **La recherche.** `messages.search_vector` est une colonne generee par
  `message_search_vector(content)`, et `search_messages()` s'appuie dessus. Sur
  du chiffre, l'index ne veut plus rien dire. Une recherche locale, appareil
  par appareil, resterait possible — sur le seul historique deja telecharge.
- **Les mentions.** Le declencheur `messages_register_mentions` lit le contenu
  au serveur, avec `regexp_matches(new.content, '@(...)')`, pour incrementer
  les compteurs. Ce declencheur ne peut pas survivre au chiffrement : il
  faudrait que le client declare lui-meme qui il mentionne — donc lui faire
  confiance sur ce point.
- **L'historique sur un nouvel appareil**, sauf a construire la sauvegarde de
  cles evoquee plus haut.
- **La moderation par le contenu.** `report_message` et `resolve_report`
  supposent qu'un moderateur puisse lire ce qui est signale. Il faudrait que le
  signalement embarque le message dechiffre par la personne qui signale.
- **Les apercus de liens et les notifications montrant le texte.**

Ce n'est pas une raison de ne pas le faire. C'est la liste de ce qu'il faut
accepter de perdre pour le faire, et elle doit etre acceptee avant d'ecrire la
premiere ligne, pas decouverte apres.

### Ce qui ameliore reellement les choses, tout de suite

Le risque concret aujourd'hui n'est pas un serveur malveillant : c'est
l'autorisation. **Quelqu'un pouvait lire les salons d'un espace dont il n'etait
pas membre** — non pas en cassant un chiffrement, mais en deplacant une ligne
de trois colonnes. C'est exactement la faille corrigee en section 2, et elle
valait, seule, davantage que n'importe quel chiffrement ajoute par-dessus.

L'ordre raisonnable est donc :

1. appliquer la migration de durcissement ;
2. se donner un moyen de verifier que les politiques RLS font ce qu'on croit —
   des tests qui tentent l'acces interdit et attendent un refus ;
3. reprendre la question du chiffrement une fois ces deux points acquis.

---

## 5. La politique de securite de contenu, et ce qu'elle porte

`src-tauri/tauri.conf.json` definit deja une CSP stricte :

```
default-src 'self';
connect-src 'self' https://*.supabase.co wss://*.supabase.co stun: turn:;
img-src 'self' data: blob: https://*.supabase.co https://*.googleusercontent.com;
media-src 'self' blob: mediastream:;
script-src 'self'
```

Elle est plus importante qu'il n'y parait, parce qu'elle est **le seul rempart
contre trois fuites d'adresse IP** :

- `avatar_url` et `banner_url` peuvent pointer n'importe ou ; sans `img-src`,
  chacun pourrait faire charger une image depuis son propre serveur et relever
  l'adresse de tous ceux qui ouvrent sa fiche ;
- `LinkPreview` affiche telle quelle toute adresse finissant par une extension
  d'image trouvee dans un message — meme mecanisme, declenche en postant un
  lien dans un salon.

La CSP bloque ces chargements. **Consequence a connaitre : dans l'application
publiee, les apercus d'images distantes et les lecteurs YouTube ou Vimeo
integres ne s'affichent pas** — `frame-src` retombe sur `default-src 'self'`.
Ces fonctions sont donc inertes hors developpement.

C'est un arbitrage defendable, mais il est implicite. Deux voies :

- **assumer** : retirer du code les apercus qui ne peuvent pas fonctionner,
  plutot que de laisser des cadres vides ;
- **assouplir** : autoriser les hotes concernes, et accepter la fuite d'adresse
  qui vient avec — ce que la page publique devrait alors dire.

Ne pas trancher revient a garder du code mort qui donne l'illusion d'une
fonction.

**A retenir surtout : si une version navigateur voit le jour, cette CSP ne la
suit pas.** Elle appartient au binaire Tauri. Il faudra la reposer en en-tetes
HTTP, faute de quoi les trois fuites ci-dessus s'ouvrent d'un coup.

---

## 6. Ce qui reste ouvert

| Sujet | Etat | Qui decide |
| --- | --- | --- |
| Migration de durcissement | Ecrite, **non appliquee** | Vous — a relire et pousser |
| Contrainte `profiles_images_forme` | `NOT VALID` | Vous — a valider apres verification |
| Relais TURN | Documente, non installe | Vous — decision d'infrastructure |
| Identifiants TURN temporaires | Non construit | Prealable a tout TURN |
| Chiffrement de bout en bout | Chiffre en section 4 | Vous — decision de produit |
| Apercus bloques par la CSP | A trancher | Vous — assumer ou assouplir |
| Tests des politiques RLS | Inexistants | Recommande avant tout le reste |
| Liens sortants dans Tauri | Aucun plugin `opener` ou `shell` : un lien externe n'a pas de chemin vers le navigateur du systeme | A corriger cote application |

Le dernier point merite un mot : tous les liens portent `target="_blank"` et
`rel="noopener noreferrer"`, mais aucune capacite Tauri ne permet d'ouvrir une
adresse dans le navigateur. Selon le comportement de la vue web, un lien ne
fait rien ou detourne la fenetre de l'application vers un site tiers, sans
barre d'adresse ni retour possible. La correction habituelle est le greffon
`opener`, avec un gestionnaire de clic qui intercepte les liens externes.
