"""Detoure un badge livre sur fond sombre.

    python outils/detourer.py entree.png src/assets/badges/pionnier.png

Options
    --taille N    cote du carre produit (256 par defaut)
    --marge N     pixels de vide autour du dessin, en pourcentage du cote (6)
    --fond R,G,B  couleur du fond, si l'estimation se trompe
    --seuil A,B   distances de bascule, sur 255 (14,140 par defaut ; la borne
                  basse est remontee toute seule si le fond est bruite)
    --principal   ne garde que le dessin, et jette ce qui flotte a cote
    --apercu F    ecrit en plus une planche avant/apres, sur damier

Pourquoi pas un simple seuil
----------------------------
Ces dessins ne s'arretent pas net : ils rayonnent. Une lueur, c'est du fond
qu'on voit a travers le dessin, et un seuil doit trancher — il la garde en bloc,
et le badge traine un halo carre, ou il la coupe, et le badge parait decoupe aux
ciseaux. Les deux se voient immediatement sur une page claire, ou le halo garde
la couleur du fond d'origine.

L'opacite est donc CONTINUE : proportionnelle a la distance entre le pixel et le
fond. La lueur devient du semi-transparent, ce qu'elle est reellement, et se
repose ensuite sur n'importe quel fond.

Deux precautions
----------------
**La couleur est desaturee du fond.** Un pixel a demi opaque a ete melange au
fond avant d'arriver : le rendre tel quel le laisserait teinte de ce fond pour
toujours. On remonte donc la couleur d'origine (`c = f + (p - f) / a`), sans quoi
un badge detoure d'un fond bleu nuit garde un voile bleu sur page blanche.

**La borne haute est volontairement loin (140 sur 255).** Basse — 64 — une lueur
un peu vive depasse la barre et devient OPAQUE : elle emporte alors la couleur
qu'elle avait une fois melangee au fond, et le badge se retrouve cercle d'un
anneau brun sur page blanche. C'est le defaut le plus visible du procede, et il
ne se voit que sur fond clair. Loin, la lueur reste a l'etat de demi-teinte,
c'est-a-dire ce qu'elle est.

Mesure, sur un badge dore a forte lueur pose sur bleu nuit puis recompose sur
blanc — luminance de la lueur, ou 255 est l'invisible :

    seuil 14,64    moyenne 169    l'anneau se voit
    seuil 14,140   moyenne 213    l'anneau ne se voit plus

Si un dessin ressort quand meme cercle, c'est cette borne qu'il faut monter.

**Le dedans n'est jamais efface.** Un badge peut contenir des zones aussi
sombres que le fond — un creux, une ombre portee, un contour noir. Juger au
pixel les effacerait et percerait le dessin. Seul ce qui TOUCHE le bord par un
chemin continu de fond est du fond ; le reste est garde, meme noir.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def _anneau(rgb: np.ndarray) -> np.ndarray:
    """Les pixels du bord, qu'on tient pour du fond."""
    bande = max(2, min(rgb.shape[0], rgb.shape[1]) // 25)
    return np.concatenate([
        rgb[:bande].reshape(-1, 3),
        rgb[-bande:].reshape(-1, 3),
        rgb[:, :bande].reshape(-1, 3),
        rgb[:, -bande:].reshape(-1, 3),
    ])


def estimer_fond(rgb: np.ndarray) -> np.ndarray:
    """La couleur dominante sur l'anneau exterieur.

    La mediane, et non la moyenne : si un morceau de dessin touche le bord, la
    moyenne se decale vers lui alors que la mediane l'ignore.
    """
    return np.median(_anneau(rgb), axis=0)


def plancher_du_bruit(rgb: np.ndarray, fond: np.ndarray, demande: float) -> float:
    """A partir de quel ecart un pixel cesse d'etre du fond.

    Une valeur fixe suppose un fond uni. Plusieurs de ces dessins arrivent sur un
    degrade, ou une vignette eclairee dans un coin : la moitie du fond s'ecarte
    alors de sa propre mediane de plus que le seuil, survit au detourage, et le
    badge garde un rectangle de fond autour de lui — bien visible des que la page
    n'est plus sombre.

    On mesure donc l'ecart REEL du bord a sa mediane et on place le plancher
    au-dessus. Le quatre-vingt-dixieme centile, et non le maximum : si un bout de
    dessin mord sur le bord, le maximum monterait jusqu'a lui et effacerait le
    badge entier.

    Le plafond a 45 est le garde-fou de ce garde-fou : au-dela, ce n'est plus un
    fond bruite qu'on mesure, c'est qu'il n'y a pas de fond a retirer.
    """
    ecarts = np.linalg.norm(_anneau(rgb) - fond, axis=1)
    return float(min(45.0, max(demande, np.percentile(ecarts, 90) * 1.6)))


def _indices(forme: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    y, x = np.mgrid[0:forme[0], 0:forme[1]]
    return y / max(forme[0] - 1, 1), x / max(forme[1] - 1, 1)


def fond_modelise(rgb: np.ndarray, plat: np.ndarray) -> np.ndarray:
    """Le fond, decrit par une surface plutot que par une couleur.

    Une couleur unique suppose un fond uniforme. Ces dessins arrivent sur autre
    chose : un degrade franc pour les uns, une lueur d'angle pour les autres. La
    moitie du fond s'ecarte alors de la mediane plus que n'importe quel seuil
    raisonnable, survit au detourage, et le badge ressort avec un rectangle de
    fond colle autour de lui — invisible sur page sombre, criant sur page claire.

    Trois modeles sont essayes, du plus simple au moins simple :

        aplat       une couleur
        plan        a + b.x + c.y            un degrade
        quadrique   + d.x2 + e.y2 + f.xy     une lueur, un coin eclaire

    Le plus complexe n'est retenu que s'il decrit le bord SENSIBLEMENT mieux
    (10 %) que celui d'avant. Sans cette condition on prendrait toujours le
    dernier, qui a plus de liberte et gagnerait toujours d'un cheveu — en
    epousant le bruit plutot que le fond.

    Ce qui rend l'exercice sur : les coefficients sont ajustes sur le BORD seul,
    et aucune de ces surfaces n'a assez de liberte pour epouser un dessin. Meme
    ajustee sur une image ou un morceau de dessin mord sur le bord, une
    quadrique reste une nappe lisse : elle ne peut pas creuser la forme du
    badge, donc elle ne peut pas l'effacer.
    """
    h, w = rgb.shape[:2]
    gy, gx = np.mgrid[0:h, 0:w]
    gy = gy / max(h - 1, 1)
    gx = gx / max(w - 1, 1)

    bande = max(2, min(h, w) // 25)
    bord = np.zeros((h, w), dtype=bool)
    bord[:bande], bord[-bande:] = True, True
    bord[:, :bande], bord[:, -bande:] = True, True

    # On ecarte le quart le plus eloigne de la mediane : c'est la que se trouve
    # un eventuel bout de dessin, et un moindre carre le suivrait.
    ecart = np.linalg.norm(rgb - plat, axis=2)[bord]
    garde = ecart <= np.percentile(ecart, 75)

    un = np.ones(h * w)
    termes = [un, gx.ravel(), gy.ravel(), gx.ravel() ** 2, gy.ravel() ** 2, gx.ravel() * gy.ravel()]

    retenu = np.broadcast_to(plat, rgb.shape).copy()
    reste = np.abs(retenu[bord][garde] - rgb[bord][garde]).mean()

    for combien in (3, 6):
        base = np.stack(termes[:combien], axis=1)
        surface = np.empty((h, w, 3))
        for c in range(3):
            coeffs, *_ = np.linalg.lstsq(
                base.reshape(h, w, combien)[bord][garde], rgb[..., c][bord][garde], rcond=None
            )
            surface[..., c] = (base @ coeffs).reshape(h, w)

        propose = np.abs(surface[bord][garde] - rgb[bord][garde]).mean()
        if propose < reste * 0.9:
            retenu, reste = surface, propose

    return retenu


def detourer(
    image: Image.Image,
    fond: np.ndarray | None = None,
    seuil: tuple[float, float] = (14.0, 140.0),
) -> Image.Image:
    rgb = np.asarray(image.convert('RGB'), dtype=np.float64)
    plat = estimer_fond(rgb) if fond is None else fond

    # Une couleur, un plan ou une quadrique selon ce que le fond demande. Voir
    # la fonction : le choix se fait sur ce qui decrit le mieux le BORD.
    fond = np.broadcast_to(plat, rgb.shape) if fond is not None else fond_modelise(rgb, plat)

    # Distance au fond, par pixel.
    ecart = np.linalg.norm(rgb - fond, axis=2)

    bas, haut = seuil
    if haut <= bas:
        raise SystemExit('--seuil veut deux valeurs croissantes, par exemple 14,140')

    # Le plancher suit le bruit du fond de CETTE image. Voir la fonction.
    bas = plancher_du_bruit(rgb, plat, bas)

    # Opacite continue entre les deux seuils : c'est ce qui garde la lueur.
    alpha = np.clip((ecart - bas) / (haut - bas), 0.0, 1.0)

    # Ce qui touche le bord par un chemin continu de fond est du fond. Le reste
    # est le dedans du dessin : garde opaque, meme sombre.
    candidat = ecart < haut
    depart = np.zeros_like(candidat)
    depart[0, :] = depart[-1, :] = True
    depart[:, 0] = depart[:, -1] = True
    depart &= candidat

    dehors = ndimage.binary_propagation(depart, mask=candidat)
    alpha = np.where(dehors, alpha, 1.0)

    # La couleur est desaturee du fond : sans cela, tout ce qui est a demi
    # opaque garde la teinte du fond d'origine.
    a = alpha[..., None]
    couleur = np.where(a > 0.004, fond + (rgb - fond) / np.maximum(a, 0.004), rgb)

    sortie = np.concatenate([np.clip(couleur, 0, 255), alpha[..., None] * 255], axis=2)
    return Image.fromarray(sortie.astype(np.uint8), 'RGBA')


def garder_le_principal(image: Image.Image, part: float = 0.06) -> Image.Image:
    """Ne garde que le dessin, et jette ce qui flotte a cote.

    Une lueur d'angle assez vive ne se distingue d'un dessin par aucun ecart de
    couleur : elle est aussi loin du fond que lui. Aucun reglage de seuil ne la
    retire — mais elle est SEPAREE du dessin, et c'est par la qu'on la prend.

    Les taches qui font moins d'une fraction de la principale s'en vont ; ce qui
    en approche reste. Un badge peut avoir des morceaux detaches qui comptent —
    etincelles, particules, satellites — et les effacer au motif qu'ils ne
    touchent pas le corps abimerait le dessin.

    Volontairement laisse en option : sur un dessin fait de plusieurs morceaux
    d'egale importance, ce nettoyage a tort.
    """
    alpha = np.asarray(image.getchannel('A'))
    taches, combien = ndimage.label(alpha > 40)
    if combien <= 1:
        return image

    aires = ndimage.sum(np.ones_like(taches), taches, range(1, combien + 1))
    gardees = {i + 1 for i, aire in enumerate(aires) if aire >= aires.max() * part}

    garde = np.isin(taches, list(gardees))
    # Le voisinage des taches gardees compte aussi : leur pourtour translucide
    # est sous le seuil de 40 et ne porte donc aucune etiquette.
    garde = ndimage.binary_dilation(garde, iterations=2) | (alpha <= 40) & ndimage.binary_dilation(garde, iterations=3)

    sortie = np.asarray(image).copy()
    sortie[..., 3] = np.where(garde, sortie[..., 3], 0)
    return Image.fromarray(sortie, 'RGBA')


def cadrer(image: Image.Image, taille: int, marge: float) -> Image.Image:
    """Recadre sur le dessin, puis pose le tout dans un carre."""
    boite = image.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if boite:
        image = image.crop(boite)

    cote = max(image.size)
    plein = max(1, int(round(cote * (1 + 2 * marge))))
    carre = Image.new('RGBA', (plein, plein), (0, 0, 0, 0))
    carre.paste(image, ((plein - image.width) // 2, (plein - image.height) // 2))
    return carre.resize((taille, taille), Image.LANCZOS)


def damier(taille: tuple[int, int], case: int = 12) -> Image.Image:
    """Un fond a carreaux, pour voir la transparence plutot que la deviner."""
    fond = Image.new('RGB', taille, (255, 255, 255))
    pixels = fond.load()
    for y in range(taille[1]):
        for x in range(taille[0]):
            if ((x // case) + (y // case)) % 2:
                pixels[x, y] = (206, 206, 210)
    return fond


def main(argv: list[str]) -> int:
    positionnels: list[str] = []
    options: dict[str, str] = {}

    i = 0
    while i < len(argv):
        if argv[i] == '--principal':
            options['principal'] = 'oui'
            i += 1
        elif argv[i].startswith('--'):
            if i + 1 >= len(argv):
                raise SystemExit(f'{argv[i]} attend une valeur')
            options[argv[i][2:]] = argv[i + 1]
            i += 2
        else:
            positionnels.append(argv[i])
            i += 1

    if len(positionnels) != 2:
        raise SystemExit(__doc__)

    entree, sortie = Path(positionnels[0]), Path(positionnels[1])
    taille = int(options.get('taille', 256))
    marge = float(options.get('marge', 6)) / 100
    fond = None
    if 'fond' in options:
        fond = np.array([float(v) for v in options['fond'].split(',')])
    seuil = (14.0, 140.0)
    if 'seuil' in options:
        bas, haut = options['seuil'].split(',')
        seuil = (float(bas), float(haut))

    source = Image.open(entree)
    detoure = detourer(source, fond, seuil)
    if 'principal' in options:
        detoure = garder_le_principal(detoure)
    decoupe = cadrer(detoure, taille, marge)

    sortie.parent.mkdir(parents=True, exist_ok=True)
    decoupe.save(sortie)

    couverture = np.asarray(decoupe.getchannel('A'), dtype=np.float64).mean() / 255
    print(f'{entree.name} -> {sortie}  ({taille}x{taille}, {couverture:.0%} d\'encre)')

    if 'apercu' in options:
        avant = source.convert('RGB')
        avant.thumbnail((taille, taille), Image.LANCZOS)
        planche = damier((taille * 2 + 24, taille))
        planche.paste(avant, (0, (taille - avant.height) // 2))
        planche.paste(decoupe, (taille + 24, 0), decoupe)
        planche.save(options['apercu'])
        print(f'apercu -> {options["apercu"]}')

    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
